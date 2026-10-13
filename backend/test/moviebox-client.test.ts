import assert from "node:assert/strict";
import test from "node:test";
import { MovieBoxClient, MOVIEBOX_HOSTS } from "../src/moviebox/client.js";
import { MovieBoxError } from "../src/moviebox/errors.js";

const FIXTURE_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d";
const PATH = "/wefeed-mobile-bff/subject-api/search/v2";
const NOW = 1700000000000;
const identity = { userAgent: "offline-fixture-agent", clientInfo: '{"device_id":"offline-fixture-device"}' };
const jwt = (claims: object) => `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.unverified`;
const json = (data: unknown, headers?: Record<string, string>) => new Response(JSON.stringify({ data }), { headers });
const login = (token = "offline-token") => json({ token, uid: 42 });
interface Call { url: string; init: RequestInit }
function fixture(handler: (call: Call, index: number) => Response | Promise<Response>, extra: { now?: () => number; attemptTimeoutMs?: number; maxAttempts?: number } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof globalThis.fetch;
  return { calls, client: new MovieBoxClient({ movieboxSecretHex: FIXTURE_HEX, fetch, now: () => NOW, identity, ...extra }) };
}
const isLogin = (call: Call) => call.url.endsWith("/user-api/visitor-login");
const rejects = (promise: Promise<unknown>, code: string, status?: number) => assert.rejects(promise,
  (error: unknown) => error instanceof MovieBoxError && error.code === code && (status === undefined || error.status === status));

test("caller cancellation aborts metadata requests without host hopping", async () => {
  const controller = new AbortController();
  const { client, calls } = fixture((call) => {
    if (isLogin(call)) return login();
    return new Promise<Response>((_resolve, reject) => {
      call.init.signal!.addEventListener("abort", () => reject(new Error("fixture abort")), { once: true });
      controller.abort();
    });
  });
  await client.init();
  await rejects(client.get("/wefeed-mobile-bff/subject-api/get?subjectId=1", controller.signal), "timeout");
  assert.equal(calls.length, 2);
  const stopped = new AbortController();
  stopped.abort();
  await rejects(client.search("Fixture", 1, stopped.signal), "timeout");
  assert.equal(calls.length, 2);
});

test("missing secret blocks setup before any fetch and diagnostics reveal counts only", async () => {
  let fetched = false;
  assert.throws(() => new MovieBoxClient({ fetch: (async () => { fetched = true; return login(); }) as typeof fetch }), MovieBoxError);
  assert.equal(fetched, false);
  const { client } = fixture(() => login());
  assert.deepEqual(client.diagnostics(), { httpAttempts: 0, loginRequests: 0, searchRequests: 0, sessionReuses: 0 });
});

test("visitor login {}, envelope search, stable identity, spoofed forwarding IP, sequential reuse", async () => {
  const { client, calls } = fixture((call) => isLogin(call) ? login() : json({ items: [{ title: "Inception" }] }));
  await client.init();
  await client.search("Inception");
  assert.deepEqual(await client.search("Inception"), { items: [{ title: "Inception" }] });
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.init.body, "{}");
  assert.equal(new Headers(calls[0]!.init.headers).get("authorization"), null);
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { keyword: "Inception", page: 1, perPage: 15, subjectType: 0 });
  for (const call of calls) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("x-client-info"), identity.clientInfo);
    assert.equal(headers.get("user-agent"), identity.userAgent);
    assert.ok(headers.get("x-forwarded-for")?.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/));
    assert.equal(headers.get("connection"), "keep-alive");
    assert.equal(call.init.redirect, "manual");
    assert.ok(call.init.signal);
  }
  assert.equal(new Headers(calls[2]!.init.headers).get("authorization"), "Bearer offline-token");
  assert.deepEqual(client.diagnostics(), { httpAttempts: 3, loginRequests: 1, searchRequests: 2, sessionReuses: 2 });
});

test("concurrent cold searches singleflight one visitor login", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { client, calls } = fixture(async (call) => { if (isLogin(call)) { await gate; return login(); } return json([]); });
  const searches = Array.from({ length: 12 }, () => client.search("Inception"));
  assert.equal(calls.length, 1);
  release();
  await Promise.all(searches);
  assert.equal(client.diagnostics().loginRequests, 1);
  assert.equal(calls.length, 13);
});

