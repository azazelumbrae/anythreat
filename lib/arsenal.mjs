// Arsenal: perfiles (defensivo / anónimo) + helpers de shell (defensa + opsec).
// Todo se inyecta en la PRELUDE del agente; los perfiles ajustan el system prompt y el env.

export const PROFILES = {
  offensive: {
    label: "ofensivo (default)",
    prompt: "",
    env: {},
  },
  defensive: {
    label: "defensivo / blue team",
    prompt:
      "PERFIL DEFENSIVO (blue team). Tu objetivo es DETECTAR, HARDENEAR y RESPONDER, no explotar. " +
      "Priorizá: auditoría de config (harden-audit/lynis), IOCs (ioc-scan/yara), " +
      "forensics (forensics: binwalk+exiftool+hashes; pcap-analyze/tshark), rootkits (rootkit-check), y fingerprint de TU WAF (waf-fingerprint). " +
      "Entregá hallazgos con severidad, vector, evidencia y remediación concreta (comando/config). NUNCA lances exploits contra el target; verificá de forma no destructiva.",
    env: {},
  },
  anon: {
    label: "anónimo / opsec",
    prompt:
      "PERFIL ANÓNIMO (opsec). Todo el tráfico sale por Tor (ya seteado vía ALL_PROXY=socks5h://127.0.0.1:9050 en cada comando; Tor se arranca solo). " +
      "Reglas: no reveles IP real ni datos personales; usá 'opsec-check' para verificar que no haya fuga de IP/DNS; limpiá metadatos con 'stripmeta' antes de compartir archivos; cifrá con 'encrypt'. " +
      "Evitá servicios que pidan teléfono/identidad; no escribas secretos en texto plano. Si necesitás un request puntual sin el proxy global, usá 'anon-curl URL'.",
    env: {
      ALL_PROXY: "socks5h://127.0.0.1:9050",
      HTTP_PROXY: "socks5h://127.0.0.1:9050",
      HTTPS_PROXY: "socks5h://127.0.0.1:9050",
      // localhost (camofox :9377, searxng :8080) must NOT go through Tor
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  },
};

export function resolveProfile(name) {
  const k = String(name || "offensive").toLowerCase();
  return PROFILES[k] ? k : "offensive";
}

// Helpers de shell (defensa + opsec). Se concatenan a la PRELUDE.
export function arsenalPrelude() {
  return `
# ---------- WORDLISTS (dentro del proyecto) ----------
AT_WL="\${AT_WL:-$HOME/anythreat/wordlists}"
wordlists() { echo "wordlists en $AT_WL:"; ls -1 "$AT_WL" 2>/dev/null || echo "(sin wordlists: corré ~/anythreat/tools/setup.sh)"; }

# ---------- INVENTARIO (qué herramientas hay) ----------
tools() {
  echo "=== ARSENAL disponible ==="
  local g=()
  for t in nmap sqlmap ffuf nuclei gobuster wfuzz hydra john hashcat subfinder amass paramspider wpscan whatweb websearch webfetch browse wafscan evilwaf captcha harden-audit ioc-scan forensics pcap-analyze rootkit-check waf-fingerprint anon anon-curl opsec-check stripmeta encrypt decrypt email-osint user-osint socialscan; do
    command -v "$t" >/dev/null 2>&1 && g+=("$t")
  done
  echo "\${g[*]}"
  echo "--- wordlists ---"; ls -1 "$AT_WL" 2>/dev/null
}

# ---------- DEFENSA / BLUE TEAM ----------
harden-audit() { if command -v lynis >/dev/null 2>&1; then lynis audit system --quick 2>&1; else echo "[harden-audit] falta lynis (brew install lynis / apt install lynis)"; fi; }
ioc-scan() { if ! command -v yara >/dev/null 2>&1; then echo "[ioc-scan] falta yara (brew install yara)"; return 1; fi; [ -z "$2" ] && { echo "[ioc-scan] uso: ioc-scan FILE reglas.yar"; return 1; }; yara -r "$2" "$1" 2>&1; }
forensics() { local f="$1"; [ -e "$f" ] || { echo "[forensics] no existe: $f"; return 1; }; echo "== file =="; file "$f"; echo "== hashes =="; if command -v hashdeep >/dev/null 2>&1; then hashdeep "$f"; else shasum -a 256 "$f"; fi; echo "== exiftool =="; if command -v exiftool >/dev/null 2>&1; then exiftool "$f" | head -40; else echo "(sin exiftool)"; fi; echo "== binwalk =="; if command -v binwalk >/dev/null 2>&1; then binwalk "$f"; else echo "(sin binwalk)"; fi; }
pcap-analyze() { local f="$1"; command -v tshark >/dev/null 2>&1 || { echo "[pcap-analyze] falta tshark"; return 1; }; echo "== endpoints =="; tshark -r "$f" -q -z endpoints,ip 2>/dev/null | head -30; echo "== DNS =="; tshark -r "$f" -Y dns -T fields -e dns.qry.name 2>/dev/null | sort -u | head -30; echo "== HTTP =="; tshark -r "$f" -Y http.request -T fields -e http.host -e http.request.uri 2>/dev/null | head -30; }
rootkit-check() { if command -v rkhunter >/dev/null 2>&1; then rkhunter --check --sk --nocolors 2>&1 | tail -20; else echo "(sin rkhunter / Linux)"; fi; if command -v chkrootkit >/dev/null 2>&1; then chkrootkit 2>&1 | grep -i infected; fi; if command -v unhide >/dev/null 2>&1; then unhide proc; unhide tcp; fi; }
waf-fingerprint() { if command -v wafw00f >/dev/null 2>&1; then wafw00f "$1" 2>&1; else echo "[waf-fingerprint] falta wafw00f (pip install wafw00f)"; fi; }

# ---------- OSINT (email -> cuentas/breaches, username -> cuentas) ----------
AT_OSINT="$HOME/anythreat/tools/osint/.venv/bin"
email-osint() {  # email-osint EMAIL  → holehe (dónde está registrado) + h8mail (breaches/contraseñas filtradas)
  local e="$1"; [ -z "$e" ] && { echo "uso: email-osint EMAIL"; return 1; }
  echo "== holehe (sitios donde existe la cuenta) =="
  if [ -x "$AT_OSINT/holehe" ]; then "$AT_OSINT/holehe" --only-used --no-color "$e" 2>&1 | head -60; else echo "(holehe no instalado: ~/anythreat/tools/setup.sh)"; fi
  echo "== h8mail (breaches / contraseñas filtradas) =="
  if [ -x "$AT_OSINT/h8mail" ]; then "$AT_OSINT/h8mail" -t "$e" 2>&1 | grep -viE "^\s*$|official h8mail|khast3x|Version|ROCKSMASSON" | head -60; else echo "(h8mail no instalado)"; fi
}
user-osint() {  # user-osint USER  → sherlock + maigret (en qué redes existe el username)
  local u="$1"; [ -z "$u" ] && { echo "uso: user-osint USER"; return 1; }
  if [ -x "$AT_OSINT/sherlock" ]; then "$AT_OSINT/sherlock" --print-found --no-color "$u" 2>&1 | head -60; else echo "(sherlock no instalado)"; fi
  if [ -x "$AT_OSINT/maigret" ]; then echo "== maigret =="; "$AT_OSINT/maigret" "$u" --no-color --no-progressbar -H 2>&1 | head -40; fi
}
socialscan() { local x="$1"; if [ -x "$AT_OSINT/socialscan" ]; then "$AT_OSINT/socialscan" "$x" 2>&1 | head -40; else echo "(socialscan no instalado)"; fi; }

# ---------- ANONIMATO / OPSEC ----------
tor-up() {
  (echo > /dev/tcp/127.0.0.1/9050) >/dev/null 2>&1 && return 0
  command -v tor >/dev/null 2>&1 || { echo "[tor] no hay binario tor"; return 1; }
  mkdir -p "$AT_TOOLS/tor-data"
  nohup tor --DataDirectory "$AT_TOOLS/tor-data" --SocksPort 9050 >/tmp/at-tor.log 2>&1 &
  echo $! > "$AT_TOOLS/tor-data/tor.pid"
  for _ in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/9050) >/dev/null 2>&1 && return 0; sleep 1; done
  echo "[tor] no arrancó (ver /tmp/at-tor.log)"; return 1
}
tor-down() {
  local pidfile="$AT_TOOLS/tor-data/tor.pid"
  if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null; rm -f "$pidfile"; echo "tor (nuestro) apagado"; else echo "tor externo en :9050 (no lo detengo)"; fi
}

# Cierra SOLO lo que levantó el agente (todo acotado a ~/anythreat). No toca Comet ni servicios externos.
cleanup() {
  local did=""
  # Tor del agente (solo el que tiene --DataDirectory .../tor-data o su pidfile)
  if [ -f "$AT_TOOLS/tor-data/tor.pid" ]; then kill "$(cat "$AT_TOOLS/tor-data/tor.pid")" 2>/dev/null; rm -f "$AT_TOOLS/tor-data/tor.pid"; did="$did tor"; fi
  pkill -f "tor --DataDirectory $AT_TOOLS/tor-data" 2>/dev/null && did="$did tor"
  # Navegador stealth camofox / Camoufox
  pkill -f "camofox-browser" 2>/dev/null && did="$did camofox"
  pkill -f "Camoufox" 2>/dev/null && did="$did Camoufox"
  # EvilWAF proxy (si quedó escuchando)
  pkill -f "$AT_TOOLS/evilwaf/.*evilwaf.py" 2>/dev/null && did="$did evilwaf"
  [ -n "$did" ] && echo "[cleanup] cerrado:$did" || echo "[cleanup] nada que cerrar"
}
anon() { case "\${1:-status}" in up) tor-up;; down) tor-down;; *) echo "ALL_PROXY=\${ALL_PROXY:-<none>} HTTP_PROXY=\${HTTP_PROXY:-<none>}"; (echo > /dev/tcp/127.0.0.1/9050) >/dev/null 2>&1 && echo "tor :9050 ARRIBA" || echo "tor :9050 caído (usá 'anon up')";; esac; }
anon-curl() { tor-up >/dev/null 2>&1; local u="$1"; shift; curl -sSL --max-time 40 --socks5-hostname 127.0.0.1:9050 "$@" "$u"; }
opsec-check() { tor-up >/dev/null 2>&1; local real tor; real=$(curl -sS --max-time 10 https://ifconfig.me 2>/dev/null || echo "?"); tor=$(anon-curl https://ifconfig.me 2>/dev/null || echo "?"); echo "IP real : $real"; echo "IP Tor  : $tor"; if [ "$real" = "$tor" ] && [ "$real" != "?" ]; then echo "⚠️  FUGA: misma IP (Tor no enruta)."; else echo "✓ distintas (o Tor OK)"; fi; (echo > /dev/tcp/127.0.0.1/9050) >/dev/null 2>&1 && echo "✓ SOCKS tor :9050 arriba" || echo "⚠️  tor :9050 caído"; }
stripmeta() { local f="$1"; [ -e "$f" ] || { echo "[stripmeta] no existe: $f"; return 1; }; if command -v exiftool >/dev/null 2>&1; then exiftool -all= -overwrite_original "$f" && echo "metadatos borrados (exiftool)"; elif command -v mat2 >/dev/null 2>&1; then mat2 "$f" 2>&1; else echo "[stripmeta] falta exiftool/mat2"; fi; }
encrypt() { local f="$1"; command -v gpg >/dev/null 2>&1 || { echo "[encrypt] falta gpg"; return 1; }; gpg -c --cipher-algo AES256 "$f" 2>&1 && echo "→ $f.gpg"; }
decrypt() { gpg -d "$1" 2>&1; }
`;
}
