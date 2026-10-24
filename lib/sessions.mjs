// Named sessions: persist the agent conversation so you can resume later.
// Stored under ~/anythreat/sessions/<slug>/session.json (+ its own workdir/findings).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const ROOT = path.join(HOME, "anythreat", "sessions");

function ensure() { fs.mkdirSync(ROOT, { recursive: true }); }
function slugify(name) {
  return (String(name || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "session";
}
function stamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-"); }

export function listSessions() {
  ensure();
  const out = [];
  for (const d of fs.readdirSync(ROOT)) {
    const f = path.join(ROOT, d, "session.json");
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      out.push({ dir: d, ...j });
    } catch {}
  }
  out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return out;
}

// Create a new named session. Returns its record.
export function createSession(name) {
  ensure();
  const base = slugify(name);
  let dir = base;
  let n = 1;
  while (fs.existsSync(path.join(ROOT, dir))) dir = `${base}-${n++}`;
  const workdir = path.join(ROOT, dir, "work");
  fs.mkdirSync(workdir, { recursive: true });
  const rec = {
    name: String(name || dir).trim() || dir,
    createdAt: stamp(),
    updatedAt: stamp(),
    dir,
    workdir,
    framework: null,
    vars: {},
    messages: null,
  };
  fs.writeFileSync(path.join(ROOT, dir, "session.json"), JSON.stringify(rec, null, 2));
  return rec;
}

export function loadSession(dir) {
  const f = path.join(ROOT, dir, "session.json");
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

export function saveSession(rec) {
  if (!rec || !rec.dir) return;
  ensure();
  rec.updatedAt = stamp();
  const f = path.join(ROOT, rec.dir, "session.json");
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec, null, 2));
  } catch {}
}
