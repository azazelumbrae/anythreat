// Config discovery: flags > process.env > .env file.
import fs from "node:fs";
import path from "node:path";
import { resolvePreset } from "./presets.mjs";

function parseEnvFile(file) {
  const out = {};
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// Load .env from cwd and from the project root (dir of this file's parent).
function loadDotEnv() {
  const from = [process.cwd(), path.resolve(new URL("..", import.meta.url).pathname)];
  const merged = {};
  for (const dir of from) {
    const env = parseEnvFile(path.join(dir, ".env"));
    Object.assign(merged, env);
  }
  return merged;
}

export function resolveConfig(flags = {}) {
  const dot = loadDotEnv();
  const env = process.env;
  const pick = (flag, ...names) => {
    if (flags[flag] !== undefined && flags[flag] !== "") return String(flags[flag]);
    for (const n of names) {
      if (env[n] !== undefined && env[n] !== "") return env[n];
      if (dot[n] !== undefined && dot[n] !== "") return dot[n];
    }
    return "";
  };
  const temperature = parseFloat(pick("temp", "AT_TEMPERATURE", "OPENAI_TEMPERATURE"));

  // Preset (flash / pro / pro-nt ...) -> model + thinking. Explicit flags win.
  // DEFAULT = flash (sin thinking) unless the user explicitly picks otherwise.
  const presetFlags = { preset: pick("preset", "AT_PRESET"), model: pick("model", "AT_MODEL", "OPENAI_MODEL"), thinking: flags.thinking || pick("thinking", "AT_THINKING"), reasoning: flags.reasoning || pick("reasoning", "AT_REASONING") };
  const resolved = resolvePreset(presetFlags) || {};
  // No preset and no explicit model -> deterministic flash (no thinking).
  const useDefaultFlash = !presetFlags.preset && !presetFlags.model;
  const defaultFlash = useDefaultFlash ? resolvePreset({ preset: "flash" }) : {};

  return {
    baseUrl: (pick("base", "AT_BASE_URL", "OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""),
    apiKey: pick("key", "AT_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "LLM_API_KEY"),
    model: resolved.model || presetFlags.model || defaultFlash.model || "deepseek-flash",
    temperature: Number.isFinite(temperature) ? temperature : 0.4,
    thinking: resolved.thinking || defaultFlash.thinking || undefined,   // 'enabled' | 'disabled' | undefined
    reasoning: resolved.reasoning || defaultFlash.reasoning || undefined, // 'low'|'medium'|'high' | undefined
    preset: presetFlags.preset || (useDefaultFlash ? "flash" : null),
  };
}

export function hasCreds(cfg) {
  return Boolean(cfg.apiKey);
}
