import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscoder, TranscodeError } from "../src/media/transcode.ts";

/**
 * A stand-in encoder that records the command line it was given, emits two chunks, and then stays
 * alive until it is killed. It is generated here rather than committed so that the executable bit
 * never decides whether these tests run.
 */
const fakeFfmpeg = () => {
  const directory = mkdtempSync(join(tmpdir(), "cine-vault-transcode-"));
  const argsFile = join(directory, "args");
  const pidFile = join(directory, "pid");
  const path = join(directory, "ffmpeg");
  writeFileSync(path, [
    "#!/bin/sh",
    `printf '%s\\n' "$@" > '${argsFile}'`,
    `echo $$ > '${pidFile}'`,
    "printf 'one'",
    "sleep 0.3",
    "printf 'two'",
    // Replace the shell with the sleeper so the recorded pid is the process that must die.
    "exec sleep 30",
    "",
  ].join("\n"));
  chmodSync(path, 0o755);
  return {
    path,
    args: () => readFileSync(argsFile, "utf8").trim().split("\n"),
    pid: () => Number(readFileSync(pidFile, "utf8").trim()),
  };
};

const leasePath = (id = "a".repeat(32)) => `/player/${id}/index.mpd`;
const source = `http://127.0.0.1:8787${leasePath()}`;

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition was never met");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** Reading a stream to its end, then cancelling, is how a browser abandoning a title looks. */
const readChunks = async (response: Response, count: number): Promise<string> => {
  const reader = response.body!.getReader();
  let text = "";
  while (text.length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  await reader.cancel();
  return text;
};

test("a transcode runs ffmpeg on the lease and streams a fragmented MP4 to the caller", async () => {
  const ffmpeg = fakeFfmpeg();
  const transcoder = createTranscoder({ ffmpegPath: ffmpeg.path });
  assert.equal(transcoder.ffmpeg, ffmpeg.path);
  const response = transcoder.stream({ source, height: 480, ladder: [1080, 720, 480], from: 12 });
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(await readChunks(response, 6), "onetwo");
  const args = ffmpeg.args();
  // Seek before the input, so a restart lands on a keyframe instead of decoding from the beginning.
  assert.deepEqual(args.slice(0, 6), ["-hide_banner", "-nostdin", "-loglevel", "error", "-ss", "12.000"]);
  assert.equal(args[args.indexOf("-i") + 1], source);
  // The 480p rung is the third video stream the manifest lists.
  assert.equal(args[args.indexOf("-map") + 1], "0:v:2");
  assert.ok(args.includes("libx264") && args.includes("ultrafast"));
  // The output must be playable while it is still being written, or a browser shows nothing.
  assert.ok(args.includes("+frag_keyframe+empty_moov+default_base_moof"));
  assert.equal(args.at(-1), "pipe:1");
  await waitFor(() => transcoder.active === 0);
});

test("the first rung needs no seek argument, and a slower reader is never buffered unboundedly", async () => {
  const ffmpeg = fakeFfmpeg();
  const transcoder = createTranscoder({ ffmpegPath: ffmpeg.path });
  const response = transcoder.stream({ source, height: 1080, ladder: [1080, 720, 480], from: 0 });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    // A reader that stops reading pauses ffmpeg rather than growing this process's memory.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(ffmpeg.args().includes("-ss"), false);
  } finally { await reader.cancel(); }
  await waitFor(() => transcoder.active === 0);
  assert.throws(() => { process.kill(ffmpeg.pid(), 0); }, "the encoder was killed with the request");
});

test("a transcode that is abandoned is killed and releases its slot", async () => {
  const ffmpeg = fakeFfmpeg();
  const transcoder = createTranscoder({ ffmpegPath: ffmpeg.path, concurrency: 1 });
  const response = transcoder.stream({ source, height: 720, ladder: [1080, 720, 480], from: 0 });
  const reader = response.body!.getReader();
  await reader.read();
  const pid = ffmpeg.pid();
  assert.equal(transcoder.active, 1);
  // While the slot is taken, another transcode is refused rather than queued behind it.
  assert.throws(() => transcoder.stream({ source, height: 480, ladder: [1080, 720, 480], from: 0 }),
    (error: unknown) => error instanceof TranscodeError && error.code === "busy" && error.status === 503);
  await reader.cancel();
  await waitFor(() => transcoder.active === 0);
  assert.throws(() => { process.kill(pid, 0); });
});

