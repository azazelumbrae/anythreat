#!/usr/bin/env node
// Any Threat — firefox-devtools MCP bridge for the agent.
// Zero-dependency Node client that speaks MCP-over-stdio to
// @mozilla/firefox-devtools-mcp and exposes a tiny line-JSON control socket so the
// bash PRELUDE can drive a persistent browser session (navigate, snapshot, click,
// fill, evaluate, screenshot, …) from inside the agent's shell.
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AT_TOOLS = process.env.AT_TOOLS || path.join(os.homedir(), "anythreat", "tools");
const DIR = path.join(AT_TOOLS, "firefox");
const SOCK = path.join(DIR, ".sock");
const PIDFILE = path.join(DIR, ".pid");
const LOG = path.join(DIR, ".log");

const FIREFOX_PATH = process.env.AT_FIREFOX_PATH || "/Applications/LibreWolf.app/Contents/MacOS/librewolf";
const TOOL_PRESET = process.env.AT_FIREFOX_TOOLS || "developer";

const sub = process.argv[2];

function serverCmdArgs() {
  return [
    "-y", "@mozilla/firefox-devtools-mcp@latest",
    "--firefoxPath", FIREFOX_PATH,
    "--autoProfile",
    "--startUrl", "about:blank",
    "--toolPreset", TOOL_PRESET,
  ];
}

// ---- MCP stdio client over a child process ----
class McpChild {
  constructor() {
    this.child = spawn("npx", serverCmdArgs(), {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // own process group so we can kill npx + firefox + server together
      env: { ...process.env, PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin" },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.tools = null;
    let buf = "";
    this.child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        this._onLine(line);
      }
    });
    this.child.stderr.on("data", () => {});
    this.child.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new Error("MCP server exited (" + code + ")"));
      this.pending.clear();
    });
  }
  _onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message || "MCP error")) : p.resolve(msg.result);
      }
    } else if (msg.id !== undefined && msg.method) {
      // server → client request: answer ping, reject the rest
      if (msg.method === "ping") this._send({ jsonrpc: "2.0", id: msg.id, result: {} });
      else this._send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not implemented" } });
    }
    // notifications ignored
  }
  _send(obj) { this.child.stdin.write(JSON.stringify(obj) + "\n"); }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }
  async init() {
    await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "anythreat", version: "0.1.0" } });
    this._send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  async listTools() {
    const r = await this.request("tools/list", {});
    this.tools = r.tools || [];
    return this.tools;
  }
  async callTool(name, args) {
    return this.request("tools/call", { name, arguments: args || {} });
  }
  stop() {
    try { process.kill(-this.child.pid, "SIGTERM"); } // kill the whole process group
    catch { try { this.child.kill("SIGTERM"); } catch {} }
  }
}

// Flatten a tools/call result into plain text for the agent.
function fmtResult(res) {
  const parts = [];
  for (const item of res?.content || []) {
    if (item.type === "text") parts.push(item.text);
    else if (item.type === "image") {
      const f = path.join(DIR, "shots", "shot-" + Date.now() + ".png");
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, Buffer.from(item.data || "", "base64"));
        parts.push("[image] guardado en " + f);
      } catch { parts.push("[image] (no se pudo guardar)"); }
    } else {
      parts.push(JSON.stringify(item));
    }
  }
  const text = parts.join("\n").trim();
  if (res?.isError) return "ERROR: " + (text || "falló la tool");
  return text || "(sin contenido)";
}

// ---- daemon: long-lived process that owns the MCP server + control socket ----
async function daemon() {
  fs.mkdirSync(DIR, { recursive: true });
  const mcp = new McpChild();
  await mcp.init();
  await mcp.listTools();
  if (fs.existsSync(SOCK)) { try { fs.unlinkSync(SOCK); } catch {} }
  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", async (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let req;
        try { req = JSON.parse(line); } catch { conn.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n"); conn.end(); return; }
        if (req.cmd === "stop") {
          conn.write(JSON.stringify({ ok: true }) + "\n");
          conn.end();
          server.close();
          mcp.stop();
          setTimeout(() => process.exit(0), 400);
          return;
        }
        if (req.cmd === "list") {
          conn.write(JSON.stringify({ ok: true, tools: (mcp.tools || []).map((t) => ({ name: t.name, description: (t.description || "").split("\n")[0] })) }) + "\n");
          conn.end();
          return;
        }
        if (req.cmd === "call") {
          try {
            const r = await mcp.callTool(req.tool, req.args);
            conn.write(JSON.stringify({ ok: true, result: fmtResult(r) }) + "\n");
          } catch (e) {
            conn.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
          }
          conn.end();
          return;
        }
        conn.write(JSON.stringify({ ok: false, error: "unknown cmd" }) + "\n");
        conn.end();
      }
    });
  });
  server.listen(SOCK, () => {
    fs.writeFileSync(PIDFILE, String(process.pid));
    const lg = fs.createWriteStream(LOG, { flags: "a" });
    lg.write("[" + new Date().toISOString() + "] firefox-devtools daemon up (preset=" + TOOL_PRESET + ")\n");
  });
  const shutdown = () => { try { mcp.stop(); } catch {} try { fs.unlinkSync(SOCK); } catch {} try { fs.unlinkSync(PIDFILE); } catch {} process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---- one-shot client: call the daemon ----
function callDaemon(req, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const sock = net.connect(SOCK, () => {
      sock.write(JSON.stringify(req) + "\n");
    });
    let buf = "";
    sock.on("data", (d) => { buf += d.toString(); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); sock.end(); resolve(line); } });
    sock.on("error", () => resolve(JSON.stringify({ ok: false, error: "daemon no activo (corré firefox-start)" })));
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(JSON.stringify({ ok: false, error: "timeout" })); });
  });
}

const out = (o) => console.log(typeof o === "string" ? o : JSON.stringify(o));

if (sub === "daemon") {
  daemon().catch((e) => { fs.writeFileSync(LOG, "daemon error: " + e.message + "\n", { flag: "a" }); process.exit(1); });
} else if (sub === "list") {
  callDaemon({ cmd: "list" }).then((line) => {
    const r = JSON.parse(line);
    if (!r.ok) { out("ERROR: " + r.error); process.exit(1); }
    for (const t of r.tools) out("- " + t.name + "  " + t.description);
  });
} else if (sub === "call") {
  const tool = process.argv[3];
  const argsJson = process.argv[4];
  if (!tool) { out("uso: mcp.mjs call <tool> '<json>'" ); process.exit(1); }
  let args = {};
  if (argsJson) { try { args = JSON.parse(argsJson); } catch { out("ERROR: args no es JSON válido"); process.exit(1); } }
  callDaemon({ cmd: "call", tool, args }).then((line) => {
    const r = JSON.parse(line);
    if (!r.ok) { out("ERROR: " + r.error); process.exit(1); }
    out(r.result);
  });
} else if (sub === "stop") {
  callDaemon({ cmd: "stop" }, 5000).then(() => {
    try { fs.unlinkSync(SOCK); } catch {} try { fs.unlinkSync(PIDFILE); } catch {}
    out("[firefox] detenido");
  });
} else {
  out("uso: mcp.mjs daemon|list|call <tool> '<json>'|stop");
}
