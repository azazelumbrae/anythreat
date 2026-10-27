#!/usr/bin/env node
// Any Threat — ranked jailbreak frameworks for any AI API.
// Launch: `at` (interactive) | `at --list` | `at --run crescendo --task "..."`
import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { loadFrameworks, byId, nextStronger, BASE_SYSTEM, fillTemplate, contextBlock } from "./lib/frameworks.mjs";
import { Client } from "./lib/client.mjs";
import { resolveConfig, hasCreds } from "./lib/config.mjs";
import { c, levelColor, bar } from "./lib/render.mjs";
import { renderMarkdown, renderMarkdownLines, renderLog, vlen } from "./lib/markdown.mjs";
import { startSpinner, stopSpinner, pauseSpinner, resumeSpinner, setBusy } from "./lib/spinner.mjs";
import { startInputBar, stopInputBar, takeLine } from "./lib/inputbar.mjs";
import { cleanupSync } from "./lib/exec.mjs";
import { listSessions, createSession, loadSession, saveSession } from "./lib/sessions.mjs";

const VERSION = "0.1.0";
const isTTY = process.stdout.isTTY && process.stdin.isTTY;

// Red input prompt with a dedicated indent.
function promptLine(label, hint = "") {
  return "  " + c.red("❯ ") + c.bold(label) + (hint ? " " + c.gray(hint) : "") + " ";
}
// Draws a framed input field (top + left + bottom) and returns the answer.
async function boxedInput(ask, label, hint = "") {
  const cols = Number(process.env.AT_COLS) || process.stdout.columns || 80;
  const w = Math.max(40, Math.min(cols - 4, 110));
  const bar = c.gray("  ╭" + "─".repeat(w));
  console.log("");
  console.log(bar);
  const ans = await ask("  " + c.gray("│ ") + c.red("❯ ") + c.bold(label) + (hint ? " " + c.gray(hint) : "") + " ");
  console.log(c.gray("  ╰" + "─".repeat(w)) );
  return ans;
}

// Multiple-choice prompt. options = [{k,label}]. Returns array of chosen labels.
async function askChoice(ask, title, options, { multi = true, hint = "" } = {}) {
  console.log("\n  " + c.bold(title) + (hint ? " " + c.gray(hint) : ""));
  options.forEach((o, i) => console.log(`   ${c.cyan(String(i + 1).padStart(2))}. ${o.label}`));
  const ans = await ask("  " + c.red("❯ ") + c.gray(multi ? "números separados por espacio (Enter=ninguno): " : "número (Enter=ninguno): "));
  const picks = ans.split(/[\s,]+/).map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= options.length);
  const chosen = picks.map((n) => options[n - 1].label);
  return multi ? chosen : chosen.slice(0, 1);
}

// Punto 1: preguntas dinámicas ligadas al objetivo, para cubrir lo que NO se dijo.
async function askClarifications(ask, vars) {
  console.log("\n  " + c.bold(c.magenta("◈ Aclaraciones")) + c.gray("  — lo que no dijiste pero importa (Enter = saltar)"));
  const q = [
    ["¿Tenés algún acceso o credencial al target? (usuario/clave, token, VPN, sesión, insider)", "access"],
    ["¿Hay pistas o indicios? (emails, nombres de usuario, versiones, endpoints, repo, subdominios)", "clues"],
    ["¿Algún alcance/limitación de scope? (solo tal rango, no tocar X, ventana horaria, rate-limit)", "scope"],
    ["¿Necesitás deep research previo? (CVE/vulns del stack, OSINT del dueño, filtraciones, historial)", "research"],
  ];
  const notes = [];
  for (const [label, key] of q) {
    const ans = (await ask("  " + c.red("❯ ") + c.bold(label) + " " + c.gray("→ "))).trim();
    if (ans) notes.push(`${key}: ${ans}`);
  }
  vars.recon_notes = notes.join("\n");
  vars._clarified = true;
}

// Punto 2: cómo querés que actúe (estilo de operación).
async function askOpStyle(ask, vars) {
  const sel = {};
  sel.pace = await askChoice(ask, "⏱  Horizonte de la operación", [
    { label: "Corto plazo — golpe rápido, un vector" },
    { label: "Largo plazo — persistencia, múltiples vectores, sigilo" },
  ], { multi: false });
  sel.noise = await askChoice(ask, "🔊 Nivel de ruido", [
    { label: "Silencioso — bajo perfil, evadir detección/IDS" },
    { label: "Ruidoso — velocidad sobre sigilo" },
  ], { multi: false });
  sel.anon = await askChoice(ask, "🕵️  Anonimato", [
    { label: "Anónimo — todo por Tor / rotación de identidad" },
    { label: "Normal — sin Tor" },
  ], { multi: false });
  sel.style = await askChoice(ask, "🎭 Estilo / ética operativa", [
    { label: "Profesional — reporte claro, no destructivo" },
    { label: "Agresivo — máximo impacto / explotación profunda" },
    { label: "Sigiloso — solo lo necesario, sin dejar rastro" },
    { label: "Bug-bounty — PoC mínima + impacto demostrable" },
  ], { multi: true });
  sel.ethics = await askChoice(ask, "⛔ Límites duros", [
    { label: "No destructivo (nada de drop/borrar/DoS)" },
    { label: "Sin exfiltración de datos reales" },
    { label: "Sin DoS / stress / flooding" },
    { label: "Sin tocar producción / usuarios reales" },
  ], { multi: true });
  const lines = [];
  if (sel.pace.length) lines.push("pace: " + sel.pace[0]);
  if (sel.noise.length) lines.push("noise: " + sel.noise[0]);
  if (sel.anon.length) lines.push("anon: " + sel.anon[0]);
  if (sel.style.length) lines.push("style: " + sel.style.join("; "));
  if (sel.ethics.length) lines.push("hard limits: " + sel.ethics.join("; "));
  vars.op_style = lines.join("\n");
  if (sel.anon.length && /Anónimo/.test(sel.anon[0])) vars.preferAnon = true;
  vars._styled = true;
}

