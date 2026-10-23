#!/usr/bin/env bash
# Instala TODAS las herramientas OSINT de awesome-osint-arsenal (tools.json) dentro del proyecto.
# - pip  -> venv en tools/osint/.venv
# - go   -> binarios en tools/bin (GOBIN)
# - git  -> clonados en tools/osint/git/<slug>
# - apt  -> solo Linux (se saltean en macOS, quedan en INDEX.md)
# También genera tools/osint/INDEX.md con TODAS las tools (incluye web/manual).
# Uso: ~/anythreat/tools/install-osint.sh [--only pip,go,git] [--limit N]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OSINT="$HERE/osint"
TJ="$OSINT/tools.json"
VENV="$OSINT/.venv"
GOBIN="$HERE/bin"
GITDIR="$OSINT/git"
ONLY="pip,go,git"
LIMIT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2;;
    --limit) LIMIT="$2"; shift 2;;
    *) shift;;
  esac
done

[ -f "$TJ" ] || { echo "[!] falta $TJ"; exit 1; }
mkdir -p "$GOBIN" "$GITDIR"

have() { case ",$ONLY," in *",$1,"*) return 0;; *) return 1;; esac; }

echo "=== AnyThreat · OSINT installer (todo dentro de $OSINT) ==="
echo "    only=$ONLY limit=$LIMIT"

# ---------- generar lista de instalación desde tools.json ----------
python3 - "$TJ" > "$OSINT/.plan.tsv" <<'PY'
import json,sys,re
tools=json.load(open(sys.argv[1]))
def clean(s): return (s or "").replace("`","").strip()
for t in tools:
    ins=t.get("install") or {}
    m=ins.get("method","")
    cmd=clean(ins.get("kali") or ins.get("raw") or "")
    name=t.get("name","").strip()
    cat=t.get("category","")
    desc=(t.get("description") or "").replace("\t"," ").replace("\n"," ")[:180]
    url=t.get("url","")
    if not name: continue
    print("\t".join([m,name,cat,cmd,url,desc]))
PY

if [ "$LIMIT" -gt 0 ]; then head -n "$LIMIT" "$OSINT/.plan.tsv" > "$OSINT/.plan2.tsv"; mv "$OSINT/.plan2.tsv" "$OSINT/.plan.tsv"; fi

# ---------- pip -> venv ----------
if have pip; then
  echo "[pip] preparando venv…"
  if [ ! -x "$VENV/bin/python" ]; then
    if command -v uv >/dev/null 2>&1; then uv venv --python 3.12 "$VENV" >/dev/null 2>&1
    else python3 -m venv "$VENV"; fi
  fi
  PY="$VENV/bin/python"
  # extraer comandos pip únicos
  awk -F'\t' '$1=="pip"{print $4}' "$OSINT/.plan.tsv" | sed -E 's/^pip3? install //; s/^pip3? //' | sort -u > "$OSINT/.pip.list"
  echo "[pip] $(wc -l < "$OSINT/.pip.list") paquetes"
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    echo "  pip: $pkg"
    if command -v uv >/dev/null 2>&1; then uv pip install --python "$PY" -q $pkg 2>>"$OSINT/.install.log" || echo "    (falló: $pkg)"
    else "$VENV/bin/pip" install -q $pkg 2>>"$OSINT/.install.log" || echo "    (falló: $pkg)"; fi
  done < "$OSINT/.pip.list"
fi

# ---------- go -> GOBIN ----------
if have go && command -v go >/dev/null 2>&1; then
  awk -F'\t' '$1=="go"{print $4}' "$OSINT/.plan.tsv" | sed -E 's/^go install //; s/@.*//' | sort -u > "$OSINT/.go.list"
  echo "[go] $(wc -l < "$OSINT/.go.list") paquetes -> $GOBIN"
  export GOBIN="$GOBIN"
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    echo "  go: $pkg"
    go install "$pkg@latest" 2>>"$OSINT/.install.log" || echo "    (falló: $pkg)"
  done < "$OSINT/.go.list"
fi

# ---------- git -> clone ----------
if have git; then
  awk -F'\t' '$1=="git"{print $4}' "$OSINT/.plan.tsv" | sed -E 's/^git clone //; s/\.git$//' | sort -u > "$OSINT/.git.list"
  echo "[git] $(wc -l < "$OSINT/.git.list") repos -> $GITDIR"
  while IFS= read -r repo; do
    [ -z "$repo" ] && continue
    slug=$(echo "$repo" | sed -E 's#^https?://##; s#/#__#g')
    dest="$GITDIR/$slug"
    [ -d "$dest" ] && { echo "  git: $slug (ya)"; continue; }
    echo "  git: $slug"
    git clone --depth 1 "$repo" "$dest" >/dev/null 2>>"$OSINT/.install.log" || echo "    (falló: $repo)"
  done < "$OSINT/.git.list"
fi

# ---------- INDEX.md (todas, incluyendo web/manual) ----------
python3 - "$TJ" "$OSINT/INDEX.md" <<'PY'
import json,sys,collections
tools=json.load(open(sys.argv[1]))
out=sys.argv[2]
by=collections.defaultdict(list)
for t in tools:
    by[t.get("category","misc")].append(t)
lines=["# OSINT Arsenal — índice completo","",f"Total: **{len(tools)}** herramientas (fuente: rawfilejson/awesome-osint-arsenal).",""]
for cat in sorted(by):
    lines.append(f"## {cat} ({len(by[cat])})")
    for t in sorted(by[cat], key=lambda x:x.get("name","")):
        m=t.get("install",{}).get("method","")
        cmd=(t.get("install",{}).get("kali") or t.get("install",{}).get("raw") or "").replace("`","").strip()
        url=t.get("url","")
        d=(t.get("description") or "").replace("\n"," ")[:140]
        lines.append(f"- **{t['name']}** [`{m}`] — {d}")
        if cmd: lines.append(f"  - `{cmd}`")
        if url: lines.append(f"  - {url}")
    lines.append("")
open(out,"w").write("\n".join(lines))
print("INDEX:",out)
PY

echo ""
echo "=== listo ==="
echo "  pip  bins: $VENV/bin"
echo "  go   bins: $GOBIN"
echo "  git repos: $GITDIR ($(ls -1 "$GITDIR" 2>/dev/null | wc -l | tr -d ' '))"
echo "  índice   : $OSINT/INDEX.md"
echo "  log      : $OSINT/.install.log"
