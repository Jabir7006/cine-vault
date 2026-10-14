import { spawn } from "node:child_process";
import { onPath } from "./binaries.ts";
import { PLAYER_PREFIX } from "./player.ts";

/**
 * Browser playback of a stream the browser cannot decode.
 *
 * The signed ladder for these titles is HEVC, which no browser on this machine decodes, and the CDN
 * offers no H.264 rendition of it. So the browser is served an H.264 rendition produced here:
 * fragmented MP4 over a chunked response, which an ordinary `<video>` element starts playing as soon
 * as the first fragment arrives, without a manifest or a player library.
 *
 * Measured on this machine, the encoder is not the constraint. Transcoding the 480p rung with
 * `libx264 -preset ultrafast` runs at the same speed as copying the same rung untouched — both are
 * limited by fetching the source, which is why the source here is this relay's own lease and not the
 * CDN. That also means there is nothing to gain from a hardware encoder.
 *
 * Seeking is a restart: the response has no index and no duration, so the client asks for a new
 * response starting at a different second. `mpv` on the same lease has none of these limits.
 */
export interface TranscoderOptions {
  ffmpegPath: string;
  /** Transcodes that may run at once: each is a decoder and an encoder on this machine. */
  concurrency?: number;
  /** A single transcode is stopped after this long, so a stalled reader cannot hold a slot. */
  maxMs?: number;
  /** How long a killed transcode is given to exit before it is killed outright. */
  killMs?: number;
}

export interface TranscodeRequest {
  /** Loopback URL of the lease manifest this transcode reads. */
  source: string;
  /** Height to transcode; must be one the lease advertises. */
  height: number;
  /** Every advertised height, in the manifest's own order — a height's position is its stream index. */
  ladder: readonly number[];
  /** Seconds into the title to begin at. */
  from: number;
}

export class TranscodeError extends Error {
  constructor(readonly code: "invalid_request" | "busy" | "unavailable", readonly status: 400 | 503) {
    super(`Transcode ${code.replaceAll("_", " ")}`);
    this.name = "TranscodeError";
  }
}

export interface Transcoder {
  stream(request: TranscodeRequest, signal?: AbortSignal): Response;
  /** Where ffmpeg was found, or undefined when it is not installed here. */
  readonly ffmpeg?: string;
  readonly active: number;
}

const bounded = (value: number | undefined, fallback: number, max: number, min: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid transcoder configuration");
  return value;
};

/** Only this relay's own lease manifests, over plain loopback HTTP: never an arbitrary URL. */
const LOCAL_MANIFEST = new RegExp(
  `^http://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):\\d{1,5}${PLAYER_PREFIX}[A-Za-z0-9_-]{32}/index\\.mpd$`,
);

/** The output is written into a pipe, so it must be a fragmented MP4 that plays as it grows. */
function arguments_(request: TranscodeRequest, index: number): string[] {
  return [
    "-hide_banner", "-nostdin", "-loglevel", "error",
    // Input seek: jump before decoding rather than after, which is what makes a restart cheap.
    ...(request.from > 0 ? ["-ss", request.from.toFixed(3)] : []),
    "-i", request.source,
    "-map", `0:v:${index}`, "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p",
    // A keyframe every two seconds at film rates: a player that joins late still resynchronises fast.
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "96k", "-ac", "2",
    "-map_metadata", "-1",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-flush_packets", "1",
    "-f", "mp4", "pipe:1",
  ];
}

export function createTranscoder(options: TranscoderOptions): Transcoder {
  const concurrency = bounded(options.concurrency, 2, 8, 1);
  const maxMs = bounded(options.maxMs, 4 * 60 * 60_000, 12 * 60 * 60_000, 60_000);
  const killMs = bounded(options.killMs, 3_000, 10_000, 100);
  // Resolved once, at startup: no request may name the program that gets executed.
  const ffmpeg = onPath(options.ffmpegPath);
  let active = 0;

  const start = (child: ReturnType<typeof spawn>, signal: AbortSignal | undefined): Promise<void> => {
    active++;
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        active--;
        clearTimeout(timer);
        signal?.removeEventListener("abort", kill);
        resolve();
      };
      const kill = () => {
        child.kill("SIGKILL");
        // A process that will not die must not hold a slot forever.
        setTimeout(() => { child.stdout?.destroy(); finish(); }, killMs).unref?.();
      };
      const timer = setTimeout(kill, maxMs);
      signal?.addEventListener("abort", kill, { once: true });
      child.on("error", finish);
      child.on("close", finish);
    });
  };

  return {
    get active() { return active; },
    get ffmpeg() { return ffmpeg; },
    stream(request, signal) {
      if (typeof request.source !== "string" || !LOCAL_MANIFEST.test(request.source)) throw new TranscodeError("invalid_request", 400);
      const index = request.ladder.indexOf(request.height);
      if (index < 0 || request.ladder.length > 32 ||
          request.ladder.some((height) => !Number.isSafeInteger(height) || height < 144 || height > 8_192)) {
        throw new TranscodeError("invalid_request", 400);
      }
      if (!Number.isFinite(request.from) || request.from < 0 || request.from > 24 * 60 * 60) throw new TranscodeError("invalid_request", 400);
      if (signal?.aborted) throw new TranscodeError("unavailable", 503);
      if (ffmpeg === undefined) throw new TranscodeError("unavailable", 503);
      if (active >= concurrency) throw new TranscodeError("busy", 503);

      const child = spawn(ffmpeg, arguments_(request, index), { stdio: ["ignore", "pipe", "ignore"], detached: false });
      const stdout = child.stdout;
      if (!stdout) { child.kill("SIGKILL"); throw new TranscodeError("unavailable", 503); }
      const running = start(child, signal);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stdout.on("data", (chunk: Buffer) => {
            if (controller.desiredSize !== null && controller.desiredSize <= 0) stdout.pause();
            try { controller.enqueue(new Uint8Array(chunk)); } catch { stdout.destroy(); }
          });
          stdout.on("end", () => { try { controller.close(); } catch { /* already closed by the reader */ } });
          stdout.on("error", () => { try { controller.close(); } catch { /* already closed by the reader */ } });
        },
        // Backpressure: a browser that reads slowly pauses ffmpeg instead of growing this buffer.
        pull() { stdout.resume(); },
        cancel() { child.kill("SIGKILL"); },
      });
      // The slot is released when ffmpeg exits, whether the body was read to the end or abandoned.
      void running.catch(() => undefined);
      return new Response(body, {
        headers: {
          "content-type": "video/mp4",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    },
  };
}