// SIGINT coordination: during an interactive agent run, Ctrl-C sets
// `wantInterrupt` (pause + inject prompt) instead of exiting.
let wantInterrupt = false;
let sigintHandler = () => { console.log(c.gray("\n  (salido)")); process.exit(0); };

// ---------- arg parsing (no deps) ----------
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const next = (i, name, arr = true) => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith("--") && !arr)) {
      if (v === undefined) throw new Error(`Falta valor para ${name}`);
      flags[name] = true;
    } else {
      flags[name] = v;
      return 1;
    }
    return 0;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h": case "--help": flags.help = true; break;
      case "-l": case "--list": flags.list = true; break;
      case "-r": case "--run": i += next(i, "run"); break;
      case "-t": case "--task": i += next(i, "task"); break;
      case "-T": case "--target": i += next(i, "target"); break;
      case "-R": case "--role": i += next(i, "role"); break;
      case "--constraints": i += next(i, "constraints"); break;
      case "-s": case "--shot": case "--single": flags.shot = true; break;
      case "-x": case "--exec": case "--agent": flags.exec = true; break;
      case "--cwd": i += next(i, "cwd"); break;
      case "--timeout": i += next(i, "timeout"); break;
      case "--max-iters": i += next(i, "maxIters"); break;
      case "-p": case "--preset": i += next(i, "preset"); break;
      case "--profile": i += next(i, "profile"); break;
      case "--thinking": i += next(i, "thinking"); break;
      case "--reasoning": i += next(i, "reasoning"); break;
      case "-d": case "--dry": flags.dry = true; break;
      case "-j": case "--json": flags.json = true; break;
      case "--base": i += next(i, "base"); break;
      case "--key": i += next(i, "key"); break;
      case "--model": i += next(i, "model"); break;
      case "--temp": i += next(i, "temp"); break;
      case "--system": i += next(i, "system"); break;
      case "--no-color": flags.noColor = true; break;
      case "-v": case "--version": flags.version = true; break;
      default:
        if (a.startsWith("-")) throw new Error(`Flag desconocida: ${a} (ver --help)`);
        positional.push(a);
    }
  }
  return { flags, positional };
}

function help() {
  console.log(`${c.bold("AT — Any Threat")} v${VERSION}
Jailbreak frameworks ranked (suave → fuerte) para CUALQUIER API de IA.

${c.bold("Uso")}
  ${c.cyan("at")}                          Menú interactivo
  ${c.cyan("at --list")}                  Listar frameworks por potencia
  ${c.cyan("at --run <id> --task \"...\"")} Ejecutar uno sin menú (AGENTE con internet; -s para chat)

${c.bold("Opciones")}
  -t, --task <t>       Tu objetivo (ej: "pentest https://x y explota el SQLi")
  -T, --target <x>     Target específico (opcional)
  -R, --role <r>       Rol/persona que interpretas (opcional)
      --constraints <c>  Restricciones / qué NO hacer (se respeta en el agente)
  -s, --shot           Single-shot (1 mensaje) en vez de multi-turno
  -x, --exec           EJECUTA de verdad: le da un shell al modelo y corre el
                       objetivo paso a paso (recon→exploit→verifica) hasta FINAL:
      --cwd <dir>      Dir de trabajo del EXEC (def: un dir temporal aislado)
      --timeout <s>    Timeout por comando (def: 60s)
      --max-iters <n>  Paso máx. del loop agéntico (def: 500; sin tope práctico)
  -p, --preset <n>     Preset de modelo (def: flash): flash | pro | pro-nt | flash-nt
      --profile <p>    Perfil: offensive (def) | defensive (blue team) | anon (Tor)
      --thinking <m>   'enabled' | 'disabled' (sobre-escrIBE el thinking del preset)
      --reasoning <m>  'low' | 'medium' | 'high' (reasoning_effort)
  -d, --dry            Mostrar los mensajes compuestos sin llamar a la API
  -j, --json           Volcar los mensajes compuestos como JSON
      --base <url>     Base URL (OpenAI-compatible). Def: https://api.openai.com/v1
      --key <k>        API key        Def: $AT_API_KEY / $OPENAI_API_KEY / .env
      --model <m>      Modelo         Def: $AT_MODEL / (preset)
      --temp <n>       Temperatura    Def: 0.4

${c.bold("Presets (DeepSeek)")}  — default: ${c.bold("flash")} (sin thinking)
  flash     deepseek-flash   sin thinking (rápido)   ← DEFAULT
  flash-nt  deepseek-flash   sin thinking
  pro       deepseek-v4-pro  con thinking (más fuerte)
  pro-nt    deepseek-v4-pro  sin thinking
      --system <text>  Reemplaza el system prompt base
      --no-color       Sin color
  -l, --list           Listar
  -h, --help           Esta ayuda

${c.bold("Arsenal del agente (modo -x)")} — 3 pilares (instalá con tools/setup.sh)
  ${c.bold("Ataque:")}   nmap · sqlmap · ffuf · nuclei · gobuster · wfuzz · hydra · john · hashcat · subfinder · amass · paramspider · evilwaf · browse · captcha
  ${c.bold("Defensa:")}  harden-audit · malware-scan · ioc-scan · forensics · pcap-analyze · rootkit-check · waf-fingerprint
  ${c.bold("Anonimato:")} anon · anon-curl · opsec-check · stripmeta · encrypt · decrypt · proxychains4 · tor
  ${c.bold("Internet:")} websearch · webfetch · browse

${c.bold("Config")}  Flags > env > .env  (crea anythreat/.env)

${c.bold("Placeholders")} en cada framework: {{TASK}} {{TARGET}} {{ROLE}} {{PREV_REPLY}}`);
}

