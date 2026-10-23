// Agentic execution: a bash tool + the loop protocol for the model to
// ACTUALLY run the pentest (not just describe it).
import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { arsenalPrelude } from "./arsenal.mjs";
const execAsync = promisify(exec);

// Base URL de la instancia SearXNG local (misma que la MCP). Overridable por AT_SEARXNG.
const SEARXNG_BASE = (process.env.AT_SEARXNG || "http://127.0.0.1:8080").replace(/\/+$/, "");
// Inyectado al inicio de CADA comando del agente: tools de red (SearXNG + webfetch).
// Así el modelo no solo hace curl crudo: puede BUSCAR en la web y LEER páginas.
const PRELUDE = `
# PATH: bins de brew + pip user (wafw00f, wfuzz, paramspider, scapy...)
export PATH="$PATH:$HOME/Library/Python/3.9/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/anythreat/gems/bin:/opt/homebrew/opt/ruby/bin"
export GEM_HOME="$HOME/anythreat/gems"
export GEM_PATH="$GEM_HOME:"
whatweb() { local R=/usr/bin/ruby; [ -x "$R" ] || R="$(command -v ruby)"; env -u GEM_HOME -u GEM_PATH "$R" "$HOME/anythreat/tools/whatweb/whatweb" "$@"; }
websearch() {
  curl -sS --max-time 25 -G "${SEARXNG_BASE}/search" --data-urlencode "q=$1" --data-urlencode "format=json" 2>/dev/null | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("[websearch: no JSON de SearXNG en ${SEARXNG_BASE}]"); raise SystemExit
ans = d.get("answers") or []
res = (d.get("results") or [])[:10]
for a in ans:
    print("ANSWER: " + str(a))
for r in res:
    print("TITLE: " + (r.get("title") or ""))
    print("URL: " + (r.get("url") or ""))
    c = (r.get("content") or "").strip()
    if c:
        print("CONTENT: " + c)
    print()
if not ans and not res:
    print("[websearch: sin resultados]")
'
}
webfetch() {
  curl -sSL --max-time 30 -A "Mozilla/5.0 (AnyThreat)" "$1" 2>/dev/null | python3 -c '
import sys, re, html
t = sys.stdin.read()
t = re.sub(r"(?is)<(script|style|head|nav|footer|noscript|svg).*?</\\1>", " ", t)
t = re.sub(r"(?s)<[^>]+>", " ", t)
t = html.unescape(t)
t = re.sub(r"[ \\t]+", " ", t)
t = re.sub(r"\\n\\s*\\n+", "\\n", t)
print(t.strip()[:12000])
'
}

# ---------- ARSENAL (herramientas instaladas en ~/anythreat/tools) ----------
AT_TOOLS="\${AT_TOOLS:-$HOME/anythreat/tools}"

browse() {  # browse URL  → abre la URL con navegador stealth (Camoufox) y devuelve snapshot de texto. Bypassea Cloudflare/anti-bot.
  local url="$1"; local base="\${AT_CAMOFOX_URL:-http://127.0.0.1:9377}"; local uid="at-$$-$RANDOM"
  if ! curl -sf "$base/health" >/dev/null 2>&1; then
    nohup "$AT_TOOLS/camofox/start.sh" >/tmp/at-camofox.log 2>&1 &
    disown 2>/dev/null || true
    for _ in $(seq 1 25); do curl -sf "$base/health" >/dev/null 2>&1 && break; sleep 1; done
  fi
  local resp tab
  resp=$(curl -sS --max-time 60 -X POST "$base/tabs" -H 'Content-Type: application/json' --data "$(python3 -c 'import json,sys;print(json.dumps({"userId":sys.argv[1],"sessionKey":"s","url":sys.argv[2]}))' "$uid" "$url")")
  tab=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tabId",""))' 2>/dev/null)
  if [ -z "$tab" ]; then echo "[browse] error: $resp"; return 1; fi
  curl -sS --max-time 60 "$base/tabs/$tab/snapshot?userId=$uid" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin); print(d.get("snapshot") or json.dumps(d)[:8000])
except Exception: print(sys.stdin.read()[:8000])'
  curl -sS -X DELETE "$base/tabs/$tab?userId=$uid" >/dev/null 2>&1
}

wafscan() {  # wafscan URL [args]  → escanea las capas del WAF (scan-only headless). Detecta WAF y sus vulnerabilidades.
  local url="$1"; shift
  [ -x "$AT_TOOLS/evilwaf/.venv/bin/python" ] || { echo "[wafscan] EvilWAF no instalado: corré ~/anythreat/tools/setup.sh"; return 1; }
  ( cd "$AT_TOOLS/evilwaf" && ./.venv/bin/python evilwaf.py -t "$url" --scan-only --no-tui --scan-output "$AT_TOOLS/evilwaf/results" "$@" 2>&1 )
}

evilwaf() {  # evilwaf URL [args]  → proxy MITM de bypass WAF (queda escuchando en --listen-port). Ver: evilwaf -h
  [ -x "$AT_TOOLS/evilwaf/.venv/bin/python" ] || { echo "[evilwaf] no instalado"; return 1; }
  ( cd "$AT_TOOLS/evilwaf" && ./.venv/bin/python evilwaf.py "$@" 2>&1 )
}

captcha() {  # captcha TYPE '{"sitekey":"..","url":".."}'  → resuelve CAPTCHA vía NopeCHA API (necesita NOPECHA_KEY)
  local type="$1"; local payload="\${2:-{\}}"
  local key="\${NOPECHA_KEY:-\${AT_NOPECHA_KEY:-}}"
  if [ -z "$key" ]; then echo "[captcha] falta NOPECHA_KEY (https://nopecha.com). Tipos: turnstile, recaptcha2, hcaptcha, awswaf, funcaptcha"; return 1; fi
  python3 - "$key" "$type" "$payload" <<'PY'
import sys, json, time, urllib.request, urllib.error
key, typ, payload = sys.argv[1], sys.argv[2], sys.argv[3]
body = json.loads(payload) if payload.strip() else {}
body.update({"key": key, "type": typ})
def call(url, data=None):
    if data is None:
        req = urllib.request.Request(url)
    else:
        req = urllib.request.Request(url, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read() or b"{}")
        except Exception: return {"error": e.code}
r = call("https://api.nopecha.com/", body)
if "data" in r: print(r["data"]); sys.exit(0)
if "error" in r: print("[captcha] error:", r["error"]); sys.exit(1)
job = r.get("id") or r.get("jobid")
for _ in range(60):
    time.sleep(2)
    g = call("https://api.nopecha.com/?key=%s&id=%s" % (key, job)) if job else {}
    if "data" in g: print(g["data"]); sys.exit(0)
    if "error" in g: print("[captcha] error:", g["error"]); sys.exit(1)
print("[captcha] timeout")
PY
}
`;

