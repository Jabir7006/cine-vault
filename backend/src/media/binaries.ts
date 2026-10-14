import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Finding the external programs this server is allowed to run.
 *
 * Only `ffmpeg` and a known media player are ever spawned, and both are located by name on PATH —
 * never by anything a request supplies. A missing program is reported to the caller instead of
 * failing at spawn time, so the UI can offer only what actually exists here.
 */
export function onPath(name: string): string | undefined {
  if (typeof name !== "string" || !name) return undefined;
  if (isAbsolute(name)) {
    try { accessSync(name, constants.X_OK); return name; } catch { return undefined; }
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return undefined;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* keep looking */ }
  }
  return undefined;
}
