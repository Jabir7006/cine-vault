import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativePlayer, NativePlayerError } from "../src/media/native.ts";

/** A stand-in player that records how it was invoked and exits immediately. */
const fakePlayer = () => {
  const directory = mkdtempSync(join(tmpdir(), "cine-vault-native-"));
  const argsFile = join(directory, "args");
  const path = join(directory, "fake-player");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\n`);
  chmodSync(path, 0o755);
  return { path, args: () => existsSync(argsFile) ? readFileSync(argsFile, "utf8").trim().split("\n") : undefined };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition was never met");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

test("a lease manifest is handed to an installed player, with the title after every option", async () => {
  const player = fakePlayer();
  const native = createNativePlayer({ candidates: [player.path] });
  assert.equal(native.available, player.path);
  assert.deepEqual(native.launch(`http://127.0.0.1:8787/player/${"a".repeat(32)}/index.mpd`, "Some Film (2024)"), { player: "fake-player" });
  await waitFor(() => player.args() !== undefined);
  const args = player.args()!;
  assert.equal(args[0], "--force-window=yes");
  assert.equal(args[1], "--title=Some Film (2024)");
  // The URL comes last and after `--`, so nothing in a lease URL or a title can be read as an option.
  assert.equal(args.at(-2), "--");
  assert.match(args.at(-1)!, /^http:\/\/127\.0\.0\.1:8787\/player\/a{32}\/index\.mpd$/);
});

test("a title is optional and a missing player is reported instead of spawned", async () => {
  const player = fakePlayer();
  const native = createNativePlayer({ candidates: [player.path] });
  native.launch(`http://localhost:8787/player/${"b".repeat(32)}/index.mpd`);
  await waitFor(() => player.args() !== undefined);
  assert.equal(player.args()![1], "--");

  const absent = createNativePlayer({ candidates: ["cine-vault-no-such-player"] });
  assert.equal(absent.available, undefined);
  assert.throws(() => absent.launch(`http://127.0.0.1:8787/player/${"c".repeat(32)}/index.mpd`),
    (error: unknown) => error instanceof NativePlayerError && error.code === "no_player" && error.status === 503);
});

test("only this relay's own lease manifest may be opened, and a title cannot smuggle options", async () => {
  const player = fakePlayer();
  const native = createNativePlayer({ candidates: [player.path] });
  for (const url of [
    `https://127.0.0.1:8787/player/${"a".repeat(32)}/index.mpd`,
    `http://127.0.0.1:8787/player/${"a".repeat(31)}/index.mpd`,
    `http://127.0.0.1:8787/media/${"a".repeat(32)}`,
    `http://evil.example.test/player/${"a".repeat(32)}/index.mpd`,
    "http://127.0.0.1:8787/player/" + "a".repeat(32) + "/index.mpd?x=--script",
    "",
  ]) {
    assert.throws(() => native.launch(url), (error: unknown) => error instanceof NativePlayerError && error.code === "invalid_request", url);
  }
  const valid = `http://127.0.0.1:8787/player/${"a".repeat(32)}/index.mpd`;
  for (const title of ["line\nbreak", "bell\x07", "\x00", "x".repeat(121)]) {
    assert.throws(() => native.launch(valid, title), (error: unknown) => error instanceof NativePlayerError && error.code === "invalid_request");
  }
  // Nothing was ever started by a refused request.
  assert.equal(player.args(), undefined);
});

test("a repeated launch is refused rather than opening a second window", async () => {
  const player = fakePlayer();
  const native = createNativePlayer({ candidates: [player.path], minIntervalMs: 60_000 });
  const url = `http://127.0.0.1:8787/player/${"d".repeat(32)}/index.mpd`;
  native.launch(url);
  assert.throws(() => native.launch(url), (error: unknown) => error instanceof NativePlayerError && error.code === "rate_limited" && error.status === 429);
  await waitFor(() => player.args() !== undefined);
  assert.equal(player.args()![0], "--force-window=yes");
});

test("native player configuration outside its bounds is refused", () => {
  for (const options of [{ candidates: [] }, { candidates: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q"] }, { minIntervalMs: -1 }, { minIntervalMs: 60_001 }]) {
    assert.throws(() => createNativePlayer(options), /Invalid native player configuration/);
  }
  // A candidate that is a path traversal or a shell string is never resolved.
  const suspicious = createNativePlayer({ candidates: ["../bin/sh", "/bin/sh -c whoami", "sh;whoami"] });
  assert.equal(suspicious.available, undefined);
});
