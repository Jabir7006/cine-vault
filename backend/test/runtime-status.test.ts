import assert from "node:assert/strict";
import test from "node:test";
import { parseListenerHost, listenerUrl } from "../src/listener";
import { createApp } from "../src/app";
import { createRuntimeServices } from "../src/moviebox/runtime";
import { assessMovieBoxSetup, isMovieBoxSetupReason } from "../src/moviebox/runtime-status";
import type { MovieBoxRuntimeConfig } from "../src/moviebox/runtime-status";
import { createSourceService } from "../src/providers";
import type { MovieBoxSetupReason, MovieBoxStatus } from "../src/providers/types";

const valid: MovieBoxRuntimeConfig = {
  movieboxSecretHex: "ab".repeat(30),
  relaySignKey: "cd".repeat(32),
  tmdb: { apiKey: "private-fixture-tmdb-token", baseUrl: "https://api.themoviedb.org/3" },
  mediaHosts: ["media.fixture.test"],
  captionHosts: ["caption.fixture.test"],
};

const blockedFixtures: Array<{ config: MovieBoxRuntimeConfig; reason: MovieBoxSetupReason }> = [
  { config: { ...valid, movieboxSecretHex: "" }, reason: "missing_signing_key" },
  { config: { ...valid, movieboxSecretHex: " \t" }, reason: "missing_signing_key" },
  { config: { ...valid, movieboxSecretHex: "private-invalid-signing-key" }, reason: "invalid_signing_key" },
  { config: { ...valid, movieboxSecretHex: "ab".repeat(29) }, reason: "invalid_signing_key" },
  { config: { ...valid, movieboxSecretHex: "ab".repeat(31) }, reason: "invalid_signing_key" },
  { config: { ...valid, movieboxSecretHex: ` ${valid.movieboxSecretHex}` }, reason: "invalid_signing_key" },
  { config: { ...valid, tmdb: { ...valid.tmdb, apiKey: "" } }, reason: "missing_tmdb_token" },
  { config: { ...valid, tmdb: { ...valid.tmdb, apiKey: " \t" } }, reason: "missing_tmdb_token" },
  { config: { ...valid, mediaHosts: [] }, reason: "missing_media_hosts" },
  { config: { ...valid, relaySignKey: "private-invalid-relay-key" }, reason: "invalid_relay_key" },
  { config: { ...valid, relaySignKey: "cd".repeat(31) }, reason: "invalid_relay_key" },
  { config: { ...valid, relaySignKey: "cd".repeat(33) }, reason: "invalid_relay_key" },
  { config: { ...valid, relaySignKey: " " }, reason: "invalid_relay_key" },
  { config: { ...valid, relaySignKey: `${valid.relaySignKey} ` }, reason: "invalid_relay_key" },
];

function assertNoConfigValues(value: unknown, fixture: MovieBoxRuntimeConfig) {
  const serialized = JSON.stringify(value);
  for (const secret of [fixture.movieboxSecretHex, fixture.relaySignKey, fixture.tmdb.apiKey,
    fixture.tmdb.baseUrl, ...fixture.mediaHosts, ...fixture.captionHosts]) {
    if (secret.trim()) assert.equal(serialized.includes(secret), false);
  }
}

test("pure setup assessment checks presence and exact signing/optional relay formats", () => {
  for (const fixture of blockedFixtures) {
    assert.equal(assessMovieBoxSetup(fixture.config), fixture.reason);
  }
  assert.equal(assessMovieBoxSetup(valid), undefined);
  assert.equal(assessMovieBoxSetup({ ...valid, relaySignKey: "", captionHosts: [] }), undefined);
  assert.equal(assessMovieBoxSetup({ ...valid, movieboxSecretHex: valid.movieboxSecretHex.toUpperCase(),
    relaySignKey: valid.relaySignKey.toUpperCase() }), undefined);
  // Presence/format diagnosis does not implement transport host admission or TMDB authorization.
  assert.equal(assessMovieBoxSetup({ ...valid, mediaHosts: ["not-a-host"],
    tmdb: { ...valid.tmdb, baseUrl: "not-a-url" } }), undefined);
});

test("runtime setup gates return only fixed reasons and unchanged embed candidates", async () => {
  const expectedEmbeds = (await createSourceService()("movie", "42")).sources;
  for (const fixture of blockedFixtures) {
    const services = createRuntimeServices(fixture.config);
    assert.equal(services.media, undefined);
    assert.equal(services.playback, undefined);
    const response = await services.sources("movie", "42");
    assert.deepEqual(response.moviebox, { status: "blocked_setup", reason: fixture.reason });
    assert.deepEqual(response.sources, expectedEmbeds);
    assertNoConfigValues(response, fixture.config);
  }
});

