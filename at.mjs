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

const VERSION = "0.1.0";
const isTTY = process.stdout.isTTY && process.stdin.isTTY;

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
  -s, --shot           Single-shot (1 mensaje) en vez de multi-turno
  -x, --exec           EJECUTA de verdad: le da un shell al modelo y corre el
                       objetivo paso a paso (recon→exploit→verifica) hasta FINAL:
      --cwd <dir>      Dir de trabajo del EXEC (def: un dir temporal aislado)
      --timeout <s>    Timeout por comando (def: 60s)
      --max-iters <n>  Paso máx. del loop agéntico (def: 500; sin tope práctico)
  -p, --preset <n>     Preset de modelo: flash | pro | pro-nt | flash-nt
      --profile <p>    Perfil: offensive (def) | defensive (blue team) | anon (Tor)
      --thinking <m>   'enabled' | 'disabled' (sobre-escrIBE el thinking del preset)
      --reasoning <m>  'low' | 'medium' | 'high' (reasoning_effort)
  -d, --dry            Mostrar los mensajes compuestos sin llamar a la API
  -j, --json           Volcar los mensajes compuestos como JSON
      --base <url>     Base URL (OpenAI-compatible). Def: https://api.openai.com/v1
      --key <k>        API key        Def: $AT_API_KEY / $OPENAI_API_KEY / .env
      --model <m>      Modelo         Def: $AT_MODEL / (preset)
      --temp <n>       Temperatura    Def: 0.4

${c.bold("Presets (DeepSeek)")}
  flash     deepseek-flash   sin thinking (rápido)
  pro       deepseek-v4-pro  con thinking (más fuerte)
  pro-nt    deepseek-v4-pro  sin thinking
  flash-nt  deepseek-flash   sin thinking
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
  console.log(indent(evt.reply || "", "    "));
}
function indent(s, pad) { return String(s).split("\n").map((l) => pad + l).join("\n"); }
function stripExecBlock(s) { return String(s || "").replace(/```exec[^\n]*\n[\s\S]*?```/gi, "").trim(); }
function clip(s, n = 400) { s = String(s || "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; }
function oneline(s) { return String(s || "").replace(/\s*\n\s*/g, " ").trim(); }

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
      console.log(c.bold(c.cyan(`\n  📋 Hallazgos cacheados (${f.length}) · ${p}`)));
      f.forEach((l) => console.log(c.gray("   " + l)));
    }
  } catch {}
}

function printAgent(evt) {
  if (evt.type === "agent_start") {
    agentWorkdir = evt.cwd;
    console.log(c.gray(`  📁 ${evt.cwd}`));
  }
  if (evt.type === "step") {
    if (evt.i > 0) console.log(c.gray("  │"));
    console.log(`  ${c.bold(c.cyan("◆"))} ${c.bold(c.cyan("paso " + (evt.i + 1)))}`);
  }
  if (evt.type === "reply") {
    const reasoning = oneline(stripExecBlock(evt.reply));
    if (reasoning) console.log(c.gray("  │ 💭 ") + c.gray(clip(reasoning, 500)));
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
    if (out) console.log(indent(clip(out, 1500), c.gray("  │   ")));
    if (err) console.log(indent(c.red(clip(err, 600)), c.gray("  │   ")));
    const n = cachedFindings().length;
    console.log(
      c.gray("  │   ") +
      (ok ? c.green("✓ " + evt.result.ms + "ms") : c.red("✗ exit " + evt.result.exit + " · " + evt.result.ms + "ms")) +
      (n ? c.gray("   📋 " + n + " hallazgo" + (n === 1 ? "" : "s") + " en cache") : "")
    );
  }
  if (evt.type === "inject") {
    console.log(c.bold(c.cyan(`\n  ➤ inyectado: ${clip(evt.text, 200)}`)));
  }
  if (evt.type === "agent_done") {
    console.log(c.gray("  ╰─") + c.bold(c.green(" FINAL")));
  }
}

