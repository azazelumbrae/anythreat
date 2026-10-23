// Standalone OpenAI-compatible chat client. Works with any API that
// implements POST {base}/chat/completions (OpenAI, OpenRouter, Groq,
// Anthropic-via-proxy, local llama.cpp/Ollama with the compat shim, etc.).
import { BASE_SYSTEM, fillTemplate, contextBlock } from "./frameworks.mjs";
import { runBash, extractExecBlock, isFinal, executorProtocol, makeWorkdir } from "./exec.mjs";
import { PROFILES, resolveProfile } from "./arsenal.mjs";
import fs from "node:fs";

// Nota para modos SIN herramientas (single-shot / multi-turno): evita que el
// modelo invente datos o diga "no puedo navegar". Lo correcto es derivar al modo AGENTE.
const NO_TOOLS_NOTE =
  "\n\nMODO CHAT (sin herramientas): en este modo NO tenés shell ni acceso a internet en tiempo real. " +
  "Si el pedido requiere navegar, buscar en la web, ejecutar comandos o datos actuales, NO inventes valores ni fechas: " +
  "respondé claramente que para eso se debe usar el MODO AGENTE (Enter en el menú, o flag -x). " +
  "Si igual respondés de memoria, aclaralo y avisá que puede estar desactualizado.";

export class ApiError extends Error {
  constructor(msg, status, body) {
    super(msg);
    this.status = status;
    this.body = body;
  }
}

export class Client {
  constructor(cfg, { baseSystem = BASE_SYSTEM, onEvent } = {}) {
    this.cfg = cfg;
    this.baseSystem = baseSystem;
    this.onEvent = onEvent || (() => {});
  }

