// One line per step: time, a short step name, key=value fields, then words.
//   2026-11-04T10:00:00.000Z download job=1a2b3c4d video=5e6f7a8b 1.2 GB in 14.1s

export function formatLine(step, fields = {}, text = "", now = new Date()) {
  const kv = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, "_")}`)
    .join(" ");
  return [now.toISOString(), step, kv, text].filter(Boolean).join(" ");
}

export function createLogger(write = (line) => process.stdout.write(line + "\n")) {
  return (step, fields, text) => write(formatLine(step, fields, text));
}

/** 1288490188 -> "1.2 GB" */
export function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(bytes) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

export function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}
