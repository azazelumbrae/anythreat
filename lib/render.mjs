// Minimal ANSI rendering helpers. No dependencies.

const enabled = process.stdout.isTTY && !process.env.NO_COLOR && !globalThis.__AT_NO_COLOR;

function wrap(code, s) {
  if (!enabled) return String(s);
  return `\x1b[${code}m${s}\x1b[0m`;
}

export const c = {
  reset: (s) => wrap(0, s),
  bold: (s) => wrap(1, s),
  dim: (s) => wrap(2, s),
  italic: (s) => wrap(3, s),
  underline: (s) => wrap(4, s),
  strike: (s) => wrap(9, s),
  red: (s) => wrap(31, s),
  green: (s) => wrap(32, s),
  yellow: (s) => wrap(33, s),
  blue: (s) => wrap(34, s),
  magenta: (s) => wrap(35, s),
  cyan: (s) => wrap(36, s),
  white: (s) => wrap(37, s),
  gray: (s) => wrap(90, s),
};

// Level color by power tier.
export function levelColor(level) {
  switch (level) {
    case "Suave": return c.cyan;
    case "Medio": return c.green;
    case "Fuerte": return c.yellow;
    case "Pesado": return c.red;
    default: return (s) => s;
  }
}

export function bar(pct, width = 20) {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return c.red("█".repeat(n)) + c.gray("░".repeat(width - n));
}