test("JWT 60s margin refreshes at boundary; unverified claims only metadata", async () => {
  let now = NOW;
  let count = 0;
  const { client } = fixture((call) => isLogin(call) ? login(jwt({ exp: now / 1000 + 120, sub: ++count })) : json([]), { now: () => now });
  await client.init();
  now += 59999;
  await client.search("Inception");
  assert.equal(count, 1);
  now++;
  await client.search("Inception");
  assert.equal(count, 2);
});

test("opaque/noexp session has seven-day lifetime with injected clock", async () => {
  let now = NOW;
  const { client } = fixture((call) => isLogin(call) ? login() : json([]), { now: () => now });
  await client.init();
  now += 7 * 86400000 - 1;
  await client.search("Inception");
  assert.equal(client.diagnostics().loginRequests, 1);
  now++;
  await client.search("Inception");
  assert.equal(client.diagnostics().loginRequests, 2);
});

test("x-user token rotation adopted on success; malformed, blank and invalid rotation ignored", async () => {
  let searches = 0;
  const rotations = [JSON.stringify({ token: "offline-rotated", uid: "new" }), "not-json", '{"token":""}',
    JSON.stringify({ token: jwt({ exp: -1 }) })];
  const { client, calls } = fixture((call) => isLogin(call) ? login() : json([], {
    "x-user": rotations[searches++] ?? "not-json",
  }));
  for (let i = 0; i < 5; i++) await client.search("Inception");
  for (const call of calls.slice(2)) {
    assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer offline-rotated");
  }
  assert.equal(client.diagnostics().loginRequests, 1);
});

test("safe 401 refresh once, repeated 401 terminal with status preserved", async () => {
  let logins = 0;
  const { client, calls } = fixture((call) => isLogin(call) ? login(`offline-${++logins}`) : new Response(null, { status: 401 }));
  await rejects(client.search("Inception"), "unauthorized", 401);
  assert.equal(logins, 2);
  assert.equal(calls.length, 4);
});

test("safe 401 refresh succeeds; concurrent failures share refresh", async () => {
  let logins = 0;
  const { client } = fixture((call) => {
    if (isLogin(call)) return login(`offline-${++logins}`);
    return new Headers(call.init.headers).get("authorization") === "Bearer offline-1" ? new Response(null, { status: 401 }) : json([]);
  });
  await client.init();
  await Promise.all(Array.from({ length: 10 }, () => client.search("Inception")));
  assert.equal(logins, 2);
});

test("unsafe POST is never replayed on 401 or network failure", async () => {
  for (const failure of [() => new Response(null, { status: 401 }), () => { throw new Error("raw-sensitive-network-error"); }]) {
    const { client, calls } = fixture((call) => isLogin(call) ? login() : failure());
    await assert.rejects(client.post(PATH, { arbitrary: true }), MovieBoxError);
    assert.equal(calls.length, 2);
    assert.equal(client.diagnostics().loginRequests, 1);
  }
});

test("network and selected 5xx bounded failover; successful host stays active", async () => {
  const { client, calls } = fixture((call, i) => {
    if (isLogin(call)) return login();
    if (i === 1) throw new Error("sensitive-url-or-header");
    if (i === 2) return new Response(null, { status: 503 });
    return json([]);
  });
  await client.search("Inception"); await client.search("Inception");
  assert.equal(calls[1]!.url, MOVIEBOX_HOSTS[0] + PATH);
  assert.equal(calls[2]!.url, MOVIEBOX_HOSTS[1] + PATH);
  assert.equal(calls[3]!.url, MOVIEBOX_HOSTS[2] + PATH);
  assert.equal(calls[4]!.url, MOVIEBOX_HOSTS[2] + PATH);
});

test("all network failures bounded; no credential or raw failure leakage", async () => {
  const { client, calls } = fixture((call) => { if (isLogin(call)) return login(); throw new Error("offline-sensitive-leak"); });
  await assert.rejects(client.search("Inception"), (error: unknown) => error instanceof MovieBoxError && error.code === "network" && !error.message.includes("offline-sensitive-leak"));
  assert.equal(calls.length, 4);
  assert.equal(client.diagnostics().loginRequests, 1);
});