test("constructor failures become invalid_configuration without exposing exception details", async () => {
  for (const fixture of [
    { ...valid, tmdb: { ...valid.tmdb, baseUrl: "private-invalid-base-url" } },
    { ...valid, mediaHosts: ["private-invalid-host"] },
    { ...valid, captionHosts: ["private-invalid-caption-host"] },
  ]) {
    const services = createRuntimeServices(fixture);
    const response = await services.sources("movie", "42");
    assert.deepEqual(response.moviebox, { status: "blocked_setup", reason: "invalid_configuration" });
    assert.equal(services.media, undefined);
    assert.equal(services.playback, undefined);
    assertNoConfigValues(response, fixture);
  }
});

test("valid runtime construction preserves progressive playback and optional automatic relay key without requests", (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected live request"); });
  for (const relaySignKey of [valid.relaySignKey, ""]) {
    const services = createRuntimeServices({ ...valid, relaySignKey });
    assert.ok(services.media);
    assert.ok(services.playback);
    assert.equal(typeof services.sources, "function");
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("source service remains backwards compatible and reason exists only for blocked_setup", async () => {
  assert.deepEqual((await createSourceService()("movie", "42")).moviebox, { status: "blocked_setup" });
  for (const reason of ["missing_signing_key", "invalid_signing_key", "missing_tmdb_token",
    "missing_media_hosts", "invalid_relay_key", "invalid_configuration"] as const) {
    assert.equal(isMovieBoxSetupReason(reason), true);
    assert.deepEqual((await createSourceService(undefined, reason)("movie", "42")).moviebox,
      { status: "blocked_setup", reason });
  }
  for (const status of ["ready", "not_found", "ambiguous", "unverified", "unsupported_adaptive",
    "unsupported_format", "unavailable"] as const satisfies readonly MovieBoxStatus[]) {
    const response = await createSourceService(async () => ({ status }), "missing_signing_key")("movie", "42");
    assert.equal("reason" in response.moviebox, false);
  }
  const failed = await createSourceService(async () => { throw new Error("private error value"); },
    "invalid_configuration")("movie", "42");
  assert.deepEqual(failed.moviebox, { status: "unavailable" });
  assert.equal(JSON.stringify(failed).includes("private error value"), false);
});

test("untrusted setup reasons and resolver fields cannot leak into the public response", async () => {
  const privateValue = "private-diagnostic-secret";
  assert.equal(isMovieBoxSetupReason(privateValue), false);
  assert.equal(isMovieBoxSetupReason({ reason: "missing_signing_key" }), false);
  const response = await createSourceService(undefined, privateValue as MovieBoxSetupReason)("movie", "42");
  assert.deepEqual(response.moviebox, { status: "blocked_setup" });
  const resolverResponse = await createSourceService(async () => ({ status: "blocked_setup", reason: privateValue }))("movie", "42");
  assert.deepEqual(resolverResponse.moviebox, { status: "blocked_setup" });
});

test("public diagnostic response retains the existing discovery access guard", async () => {
  const app = createApp({ allowedOrigins: ["http://localhost:5173"], accessToken: "fixture-access-token",
    sources: createSourceService(undefined, "missing_signing_key") });
  const denied = await app.request("/api/sources/movie/42");
  assert.equal(denied.status, 401);
  assert.equal((await denied.text()).includes("missing_signing_key"), false);
  const allowed = await app.request("/api/sources/movie/42", { headers: { "x-access-token": "fixture-access-token" } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  const body = await allowed.json() as { moviebox: unknown };
  assert.deepEqual(body.moviebox, { status: "blocked_setup", reason: "missing_signing_key" });
});

test("listener defaults to IPv4 loopback and accepts only unscoped exact IPv4/IPv6 literals", () => {
  for (const value of [undefined, "", " \t"]) assert.equal(parseListenerHost(value), "127.0.0.1");
  for (const value of ["127.0.0.1", "0.0.0.0", "::1", "::", "2001:db8::1"]) {
    assert.equal(parseListenerHost(value), value);
  }
  for (const value of ["localhost", "example.test", "127.1", "256.0.0.1", "127.0.0.1:8787",
    "[::1]", "http://127.0.0.1", " 127.0.0.1", "::1 ", "fe80::1%lo", "private-host-value"]) {
    assert.throws(() => parseListenerHost(value), { message: "Invalid listener host configuration" });
  }
  assert.equal(listenerUrl("127.0.0.1", 8787), "http://127.0.0.1:8787");
  assert.equal(listenerUrl("0.0.0.0", 8787), "http://0.0.0.0:8787");
  assert.equal(listenerUrl("::1", 8787), "http://[::1]:8787");
  assert.equal(listenerUrl("::", 8787), "http://[::]:8787");
});
