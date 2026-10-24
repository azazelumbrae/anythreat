// Live input during an agent run: captures keystrokes in raw mode and feeds them to
// the bottom block (spinner line + full-width input box). Submitted lines are queued
// and the agent drains them at each step boundary.
import readline from "node:readline";
import { setInputBuf, enableInputBox } from "./spinner.mjs";

let active = false;
let buf = "";
const queue = [];

function onKey(str, key) {
  if (!active) return;
  if (key && key.ctrl && key.name === "c") {
    process.kill(process.pid, "SIGINT");
    return;
  }
  if (key && (key.name === "return" || key.name === "enter")) {
    // Shift+Enter / Alt+Enter -> newline (multi-line); plain Enter -> submit
    if (key.shift || key.alt) { buf += "\n"; setInputBuf(buf); return; }
    const line = buf.trim();
    buf = "";
    setInputBuf("");
    if (line) queue.push(line);
    return;
  }
  if (key && (key.name === "backspace" || key.name === "delete")) {
    buf = buf.slice(0, -1);
    setInputBuf(buf);
    return;
  }
  if (key && key.ctrl && key.name === "u") { buf = ""; setInputBuf(buf); return; }
  if (str && !key?.ctrl && !key?.meta && (str >= " " || str === "\n")) {
    buf += str;
    setInputBuf(buf);
  }
}

export function startInputBar() {
  if (!process.stdin.isTTY || active) return;
  active = true;
  buf = "";
  enableInputBox(true);
  readline.emitKeypressEvents(process.stdin);
  try { process.stdin.setRawMode(true); } catch {}
  process.stdin.resume();
  process.stdin.on("keypress", onKey);
}

export function stopInputBar() {
  if (!active) return;
  active = false;
  process.stdin.removeListener("keypress", onKey);
  try { process.stdin.setRawMode(false); } catch {}
  enableInputBox(false);
  setInputBuf("");
}

export function takeLine() {
  return queue.length ? queue.shift() : null;
}
