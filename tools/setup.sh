#!/usr/bin/env bash
# AnyThreat — instalador del arsenal completo. TODO queda dentro de ~/anythreat/.
# Un solo comando:   ~/anythreat/tools/setup.sh
# Cross-platform: usa brew (macOS/Linux) o apt (Debian/Parrot/Kali), pip, gem y git.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"     # ~/anythreat/tools
ROOT="$(cd "$HERE/.." && pwd)"            # ~/anythreat
WL="$ROOT/wordlists"
GEMS="$ROOT/gems"
echo "=== AnyThreat arsenal setup ==="
echo "  proyecto: $ROOT"

# ---- detector de package manager ----
if command -v brew >/dev/null 2>&1; then PM=brew
elif command -v apt-get >/dev/null 2>&1; then PM=apt
else PM=none; fi
echo "  package manager: $PM"

# ---------- 1) CLIs cross-platform (ataque + defensa + anonimato) ----------
echo "[1/6] CLIs (nmap sqlmap ffuf nuclei ...)"
case "$PM" in
  brew)
    brew install nmap sqlmap ffuf nuclei gobuster hydra john-jumbo hashcat subfinder amass \
      proxychains-ng tor torsocks yara binwalk exiftool rkhunter lynis foremost hashdeep ssdeep tshark >/dev/null 2>&1 ;;
  apt)
    sudo apt-get update -y >/dev/null 2>&1
    sudo apt-get install -y nmap sqlmap ffuf nuclei gobuster hydra john hashcat subfinder amass \
      proxychains4 tor torsocks yara binwalk exiftool rkhunter lynis foremost hashdeep ssdeep tshark >/dev/null 2>&1 ;;
  *) echo "  [!] sin brew/apt: instalá a mano (ver ARSENAL.md)" ;;
esac

# ---------- 2) pip tools ----------
echo "[2/6] pip (wfuzz wafw00f)"
pip3 install --user wfuzz wafw00f >/dev/null 2>&1 || pip3 install wfuzz wafw00f >/dev/null 2>&1

# ---------- 3) ruby + wpscan (gem) + whatweb ----------
echo "[3/6] wpscan + whatweb (ruby)"
if ! command -v ruby >/dev/null 2>&1 || [ "$(ruby -e 'puts RUBY_VERSION >= "3.0"' 2>/dev/null)" != "true" ]; then
  case "$PM" in brew) brew install ruby >/dev/null 2>&1 ;; apt) sudo apt-get install -y ruby-full >/dev/null 2>&1 ;; esac
fi
export PATH="/opt/homebrew/opt/ruby/bin:/usr/local/bin:$PATH"
mkdir -p "$GEMS"
gem install wpscan --install-dir "$GEMS" --no-document >/dev/null 2>&1
[ -d "$HERE/whatweb" ] || git clone --depth 1 https://github.com/urbanadventurer/WhatWeb.git "$HERE/whatweb" >/dev/null 2>&1

# ---------- 4) wordlists (dentro del proyecto) ----------
echo "[4/6] wordlists ($WL)"
mkdir -p "$WL"
B="https://raw.githubusercontent.com/danielmiessler/SecLists/master"
dl() { [ -f "$WL/$1" ] || curl -sSL --max-time 120 -o "$WL/$1" "$B/$2"; }
dl passwords.txt  "Passwords/Common-Credentials/Pwdb_top-100000.txt"
dl dirs.txt       "Discovery/Web-Content/raft-small-directories.txt"
dl subdomains.txt "Discovery/DNS/subdomains-top1million-110000.txt"
dl usernames.txt  "Usernames/top-usernames-shortlist.txt"
if [ ! -f "$WL/rockyou.txt" ]; then
  curl -sSL --max-time 300 -o /tmp/rockyou.txt.tar.gz "$B/Passwords/Leaked-Databases/rockyou.txt.tar.gz" 2>/dev/null \
    && tar xzf /tmp/rockyou.txt.tar.gz -C "$WL" 2>/dev/null && rm -f /tmp/rockyou.txt.tar.gz
fi

# ---------- 5) EvilWAF (proxy MITM bypass WAF + scanner) ----------
echo "[5/6] evilwaf (venv)"
if [ ! -d "$HERE/evilwaf/.git" ]; then git clone --depth 1 https://github.com/matrixleons/Evilwaf.git "$HERE/evilwaf" >/dev/null 2>&1; fi
if [ -d "$HERE/evilwaf" ] && [ ! -x "$HERE/evilwaf/.venv/bin/python" ]; then
  python3 -m venv "$HERE/evilwaf/.venv" 2>/dev/null && "$HERE/evilwaf/.venv/bin/pip" install -q --upgrade pip && \
  "$HERE/evilwaf/.venv/bin/pip" install -q -r "$HERE/evilwaf/requirements.txt"
fi
mkdir -p "$HERE/evilwaf/results"

# ---------- 6) camofox-browser (stealth, API REST :9377) ----------
echo "[6/6] camofox (npm)"
if [ ! -d "$HERE/camofox/node_modules/@askjo/camofox-browser" ]; then
  ( cd "$HERE/camofox" && ([ -f package.json ] || npm init -y >/dev/null 2>&1) && npm install @askjo/camofox-browser >/dev/null 2>&1 )
fi
if [ -d "$HERE/camofox/node_modules/@askjo/camofox-browser" ]; then
  ( cd "$HERE/camofox" && node node_modules/@askjo/camofox-browser/postinstall.js >/dev/null 2>&1; npm rebuild better-sqlite3 >/dev/null 2>&1 ) || true
fi
mkdir -p "$HERE/camofox/data"/{profiles,cookies,traces,uploads} "$HERE/tor-data"

echo ""
echo "=== resumen ==="
echo "  ATAQUE   : nmap sqlmap ffuf nuclei gobuster wfuzz hydra john hashcat subfinder amass wpscan whatweb paramspider evilwaf camofox"
echo "  DEFENSA  : lynis yara binwalk exiftool foremost hashdeep ssdeep rkhunter tshark wafw00f"
echo "  ANONIMATO: tor torsocks proxychains4 (mat2/clamav omitidos: mac/opcional)"
echo "  WORDLISTS: $WL  (passwords.txt rockyou.txt dirs.txt subdomains.txt usernames.txt)"
echo "  NopeCHA  : opcional, export NOPECHA_KEY=..."
echo "Listo. Probá: at -x --profile anon --task \"...\""