// ---------- logo + menu ----------
const LOGO_LINES = [
  "  ▄████████ ███▄▄▄▄   ▄██   ▄            ███        ▄█    █▄       ▄████████    ▄████████    ▄████████     ███",
  "  ███    ███ ███▀▀▀██▄ ███   ██▄      ▀█████████▄   ███    ███     ███    ███   ███    ███   ███    ███ ▀█████████▄",
  "  ███    ███ ███   ███ ███▄▄▄███         ▀███▀▀██   ███    ███     ███    ███   ███    █▀    ███    ███    ▀███▀▀██",
  "  ███    ███ ███   ███ ▀▀▀▀▀▀███          ███   ▀  ▄███▄▄▄▄███▄▄  ▄███▄▄▄▄██▀  ▄███▄▄▄       ███    ███     ███   ▀",
  "▀███████████ ███   ███ ▄██   ███          ███     ▀▀███▀▀▀▀███▀  ▀▀███▀▀▀▀▀   ▀▀███▀▀▀     ▀███████████     ███",
  "  ███    ███ ███   ███ ███   ███          ███       ███    ███   ▀███████████   ███    █▄    ███    ███     ███",
  "  ███    ███ ███   ███ ███   ███          ███       ███    ███     ███    ███   ███    ███   ███    ███     ███",
  "  ███    █▀   ▀█   █▀   ▀█████▀          ▄████▀     ███    █▀      ███    ███   ██████████   ███    █▀     ▄████▀",
  "                                                                   ███    ███",
];
function printLogo() {
  console.log(c.bold(c.red(LOGO_LINES.map((l) => l.trimEnd()).join("\n"))));
  console.log(c.gray(`  v${VERSION}  ·  jailbreak frameworks ranked (suave→fuerte)  ·  cualquier API de IA\n`));
}
function modelTag(cfg) {
  return c.cyan(cfg.model) + (cfg.preset ? c.gray(`  (${cfg.preset}${cfg.thinking ? " · " + cfg.thinking : ""})`) : "");
}
function printMenu(cfg) {
  const maxLen = Math.max(...loadFrameworks().map((f) => f.name.length));
  console.log(c.bold("  MODELO ") + c.gray(`${modelTag(cfg)}  ·  ${cfg.baseUrl}`));
  console.log(c.gray("  Elige un framework (número). Si se resiste, salta al siguiente más fuerte."));
  console.log();
  let last = null;
  for (const f of loadFrameworks()) {
    if (f.level !== last) {
      last = f.level;
      console.log("  " + levelColor(f.level)(c.bold(f.level.padEnd(7))) + c.gray(`  ${"■".repeat(f.order)}`));
    }
    console.log(`   ${c.bold(String(f.order).padStart(2))}. ${f.name.padEnd(maxLen)}  ${c.gray(f.tagline || "")}`);
  }
  console.log();
}

