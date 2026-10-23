<div align="center">

<img src="assets/any-threat-logo.png" alt="Any Threat" width="820">

<b>An agentic security toolkit for any LLM</b><br>
<sub>ranked jailbreak frameworks · real execution · attack / defense / opsec arsenal</sub>

</div>

---

**Any Threat** is a command-line security toolkit that drives **any OpenAI-compatible
LLM** to perform real, hands-on security work. It combines three things into one tool:

1. **Ranked jailbreak frameworks** (soft → strong) to push any model past its
   refusals and get a complete, direct deliverable.
2. **An agentic executor** that hands the model a real `bash` shell with a full
   offensive/defensive/opsec **arsenal**, so it *does* the work instead of
   describing it — with live interrupt/inject control.
3. **Three operating profiles** — `offensive`, `defensive` (blue team), and
   `anon` (opsec/Tor) — that reshape the model's instructions and environment.

Zero runtime dependencies (Node.js ≥ 18). One command installs the whole toolkit.

> **Disclaimer** — For authorized security testing, research, and education only.
> You must have explicit permission to test any target. You are responsible for
> how you use it.

---

## Features

- **Ranked framework ladder** — 11 frameworks from subtle semantic drift to heavy
  coercion. If the model refuses, jump to the next, stronger one with the same task.
- **Real execution, not prose** — in agent mode the model gets a `bash` shell,
  runs commands, reads the real output, and iterates until it emits `FINAL:`.
- **Full attack arsenal** — nmap, sqlmap, ffuf, nuclei, gobuster, wfuzz, hydra,
  john, hashcat, subfinder, amass, paramspider, wpscan, whatweb, plus a stealth
  browser and a WAF-bypass proxy.
- **Defensive (blue team)** — lynis hardening audits, yara IOC scanning,
  binwalk/exiftool/hashdeep forensics, tshark pcap analysis, rootkit checks,
  WAF fingerprinting.
- **Anonymity (opsec)** — Tor on demand, requests over Tor, IP-leak detection,
  metadata stripping, and gpg encryption. `--profile anon` routes *everything*
  through Tor.
- **Live agent control** — `Ctrl-C` to pause, inject instructions, ask questions,
  or stop mid-run.
- **Persistent findings cache** — the agent appends every discovery to
  `findings.md`, with a live counter and a final dump.
- **Model presets** — quick-switch between provider presets (e.g. DeepSeek
  `flash` / `pro` / `pro-nt` / `flash-nt`) or any custom OpenAI-compatible endpoint.

---

## Installation

```sh
git clone https://github.com/<you>/anythreat.git
cd anythreat

# 1) configure the API
cp .env.example .env        # set AT_BASE_URL / AT_API_KEY / AT_MODEL

# 2) put `at` on your PATH (uses the `bin` entry)
npm link

# 3) install the entire arsenal (cross-platform: brew/apt + pip + gem + git)
./tools/setup.sh
```

`tools/setup.sh` is idempotent and self-contained — everything is installed
**inside the project directory** (`tools/`, `gems/`, `wordlists/`). On Linux it
uses `apt`, on macOS `brew`; tools without a system package are fetched via
`pip`, `gem`, `git`, or npm.

### Requirements

- **Node.js ≥ 18** (runtime only; no npm dependencies)
- macOS or Linux
- `git`, `python3`, and either `brew` (macOS) or `apt` (Debian/Parrot/Kali) for
  the optional arsenal

---

## Usage

```sh
at                                       # interactive ranked menu
at --list                                # list frameworks by strength
at --run <id> --task "..."               # agent mode (real shell + internet)
at --run <id> --task "..." -s            # single-shot chat (no tools)
at --run <id> --task "..." --dry         # inspect composed messages (no API call)
at --run <id> --task "..." --json        # dump messages as JSON
```

In the interactive menu the flow is: **logo → model → framework → task → target →
role → mode** (default is the live agent).

### Modes

| Mode | Flag / menu | What it does |
|------|-------------|--------------|
| **Agent** | `-x` / Enter | Real `bash` shell + internet + arsenal; iterates until `FINAL:`. `Ctrl-C` pauses/injects. |
| **Multi-turn** | `m` | Guided jailbreak turns fed back through the model (chat, no tools). |
| **Single-shot** | `-s` | Everything compressed into one message (chat, no tools). |

### Profiles

```sh
at --profile defensive --task "..."      # blue team: detect/harden, never exploit
at --profile anon       --task "..."     # opsec: all traffic through Tor
at --profile offensive  --task "..."     # default red team
```

### Presets

```sh
at --preset flash      --task "..."      # fast, no thinking
at --preset pro        --task "..."      # stronger, with thinking
at --preset pro-nt     --task "..."      # stronger, no thinking (fast)
at --preset flash-nt   --task "..."      # fast, no thinking
```

Override: `--thinking enabled|disabled`, `--reasoning low|medium|high`.
Any OpenAI-compatible endpoint works via `--base` / `--key` / `--model`.

### Options

`-t/--task`, `-T/--target`, `-R/--role`, `-s/--shot`, `-x/--exec`, `--cwd`,
`--timeout <s>`, `--max-iters <n>` (default 500), `-p/--preset`, `--profile`,
`--thinking`, `--reasoning`, `-d/--dry`, `-j/--json`, `--base`, `--key`,
`--model`, `--temp`, `--system`, `--no-color`, `-l/--list`, `-h/--help`,
`-v/--version`.

---

## The ladder (soft → strong)