test("a machine without ffmpeg refuses a transcode instead of failing at spawn time", () => {
  const transcoder = createTranscoder({ ffmpegPath: "cine-vault-no-such-encoder" });
  assert.equal(transcoder.ffmpeg, undefined);
  assert.throws(() => transcoder.stream({ source, height: 480, ladder: [1080, 720, 480], from: 0 }),
    (error: unknown) => error instanceof TranscodeError && error.code === "unavailable");
});

test("only this relay's own lease manifest may be transcoded", () => {
  const transcoder = createTranscoder({ ffmpegPath: fakeFfmpeg().path });
  const rejected = [
    "https://127.0.0.1:8787" + leasePath(),                       // TLS is not how this server listens
    "http://evil.example.test:8787" + leasePath(),                // never a remote host
    "http://127.0.0.1:8787/media/v1.video.GET-HEAD.x/index.mpd",  // not a player lease
    "http://127.0.0.1:8787/player/short/index.mpd",               // not a lease id
    "http://127.0.0.1:8787/player/" + "a".repeat(32) + "/chunk-stream0-00001.m4s",
    "file:///etc/passwd",
    "",
  ];
  for (const invalid of rejected) {
    assert.throws(() => transcoder.stream({ source: invalid, height: 480, ladder: [1080, 720, 480], from: 0 }),
      (error: unknown) => error instanceof TranscodeError && error.code === "invalid_request" && error.status === 400, invalid);
  }
});

test("a height, a start second or a ladder outside the lease's own is refused", () => {
  const transcoder = createTranscoder({ ffmpegPath: fakeFfmpeg().path });
  const ladder = [1080, 720, 480];
  for (const height of [360, 1440, 0, -480, 480.5, Number.NaN]) {
    assert.throws(() => transcoder.stream({ source, height, ladder, from: 0 }),
      (error: unknown) => error instanceof TranscodeError && error.code === "invalid_request", String(height));
  }
  for (const from of [-1, 86_401, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => transcoder.stream({ source, height: 480, ladder, from }),
      (error: unknown) => error instanceof TranscodeError && error.code === "invalid_request", String(from));
  }
  assert.throws(() => transcoder.stream({ source, height: 480, ladder: [1080.5, 720, 480], from: 0 }),
    (error: unknown) => error instanceof TranscodeError && error.code === "invalid_request");
  assert.throws(() => transcoder.stream({ source, height: 480, ladder: Array.from({ length: 33 }, (_v, i) => 144 + i), from: 0 }),
    (error: unknown) => error instanceof TranscodeError && error.code === "invalid_request");
  assert.throws(() => createTranscoder({ ffmpegPath: "ffmpeg", concurrency: 0 }), /Invalid transcoder configuration/);
  assert.throws(() => createTranscoder({ ffmpegPath: "ffmpeg", concurrency: 9 }), /Invalid transcoder configuration/);
  assert.throws(() => createTranscoder({ ffmpegPath: "ffmpeg", maxMs: 1_000 }), /Invalid transcoder configuration/);
});

test("an already-cancelled request never starts an encoder", () => {
  const ffmpeg = fakeFfmpeg();
  const transcoder = createTranscoder({ ffmpegPath: ffmpeg.path });
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => transcoder.stream({ source, height: 480, ladder: [1080, 720, 480], from: 0 }, controller.signal),
    (error: unknown) => error instanceof TranscodeError && error.code === "unavailable");
  assert.equal(transcoder.active, 0);
  assert.equal(existsSync(join(ffmpeg.path, "..", "pid")), false);
});
