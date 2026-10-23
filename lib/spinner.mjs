// Red loading spinner: a rotating dot-square + a hacking-related word, shown
// on the current terminal line while the model is "thinking". ANSI only, no deps.
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

function clearLine() {
  process.stdout.write("\r\x1b[2K");
}

function paint() {
  const glyph = FRAMES[frame % FRAMES.length];
  const word = WORDS[Math.floor(frame / FRAMES_PER_WORD) % WORDS.length];
  const dots = ".".repeat((Math.floor(frame / 5) % 3) + 1);
  process.stdout.write("\r\x1b[2K" + c.red(`  ${glyph} ${word}${dots}`));
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
  if (timer) { clearInterval(timer); timer = null; }
  if (process.stdout.isTTY) clearLine();
}