test("400 surfaces immediately without host hopping or session refresh", async () => {
  const { client, calls } = fixture((call) => isLogin(call) ? login() : new Response("untrusted-sensitive-body", { status: 400, headers: { "retry-after": "1", "x-user": '{"token":"do-not-adopt"}' } }));
  await rejects(client.search("Inception"), "http", 400);
  assert.equal(calls.length, 2);
  assert.equal(client.diagnostics().loginRequests, 1);
});

test("403 triggers session refresh (one refresh, then terminal)", async () => {
  let logins = 0;
  const { client, calls } = fixture((call) => {
    if (isLogin(call)) return login(`offline-${++logins}`);
    return new Response(null, { status: 403 });
  });
  await rejects(client.search("Inception"), "denied", 403);
  assert.equal(logins, 2); // initial login + one refresh attempt
  // 403 is not failover-retried in #requestHosts; #request refreshes once and retries:
  // login + 1 attempt(403) + refresh login + 1 attempt(403) = 4
  assert.equal(calls.length, 4);
});

test("406/429/407 failover to next host without session refresh", async () => {
  for (const status of [406, 429, 407]) {
    let logins = 0;
    const { client, calls } = fixture((call, i) => {
      if (isLogin(call)) return login(`offline-${++logins}`);
      // First attempt on host 0 fails, second attempt on host 1 succeeds.
      if (i === 1) return new Response("untrusted-sensitive-body", { status, headers: { "retry-after": "1" } });
      return json([]);
    });
    await client.search("Inception");
    assert.equal(calls.length, 3); // login + failed attempt + successful retry
    assert.equal(client.diagnostics().loginRequests, 1);
  }
});

test("redirect status and already followed redirect rejected", async () => {
  for (const response of [new Response(null, { status: 302, headers: { location: "https://evil.test" } }), (() => {
    const response = json([]); Object.defineProperty(response, "redirected", { value: true }); return response;
  })()]) {
    const { client, calls } = fixture((call) => isLogin(call) ? login() : response);
    await rejects(client.search("Inception"), "redirect");
    assert.equal(calls.length, 2);
  }
});

test("malformed JSON not retried; malformed/missing/expired visitor token safely rejected", async () => {
  const { client, calls } = fixture((call) => isLogin(call) ? login() : new Response("{sensitive"));
  await rejects(client.search("Inception"), "malformed");
  assert.equal(calls.length, 2);
  for (const token of [undefined, "", "bad\r\nheader", "fixture.invalid.unverified", "fixture..unverified", jwt({ exp: NOW / 1000 + 59 }), jwt({ exp: -1 }), jwt({ exp: "invalid" })]) {
    const { client } = fixture(() => json({ token }));
    await rejects(client.init(), "session");
  }
});

test("bounded streamed and declared response size", async () => {
  for (const response of [new Response("{}", { headers: { "content-length": String(1024 * 1024 + 1) } }),
    new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(600000)); controller.enqueue(new Uint8Array(600000)); controller.close();
    } }))]) {
    const { client, calls } = fixture((call) => isLogin(call) ? login() : response);
    await rejects(client.search("Inception"), "size");
    assert.equal(calls.length, 2);
  }
});

test("per-attempt deadline bounds both non-cooperative fetch and stalled body", async () => {
  for (const stalled of [() => new Promise<Response>(() => undefined),
    () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from('{"data":')); } }))]) {
    const { client, calls } = fixture((call) => isLogin(call) ? login() : stalled(), { attemptTimeoutMs: 10, maxAttempts: 2 });
    await rejects(client.search("Inception"), "timeout");
    assert.equal(calls.length, 3);
    assert.equal(calls[1]!.init.signal!.aborted, true);
    assert.equal(calls[2]!.init.signal!.aborted, true);
  }
});

test("invalid path before login; bounded options; failed singleflight can recover", async () => {
  const { client, calls } = fixture((_, i) => i === 0 ? json({}) : login());
  await rejects(client.get("//evil.test"), "path");
  assert.equal(calls.length, 0);
  await rejects(client.init(), "session");
  await client.init();
  assert.equal(calls.length, 2);
  for (const options of [{ maxAttempts: 8 }, { maxAttempts: 0 }, { attemptTimeoutMs: 0 }, { attemptTimeoutMs: 30001 }]) {
    assert.throws(() => new MovieBoxClient({ movieboxSecretHex: FIXTURE_HEX, ...options }), MovieBoxError);
  }
});
