import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createMediaRegistry, MAX_MEDIA_TTL_MS, UPSTREAM_EXPIRY_MARGIN_MS } from "../src/media/registry.js";
import type { MediaRegistry, MediaResource } from "../src/media/types.js";

// Synthetic offline key and resource only, never an upstream credential.
const KEY = "ab".repeat(32);
const NOW = 1_700_000_000_000;
function resource(overrides: Partial<MediaResource> = {}): MediaResource {
  return { url: "https://media.example.test/video.mp4?signature=private-fixture", kind: "video",
    headers: { Cookie: "offline-private-cookie" }, ...overrides };
}
function fixture(options: { ttlMs?: number; capacity?: number } = {}) {
  let now = NOW;
  const registry = createMediaRegistry({ signingKey: KEY, now: () => now, ...options });
  return { registry, setNow: (value: number) => { now = value; } };
}
function sign(parts: string[]): string {
  const payload = parts.join(".");
  const signature = createHmac("sha256", Buffer.from(KEY, "hex"))
    .update(`cine-vault/media-capability\n${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

test("opaque capabilities implement existing interface and authorize only GET and HEAD", () => {
  const { registry } = fixture();
  const compatible: MediaRegistry = registry;
  const token = compatible.register(resource(), NOW + 120_000);
  assert.deepEqual(compatible.resolve(token, "GET"), compatible.resolve(token, "HEAD"));
  assert.equal(compatible.resolve(token, "GET")?.kind, "video");
  for (const method of ["POST", "PUT", "OPTIONS", "DELETE", "get", "head", " GET", "GET\n", ""]) {
    assert.equal(compatible.resolve(token, method), undefined);
  }
  assert.equal(registry.expiresAt(token), NOW + 120_000);
  for (const secret of ["example", "https", "private-fixture", "Cookie", "offline-private-cookie", KEY]) {
    assert.ok(!token.includes(secret));
  }
  const subtitle = compatible.register(resource({ kind: "subtitle", captionFormat: "srt" }), NOW + 120_000);
  assert.equal(compatible.resolve(subtitle, "HEAD")?.kind, "subtitle");
  assert.notEqual(token, compatible.register(resource(), NOW + 120_000));
});

test("tampered purpose, ID, method scope, expiry and signature fail closed", () => {
  const { registry } = fixture();
  const token = registry.register(resource(), NOW + 120_000);
  const parts = token.split(".");
  for (const [index, replacement] of [[0, "v2"], [1, "subtitle"], [2, "POST"], [2, "HEAD-GET"],
    [3, "Z".repeat(32)], [4, String(NOW + 119_000)], [5, "A".repeat(43)]] as const) {
    const modified = [...parts]; modified[index] = replacement;
    assert.equal(registry.resolve(modified.join("."), "GET"), undefined);
  }
  for (const malformed of ["", `${token}=`, ` ${token}`, `${token}\n`, token.replace("v1", "V1"), "x".repeat(100_000)]) {
    assert.equal(registry.resolve(malformed, "GET"), undefined);
  }
  // A noncanonical base64url encoding may decode to the same signature bytes.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const signature = parts[5]!;
  const last = alphabet.indexOf(signature.at(-1)!);
  const alias = `${token.slice(0, -1)}${alphabet[last + 1]}`;
  assert.equal(Buffer.from(alias.split(".")[5]!, "base64url").equals(Buffer.from(signature, "base64url")), true);
  assert.equal(registry.resolve(alias, "GET"), undefined);
  assert.ok(registry.resolve(token, "GET"));
});

test("even correctly signed unknown IDs and mismatched entry claims cannot resolve", () => {
  const { registry } = fixture();
  const token = registry.register(resource(), NOW + 120_000);
  const parts = token.split(".").slice(0, 5);
  const unknown = [...parts]; unknown[3] = "Z".repeat(32);
  assert.equal(registry.resolve(sign(unknown), "GET"), undefined);
  const kind = [...parts]; kind[1] = "subtitle";
  assert.equal(registry.resolve(sign(kind), "GET"), undefined);
  const expiry = [...parts]; expiry[4] = String(NOW + 90_000);
  assert.equal(registry.resolve(sign(expiry), "GET"), undefined);
  const leadingZero = [...parts]; leadingZero[4] = `0${parts[4]}`;
  assert.equal(registry.resolve(sign(leadingZero), "GET"), undefined);
});

test("expiry respects configured TTL, upstream safety margin and exact expiry boundary", () => {
  const { registry, setNow } = fixture({ ttlMs: 120_000 });
  const ttl = registry.register(resource(), NOW + 999_000);
  assert.equal(registry.expiresAt(ttl), NOW + 120_000);
  const upstream = registry.register(resource({ expiresAt: NOW + 90_000 }), NOW + 999_000);
  assert.equal(registry.expiresAt(upstream), NOW + 90_000 - UPSTREAM_EXPIRY_MARGIN_MS);
  setNow(NOW + 29_999);
  assert.ok(registry.resolve(upstream, "GET"));
  setNow(NOW + 30_000);
  assert.equal(registry.resolve(upstream, "HEAD"), undefined);
  assert.equal(registry.expiresAt(upstream), undefined);
  assert.ok(registry.resolve(ttl, "GET"));
  setNow(NOW + 120_000);
  assert.equal(registry.resolve(ttl, "GET"), undefined);
  for (const expiry of [NOW, NOW - 1, Infinity, NaN, NOW + 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => registry.register(resource(), expiry));
  }
  assert.throws(() => registry.register(resource({ expiresAt: NOW + 180_000 }), NOW + 999_000));
});

test("revoke authenticates before deleting and cannot authorize another registry", () => {
  const { registry } = fixture();
  const token = registry.register(resource(), NOW + 120_000);
  const tampered = token.replace(".video.", ".subtitle.");
  registry.revoke(tampered);
  assert.ok(registry.resolve(token, "GET"));
  const other = createMediaRegistry({ signingKey: "cd".repeat(32), now: () => NOW });
  assert.equal(other.resolve(token, "GET"), undefined);
  assert.equal(fixture().registry.resolve(token, "GET"), undefined);
  registry.revoke(token);
  assert.equal(registry.resolve(token, "GET"), undefined);
  assert.equal(registry.expiresAt(token), undefined);
  registry.revoke(token);
});

test("keys are explicit, strict hex or copied bytes and errors do not leak key material", () => {
  for (const signingKey of [undefined, "", "secret", "ab".repeat(31), "ab".repeat(33), "zz".repeat(32),
    ` ${KEY}`, `${KEY}\n`, new Uint8Array(31)] as unknown[]) {
    assert.throws(() => createMediaRegistry({ signingKey: signingKey as string }),
      (error: unknown) => error instanceof Error && !error.message.includes(KEY));
  }
  assert.ok(createMediaRegistry({ signingKey: KEY.toUpperCase() }));
  assert.ok(createMediaRegistry({ signingKey: new Uint8Array(64) }));
  const bytes = Buffer.from(KEY, "hex");
  const registry = createMediaRegistry({ signingKey: bytes, now: () => NOW });
  const token = registry.register(resource(), NOW + 120_000);
  bytes.fill(0);
  assert.equal(sign(token.split(".").slice(0, 5)), token);
  assert.ok(registry.resolve(token, "GET"));
  const afterMutation = registry.register(resource(), NOW + 121_000);
  assert.equal(afterMutation, sign(afterMutation.split(".").slice(0, 5)));
});

test("invalid TTL/capacity fail rather than create unbounded registries", () => {
  for (const ttlMs of [0, -1, NaN, Infinity, 1.5, MAX_MEDIA_TTL_MS + 1]) {
    assert.throws(() => createMediaRegistry({ signingKey: KEY, ttlMs }));
  }
  for (const capacity of [0, -1, NaN, Infinity, 1.5, 10_001]) {
    assert.throws(() => createMediaRegistry({ signingKey: KEY, capacity }));
  }
  assert.ok(createMediaRegistry({ signingKey: KEY, ttlMs: MAX_MEDIA_TTL_MS, capacity: 1 }));
});

test("capacity evicts FIFO and prunes expired entries before evicting valid ones", () => {
  const { registry, setNow } = fixture({ capacity: 2 });
  const first = registry.register(resource({ label: "first" }), NOW + 120_000);
  const second = registry.register(resource({ label: "second" }), NOW + 10_000);
  registry.resolve(first, "GET");
  const third = registry.register(resource({ label: "third" }), NOW + 120_000);
  assert.equal(registry.resolve(first, "GET"), undefined);
  assert.ok(registry.resolve(second, "GET"));
  assert.ok(registry.resolve(third, "GET"));
  setNow(NOW + 10_000);
  const fourth = registry.register(resource({ label: "fourth" }), NOW + 120_000);
  assert.equal(registry.resolve(second, "GET"), undefined);
  assert.ok(registry.resolve(third, "GET"));
  assert.ok(registry.resolve(fourth, "GET"));
});

test("server-owned descriptors and headers are defensive immutable copies", () => {
  const { registry } = fixture();
  const input = resource({ height: 720, codec: "h264", resourceId: "fixture", lang: "en", label: "fixture", captionFormat: "vtt" });
  const token = registry.register(input, NOW + 120_000);
  input.url = "https://other.example.test/";
  (input.headers as Record<string, string>).Cookie = "changed";
  input.kind = "subtitle";
  input.label = "changed";
  const owned = registry.resolve(token, "GET")!;
  assert.notEqual(owned, input);
  assert.notEqual(owned.headers, input.headers);
  assert.equal(owned.url, "https://media.example.test/video.mp4?signature=private-fixture");
  assert.equal(owned.kind, "video");
  assert.equal(owned.label, "fixture");
  assert.equal(owned.headers.Cookie, "offline-private-cookie");
  assert.equal(Object.isFrozen(owned), true);
  assert.equal(Object.isFrozen(owned.headers), true);
  assert.throws(() => { owned.url = "https://changed.example.test/"; }, TypeError);
  assert.throws(() => { (owned.headers as Record<string, string>).Cookie = "changed"; }, TypeError);
});

test("descriptors reject unsafe URL shape, unsupported kinds and malformed metadata", () => {
  const { registry } = fixture();
  for (const url of ["http://media.example.test/x", "file:///x", "//media.example.test/x", "https://user:pass@media.example.test/x",
    "https://@media.example.test/x", "https://media.example.test:8443/x", "https://media.example.test/x#fragment",
    "https://media.example.test/x#", "https://media.example.test/\nx", "https://media.example.test/\\x", "https://", "not a URL"]) {
    assert.throws(() => registry.register(resource({ url }), NOW + 120_000),
      (error: unknown) => error instanceof Error && !error.message.includes(url));
  }
  assert.ok(registry.register(resource({ url: "https://media.example.test:443/x" }), NOW + 120_000));
  for (const overrides of [{ kind: "manifest" }, { expiresAt: NaN }, { height: -1 }, { height: 1.5 }, { captionFormat: "ass" },
    { headers: { Cookie: "value\r\nInjected: yes" } }, { headers: { "bad name": "value" } },
    { headers: { Cookie: "a".repeat(16_385) } }, { label: "a".repeat(1_025) }, { codec: {} }]) {
    assert.throws(() => registry.register(resource(overrides as Partial<MediaResource>), NOW + 120_000));
  }
});