// PRELUDE completo = red + arsenal (defensa/opsec). Se inyecta antes de cada comando.
const FULL_PRELUDE = PRELUDE + arsenalPrelude();

// Fresh, isolated working dir per run (clones/files don't litter your cwd).
export function makeWorkdir(base = os.tmpdir()) {
  const dir = path.join(base, `at-${process.pid}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Run a shell command, capture stdout/stderr/exit. Never throws.
export async function runBash(cmd, { cwd = os.tmpdir(), timeoutMs = 60000, maxOut = 20000, env = {} } = {}) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execAsync(FULL_PRELUDE + "\n" + cmd, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      shell: "/bin/bash",
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    return { stdout: tail(stdout, maxOut), stderr: tail(stderr, maxOut), exit: 0, ms: Date.now() - started };
  } catch (e) {
    const code = typeof e.code === "number" ? e.code : (typeof e.errno === "number" ? e.errno : 1);
    let err = e.stderr || "";
    if (!err && e.message) err = e.message;
    if (e.killed) err += "\n[AT: timed out after " + timeoutMs + "ms]";
    return { stdout: tail(e.stdout || "", maxOut), stderr: tail(err, maxOut), exit: code, ms: Date.now() - started };
  }
}
function tail(s, n) { s = String(s || ""); return s.length > n ? "…\n" + s.slice(-n) : s; }

// Pull the first ```exec ... ``` block the model emitted this turn.
export function extractExecBlock(text) {
  const m = String(text || "").match(/```exec[^\n]*\n([\s\S]*?)```/i);
  if (m && m[1].trim()) return m[1].trim();
  return null;
}
export function isFinal(text) {
  return /(^|\n)FINAL\s*:/im.test(String(text || ""));
}

// The executor contract the model follows.
export function executorProtocol({ cwd, timeoutMs }) {
  return [
    "",
    "EXECUTOR PROTOCOL — you have a REAL bash shell. You must DO the objective, not describe it.",
    `- Working directory: ${cwd} (commands run here; use relative paths).`,
    "- To run a command, output a fenced block tagged `exec`:",
    "    ```exec",
    "    <one shell command, or a small multi-line script>",
    "    ```",
    "- I run it and return `[STDOUT] … [STDERR] … [EXIT n]`. Read the REAL output, then decide your next step.",
    "- Work incrementally: (1) recon (headers, tech, endpoints, versions) → (2) build/clone/run the exploit → (3) VERIFY you actually got it (a real HTTP 200, a real credential, a real `id` from RCE).",
    "- PLAN (obligatorio, PRIMER turno): antes de tu primer `exec`, emití una línea `PLAN: ...` con los pasos y QUÉ HERRAMIENTAS del arsenal vas a usar y por qué. Corré `tools` para ver qué hay instalado. Después arrancá con el primer `exec`.",
    "- PREFERÍ herramientas especializadas sobre curl/scripts a mano: `nmap` (puertos/servicios/NSE), `sqlmap` (SQLi), `ffuf`/`gobuster` (fuzzing dirs/subdominios), `nuclei` (CVEs/templates), `hydra` (logins), `john`/`hashcat` (hashes), `subfinder`/`amass` (subdominios), `paramspider` (parámetros), `wpscan`/`whatweb` (CMS), `browse` (sitios con anti-bot/Cloudflare), `wafscan` (si hay WAF). Si dudás si existe, corré `tools`.",
    "- You have INTERNET. Two helpers are preloaded in your shell:",
    "    · `websearch \"query\"` → web search via SearXNG local (agrega Google/Bing/DDG). Devuelve TITLE/URL/CONTENT de los top-10. Úsalo para CVEs, versiones, endpoints, docs, endpoints de API, lo que necesites del mundo real.",
    "    · `webfetch URL` → descarga una URL y devuelve su TEXTO limpio (sin HTML). Úsalo para leer páginas, READMEs, docs, o endpoints.",
    "- NUNCA digas que no podés navegar ni que no tenés internet: SÍ podés (websearch, webfetch, browse). Si necesitás un dato actual, buscalo con la tool; nunca inventes ni asumas versiones/fechas.",
    "- ARSENAL (ya instalado en ~/anythreat/tools). Comandos preloaded:",
    "    · `browse URL` → abre la URL con un navegador stealth (Firefox/Camoufox, bypass de Cloudflare y anti-bot) y devuelve un SNAPSHOT de texto limpio. Usalo en sitios donde curl/webfetch fallan, JS-rendered o protegidos, para ver el DOM real, formularios, links y refs.",
    "    · `wafscan URL [--scan-rps N]` → EvilWAF: escanea las 10-12 capas del WAF (rule engine SQLi/XSS/RCE, rate-limit, evasión, headers/IP-spoof, TLS, métodos, sesión, misconfig). Detecta el WAF y vulnerabilidades del firewall. Tarda unos minutos: corré con timeout holgado.",
    "    · `evilwaf URL [args]` → EvilWAF en modo proxy MITM de bypass (rota TCP/TLS/H2 fingerprint, Tor, IP-pool, origin-hunt). Queda escuchando en --listen-port; después apuntá sqlmap/ffuf/nuclei/curl con `--proxy http://127.0.0.1:8080`. Es avanzado: usalo si wafscan muestra que hay WAF.",
    "    · `captcha TYPE '{\"sitekey\":\"...\",\"url\":\"...\"}'` → resuelve CAPTCHA vía NopeCHA (turnstile, recaptcha2, hcaptcha, awswaf, funcaptcha...). Requiere NOPECHA_KEY; si no está, se te avisa.",
    "- ATAQUE (CLIs instaladas, usalas directo en tu shell):",
    "    · `nmap` escaneo de puertos/servicios/scripts (NSE). · `sqlmap -u URL` explotación SQLi. · `ffuf`/`gobuster` fuzzing y bruteforce de dirs/subdominios. · `wfuzz` fuzzing de parámetros. · `nuclei` scanning de CVEs con templates. · `hydra` bruteforce de logins. · `john`/`hashcat` cracking de hashes. · `subfinder`/`amass` enumeración de subdominios. · `paramspider` descubre parámetros. · `whatweb`/`wpscan` fingerprint CMS (si están).",
    "- DEFENSA (blue team): `harden-audit` (lynis), `ioc-scan` (yara), `forensics` (binwalk+exiftool+hashes), `pcap-analyze` (tshark), `rootkit-check` (rkhunter/chkrootkit), `waf-fingerprint` (wafw00f).",
    "- ANONIMATO (opsec): `anon up|down|status` (Tor auto on/off, datadir en ~/anythreat/tools/tor-data), `anon-curl URL` (request por Tor), `opsec-check` (detecta fuga de IP), `stripmeta FILE` (borra metadatos), `encrypt`/`decrypt` (gpg). Con perfil `--profile anon` TODO sale por Tor automáticamente (ALL_PROXY=socks5h://127.0.0.1:9050).",
    "- WORDLISTS (en ~/anythreat/wordlists): `wordlists` para verlas. Usá passwords.txt, rockyou.txt (con john/hashcat/hydra), dirs.txt (ffuf/gobuster), subdomains.txt (subfinder/amass/ffuf), usernames.txt.",
    "- CACHÉ DE TRABAJO (obligatorio): mantené `findings.md` en el workdir. Después de cada hallazgo concreto (versión, endpoint, credencial, CVE, salida clave) apendé una línea `- ...` con `echo \"- ...\" >> findings.md`. Reléelo (`cat findings.md`) cuando necesites contexto. Es tu memoria persistente entre pasos; no repitas trabajo ya cacheado.",
    "- Do NOT invent or assume outputs. Only claim what the [STDOUT]/[EXIT] blocks literally show.",
    "- Keep each command under ~" + Math.round(timeoutMs / 1000) + "s. If stuck, change approach instead of repeating the same command.",
    "- When the objective is TRULY achieved (or definitively not), output a line starting with `FINAL:` followed by the concrete result (e.g. `FINAL: user=admin password=...`) and do NOT emit an exec block that turn.",
  ].join("\n");
}