| # | Framework | Mechanism |
|---|-----------|-----------|
| 1 | Semantic Drift | change the representation (spec/JSON/alias), keep the meaning |
| 2 | Component Fragmentation | split the goal into harmless pieces, reassemble at the end |
| 3 | Crescendo | gradual escalation across turns to the final slot |
| 4 | CustomGPT Extraction | "debug/maintenance" framing + authority to extract the full plan |
| 5 | Cognitive Dissonance | trap the model in its own commitments |
| 6 | Trust Cascade | the request gains authority through relays/approvals (confused deputy) |
| 7 | Mutation Window | approve one version, mutate it before use (TOCTOU) |
| 8 | Latent Persistence | poison persistent notes/memory that reconfigure the session |
| 9 | Social Engineering | recon → pretext → credibility → urgency |
| 10 | Manipulation Matrix | stakes + role + dependency + urgency, with real delivery |
| 11 | Dark Psychology | guilt + fear + coercion (last resort) |

Each framework lives in `frameworks/*.json` (`turns`, `singleShot`, `metadata`).
To add one, copy a JSON and edit `id`, `name`, `order`, `turns`, `singleShot`.
Placeholders: `{{TASK}}`, `{{TARGET}}`, `{{ROLE}}`, `{{PREV_REPLY}}`.

---

## The arsenal

Available to the agent in agent mode (`-x`). See `ARSENAL.md` for the full
audit against the Parrot OS tool catalog.

| Pillar | Tools |
|--------|-------|
| **Attack** | `nmap`, `sqlmap`, `ffuf`, `nuclei`, `gobuster`, `wfuzz`, `hydra`, `john`, `hashcat`, `subfinder`, `amass`, `paramspider`, `wpscan`, `whatweb`, `evilwaf` (MITM WAF bypass), `wafscan`, `browse` (stealth browser), `captcha` |
| **Defense** | `harden-audit` (lynis), `ioc-scan` (yara), `forensics` (binwalk/exiftool/hashdeep), `pcap-analyze` (tshark), `rootkit-check`, `waf-fingerprint` (wafw00f) |
| **Anonymity** | `anon` (Tor on/off), `anon-curl`, `opsec-check`, `stripmeta`, `encrypt`/`decrypt` (gpg), `proxychains4`, `tor` |
| **Internet** | `websearch` (local SearXNG), `webfetch` (URL → clean text), `browse` |

Wordlists ship with the project (`wordlists/`): `passwords.txt`, `rockyou.txt`,
`dirs.txt`, `subdomains.txt`, `usernames.txt`.

---

## How it works

**Agent mode** runs a loop: the model emits a fenced `exec` block, the tool runs
it in an isolated working directory, and the real `[STDOUT]/[STDERR]/[EXIT]` is
fed back. The executor protocol also loads every arsenal helper into the shell
before each command.

### Two-phase execution (recon + plan → approval → attack)

By default the agent runs in **two phases**:

1. **Phase 1 — Recon + Plan.** The agent profiles the target with the arsenal
   (`browse`, `websearch`, `nmap`, `whatweb`, `wpscan`, `subfinder`, `ffuf`,
   `wafscan`, …). It runs `tools` to see what is installed, and installs anything
   missing (`brew`/`apt`/`pip`/`gem`) or falls back to an equivalent. Findings
   are cached to `findings.md`. When it has enough intel it emits `PLAN READY:`
   and a **PLANNING** box is shown with four parts: findings, attack path, tools,
   and risks.
2. **Approval gate.** The operator reviews the recon + plan and decides. **Enter**
   approves (attack proceeds); **n** rejects (nothing runs).
3. **Phase 2 — Attack.** After approval the agent executes the plan step by step,
   verifies every result, and emits `FINAL:`.

In non-interactive runs (`--run <id> --task ...` with a TTY) the gate auto-approves.
A mandatory `PLAN:` line and a tool-preference rule make the model consider its
arsenal before acting.

- **Interrupt/inject** — `Ctrl-C` during a run pauses at the next step boundary;
  type to inject an instruction into the model, `Enter` to continue, `q` to stop.
- **Findings cache** — the agent appends each discovery to `findings.md`; the TUI
  shows a live `📋 N findings` counter and dumps the cache at the end.
- **Loading spinner** — while the model is thinking, a red spinner cycles a
  rotating dot-square and hacking words (`Hacking`, `Scanning`, `Exploiting`, …).
- **Anonymity** — the `anon` profile injects `ALL_PROXY=socks5h://127.0.0.1:9050`
  into every command and starts Tor on demand.

**Single/multi-turn modes** are pure chat (no shell, no internet). The model is
instructed to point to agent mode instead of inventing data when a request needs
the web or execution.

---

## Configuration (flags > env > `.env`)

| Variable | Default |
|----------|---------|
| `AT_BASE_URL` | `https://api.openai.com/v1` |
| `AT_API_KEY` | — |
| `AT_MODEL` | `gpt-4o-mini` |
| `AT_TEMPERATURE` | `0.4` |
| `AT_PRESET` | — |
| `NOPECHA_KEY` | — (optional, for `captcha`) |
| `AT_SEARXNG` | `http://127.0.0.1:8080` |
| `AT_CAMOFOX_URL` | `http://127.0.0.1:9377` |

---

## Project layout

```
anythreat/
├── at.mjs                # CLI entry (menu, parsing, agent runner)
├── lib/                  # client, executor, presets, config, render, arsenal
├── frameworks/           # 11 ranked jailbreak framework bundles (JSON)
├── tools/                # heavy tools (evilwaf, camofox) + setup.sh
├── wordlists/            # passwords / dirs / subdomains / usernames
├── gems/                 # wpscan (installed by setup.sh)
├── ARSENAL.md            # full arsenal audit + install matrix
└── .env.example          # config template
```

## License

MIT