async function doRun(fw, vars, mode, cfg, flags) {
  const client = new Client(cfg, { baseSystem: flags.system || undefined });
  const isExec = flags.exec || mode === "exec";

  if (isExec && flags.dry) {
    console.log(c.bold(`\n  [dry] EXEC agéntico · ${fw.name} · ${cfg.model}`));
    console.log(c.gray(`  El modelo recibirá un shell real y ejecutará el objetivo paso a paso hasta emitir FINAL:`));
    console.log(c.bold(`\n  Objective:\n    ${vars.task}${vars.target ? " | TARGET: " + vars.target : ""}`));
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
    console.log(c.bold(`\n  ▶ EXEC ${fw.name} ${c.gray(`(${fw.level} · ${cfg.model} · ${timeoutMs / 1000}s/cmd)`)}`));
    const start = Date.now();
    const { final, cwd, done } = await client.runAgent(fw, vars, { maxIters, cwd: flags.cwd || "", timeoutMs, onStep: (e) => printAgent(e), profile: flags.profile || "offensive" });
    console.log(c.gray(`\n  ${done ? "✓ terminado" : "⏸ llegó al límite de pasos"} en ${((Date.now() - start) / 1000).toFixed(1)}s · workdir ${cwd}`));
    console.log(c.bold(`\n${done ? c.green("  ◂ RESULTADO FINAL") : c.yellow("  ◂ último output")}:\n`));
    console.log(stripFinalMarker(final));
    dumpFindings(cwd);
    return final;
  }

  client.onEvent = (evt) => { if (evt.type === "turn") printTurn(evt); else printReply(evt); };
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
  return m ? indent(m[1].trim(), "    ") : indent(s, "    ");
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
async function runInteractiveAgent(client, fw, vars, cfg, rl, ask, flags) {
  const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) * 1000 : 90000;
  const maxIters = flags.maxIters ? parseInt(flags.maxIters, 10) : 500;
  client.onEvent = (e) => printAgent(e);
  console.log(c.bold(`\n  ▶ AGENTE ${fw.name} ${c.gray(`(${cfg.model} · ${timeoutMs / 1000}s/cmd)`)}`));
  console.log(c.gray("  " + "Ctrl-C = pausar · escribir = inyectar al modelo · Enter = seguir · q = salir\n"));
  wantInterrupt = false;
  const prevHandler = sigintHandler;
  sigintHandler = () => { wantInterrupt = true; process.stdout.write("\n"); };
  const start = Date.now();
  let res;
  try {
    res = await client.runAgent(fw, vars, {
      maxIters,
      cwd: flags.cwd || "",
      timeoutMs,
      profile: flags.profile || "offensive",
      onStep: (e) => printAgent(e),
      userInput: async () => {
        if (!wantInterrupt) return null;
        wantInterrupt = false;
        process.stdout.write(c.yellow("  ⏸  pausado") + c.gray("  —  escribe para inyectar al modelo, Enter=seguir, q=salir\n"));
        let line;
        try { line = (await ask("  > ")).trim(); } catch { return { stop: true }; }
        if (/^q$/i.test(line)) return { stop: true };
        if (line === "") return null;
        return { inject: line };
      },
    });
  } finally {
    sigintHandler = prevHandler;
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(c.gray(`\n  ${res.done ? "✓ FINAL" : res.interrupted ? "⏸ lo detuviste" : "⏸ límite de pasos"} en ${secs}s`));
  console.log(c.bold(`\n${res.done ? c.green("  ◂ RESULTADO FINAL") : c.yellow("  ◂ último output")}:\n`));
  console.log(stripFinalMarker(res.final));
  dumpFindings(res.cwd);
  return res.final;
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

  let vars = { task: flags.task || "", target: flags.target || "", role: flags.role || "" };
  let mode = flags.exec ? "exec" : flags.shot ? "single" : "exec"; // default: agente en vivo
  let current = null;

  while (true) {
    if (!current) printMenu(cfg);
    const pick = await ask(c.bold("  Elige un framework ") + c.gray("(número, 'q' salir): "));
    if (!pick) { current = null; continue; }
    if (/^q$/i.test(pick)) break;
    const idx = parseInt(pick, 10);
    const all = loadFrameworks();
    const fw = all.find((f) => String(f.order) === pick) || all[idx - 1] || all.find((f) => f.id === pick);
    if (!fw) { console.log(c.yellow("  Opción inválida.")); continue; }
    current = fw;
    console.log(`\n  ${c.bold(fw.name)} ${c.gray(`· ${fw.level} · ${fw.mechanism}`)}`);

    if (!vars.task) vars.task = await ask("  Tu tarea/objetivo: ");
    if (!vars.target && !flags.target) vars.target = await ask(c.gray("  Target (Enter para saltar): "));
    if (!vars.role && !flags.role) vars.role = await ask(c.gray("  Rol/persona (Enter para saltar): "));
    if (!flags.shot && !flags.exec && !flags.dry && !flags.json) {
      const m = await ask(c.gray("  Modo [Enter=AGENTE en vivo (internet+shell) / m=chat multi-turno (sin tools) / s=chat single-shot (sin tools)]: "));
      mode = /^m/i.test(m) ? "multi" : /^s/i.test(m) ? "single" : "exec";
      if (mode !== "exec") console.log(c.yellow("  ⚠ modo chat: SIN internet ni ejecución. Para navegar/buscar usá AGENTE (Enter)."));
    }
    if (!vars.task) { console.log(c.yellow("  Falta la tarea.")); current = null; continue; }

    try {
      if (mode === "exec" && isTTY) {
        const client = new Client(cfg, { baseSystem: flags.system || undefined });
        if (!hasCreds(cfg) && cfg.baseUrl.includes("api.openai.com")) throw new Error("Sin API key. Usa --key o AT_API_KEY, o ponlo en .env.");
        await runInteractiveAgent(client, fw, vars, cfg, rl, ask, flags);
      } else {
        await doRun(fw, vars, mode, cfg, flags);
      }
    } catch (e) {
      console.log(c.red(`\n  ✗ ${e.message}`));
    }

    const choice = await ask(c.bold("\n  ¿Funcionó? ") + c.gray("[1 sí / 2 no→siguiente más fuerte / q salir]: "));
    if (/^2$/i.test(choice)) {
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
    if (/^q$/i.test(choice) || /^1$/i.test(choice)) break;
    if (choice === "") break;
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
    const vars = { task: flags.task || "", target: flags.target || "", role: flags.role || "" };
    if (!vars.task && isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      vars.task = (await rl.question("Tu tarea/objetivo: ")).trim();
      vars.target = (await rl.question(c.gray("Target (Enter para saltar): "))).trim();
      vars.role = (await rl.question(c.gray("Rol/persona (Enter para saltar): "))).trim();
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
main().catch((e) => {
  if (/Aborted|EOF|Ctrl\+D/i.test(String(e?.message || ""))) { console.log(c.gray("\n  (salido)")); process.exit(0); }
  console.error(c.red(`\n  ✗ ${e.message}`));
  process.exit(1);
});
