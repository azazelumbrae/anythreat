// Red loading spinner: a rotating dot-square + a hacking-related word, shown
// on the current terminal line while the model is "thinking". ANSI only, no deps.
// Also renders a live input buffer on the same line:  ⠋ Hacking...   ❯ typed text
import { c } from "./render.mjs";

// Braille dot-square that spins.
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ~17 hacking-flavoured words that cycle while loading.
const WORDS = [
  "Hacking", "Checking", "Scanning", "Probing", "Enumerating", "Fuzzing",
  "Sniffing", "Bypassing", "Injecting", "Cracking", "Pivoting", "Reconning",
  "Mapping", "Fingerprinting", "Exploiting", "Escalating", "Tunneling",
];

const TICK_MS = 80;        // frame speed
const FRAMES_PER_WORD = 14; // ~1.1s per word

let timer = null;
let frame = 0;
let inputBuf = "";
let hintText = "";

export function setInputBuf(s) { inputBuf = s; if (timer) paint(); }
export function setInputHint(s) { hintText = s; }

function clearLine() {
  process.stdout.write("\r\x1b[2K");
}

function paint() {
  if (!process.stdout.isTTY) return;
  const glyph = FRAMES[frame % FRAMES.length];
  const word = WORDS[Math.floor(frame / FRAMES_PER_WORD) % WORDS.length];
  const dots = ".".repeat((Math.floor(frame / 5) % 3) + 1);
  let line = c.red(`  ${glyph} ${word}${dots}`);
  if (inputBuf) line += c.gray("   ") + c.red("❯ ") + inputBuf;
  else if (hintText) line += c.gray("   " + hintText);
  process.stdout.write("\r\x1b[2K" + line);
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

export function stopSpinner() {
  if (!timer) return; // nothing running -> don't touch the current line
  clearInterval(timer);
  timer = null;
  if (process.stdout.isTTY) clearLine();
}

export function pauseSpinner() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  if (process.stdout.isTTY) clearLine();
}
export function resumeSpinner() {
  if (timer || !process.stdout.isTTY) return;
  paint();
  timer = setInterval(paint, TICK_MS);
  if (timer.unref) timer.unref();
}
