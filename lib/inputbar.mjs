// Live input bar during an agent run. Captures keystrokes in raw mode, echoes them
// on the spinner line ( ❯ ... ), and queues submitted lines. The agent drains the
// queue at each step boundary and injects them into the model.
import readline from "node:readline";
import { setInputBuf, setInputHint } from "./spinner.mjs";

let active = false;
let buf = "";
const queue = [];

function onKey(str, key) {
  if (!active) return;
  if (key && key.ctrl && key.name === "c") {
    // let the sigint handler pause the agent
    process.kill(process.pid, "SIGINT");
    return;
  }
  if (key && (key.name === "return" || key.name === "enter")) {
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
  if (key && key.ctrl && key.name === "u") { buf = ""; setInputBuf(""); return; }
  if (str && !key?.ctrl && !key?.meta && str >= " ") {
    buf += str;
    setInputBuf(buf);
  }
}

export function startInputBar() {
  if (!process.stdin.isTTY || active) return;
  active = true;
  buf = "";
  setInputHint("escribí para inyectar al modelo · Enter = enviar · Ctrl-C = pausar");
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
  setInputBuf("");
  setInputHint("");
}

// Drain one queued line (called by userInput at each step). Returns string | null.
export function takeLine() {
  return queue.length ? queue.shift() : null;
}
