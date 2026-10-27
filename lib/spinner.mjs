// Bottom "block" renderer: an optional busy spinner line on top, and a full-width
// input box underneath that grows in height with the message. Redrawn in place (no
// flicker). ANSI only, no deps.
//
// The interval stays alive while the input box is shown so typed text redraws live,
// but the "⠋ Hacking..." line only renders while `busy` is true (i.e. the model is
// actually thinking). This stops the spinner from spinning forever while idle.
import { c } from "./render.mjs";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WORDS = [
  "Hacking", "Checking", "Scanning", "Probing", "Enumerating", "Fuzzing",
  "Sniffing", "Bypassing", "Injecting", "Cracking", "Pivoting", "Reconning",
  "Mapping", "Fingerprinting", "Exploiting", "Escalating", "Tunneling",
];
const TICK_MS = 80;
const FRAMES_PER_WORD = 14;

let timer = null;
let frame = 0;
let inputBuf = "";
let showBox = false;
let busy = false;
let drawn = 0; // how many lines are currently drawn

export function setInputBuf(s) { inputBuf = s; if (timer) paint(); }
export function enableInputBox(on) { showBox = !!on; if (timer) paint(); }
export function hasInputBox() { return showBox; }
export function setBusy(on) { busy = !!on; if (timer) paint(); }

function cols() { return Number(process.env.AT_COLS) || process.stdout.columns || 80; }

// Word-wrap a single line into chunks <= w (visible width).
function wrap(s, w) {
  if (w < 10) w = 10;
  const out = [];
  for (const para of String(s).split("\n")) {
    if (!para) { out.push(""); continue; }
    let cur = "";
    for (const word of para.split(/(\s+)/)) {
      if ((cur + word).length > w && cur) { out.push(cur); cur = word.trimStart(); }
      else cur += word;
    }
    out.push(cur);
  }
  return out.length ? out : [""];
}

function buildLines() {
  const W = Math.max(30, cols() - 4);
  const lines = [];
  if (busy) {
    const glyph = FRAMES[frame % FRAMES.length];
    const word = WORDS[Math.floor(frame / FRAMES_PER_WORD) % WORDS.length];
    const dots = ".".repeat((Math.floor(frame / 5) % 3) + 1);
    lines.push(c.red(`  ${glyph} ${word}${dots}`));
  }
  if (showBox) {
    lines.push(c.gray("  ╭" + "─".repeat(W) + "╮"));
    const wrapped = wrap(inputBuf ? "❯ " + inputBuf : "❯ ", W - 2);
    for (const w of wrapped) {
      const pad = Math.max(0, W - 2 - w.length);
      lines.push(c.gray("  │ ") + c.red(w) + " ".repeat(pad) + c.gray(" │"));
    }
    lines.push(c.gray("  ╰" + "─".repeat(W) + "╯"));
  }
  return lines;
}

function paint() {
  if (!process.stdout.isTTY) return;
  let out = "";
  if (drawn > 0) out += `\x1b[${drawn}A`; // move cursor up to block start
  out += "\x1b[J";                        // clear from cursor to end of screen
  const lines = buildLines();
  out += lines.join("\n") + "\n";
  process.stdout.write(out);
  drawn = lines.length;
  frame++;
}

export function startSpinner() {
  if (!process.stdout.isTTY) return;
  frame = 0;
  paint();
  if (timer) clearInterval(timer);
  timer = setInterval(paint, TICK_MS);
  if (timer.unref) timer.unref();
}

function eraseBlock() {
  if (!process.stdout.isTTY || drawn <= 0) { drawn = 0; return; }
  process.stdout.write(`\x1b[${drawn}A\x1b[J`);
  drawn = 0;
}

export function stopSpinner() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  eraseBlock();
}

export function pauseSpinner() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  eraseBlock();
}
export function resumeSpinner() {
  if (timer || !process.stdout.isTTY) return;
  paint();
  timer = setInterval(paint, TICK_MS);
  if (timer.unref) timer.unref();
}
