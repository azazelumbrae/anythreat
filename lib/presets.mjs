// DeepSeek model presets. "flash" = rápido, "pro" = más fuerte.
// thinking: 'enabled' | 'disabled'  -> se manda como {thinking:{type}}
export const PRESETS = {
  flash:    { model: "deepseek-flash",  thinking: "disabled", note: "rápido, sin thinking" },
  "flash-nt": { model: "deepseek-flash", thinking: "disabled", note: "flash sin thinking" },
  pro:      { model: "deepseek-v4-pro", thinking: "enabled",  note: "pro con thinking" },
  "pro-nt": { model: "deepseek-v4-pro", thinking: "disabled", note: "pro sin thinking" },
};

// Resolve preset -> {model, thinking, reasoning}. Explicit flags win.
export function resolvePreset(flags = {}) {
  const name = flags.preset;
  if (!name) return {};
  const p = PRESETS[name];
  if (!p) {
    throw new Error(`Preset desconocido: ${name}. Opciones: ${Object.keys(PRESETS).join(", ")}`);
  }
  const thinking = flags.thinking || p.thinking;
  const reasoning = flags.reasoning || (thinking === "enabled" ? "high" : undefined);
  return { model: flags.model || p.model, thinking, reasoning };
}
