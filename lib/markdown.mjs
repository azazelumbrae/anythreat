// Zero-dependency Markdown → ANSI renderer with consistent alignment.
// Every rendered line gets a stable left margin; wrapped continuation lines are
// aligned to their first line (fixes the "second line starts further left" bug).
import { c } from "./render.mjs";

export const ANSI_RE = /\x1b\[[0-9;]*m/g;

// Whether we may emit ANSI color codes at all.
const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR && !globalThis.__AT_NO_COLOR;
const RESET = colorEnabled ? "\x1b[0m" : "";

// Visible length (ANSI codes stripped).
export function vlen(s) {
  return String(s ?? "").replace(ANSI_RE, "").length;
}

// Inline markdown → ANSI (bold, italic, strikethrough, inline code, links).
// Line-level constructs (headings, lists, blockquotes, fences, rules) are handled
// by renderMarkdownLines.
export function mdToAnsi(s) {
  let t = String(s ?? "");
  t = t.replace(/`([^`\n]+)`/g, (_, x) => c.cyan(x));                              // `code`
  t = t.replace(/\*\*([^*\n]+)\*\*/g, (_, x) => c.bold(x));                        // **bold**
  t = t.replace(/__([^_\n]+)__/g, (_, x) => c.bold(x));                            // __bold__
  t = t.replace(/~~([^~\n]+)~~/g, (_, x) => c.strike(x));                          // ~~strike~~
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, p, x) => p + c.italic(x));     // *italic*
  t = t.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, (_, p, x) => p + c.italic(x));        // _italic_
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, x, u) => c.underline(x) + c.gray(" (" + u + ")")); // [link](url)
  return t;
}

function tokenize(s) {
  const parts = [];
  let idx = 0, m;
  ANSI_RE.lastIndex = 0;
  while ((m = ANSI_RE.exec(s))) {
    if (m.index > idx) parts.push({ t: s.slice(idx, m.index) });
    parts.push({ a: m[0] });
    idx = ANSI_RE.lastIndex;
  }
  if (idx < s.length) parts.push({ t: s.slice(idx) });
  return parts;
}

// Word-wrap an ANSI string to visible width `w`. Returns lines with no outer gutter.
function wrapAnsi(s, w) {
  if (w < 10) w = 10;
  const lines = [];
  let cur = "", curLen = 0;
  const flush = () => {
    lines.push(cur.replace(/\s+$/, "") + RESET);
    cur = ""; curLen = 0;
  };
  for (const p of tokenize(s)) {
    if (p.a) { cur += p.a; continue; }
    for (const word of p.t.split(/(\s+)/)) {
      if (word === "") continue;
      const wl = vlen(word);
      const isSpace = /^\s+$/.test(word);
      if (!isSpace && curLen + wl > w && curLen > 0) flush();
      if (!cur && isSpace) continue; // drop leading whitespace on a fresh line
      cur += word;
      curLen += wl;
    }
  }
  if (cur.replace(/\s+$/, "")) flush();
  return lines.length ? lines : [""];
}

const MARGIN = "  ";

// Render a markdown string to an array of ANSI lines. `W` is the usable width.
export function renderMarkdownLines(text, W) {
  const out = [];
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let inCode = false;
  for (const raw of lines) {
    // fenced code block toggling (``` or ```lang)
    const fence = raw.match(/^\s{0,3}```/);
    if (fence) { inCode = !inCode; continue; }
    if (inCode) {
      const w = W - vlen(MARGIN) - 2;
      wrapAnsi(raw, Math.max(10, w)).forEach((l) => out.push(MARGIN + "  " + c.gray(l)));
      continue;
    }
    if (/^\s*$/.test(raw)) { out.push(""); continue; }
    // horizontal rule
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(raw)) {
      out.push(MARGIN + c.gray("─".repeat(Math.max(10, W - vlen(MARGIN)))));
      continue;
    }
    // heading
    const h = raw.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      const t = mdToAnsi(h[2]);
      out.push("");
      out.push(MARGIN + c.bold(c.cyan(t)));
      if (h[1].length <= 2) out.push(MARGIN + c.gray("─".repeat(Math.min(Math.max(10, W - vlen(MARGIN)), vlen(t) + 2))));
      continue;
    }
    // blockquote
    const bq = raw.match(/^\s*>\s?(.*)$/);
    if (bq) {
      const w = W - vlen(MARGIN) - 2;
      wrapAnsi(mdToAnsi(bq[1]), Math.max(10, w)).forEach((l) => out.push(MARGIN + c.gray("│ ") + l));
      continue;
    }
    // bullet / numbered list item
    const li = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      const indent = li[1];
      const isNum = /^\d+\.$/.test(li[2]);
      const bullet = isNum ? mdToAnsi(li[2]) + " " : c.red("• ");
      const contPad = " ".repeat(vlen(bullet)); // continuation aligns under the text
      const w = W - vlen(MARGIN) - vlen(indent) - vlen(bullet);
      wrapAnsi(mdToAnsi(li[3]), Math.max(10, w)).forEach((l, i) =>
        out.push(MARGIN + indent + (i === 0 ? bullet : contPad) + l)
      );
      continue;
    }
    // plain paragraph
    const w = W - vlen(MARGIN);
    wrapAnsi(mdToAnsi(raw), Math.max(10, w)).forEach((l) => out.push(MARGIN + l));
  }
  return out;
}

export function renderMarkdown(text, W) {
  const cols = Number(process.env.AT_COLS) || process.stdout.columns || 100;
  const width = W || Math.max(60, cols - 4);
  for (const l of renderMarkdownLines(text, width)) console.log(l);
}

// Wrap raw/log text (command output, findings) with a gutter prefix on every line.
// Returns an array of lines (does NOT print).
export function renderLog(text, { width, gutter = "  │   ", maxLen = 4000 } = {}) {
  const cols = Number(process.env.AT_COLS) || process.stdout.columns || 100;
  const W = width || Math.max(60, cols - 4);
  const s = String(text ?? "");
  const clipped = s.length > maxLen ? "…\n" + s.slice(-maxLen) : s;
  const out = [];
  for (const para of clipped.split("\n")) {
    if (para === "") { out.push(gutter); continue; }
    wrapAnsi(para, Math.max(10, W - vlen(gutter))).forEach((l) => out.push(gutter + l));
  }
  return out;
}