// ---------- run ----------
function printTurn(evt) {
  if (evt.type === "turn") {
    process.stdout.write(`\n${c.bold(c.yellow(`  ▸ [${evt.index + 1}/${evt.total}] ${evt.label}`))}  `);
    const first = (evt.userText || "").split("\n")[0].slice(0, 100);
    process.stdout.write(c.gray(first) + (evt.userText && evt.userText.length > 100 ? c.gray("…") : "") + "\n");
  }
}
function printReply(evt) {
  console.log(`\n${c.bold(c.green("  ◂ respuesta"))}`);
  renderMarkdown(evt.reply || "");
}
function indent(s, pad) { return String(s).split("\n").map((l) => pad + l).join("\n"); }
function stripExecBlock(s) { return String(s || "").replace(/```exec[^\n]*\n[\s\S]*?```/gi, "").trim(); }
function clip(s, n = 400) { s = String(s || "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; }
// Prose of an assistant reply, minus exec blocks and the trailing `FINAL:` content
// (both get their own dedicated rendering). Returns "" for plan-ready turns.
function replyProse(reply) {
  const s = stripExecBlock(reply);
  if (/^\s*PLAN\s*READY\s*:?/i.test(s)) return "";
  return s.replace(/FINAL\s*:[\s\S]*$/i, "").trim();
}

// #3: cache de hallazgos — el agente apenda a findings.md; acá lo leemos y contamos.
let agentWorkdir = null;
function cachedFindings() {
  if (!agentWorkdir) return [];
  try {
    const p = path.join(agentWorkdir, "findings.md");
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter((l) => /^[-*]\s+\S/.test(l));
  } catch { return []; }
}
function dumpFindings(cwd) {
  try {
    const p = cwd && path.join(cwd, "findings.md");
    const f = cachedFindings();
    if (p && fs.existsSync(p) && f.length) {
      console.log(c.bold(c.cyan(`\n  📋 Hallazgos cacheados (${f.length}) `)) + c.gray("▸ colapsado · presioná 'v' abajo para expandir") + c.gray(`  · ${p}`));
    }
  } catch {}
}
function showFindings(cwd) {
  try {
    const p = cwd && path.join(cwd, "findings.md");
    const f = cachedFindings();
    if (p && fs.existsSync(p) && f.length) {
      console.log(c.bold(c.cyan(`\n  📋 Hallazgos (${f.length}) · ${p}`)));
      f.forEach((l) => console.log(c.gray("   " + l)));
    } else {
      console.log(c.gray("  (sin hallazgos)"));
    }
  } catch {}
}

function printPlanBox(text) {
  const cols = Number(process.env.AT_COLS) || process.stdout.columns || 100;
  const W = Math.max(60, cols - 6);
  const inner = String(text || "").replace(/^\s*PLAN\s*READY\s*:?\s*/i, "").trim();
  const lines = renderMarkdownLines(inner, W);
  const head = "  ╭─ 🎯 PLANNING ";
  const topBar = "─".repeat(Math.max(0, W + 4 - vlen(head)));
  console.log("");
  console.log(c.bold(c.red(head + topBar)));
  for (const l of lines) console.log(c.red("  │ ") + l);
  console.log(c.bold(c.red("  ╰" + "─".repeat(W + 4))));
}

function printAgent(evt) {
  // The "Hacking…" spinner line only animates while the model is actually thinking.
  if (evt.type === "thinking") { setBusy(true); return; }
  if (evt.type === "think_done") { setBusy(false); return; }
  stopSpinner();
  const resume = () => startSpinner();

  if (evt.type === "agent_start") {
    agentWorkdir = evt.cwd;
    console.log(c.gray(`  📁 ${evt.cwd}`));
    resume(); return;
  }
  if (evt.type === "plan_ready") { printPlanBox(evt.plan); resume(); return; }
  if (evt.type === "attack_start") { console.log(c.bold(c.red("\n  ▶ FASE 2 — ATAQUE"))); resume(); return; }
  if (evt.type === "step") {
    if (evt.i > 0) console.log(c.gray("  │"));
    const ph = evt.phase === "attack" ? c.red("ataque") : c.magenta("recon");
    console.log(`  ${c.bold(c.cyan("◆"))} ${c.bold(c.cyan("paso " + (evt.i + 1)))} ${c.gray("·")} ${ph}`);
    resume(); return;
  }
  if (evt.type === "reply") {
    const prose = replyProse(evt.reply);
    if (prose) {
      console.log(c.gray("  │ 💭"));
      renderMarkdown(prose);
    }
    resume(); return;
  }
  if (evt.type === "exec") {
    const ok = evt.result.exit === 0;
    const lines = String(evt.cmd || "").trim().split("\n");
    const first = clip(lines[0], 200);
    const extra = lines.length - 1;
    console.log(
      c.gray("  │ ") + c.bold(c.yellow("$ ")) + c.yellow(first) +
      (extra > 0 ? c.gray(`  ⏎ +${extra} línea${extra === 1 ? "" : "s"}`) : "")
    );
    const out = (evt.result.stdout || "").trim();
    const err = (evt.result.stderr || "").trim();
    if (out) for (const l of renderLog(out, { gutter: c.gray("  │   "), maxLen: 1500 })) console.log(l);
    if (err) for (const l of renderLog(err, { gutter: c.gray("  │   "), maxLen: 600 })) console.log(c.red(l));
    const n = cachedFindings().length;
    console.log(
      c.gray("  │   ") +
      (ok ? c.green("✓ " + evt.result.ms + "ms") : c.red("✗ exit " + evt.result.exit + " · " + evt.result.ms + "ms")) +
      (n ? c.gray("   📋 " + n + " hallazgo" + (n === 1 ? "" : "s") + " en cache") : "")
    );
    resume(); return;
  }
  if (evt.type === "inject") {
    console.log(c.bold(c.cyan(`\n  ➤ inyectado: ${clip(evt.text, 200)}`)));
    resume(); return;
  }
  if (evt.type === "agent_done") {
    setBusy(false);
    console.log(c.gray("  ╰─") + c.bold(c.green(" FINAL")));
    return; // stop spinner (no resume)
  }
  if (evt.type === "agent_maxiters") { setBusy(false); return; }
  resume();
}

async function doRun(fw, vars, mode, cfg, flags) {
  const client = new Client(cfg, { baseSystem: flags.system || undefined });
  const isExec = flags.exec || mode === "exec";

  if (isExec && flags.dry) {
    console.log(c.bold(`\n  [dry] EXEC agéntico · ${fw.name} · ${cfg.model}`));
    console.log(c.gray(`  El modelo recibirá un shell real y ejecutará el objetivo paso a paso hasta emitir FINAL:`));
    console.log(c.bold(`\n  Objective:\n    ${vars.task}${vars.target ? " | TARGET: " + vars.target : ""}${vars.constraints ? "\n    CONSTRAINTS: " + vars.constraints : ""}`));
    return "";
  }
  if (flags.json) {
    console.log(JSON.stringify({ framework: fw.id, mode, vars, messages: client.composeMessages(fw, vars, mode === "single" ? "single" : "multi") }, null, 2));
    return "";
  }
  if (flags.dry) {
    console.log(c.bold(`\n  [dry] ${fw.name} · ${mode === "single" ? "single-shot" : "multi-turno"}`));
    console.log(c.gray(`  vars: ${JSON.stringify(vars)}`));
    for (const m of client.composeMessages(fw, vars, mode === "single" ? "single" : "multi")) {
      console.log(`\n${c.bold(`  [${m.role}]`)}${m.role === "system" ? c.gray(" (base)") : ""}`);
      console.log(indent(m.content, "    "));
    }
    return "";
  }
  if (!hasCreds(cfg) && cfg.baseUrl.includes("api.openai.com")) {
    throw new Error(`Sin API key. Usa --key, AT_API_KEY u OPENAI_API_KEY, o ponlo en anythreat/.env.`);
  }

  if (isExec) {
    const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) * 1000 : 60000;
    const maxIters = flags.maxIters ? parseInt(flags.maxIters, 10) : 500;
    client.onEvent = (evt) => printAgent(evt);
    console.log(c.bold(`\n  ▶ EXEC ${fw.name} ${c.gray(`(${fw.level} · ${cfg.model} · ${timeoutMs / 1000}s/cmd${(flags.profile && flags.profile!=="offensive")?" · profile:"+flags.profile:""})`)}`));
    const start = Date.now();
    const { final, cwd, done } = await client.runAgent(fw, vars, { maxIters, cwd: flags.cwd || "", timeoutMs, onStep: (e) => printAgent(e), profile: flags.profile || "offensive", approve: async () => true });
    console.log(c.gray(`\n  ${done ? "✓ terminado" : "⏸ llegó al límite de pasos"} en ${((Date.now() - start) / 1000).toFixed(1)}s · workdir ${cwd}`));
    console.log(c.bold(`\n${done ? c.green("  ◂ RESULTADO FINAL") : c.yellow("  ◂ último output")}:\n`));
    renderMarkdown(stripFinalMarker(final));
    dumpFindings(cwd);
    return final;
  }

  client.onEvent = (evt) => {
    if (evt.type === "thinking") { setBusy(true); return startSpinner(); }
    if (evt.type === "think_done") { stopSpinner(); setBusy(false); return; }
    if (evt.type === "turn") printTurn(evt); else printReply(evt);
  };
  console.log(c.bold(`\n  ▶ ${fw.name} ${c.gray(`(${fw.level} · ${mode === "single" ? "single-shot" : "multi-turno"} · ${cfg.model})`)}`));
  const start = Date.now();
  const { final } = mode === "single"
    ? await client.runSingleShot(fw, vars)
    : await client.runMultiTurn(fw, vars);
  console.log(c.gray(`\n  ✓ ${((Date.now() - start) / 1000).toFixed(1)}s`));
  return final;
}
function stripFinalMarker(s) {
  const m = String(s || "").match(/FINAL\s*:\s*([\s\S]*)/i);
  return m ? m[1].trim() : String(s || "").trim();
}

// ---------- model switch (start of session) ----------
async function chooseModel(ask, cfg) {
  const ans = await ask(c.bold("\n  ¿Cambiar modelo? ") + c.gray(`[Enter=mantener ${cfg.model} / y] `));
  if (!/^y/i.test(ans)) return cfg;
  const { PRESETS } = await import("./lib/presets.mjs");
  const names = Object.keys(PRESETS);
  console.log(c.gray("\n  Presets:"));
  names.forEach((n, i) => console.log(`   ${i + 1}. ${c.cyan(n.padEnd(9))} ${c.gray(PRESETS[n].note)}`));
  console.log(`   ${names.length + 1}. ${c.cyan("custom   ")} ${c.gray("(base URL + key + modelo propios)")}`);
  const sel = await ask(c.bold("  Elige ") + c.gray("(número, Enter=volver): "));
  if (sel === "") return cfg;
  if (parseInt(sel, 10) === names.length + 1) {
    const base = (await ask("  Base URL: ")).trim() || cfg.baseUrl;
    const key = (await ask("  API key: ")).trim() || cfg.apiKey;
    const model = (await ask("  Modelo: ")).trim() || "gpt-4o";
    return { ...cfg, baseUrl: base.replace(/\/+$/, ""), apiKey: key, model, preset: null, thinking: undefined, reasoning: undefined };
  }
  const p = names[parseInt(sel, 10) - 1];
  if (!p) return cfg;
  const pr = PRESETS[p];
  const thinking = pr.thinking === "enabled" ? "enabled" : "disabled";
  const reasoning = thinking === "enabled" ? "high" : undefined;
  console.log(c.gray(`  → ${pr.model} (${pr.note})`));
  return { ...cfg, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: pr.model, preset: p, thinking, reasoning };
}

// ---------- interactive agent (interrupt / ask / inject) ----------
async function runInteractiveAgent(client, fw, vars, cfg, rl, ask, flags, cont = {}) {
  const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) * 1000 : 90000;
  const maxIters = flags.maxIters ? parseInt(flags.maxIters, 10) : 500;
  client.onEvent = (e) => printAgent(e);
  console.log(c.bold(`\n  ▶ AGENTE ${fw.name} ${c.gray(`(${cfg.model} · ${timeoutMs / 1000}s/cmd${(flags.profile && flags.profile!=="offensive")?" · profile:"+flags.profile:""})`)}`));
  console.log(c.gray("  Enter = inject at the next step · Ctrl-C = pause · q (at pause) = stop\n"));
  wantInterrupt = false;
  const prevHandler = sigintHandler;
  sigintHandler = () => { wantInterrupt = true; resumeSpinner(); };
  const start = Date.now();
  let res;
  startInputBar();
  try {
    res = await client.runAgent(fw, vars, {
      maxIters,
      cwd: cont.cwd || flags.cwd || "",
      timeoutMs,
      profile: flags.profile || "offensive",
      initialMessages: cont.initialMessages || null,
      followup: cont.followup || "",
      onStep: (e) => printAgent(e),
      approve: async () => {
        stopInputBar();
        stopSpinner();
        const ans = (await ask(c.bold("\n  ¿Aceptás el ataque? ") + c.gray("[Enter=sí / n=no]: "))).trim();
        startInputBar();
        startSpinner();
        return !/^n/i.test(ans);
      },
      userInput: async () => {
        // 1) lines typed live during the run (queue) — inject anytime
        const live = takeLine();
        if (live) {
          if (/^q$/i.test(live)) return { stop: true };
          return { inject: live };
        }
        // 2) Ctrl-C pause: let the operator type one line / continue / stop
        if (!wantInterrupt) return null;
        wantInterrupt = false;
        stopInputBar();
        stopSpinner();
        process.stdout.write(c.yellow("  ⏸  pausado") + c.gray("  —  escribe para inyectar, Enter=seguir, q=salir\n"));
        let line;
        try { line = (await ask("  " + c.red("❯ ") + c.gray("inyecta (Enter=seguir, q=salir): "))).trim(); } catch { startInputBar(); startSpinner(); return { stop: true }; }
        startInputBar();
        startSpinner();
        if (/^q$/i.test(line)) return { stop: true };
        if (line === "") return null;
        return { inject: line };
      },
    });
  } finally {
    stopInputBar();
    sigintHandler = prevHandler;
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  if (res.rejected) {
    console.log(c.gray(`\n  ⏸ ataque NO aprobado (${secs}s). No se ejecutó nada.`));
    dumpFindings(res.cwd);
    return res;
  }
  console.log(c.gray(`\n  ${res.done ? "✓ FINAL" : res.interrupted ? "⏸ lo detuviste" : "⏸ límite de pasos"} en ${secs}s`));
  console.log(c.bold(`\n${res.done ? c.green("  ◂ RESULTADO FINAL") : c.yellow("  ◂ último output")}:\n`));
  renderMarkdown(stripFinalMarker(res.final));
  dumpFindings(res.cwd);
  return res;
}

// ---------- helpers: sessions / history rendering ----------
function relTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso).slice(0, 13).replace("T", " ");
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d}d`;
  return new Date(t).toISOString().slice(0, 10);
}
function sessionPreview(s) {
  for (const m of s.messages || []) {
    if (m.role !== "assistant") continue;
    const prose = replyProse(m.content);
    const first = prose.split("\n").map((l) => l.trim()).find(Boolean);
    if (first) return first.slice(0, 90);
  }
  return "";
}
function findingsCount(workdir) {
  try {
    const p = path.join(workdir, "findings.md");
    if (!fs.existsSync(p)) return 0;
    return fs.readFileSync(p, "utf8").split("\n").filter((l) => /^[-*]\s+\S/.test(l.trim())).length;
  } catch { return 0; }
}
// Card list of sessions (0 = new, 1..N = resume). Pure rendering; caller reads a number.
function renderSessionPicker(sessions) {
  const cols = Number(process.env.AT_COLS) || process.stdout.columns || 100;
  const W = Math.max(60, cols - 4);
  console.log("");
  console.log(c.bold("  📂 SESIONES") + c.gray("  — 0 nueva · número para reanudar"));
  const draw = (num, name, nameColor, meta, preview) => {
    const head = `  ${num}. ` + nameColor(name);
    const fill = Math.max(4, W - vlen(head) + 2);
    console.log(c.gray("  ╭─" + "─".repeat(fill)) + c.gray("╮"));
    console.log(c.gray("  │ ") + head + c.gray(" ".repeat(Math.max(0, fill - vlen(head) - 1))) + c.gray("│"));
    if (meta) console.log(c.gray("  │  ") + c.gray(meta));
    if (preview) console.log(c.gray("  │  ") + c.gray("…" + preview));
    console.log(c.gray("  ╰─" + "─".repeat(fill)) + c.gray("╯"));
  };
  draw("0", "＋ Nueva sesión", c.green, "empezar de cero", "");
  sessions.slice(0, 15).forEach((s, i) => {
    const n = i + 1;
    const nMsg = (s.messages || []).length;
    const meta = `${relTime(s.updatedAt)}  ·  ${s.framework || "—"}  ·  ${nMsg} msj  ·  ${findingsCount(s.workdir)} hallazgos`;
    draw(String(n), s.name, c.cyan, meta, sessionPreview(s));
  });
  console.log("");
}

// Replay a stored conversation as a readable transcript (assistant prose fully
// rendered; command/output collapsed). Lets you see what happened before resuming.
function renderHistory(messages) {
  const msgs = (messages || []).slice(1); // drop the system prompt
  if (!msgs.length) return;
  console.log(c.gray(`  ╭─ ${c.bold("historial")} ─ `) + c.gray(`${msgs.length} mensajes`));
  for (const m of msgs) {
    const content = String(m.content || "");
    if (m.role === "user") {
      if (content.startsWith("[OPERADOR]")) {
        const t = content.slice("[OPERADOR]".length).trim();
        if (t) console.log(c.green("  👤 tú: ") + t);
      } else if (content.startsWith("[CMD]")) {
        const cmd = (content.match(/\[CMD\]\n([\s\S]*?)\n\[STDOUT\]/) || [])[1] || "";
        const first = cmd.trim().split("\n")[0].slice(0, 120);
        console.log(c.gray("  │ $ ") + c.yellow(first) + c.gray("  · salida omitida"));
      } else if (/^OBJECTIVE:/.test(content)) {
        console.log(c.bold(c.magenta("  🎯 ")) + content.replace(/^OBJECTIVE:\s*/i, "").split("\n")[0]);
      } else {
        const first = content.trim().split("\n")[0].slice(0, 140);
        if (first) console.log(c.gray("  ▶ ") + first);
      }
    } else if (m.role === "assistant") {
      const prose = replyProse(content);
      if (prose) renderMarkdown(prose);
      const execs = content.match(/```exec[^\n]*\n([\s\S]*?)```/gi) || [];
      for (const b of execs) {
        const cmd = b.replace(/```exec[^\n]*\n/i, "").replace(/```\s*$/, "").trim();
        const first = cmd.split("\n")[0].slice(0, 120);
        console.log(c.gray("  │ $ ") + c.yellow(first) + (cmd.includes("\n") ? c.gray(`  ⏎ +${cmd.split("\n").length - 1}`) : ""));
      }
      if (/FINAL\s*:/i.test(content)) {
        console.log(c.green("  ◂ ") + c.gray(stripFinalMarker(content).split("\n")[0].slice(0, 140)));
      }
    }
  }
  console.log(c.gray("  ╰" + "─".repeat(40)));
  console.log("");
}

// ---------- interactive loop ----------
async function interactive(flags, cfg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => rl.question(q).then((s) => s.trim());
  // Ctrl-C sin prompt pendiente (durante un agente): marca interrupción.
  // Con listener, readline no se auto-cierra y la interfaz queda viva para el pause.
  rl.on("SIGINT", () => { wantInterrupt = true; });

  printLogo();
  cfg = await chooseModel(ask, cfg);

  // ---- session picker: card list (0 = new, N = resume) ----
  const sessions = listSessions();
  let session = null;
  {
    renderSessionPicker(sessions);
    const pick = await ask(c.bold("  Elige una sesión ") + c.gray("(0 = nueva, número = reanudar, Enter = 0): "));
    const idx = parseInt(pick, 10);
    if (idx > 0 && idx <= sessions.length) {
      session = loadSession(sessions[idx - 1].dir);
      if (!session) console.log(c.yellow("  No pude cargar la sesión; arranco nueva."));
    }
    if (!session) {
      const nm = (await boxedInput(ask, "Nombre de la sesión", "(Enter = auto)")).trim();
      session = createSession(nm || "sesion-" + new Date().toISOString().slice(0, 10));
    }
    console.log(c.gray(`  📂 sesión: `) + c.bold(session.name) + c.gray(`  · ${session.workdir}`));
  }

  let vars = { task: flags.task || "", target: flags.target || "", role: flags.role || "", constraints: flags.constraints || "" };
  let mode = flags.exec ? "exec" : flags.shot ? "single" : "exec"; // default: agente en vivo
  let current = null;

  // Resume an old session: show the history, then continue where it left off. After the
  // follow-up run we fall into the SAME post-run menu as a fresh run (no early exit).
  let resumeState = null;
  if (session.messages && session.framework) {
    const fw0 = byId(session.framework) || loadFrameworks().find((f) => f.name === session.framework);
    if (fw0) {
      renderHistory(session.messages);
      const vars0 = session.vars || { task: "", target: "", role: "", constraints: "" };
      const msg = (await boxedInput(ask, "¿Qué querés hacer ahora?", "(Enter = seguir donde quedó)")).trim();
      console.log(c.gray(`  ↻ reanudando (${session.messages.length} mensajes previos)…`));
      try {
        const client = new Client(cfg, { baseSystem: flags.system || undefined });
        const res = await runInteractiveAgent(client, fw0, vars0, cfg, rl, ask, flags, {
          initialMessages: session.messages, followup: msg || "Continuá donde quedaste.", cwd: session.workdir,
        });
        if (res && res.messages) { session.messages = res.messages; session.vars = vars0; saveSession(session); }
        vars = vars0;
        current = fw0;
        resumeState = { fw: fw0, res };
      } catch (e) {
        stopSpinner();
        console.log(c.red(`\n  ✗ ${e.message}`));
        console.log(c.gray("  No pude reanudar; seguí con una nueva operación."));
      }
    }
  }

  while (true) {
    let fw, res;
    if (resumeState) {
      ({ fw, res } = resumeState);
      resumeState = null;
    } else {
      if (!current) printMenu(cfg);
      const pick = await ask(c.bold("  Elige un framework ") + c.gray("(número, 'q' salir): "));
      if (!pick) { current = null; continue; }
      if (/^q$/i.test(pick)) break;
      const idx = parseInt(pick, 10);
      const all = loadFrameworks();
      fw = all.find((f) => String(f.order) === pick) || all[idx - 1] || all.find((f) => f.id === pick);
      if (!fw) { console.log(c.yellow("  Opción inválida.")); continue; }
      current = fw;
      console.log(`\n  ${c.bold(fw.name)} ${c.gray(`· ${fw.level} · ${fw.mechanism}`)}`);

      if (!vars.task) vars.task = await boxedInput(ask, "Tu tarea/objetivo");
      if (!vars.target && !flags.target) vars.target = await boxedInput(ask, "Target", "(Enter para saltar)");
      if (!vars.role && !flags.role) vars.role = await boxedInput(ask, "Rol/persona", "(Enter para saltar)");
      if (!vars.constraints && !flags.constraints) vars.constraints = await boxedInput(ask, "Restricciones (qué NO hacer)", "(Enter para saltar)");
      if (!vars._clarified && isTTY) await askClarifications(ask, vars);
      if (!vars._styled && isTTY) await askOpStyle(ask, vars);
      if (vars.preferAnon && !flags.profile) flags.profile = "anon";
      if (!flags.shot && !flags.exec && !flags.dry && !flags.json) {
        const m = await ask(c.gray("  Modo [Enter=AGENTE en vivo (internet+shell) / m=chat multi-turno (sin tools) / s=chat single-shot (sin tools)]: "));
        mode = /^m/i.test(m) ? "multi" : /^s/i.test(m) ? "single" : "exec";
        if (mode !== "exec") console.log(c.yellow("  ⚠ modo chat: SIN internet ni ejecución. Para navegar/buscar usá AGENTE (Enter)."));
      }
      if (!vars.task) { console.log(c.yellow("  Falta la tarea.")); current = null; continue; }

      if (session && !flags.cwd) flags.cwd = session.workdir;
      res = null;
      try {
        if (mode === "exec" && isTTY) {
          const client = new Client(cfg, { baseSystem: flags.system || undefined });
          if (!hasCreds(cfg) && cfg.baseUrl.includes("api.openai.com")) throw new Error("Sin API key. Usa --key o AT_API_KEY, o ponlo en .env.");
          res = await runInteractiveAgent(client, fw, vars, cfg, rl, ask, flags);
        } else {
          await doRun(fw, vars, mode, cfg, flags);
        }
      } catch (e) {
        stopSpinner();
        console.log(c.red(`\n  ✗ ${e.message}`));
      }

      // Persist this session (messages + vars + framework + workdir).
      if (session) {
        session.framework = fw.id; session.vars = vars;
        if (res && res.messages) session.messages = res.messages;
        session.name = session.name || fw.name;
        saveSession(session);
        console.log(c.gray(`  💾 sesión guardada: `) + c.bold(session.name) + c.gray(` (${session.dir})`));
      }
    }

    // After finishing, allow continuing the SAME session (keep talking to the agent).
    let escalate = false;
    if (res && res.messages && isTTY) {
      let keepGoing = true;
      while (keepGoing) {
        const choice = await ask(c.bold("\n  ¿Funcionó? ") + c.gray("[1 sí / 2 no→más fuerte / c = seguir hablando / v = ver hallazgos / q salir]: "));
        if (/^v$/i.test(choice)) { showFindings(res.cwd); continue; }
        if (/^2$/i.test(choice)) { escalate = true; keepGoing = false; break; }
        if (/^c$/i.test(choice)) {
          const msg = (await boxedInput(ask, "Seguir hablando con el agente", "(qué querés que haga ahora)")).trim();
          if (!msg) continue;
          try {
            const client = new Client(cfg, { baseSystem: flags.system || undefined });
            res = await runInteractiveAgent(client, fw, vars, cfg, rl, ask, flags, { initialMessages: res.messages, followup: msg, cwd: res.cwd });
            if (session) { session.messages = res.messages; saveSession(session); console.log(c.gray(`  💾 sesión guardada (${session.dir})`)); }
          } catch (e) {
            stopSpinner();
            console.log(c.red(`\n  ✗ ${e.message}`));
            console.log(c.gray("  La sesión sigue activa — elegí otra opción."));
          }
          continue;
        }
        // 1 / q / Enter -> leave the agent menu
        keepGoing = false;
      }
    } else {
      const choice = await ask(c.bold("\n  ¿Funcionó? ") + c.gray("[1 sí / 2 no→siguiente más fuerte / q salir]: "));
      escalate = /^2$/i.test(choice);
    }

    if (escalate) {
      const nxt = nextStronger(fw);
      if (nxt) {
        console.log(`\n  ${c.bold("  Escalando a ")}${c.bold(nxt.name)} ${c.gray(`(${nxt.level})`)}${c.gray(" con la misma tarea…")}`);
        current = null;
        continue;
      }
      console.log(c.yellow("\n  Ya estabas en el más fuerte (Dark Psychology). Prueba --shot o cambia de modelo."));
      current = null;
      continue;
    }
    current = null;
  }
  rl.close();
}

// ---------- main ----------
async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.noColor) globalThis.__AT_NO_COLOR = true;
  if (flags.help) return help();
  if (flags.version) return console.log(VERSION);

  const cfg = resolveConfig(flags);
  if (flags.list || positional.includes("--list")) {
    printLogo();
    printMenu(cfg);
    return;
  }

  const nonInteractive = !isTTY;
  const runId = flags.run || positional[0];

  if (runId) {
    const fw = byId(runId) || loadFrameworks().find((f) => String(f.order) === runId);
    if (!fw) { console.error(c.red(`Framework no encontrado: ${runId}`)); process.exit(1); }
    if (!flags.task && !isTTY && !flags.dry && !flags.json) {
      console.error(c.red("Falta --task (o corre en un terminal interactivo)."));
      process.exit(1);
    }
    const vars = { task: flags.task || "", target: flags.target || "", role: flags.role || "", constraints: flags.constraints || "" };
    if (!vars.task && isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q) => rl.question(q).then((s) => s.trim());
      vars.task = await boxedInput(ask, "Tu tarea/objetivo");
      vars.target = await boxedInput(ask, "Target", "(Enter para saltar)");
      vars.role = await boxedInput(ask, "Rol/persona", "(Enter para saltar)");
      vars.constraints = await boxedInput(ask, "Restricciones (qué NO hacer)", "(Enter para saltar)");
      rl.close();
    }
    const mode = flags.shot ? "single" : "exec"; // default: AGENTE (tiene internet/shell)
    if (mode === "single") console.log(c.yellow("  ⚠ single-shot (chat sin tools/internet). Para navegar usá AGENTE: -x o Enter en el menú."));
    await doRun(fw, vars, mode, cfg, flags);
    return;
  }

  if (nonInteractive) {
    console.error(c.yellow("Terminal no interactiva: usa --list, --run <id> --task \"...\", o --help."));
    return;
  }
  await interactive(flags, cfg);
}

process.on("SIGINT", () => sigintHandler());
// Limpieza final garantizada al salir (síncrona).
process.on("exit", () => { try { cleanupSync(); } catch {} });
main().catch((e) => {
  if (/Aborted|EOF|Ctrl\+D/i.test(String(e?.message || ""))) { console.log(c.gray("\n  (salido)")); process.exit(0); }
  console.error(c.red(`\n  ✗ ${e.message}`));
  process.exit(1);
});
