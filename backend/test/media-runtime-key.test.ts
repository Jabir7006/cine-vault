import assert from "node:assert/strict";
import test from "node:test";
import { resolveRelaySigningKey } from "../src/media/runtime-key";
import { createMediaRegistry } from "../src/media/registry";

test("absent relay configuration generates one random process-local key usable by the registry", () => {
  const key = resolveRelaySigningKey("");
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(resolveRelaySigningKey(""), key);
  const registry = createMediaRegistry({ signingKey: key });
  const token = registry.register({ kind: "video", url: "https://media.example.test/fixture.mp4", headers: {} }, Date.now() + 60000);
  assert.equal(registry.resolve(token, "GET")?.kind, "video");
});

test("explicit relay keys remain supported and malformed keys do not silently fall back", () => {
  const key = "ab".repeat(32);
  assert.equal(resolveRelaySigningKey(key), key);
  for (const value of [" ", "placeholder", "ab".repeat(31), "ab".repeat(33), ` ${key}`, `${key} `]) {
    assert.throws(() => resolveRelaySigningKey(value), { message: "Invalid relay signing configuration" });
  }
});