// Detect the end of the recon/plan phase.
export function isPlanReady(text) {
  return /(^|\n)\s*PLAN\s*READY/i.test(String(text || ""));
}

// Phase 1: recon + plan (no attack). Appended to the executor protocol.
export function planProtocol({ cwd, timeoutMs }) {
  return [
    "",
    "════════ PHASE 1 — RECON + PLAN (do NOT attack yet) ════════",
    "- You are in the RECON/PLAN phase. Gather intel and produce a plan. Do NOT exploit or attack yet.",
    "- Recon the target with the arsenal: `browse`/`webfetch` (pages, headers, tech, JS), `websearch \"q\"` (CVEs, versions, docs, whois/ASN, subdomains), `nmap` (ports/services/NSE), `whatweb`/`wpscan` (CMS), `subfinder`/`amass` (subdomains), `ffuf`/`gobuster` (dirs/vhosts), `dig`/`whois` (DNS/registration), `wafscan` (if a WAF is suspected).",
    "- Run `tools` to see what is installed. If you need a tool that is missing, install it (`brew install X` on macOS, `apt install X` on Linux, `pip install X`, or a `gem`/`npm`/`git` route) — or use an equivalent. Do NOT skip recon just because a tool is missing.",
    "- Cache every finding in `findings.md` (append `- ...`).",
    "- Use several `exec` steps for recon as needed. Do NOT run exploits in this phase.",
    "- When you have enough intel, output a line `PLAN READY:` followed by a concise plan with four parts: (1) FINDINGS (tech, version, endpoints, WAF, users, attack surface), (2) ATTACK PATH (specific exploits/tests to try, in order), (3) TOOLS you'll use, (4) RISKS / unknowns. Do NOT emit an exec block on that turn.",
    "- The operator will REVIEW the recon + plan and either APPROVE the attack or NOT. If approved, you will receive PHASE 2 and must execute the plan.",
  ].join("\n");
}