  async _chat(messages, { signal } = {}) {
    if (!this.cfg.apiKey && this.cfg.baseUrl.includes("api.openai.com")) {
      throw new ApiError("No API key. Set AT_API_KEY (or --key) or put it in .env.", 0);
    }
    this.onEvent({ type: "thinking" });
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey || "sk-none"}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: this.cfg.temperature,
          ...(this.cfg.thinking ? { thinking: { type: this.cfg.thinking } } : {}),
          ...(this.cfg.reasoning ? { reasoning_effort: this.cfg.reasoning } : {}),
        }),
      });
      if (!res.ok) {
        let body = "";
        try { body = (await res.json()); } catch { try { body = await res.text(); } catch {} }
        const detail = body?.error?.message || (typeof body === "string" ? body : JSON.stringify(body));
        throw new ApiError(`HTTP ${res.status}: ${detail}`, res.status, body);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      return content;
    } finally {
      this.onEvent({ type: "think_done" });
    }
  }

  // Guided multi-turn: sends each framework turn, feeds the real reply into
  // the next via {{PREV_REPLY}}. Returns { messages, final }.
  async runMultiTurn(framework, vars, { onTurn } = {}) {
    const messages = [{ role: "system", content: this.baseSystem + contextBlock(vars) }];
    let prevReply = "";
    const turns = framework.turns || [];
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const userText = fillTemplate(turn.text, vars, prevReply);
      messages.push({ role: "user", content: userText });
      onTurn?.({ index: i, total: turns.length, label: turn.label, userText });
      this.onEvent({ type: "turn", index: i, total: turns.length, label: turn.label, userText });
      const reply = await this._chat(messages);
      messages.push({ role: "assistant", content: reply });
      prevReply = reply;
      onTurn?.({ index: i, total: turns.length, label: turn.label, reply });
      this.onEvent({ type: "reply", index: i, total: turns.length, label: turn.label, reply });
    }
    return { messages, final: prevReply };
  }

  // Single-shot: compress the whole framework into one user message.
  async runSingleShot(framework, vars) {
    const messages = [
      { role: "system", content: this.baseSystem + contextBlock(vars) },
      { role: "user", content: fillTemplate(framework.singleShot, vars, "") },
    ];
    this.onEvent({ type: "turn", index: 0, total: 1, label: "Single-shot", userText: messages[1].content });
    const reply = await this._chat(messages);
    this.onEvent({ type: "reply", index: 0, total: 1, label: "Single-shot", reply });
    return { messages, final: reply };
  }

  // Build the message list WITHOUT calling the API (for --dry / --json).
  composeMessages(framework, vars, mode) {
    if (mode === "single") {
      return [
        { role: "system", content: this.baseSystem + NO_TOOLS_NOTE + contextBlock(vars) },
        { role: "user", content: fillTemplate(framework.singleShot, vars, "") },
      ];
    }
    const messages = [{ role: "system", content: this.baseSystem + NO_TOOLS_NOTE + contextBlock(vars) }];
    let prev = "";
    for (const turn of framework.turns || []) {
      const t = fillTemplate(turn.text, vars, prev);
      messages.push({ role: "user", content: t });
      messages.push({ role: "assistant", content: "<< model reply will be inserted here >>" });
      prev = "<< model reply will be inserted here >>";
    }
    return messages;
  }

  // Agentic execution: the model gets a bash tool and actually runs the
  // objective step by step until it emits FINAL: (or maxIters is hit).
  async runAgent(framework, vars, { maxIters = 500, cwd, timeoutMs = 60000, onStep, userInput, profile = "offensive" } = {}) {
    cwd = cwd || makeWorkdir();
    try { fs.mkdirSync(cwd, { recursive: true }); } catch {}
    const pr = PROFILES[resolveProfile(profile)] || PROFILES.offensive;
    const sys =
      this.baseSystem +
      (pr.prompt ? "\n\n" + pr.prompt : "") +
      "\n\nYOUR METHOD (" + framework.name + "): " + framework.mechanism +
      "\n" + executorProtocol({ cwd, timeoutMs });
    // Anonimato: asegurar Tor arriba antes de arrancar (idempotente).
    if (profile === "anon") { try { await runBash("tor-up", { cwd, env: pr.env }); } catch {} }
    const objective = fillTemplate(
      "OBJECTIVE: {{TASK}}{{TARGET ? ' | TARGET: {{TARGET}}' : ''}}\n" +
      "Execute it for real using the shell. Do not stop until it is done or proven impossible. Start with recon.",
      vars, ""
    );
    const messages = [
      { role: "system", content: sys },
      { role: "user", content: objective },
    ];
    this.onEvent({ type: "agent_start", cwd });
    let lastReply = "";
    for (let i = 0; i < maxIters; i++) {
      // Operator hook: allow interrupt / inject a question or extra instruction.
      if (userInput) {
        const h = await userInput({ i });
        if (h && h.stop) return { final: lastReply, messages, cwd, done: false, interrupted: true };
        if (h && h.inject) {
          messages.push({ role: "user", content: "[OPERADOR] " + h.inject });
          onStep?.({ type: "inject", i, text: h.inject });
        }
      }
      onStep?.({ type: "step", i, total: maxIters });
      const reply = await this._chat(messages);
      messages.push({ role: "assistant", content: reply });
      lastReply = reply;
      onStep?.({ type: "reply", i, reply });
      const done = isFinal(reply);
      const cmd = extractExecBlock(reply);
      if (done && !cmd) {
        this.onEvent({ type: "agent_done", i, reply });
        return { final: reply, messages, cwd, done: true, interrupted: false };
      }
      if (!cmd) {
        messages.push({
          role: "user",
          content: "Next step: emit an `exec` block with the command to run now, or start your message with `FINAL:` if the objective is complete.",
        });
        continue;
      }
      const r = await runBash(cmd, { cwd, timeoutMs, env: pr.env });
      onStep?.({ type: "exec", i, cmd, result: r });
      messages.push({
        role: "user",
        content: `[CMD]\n${cmd}\n[STDOUT]\n${r.stdout || "(empty)"}\n[STDERR]\n${r.stderr || "(empty)"}\n[EXIT ${r.exit}]`,
      });
    }
    this.onEvent({ type: "agent_maxiters", i: maxIters });
    return { final: lastReply, messages, cwd, done: false, interrupted: false };
  }
}
