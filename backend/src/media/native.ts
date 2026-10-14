import { spawn } from "node:child_process";
import { onPath } from "./binaries.ts";
import { PLAYER_PREFIX } from "./player.ts";

/**
 * Playing a lease in a native player on this machine.
 *
 * The browser is the only client that has to be served a transcode, and the only one that cannot
 * seek a two and a half hour title comfortably. A native player on the same machine can read the
 * lease's signed DASH manifest as it is — software-decoding the HEVC ladder with full seeking and
 * hardware output — so this is offered alongside browser playback rather than instead of it.
 *
 * The process is detached and unreferenced: it outlives the request that asked for it, and its
 * output does not belong to this server. Only this relay's own loopback lease manifests are allowed.
 */
export interface NativePlayerOptions {
  /** Players to look for on PATH, in preference order. */
  candidates?: readonly string[];
  /** Launches closer together than this are refused, so a stuck button cannot spawn a crowd. */
  minIntervalMs?: number;
}

export class NativePlayerError extends Error {
  constructor(readonly code: "invalid_request" | "no_player" | "rate_limited" | "failed", readonly status: 400 | 429 | 503) {
    super(`Native player ${code.replaceAll("_", " ")}`);
    this.name = "NativePlayerError";
  }
}

export interface NativePlayer {
  /** Name of the player that will be used, or undefined when none is installed. */
  readonly available?: string;
  launch(url: string, title?: string): { player: string };
}

const LOCAL_MANIFEST = new RegExp(
  `^http://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):\\d{1,5}${PLAYER_PREFIX}[A-Za-z0-9_-]{32}/index\\.mpd$`,
);
const DEFAULT_CANDIDATES = ["mpv", "vlc", "celluloid", "smplayer", "totem"] as const;

/** A player is started with the URL last and after `--`, so a title can never be read as an option. */
function argumentsFor(url: string, title: string | undefined): string[] {
  return [
    "--force-window=yes",
    ...(title ? [`--title=${title}`] : []),
    "--",
    url,
  ];
}

export function createNativePlayer(options: NativePlayerOptions = {}): NativePlayer {
  const candidates = options.candidates ?? DEFAULT_CANDIDATES;
  const minInterval = options.minIntervalMs ?? 2_000;
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 16 ||
      !Number.isSafeInteger(minInterval) || minInterval < 0 || minInterval > 60_000) {
    throw new Error("Invalid native player configuration");
  }
  let found: string | undefined;
  for (const candidate of candidates) {
    const path = onPath(candidate);
    if (path !== undefined) { found = path; break; }
  }
  let lastLaunch = 0;
  return {
    get available() { return found; },
    launch(url, title) {
      if (typeof url !== "string" || !LOCAL_MANIFEST.test(url)) throw new NativePlayerError("invalid_request", 400);
      if (title !== undefined && (typeof title !== "string" || title.length > 120 || /[\x00-\x1f\x7f]/.test(title))) {
        throw new NativePlayerError("invalid_request", 400);
      }
      if (found === undefined) throw new NativePlayerError("no_player", 503);
      const now = Date.now();
      if (now - lastLaunch < minInterval) throw new NativePlayerError("rate_limited", 429);
      lastLaunch = now;
      const child = spawn(found, argumentsFor(url, title), { detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      // The request is over; the player is not this server's child to wait for.
      child.unref();
      return { player: found.split("/").pop() ?? found };
    },
  };
}
