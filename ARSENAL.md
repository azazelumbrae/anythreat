# AnyThreat · Arsenal (Ataque · Defensa · Anonimato)

Todo el arsenal del agente, organizado en 3 pilares. Las herramientas cross-platform quedan
instaladas en el sistema (brew/pip); las pesadas (EvilWAF, camofox) en `~/anythreat/tools/`.

> Fuente de referencia: catálogo de **tools.parrotsec.org** (445 tools, 105 categorías), revisado
> y filtrado a lo que sirve cross-platform y es usable por un agente bash.

---

## 1. ATAQUE (principal)

| Herramienta | Uso | Instalación |
|---|---|---|
| `nmap` | Escaneo de puertos/servicios/scripts NSE | ✅ brew |
| `sqlmap` | Explotación SQLi automática | ✅ brew |
| `ffuf` | Fuzzing de dirs/subdominios/params | ✅ brew |
| `nuclei` | Scanning de CVEs/vulns con templates | ✅ brew |
| `gobuster` | Bruteforce de directorios/DNS/VHOST | ✅ brew |
| `wfuzz` | Fuzzing de parámetros web | ✅ pip |
| `hydra` | Bruteforce de logins (HTTP/SSH/…) | ✅ brew |
| `john` | Cracking de hashes (offline) | ✅ brew |
| `hashcat` | Cracking de hashes (GPU) | ✅ brew |
| `subfinder` | Enumeración de subdominios (pasivo) | ✅ brew |
| `amass` | Enumeración de subdominios/ASN (activo+pasivo) | ✅ brew |
| `paramspider` | Descubre parámetros GET/POST | ✅ pip |
| `evilwaf` | Proxy MITM bypass WAF (rota TCP/TLS/H2 fingerprint, Tor, origin-hunt) | ✅ tools/ |
| `wafscan` | Escáner de capas del WAF (EvilWAF --scan-only) | ✅ tools/ |
| `browse` | Navegador stealth (Camoufox) — bypass Cloudflare/anti-bot | ✅ tools/ |
| `captcha` | Solver CAPTCHA (NopeCHA) — turnstile/reCAPTCHA/AWS WAF | ⚠️ requiere NOPECHA_KEY |
| `websearch`/`webfetch` | Búsqueda web (SearXNG) / URL→texto | ✅ |

## 2. DEFENSA (blue team)

| Herramienta | Uso | Instalación |
|---|---|---|
| `harden-audit` (lynis) | Auditoría de hardening del sistema | ✅ brew |
| `malware-scan` (clamav) | Antivirus / malware | ✅ brew (editar conf + freshclam) |
| `ioc-scan` (yara) | Detección por reglas/IOCs | ✅ brew |
| `forensics` (binwalk+exiftool+hashdeep) | Triaje de binarios/metadatos/hashes | ✅ brew |
| `pcap-analyze` (tshark) | Análisis de tráfico/capturas | ✅ brew |
| `rootkit-check` (rkhunter/chkrootkit/unhide) | Detección de rootkits | ✅ brew |
| `waf-fingerprint` (wafw00f) | Identificar WAF (en tu propio sitio) | ✅ pip |
| `ssdeep`/`hashdeep` | Fuzzy hashing / hashes recursivos | ✅ brew |

## 3. ANONIMATO (opsec)

| Herramienta | Uso | Instalación |
|---|---|---|
| `tor` | Red Tor (SOCKS5 :9050) | ✅ brew |
| `torsocks` | Enruta cualquier comando por Tor | ✅ brew |
| `proxychains4` | Fuerza conexiones por proxy SOCKS/HTTP | ✅ brew |
| `anon`/`anon-curl` | Estado de Tor / request por Tor | ✅ integrado |
| `opsec-check` | Compara IP real vs Tor (detecta fuga) | ✅ integrado |
| `stripmeta` | Borra metadatos (exiftool; mat2 opcional) | ✅ exiftool |
| `encrypt`/`decrypt` | Cifrado simétrico (gpg AES-256) | ✅ gpg |
| `--profile anon` | TODO el tráfico sale por Tor (ALL_PROXY) | ✅ integrado |

---

## 3b. OSINT (email/usuario → cuentas y contraseñas reales)

Instalado en `tools/osint/.venv` (vía `uv`, Python 3.12). Se usa para pivotar de un email/usuario
encontrado en el target hacia credenciales filtradas reales.

| Herramienta | Uso | Comando |
|---|---|---|
| `holehe` | Email → sitios donde está registrado | `email-osint EMAIL` |
| `h8mail` | Email → breaches / contraseñas filtradas | `email-osint EMAIL` |
| `sherlock` | Username → cuentas en redes | `user-osint USER` |
| `maigret` | Username → cuentas (más profundo) | `user-osint USER` |
| `socialscan` | Email/usuario → disponibilidad/disponibilidad en sitios | `socialscan EMAIL\|USER` |

Flujo típico: encontrás un email en el target → `email-osint email` (holehe+h8mail) → si salen
contraseñas filtradas, probarlas con `hydra`/`wpscan` contra el login. Si encontrás un username →
`user-osint user` para mapear cuentas y elegir vectores.

> Complementa con `websearch` para Google dorks, `theHarvester`/`amass` (dominios) y `h8mail -c`
> (config con APIs de breach, opcional).

---

## 3c. Anti-WAF inteligente

Cuando el target devuelve WAF/CAPTCHA/Cloudflare/hcdn/LiteSpeed/403/429/503 o JS-challenge, el agente
**no se rinde**: (1) identifica el WAF (`waf-fingerprint`/`wafscan`), (2) **busca en la web** el bypass
específico (`websearch "cloudflare bypass 2025"`, `"<waf> 403 bypass"`, `"litespeed mod_security bypass"`,
`"hcdn bypass"`), (3) aplica `browse` (fingerprint real + Tor), `evilwaf` (rota TCP/TLS/H2), `captcha`
si es CAPTCHA, rotación de UA/headers/IP, otros métodos (POST/encoding/fragmentación), (4) prueba por
otro vector (subdominio, API, origin IP).

---

## Perfiles (`--profile`)

- `offensive` (default) — red team, explota.
- `defensive` — blue team: detecta, hardenea, responde; NO explota.
- `anon` — opsec: todo por Tor, sin fugas, cifra y limpia metadatos.

## No integrado (y por qué)

- **GUI-only**: autopsy, wireshark-GUI, zenmap, ettercap-graphical, keepassxc-GUI, gpa.
- **Linux/root**: macchanger (MAC spoof), iptables/nftables/ufw, suricata/zeek/snort (IDS de kernel), unhide, chkrootkit a fondo.
- **Servicios web pesados**: faraday, dradis, xplico, neo4j, openvas, nessus, metasploit-service.
- **Hardware**: Wi-Fi/Bluetooth/SDR/RFID/CAN.
- **mat2**: falla en macOS (PyGObject); se usa `exiftool -all=` como reemplazo en `stripmeta`.

## Instalación

```sh
# 1) herramientas cross-platform (ataque+defensa+anonimato)
brew install nmap sqlmap ffuf nuclei gobuster hydra john-jumbo hashcat subfinder amass \
  yara binwalk exiftool clamav rkhunter lynis foremost hashdeep ssdeep proxychains-ng tor torsocks tshark
pip3 install --user wfuzz wafw00f

# 2) herramientas pesadas (dentro del proyecto)
~/anythreat/tools/setup.sh

# opcional
pip3 install --user volatility3
brew install osquery
```
