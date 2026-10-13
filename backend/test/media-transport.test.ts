import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  SecureMediaTransport, TransportError, isMp4Prefix, isPublicAddress,
  resourceHeaders, validateMediaUrl, validateRange, validateVideoResponse,
} from "../src/media/transport.ts";
import type { TransportOptions, TransportRequest } from "../src/media/transport.ts";
import type { MediaResource } from "../src/media/types.ts";

const media: MediaResource = { url: "https://media.example/signed?secret=not-public", kind: "video", headers: {} };
const mp4 = Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 0, 0, ...Buffer.from("isommp42")]);
const errorCode = (code: string) => (error: unknown) => error instanceof TransportError && error.code === code && !error.message.includes("secret") && !error.message.includes("example");
function message(status: number, headers: Record<string, string | string[] | undefined> = {}): IncomingMessage {
  const stream = new PassThrough() as unknown as IncomingMessage;
  stream.statusCode = status;
  stream.headers = headers;
  stream.setTimeout = () => stream;
  return stream;
}
type Reply = { status?: number; headers?: Record<string, string | string[] | undefined>; body?: Buffer; hang?: boolean; noHeaders?: boolean; error?: boolean };
function fixture(reply: Reply = {}, options: Partial<TransportOptions> = {}) {
  const responses: IncomingMessage[] = [];
  const requests: (EventEmitter & { destroyed: boolean })[] = [];
  const calls: { url: URL; options: RequestOptions }[] = [];
  let idle: (() => void) | undefined;
  const request: TransportRequest = (url, requestOptions, callback) => {
    calls.push({ url, options: requestOptions });
    const req = Object.assign(new EventEmitter(), {
      destroyed: false,
      end() {
        queueMicrotask(() => {
          if (reply.error) { req.emit("error", new Error(`upstream ${media.url}`)); return; }
          if (reply.noHeaders || req.destroyed) return;
          const response = message(reply.status ?? 200, reply.headers ?? { "content-type": "video/mp4", "content-length": String((reply.body ?? mp4).length) });
          response.setTimeout = (_ms, callback) => { idle = callback; return response; };
          responses.push(response);
          callback(response);
          if (!reply.hang) (response as unknown as PassThrough).end(reply.body ?? mp4);
        });
      },
      destroy() { req.destroyed = true; return req; },
    });
    requests.push(req);
    return req as unknown as ClientRequest;
  };
  const transport = new SecureMediaTransport({
    mediaHosts: ["media.example"], captionHosts: ["captions.example"],
    resolver: async () => [{ address: "8.8.8.8", family: 4 }], request,
    ...options,
  });
  return { transport, responses, requests, calls, expireIdle: () => idle?.() };
}

test("URL policy requires explicit exact hosts, HTTPS/443 and no userinfo or fragment", () => {
  const hosts = new Set(["media.example"]);
  assert.equal(validateMediaUrl("https://media.example:443/video", hosts).hostname, "media.example");
  for (const url of ["http://media.example/x", "https://media.example:444/x", "https://user:password@media.example/x", "https://@media.example/x", "https://media.example/x#", "https://media.example/x#frag", "https://other.example/x", "https://sub.media.example/x", "https://media.example./x", "https://127.0.0.1/x", "https://[::1]/x", "not a URL"]) {
    assert.throws(() => validateMediaUrl(url, hosts), errorCode("invalid_resource"), url);
  }
  assert.throws(() => new SecureMediaTransport({ mediaHosts: ["*.example"], captionHosts: [] }), errorCode("invalid_resource"));
});
test("IP validation denies every local/reserved/transition/documentation address family", () => {
  for (const address of ["0.0.0.0", "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.9", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "::", "::1", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "64:ff9b:1::1", "100::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001::1", "2001:2::1", "2001:20::1", "2001:db8::1", "2002:808:808::1", "3fff::1", "fe80::1%eth0", "garbage"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "100.128.0.1", "172.32.0.1", "192.0.1.1", "223.255.255.255", "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:830::200e"]) assert.equal(isPublicAddress(address), true, address);
});
test("ranges support only bounded, nonempty single byte ranges", () => {
  assert.equal(validateRange(), undefined);
  assert.deepEqual(validateRange("bytes=0-0"), { start: 0, end: 0 });
  assert.deepEqual(validateRange("bytes=4096-"), { start: 4096, end: undefined });
  assert.deepEqual(validateRange("bytes=-500"), { suffix: 500 });
  for (const range of ["", "bytes=-", "bytes=-0", "bytes=3-2", "bytes=0-1,4-5", "items=0-5", "bytes= 0-4", "bytes=+1-4", "bytes=0-4\r\nCookie: x", "bytes=9007199254740992-", "bytes=-99999999999999999999"]) assert.throws(() => validateRange(range), errorCode("invalid_range"));
});
test("server descriptor headers are whitelisted and caption cookies are never forwarded", () => {
  const headers = { Referer: "https://origin.example", "User-Agent": "Server", Cookie: "session=owned", Authorization: "forbidden", Host: "private", Range: "bytes=0-1", "X-Forwarded-For": "private" };
  assert.deepEqual(resourceHeaders({ ...media, headers }, "bytes=1-5"), { "accept-encoding": "identity", accept: "video/mp4", referer: headers.Referer, "user-agent": "Server", cookie: "session=owned", range: "bytes=1-5" });
  assert.equal(resourceHeaders({ ...media, kind: "subtitle", headers }).cookie, undefined);
  assert.throws(() => resourceHeaders({ ...media, headers: { cookie: "x\r\nHost: bad" } }), errorCode("invalid_resource"));
  assert.throws(() => resourceHeaders({ ...media, headers: { Cookie: "one", cookie: "two" } }), errorCode("invalid_resource"));
});
test("video headers validate statuses, lengths, types and range consistency", () => {
  const response = message(206, { "content-type": "video/mp4", "content-length": "4", "content-range": "bytes 0-3/10", "accept-ranges": "bytes", "set-cookie": "private", location: media.url });
  const metadata = validateVideoResponse(response, { start: 0, end: 3 });
  assert.equal(metadata.headers.get("content-range"), "bytes 0-3/10");
  assert.equal(metadata.headers.get("set-cookie"), null);
  assert.equal(metadata.headers.get("location"), null);
  assert.equal(validateVideoResponse(message(206, { "content-type": "video/mp4", "content-length": "3", "content-range": "bytes 7-9/10" }), { suffix: 3 }).status, 206);
  assert.equal(validateVideoResponse(message(416, { "content-range": "bytes */10" }), { start: 10 }).headers.get("content-length"), "0");
  assert.equal(validateVideoResponse(message(200, { "content-type": "video/mp4" })).length, undefined);
  for (const [status, headers, range] of [
    [302, { location: media.url }, undefined], [500, {}, undefined], [204, {}, undefined],
    [200, { "content-type": "text/html" }, undefined], [200, { "content-type": "application/vnd.apple.mpegurl" }, undefined],
    [200, { "content-type": "video/mp4", "content-length": "-1" }, undefined],
    [200, { "content-type": "video/mp4", "content-length": "0" }, undefined],
    [200, { "content-type": "video/mp4", "content-encoding": "gzip" }, undefined],
    [200, { "content-type": "video/mp4", "content-range": "bytes 0-1/2" }, undefined],
    [206, { "content-type": "multipart/byteranges" }, { start: 0 }],
    [206, { "content-type": "video/mp4", "content-range": "bytes 0-3/10", "content-length": "5" }, { start: 0, end: 3 }],
    [206, { "content-type": "video/mp4", "content-range": "bytes 1-3/10", "content-length": "3" }, { start: 0, end: 3 }],
    [206, { "content-type": "video/mp4", "content-range": "bytes 0-3/*", "content-length": "4" }, { start: 0, end: 3 }],
    [206, { "content-type": "video/mp4", "content-range": "bytes 0-3/4", "content-length": "4" }, undefined],
    [416, { "content-range": "bytes */10" }, undefined], [416, { "content-range": "bytes */10" }, { start: 0 }],
    [416, { "content-range": "bytes 0-9/10" }, { start: 10 }],
  ] as const) assert.throws(() => validateVideoResponse(message(status, headers), range), errorCode("invalid_response"));
});
test("MP4 probe evidence is ftyp plus recognized MP4 brand, never extension alone", () => {
  assert.equal(isMp4Prefix(mp4), true);
  const corrupt = Buffer.from(mp4);
  corrupt[4] = 0xe6; // ASCII decoding would mask this to 'f'.
  assert.equal(isMp4Prefix(corrupt), false);
  for (const bytes of [Buffer.from("<!doctype html>hello"), Buffer.from("#EXTM3U\n"), Buffer.from("<MPD></MPD>"), mp4.subarray(0, 12), Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypqt  "), 0, 0, 0, 0, ...Buffer.from("qt  qt  ")])]) assert.equal(isMp4Prefix(bytes), false);
});
test("constructor refuses unsafe concurrency and timeout settings", () => {
  for (const options of [{ concurrency: 3 }, { concurrency: 17 }, { concurrency: 4.5 }, { connectTimeoutMs: 10001 }, { headersTimeoutMs: 10001 }, { idleTimeoutMs: 15001 }, { totalTimeoutMs: 1800001 }, { probeTimeoutMs: 10001 }, { captionTimeoutMs: 0 }]) assert.throws(() => fixture({}, options), errorCode("invalid_resource"));
});
test("DNS validates all answers and rejects mixed private/public or mapped responses before request", async () => {
  for (const answers of [[], [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }], [{ address: "::ffff:8.8.8.8", family: 6 }], [{ address: "8.8.8.8", family: 6 }]]) {
    const f = fixture({}, { resolver: async () => answers });
    await assert.rejects(f.transport.relay(media, "GET"), errorCode("blocked_address"));
    assert.equal(f.calls.length, 0);
  }
});
test("actual HTTPS options pin approved DNS while retaining SNI and default TLS verification", async () => {
  let lookups = 0;
  const f = fixture({}, { resolver: async () => { lookups++; return [{ address: "2606:4700:4700::1111", family: 6 }]; } });
  const response = await f.transport.relay(media, "GET");
  const options = f.calls[0]!.options;
  assert.equal(options.servername, "media.example");
  assert.equal(options.rejectUnauthorized, undefined);
  assert.equal(options.checkServerIdentity, undefined);
  assert.equal(options.agent, false);
  const pinned = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    const pin = options.lookup as (hostname: string, options: object, cb: (error: Error | null, address: string, family: number) => void) => void;
    pin("media.example", {}, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(pinned, { address: "2606:4700:4700::1111", family: 6 });
  assert.equal(lookups, 1);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4);
});
test("relay preserves 200/206 and streams bytes with only safe headers", async () => {
  const f = fixture({ status: 206, body: mp4, headers: { "content-type": "video/mp4", "content-length": "24", "content-range": "bytes 0-23/24", "accept-ranges": "bytes", "set-cookie": "secret", server: "private" } });
  const response = await f.transport.relay(media, "GET", "bytes=0-4095");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("server"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4);
});
test("chunked single-range responses derive bounded length from Content-Range", async () => {
  const f = fixture({ status: 206, body: mp4, headers: { "content-type": "video/mp4", "content-range": "bytes 0-23/24" } });
  const response = await f.transport.relay(media, "GET", "bytes=0-4095");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-length"), "24");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4);
  const probe = fixture({ status: 206, body: mp4, headers: { "content-type": "video/mp4", "content-range": "bytes 0-23/24" } });
  assert.equal(await probe.transport.probe(media), true);
});

test("HEAD and 416 return no body and destroy upstream without reading it", async () => {
  const f = fixture({ hang: true });
  const head = await f.transport.relay(media, "HEAD");
  assert.equal(head.body, null);
  assert.equal(f.requests[0]!.destroyed, true);
  assert.equal(f.responses[0]!.destroyed, true);
  const g = fixture({ status: 416, hang: true, headers: { "content-range": "bytes */24", "content-type": "text/html", "content-length": "1000000000" } });
  const unsatisfied = await g.transport.relay(media, "GET", "bytes=24-");
  assert.equal(unsatisfied.status, 416);
  assert.equal(unsatisfied.body, null);
  assert.equal(unsatisfied.headers.get("content-length"), "0");
  assert.equal(g.responses[0]!.destroyed, true);
});
test("redirects/errors never leak upstream URL and never cause a follow-up request", async () => {
  const f = fixture({ status: 302, headers: { location: "https://127.0.0.1/secret" } });
  await assert.rejects(f.transport.relay(media, "GET"), errorCode("invalid_response"));
  assert.equal(f.calls.length, 1);
  assert.equal(f.requests[0]!.destroyed, true);
  const g = fixture({ error: true });
  await assert.rejects(g.transport.relay(media, "GET"), errorCode("upstream"));
});
test("backpressure does not drain upstream until the browser consumes", async () => {
  const body = Buffer.alloc(128 * 1024);
  const f = fixture({ body });
  const response = await f.transport.relay(media, "GET");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.responses[0]!.readableLength, body.length);
  assert.equal(f.responses[0]!.readableFlowing, false);
  await response.body!.cancel();
  assert.equal(f.requests[0]!.destroyed, true);
  assert.equal(f.responses[0]!.destroyed, true);
});
test("bounded concurrency releases on browser cancellation, HEAD and completion", async () => {
  const f = fixture({ hang: true }, { concurrency: 4 });
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.transport.relay(media, "GET")));
  await assert.rejects(f.transport.relay(media, "GET"), errorCode("busy"));
  await responses[0]!.body!.cancel();
  const head = await f.transport.relay(media, "HEAD");
  assert.equal(head.body, null);
  const next = await f.transport.relay(media, "GET");
  await next.body!.cancel();
  await Promise.all(responses.slice(1).map((response) => response.body!.cancel()));
  const complete = fixture({}, { concurrency: 4 });
  for (let i = 0; i < 8; i++) await (await complete.transport.relay(media, "GET")).arrayBuffer();
});
test("abort before DNS, during DNS and after headers destroys/releases", async () => {
  const pre = new AbortController();
  pre.abort();
  const f = fixture();
  await assert.rejects(f.transport.relay(media, "GET", undefined, pre.signal), errorCode("cancelled"));
  assert.equal(f.calls.length, 0);
  const slow = fixture({}, { resolver: () => new Promise(() => {}) });
  const dnsAbort = new AbortController();
  const pending = slow.transport.relay(media, "GET", undefined, dnsAbort.signal);
  dnsAbort.abort();
  await assert.rejects(pending, errorCode("cancelled"));
  const g = fixture({ hang: true });
  const abort = new AbortController();
  const response = await g.transport.relay(media, "GET", undefined, abort.signal);
  abort.abort();
  assert.equal(g.requests[0]!.destroyed, true);
  await assert.rejects(response.arrayBuffer(), errorCode("cancelled"));
  for (let i = 0; i < 8; i++) await g.transport.relay(media, "HEAD");
});
test("connect, headers, DNS and whole-stream deadlines bound stalled transfers", async () => {
  const connect = fixture({ noHeaders: true }, { connectTimeoutMs: 5 });
  await assert.rejects(connect.transport.relay(media, "GET"), errorCode("timeout"));
  assert.equal(connect.requests[0]!.destroyed, true);
  const headers = fixture({ noHeaders: true }, { headersTimeoutMs: 5 });
  await assert.rejects(headers.transport.relay(media, "GET"), errorCode("timeout"));
  const dns = fixture({}, { resolver: () => new Promise(() => {}), headersTimeoutMs: 5 });
  await assert.rejects(dns.transport.relay(media, "GET"), errorCode("timeout"));
  const total = fixture({ hang: true }, { totalTimeoutMs: 5 });
  const response = await total.transport.relay(media, "GET");
  await assert.rejects(response.arrayBuffer(), errorCode("timeout"));
  assert.equal(total.requests[0]!.destroyed, true);
});
test("idle deadline destroys stream and produces sanitized timeout", async () => {
  const f = fixture({ hang: true });
  const response = await f.transport.relay(media, "GET");
  f.expireIdle();
  await assert.rejects(response.arrayBuffer(), errorCode("timeout"));
  assert.equal(f.responses[0]!.destroyed, true);
});
test("stream rejects truncated and excessive Content-Length", async () => {
  for (const length of ["1", "100"]) {
    const f = fixture({ body: mp4, headers: { "content-type": "video/mp4", "content-length": length } });
    const response = await f.transport.relay(media, "GET");
    await assert.rejects(response.arrayBuffer(), errorCode("invalid_response"));
  }
});
test("probe performs bounded range GET, validates prefix and stops full-body upstream", async () => {
  const f = fixture({ body: Buffer.concat([mp4, Buffer.alloc(1000000)]) });
  assert.equal(await f.transport.probe(media), true);
  assert.equal(f.calls[0]!.options.method, "GET");
  assert.equal(f.calls[0]!.options.headers && (f.calls[0]!.options.headers as Record<string, string>).range, "bytes=0-4095");
  assert.equal(f.requests[0]!.destroyed, true);
  assert.equal(f.responses[0]!.destroyed, true);
  const partial = fixture({ status: 206, body: mp4, headers: { "content-type": "video/mp4", "content-length": "24", "content-range": "bytes 0-23/24" } });
  assert.equal(await partial.transport.probe(media), true);
  for (const reply of [{ body: Buffer.from("<html>not a movie</html>") }, { body: Buffer.from("#EXTM3U\nxxxxxxxxxxxx") }, { status: 302 }, { headers: { "content-type": "text/html" } }, { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 5-23/24", "content-length": "19" } }]) {
    const bad = fixture(reply);
    assert.equal(await bad.transport.probe(media), false);
    assert.equal(bad.requests[0]!.destroyed, true);
  }
});
test("probe failure evidence retains fixed validation codes and only actually observed status", async () => {
  const cases: Array<{ reply: Reply; options?: Partial<TransportOptions>; code: string; httpStatus?: number }> = [
    { reply: { status: 403, headers: { "set-cookie": "private-cookie", etag: '"private-etag"', location: media.url } }, code: "invalid_response", httpStatus: 403 },
    { reply: { status: 302, headers: { location: "https://private.example/?token=private" } }, code: "invalid_response", httpStatus: 302 },
    { reply: { body: Buffer.from("<html>not movie</html>") }, code: "invalid_container", httpStatus: 200 },
    { reply: { error: true }, code: "upstream" },
    { reply: {}, options: { resolver: async () => [{ address: "127.0.0.1", family: 4 }] }, code: "blocked_address" },
    { reply: {}, options: { resolver: async () => { throw new Error(`private DNS ${media.url}`); } }, code: "upstream" },
    { reply: {}, options: { request: () => { throw new Error(`private TLS ${media.url}`); } }, code: "upstream" },
    { reply: { hang: true }, options: { probeTimeoutMs: 5 }, code: "timeout", httpStatus: 200 },
    { reply: { noHeaders: true }, options: { probeTimeoutMs: 5 }, code: "timeout" },
  ];
  for (const row of cases) {
    const f = fixture(row.reply, row.options);
    const result = await f.transport.probeEvidence(media);
    assert.deepEqual(result, { playable: false, failure: { code: row.code, ...(row.httpStatus === undefined ? {} : { httpStatus: row.httpStatus }) } });
    for (const privateValue of ["example", "secret", "private-cookie", "private-etag", "token=", "127.0.0.1"]) {
      assert.equal(JSON.stringify(result).includes(privateValue), false);
    }
    if (row.reply.status === 302) assert.equal(f.calls.length, 1);
  }
  const unapproved = fixture();
  assert.deepEqual(await unapproved.transport.probeEvidence({ ...media, url: "https://unapproved.example/private" }),
    { playable: false, failure: { code: "invalid_resource" } });
  assert.equal(unapproved.calls.length, 0);
});

test("probeEvidence preserves eligibility without validators and records only bounded strong original-server evidence", async () => {
  for (const etag of [undefined, 'W/"version"', "unquoted", '"bad\r\ntag"', '"a", "b"',
    `"${"x".repeat(1024)}"`, [ '"one"', '"two"' ]]) {
    const f = fixture({ headers: { "content-type": "video/mp4", "content-length": "24", etag } });
    assert.deepEqual(await f.transport.probeEvidence(media), { playable: true });
    assert.equal(await f.transport.probe(media), true);
  }
  const chunked = fixture({ headers: { "content-type": "video/mp4", etag: '"version"' } });
  assert.deepEqual(await chunked.transport.probeEvidence(media), { playable: true });
  const evidenceReplies: { reply: Reply; total: number }[] = [
    { reply: { headers: { "content-type": "video/mp4", "content-length": "24", etag: '"version"' } }, total: 24 },
    { reply: { status: 206, headers: { "content-type": "video/mp4", "content-length": "4096", "content-range": "bytes 0-4095/5000", etag: '"version"' }, body: Buffer.concat([mp4, Buffer.alloc(4072)]) }, total: 5000 },
    { reply: { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-23/24", etag: '"version"' } }, total: 24 },
  ];
  for (const { reply, total } of evidenceReplies) {
    // A ranged probe total is the complete representation, never the returned prefix length.
    const f = fixture(reply);
    const evidence = await f.transport.probeEvidence(media);
    assert.deepEqual(evidence, { playable: true, representation: { etag: '"version"', length: total } });
    assert.equal(f.requests[0]!.destroyed, true);
    assert.equal(f.responses[0]!.destroyed, true);
    assert.equal((f.calls[0]!.options.headers as Record<string, string>)["if-match"], undefined);
  }
  assert.deepEqual(await fixture({ body: Buffer.from("<html>not MP4</html>"), headers: { "content-type": "video/mp4", "content-length": "20", etag: '"version"' } }).transport.probeEvidence(media), { playable: false, failure: { code: "invalid_container", httpStatus: 200 } });
  assert.deepEqual(await fixture({ headers: { "content-type": "video/mp4", "content-length": "12", etag: '"version"' } }).transport.probeEvidence(media), { playable: false, failure: { code: "invalid_response", httpStatus: 200 } });
});

test("If-Match originates only from typed video evidence, never arbitrary descriptor headers or captions", () => {
  const bound = { ...media, representation: { etag: '"version"', length: 24 }, headers: { "If-Match": '"forged"', "If-Range": '"forged"', Authorization: "forbidden" } };
  assert.equal(resourceHeaders(bound)["if-match"], '"version"');
  assert.equal(resourceHeaders({ ...media, headers: bound.headers })["if-match"], undefined);
  assert.equal(resourceHeaders(bound)["if-range"], undefined);
  assert.equal(resourceHeaders(bound).authorization, undefined);
  assert.equal(resourceHeaders({ ...media, kind: "subtitle", headers: { "If-Match": '"forged"', Cookie: "secret" } })["if-match"], undefined);
  assert.throws(() => resourceHeaders({ ...bound, kind: "subtitle" }), errorCode("invalid_resource"));
  assert.throws(() => resourceHeaders({ ...bound, representation: { etag: 'W/"version"', length: 24 } }), errorCode("invalid_resource"));
});

test("evidence-bound full, partial and HEAD relays verify complete representation before returning", async () => {
  const bound = { ...media, representation: { etag: '"version"', length: 24 } };
  for (const method of ["GET", "HEAD"] as const) {
    for (const ranged of [false, true]) {
      const f = fixture({ status: ranged ? 206 : 200, body: mp4, headers: { "content-type": "video/mp4", "content-length": "24", etag: '"version"', ...(ranged ? { "content-range": "bytes 0-23/24" } : {}) } });
      const response = await f.transport.relay(bound, method, ranged ? "bytes=0-4095" : undefined);
      assert.equal((f.calls[0]!.options.headers as Record<string, string>)["if-match"], '"version"');
      assert.equal(response.headers.get("etag"), null);
      assert.equal(response.headers.get("if-match"), null);
      if (method === "HEAD") assert.equal(response.body, null);
      else assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4);
    }
  }
  const partial = fixture({ status: 206, body: mp4.subarray(0, 4), headers: { "content-type": "video/mp4", "content-length": "4", "content-range": "bytes 0-3/24", etag: '"version"' } });
  assert.equal(await (await partial.transport.relay(bound, "GET", "bytes=0-3")).arrayBuffer().then((b) => b.byteLength), 4);
  const noPrefixLength = fixture({ status: 206, body: mp4.subarray(20), headers: { "content-type": "video/mp4", "content-range": "bytes 20-23/24", etag: '"version"' } });
  assert.equal((await (await noPrefixLength.transport.relay(bound, "GET", "bytes=-4")).arrayBuffer()).byteLength, 4);
});

test("ignored conditions, weak/missing/changed validators, totals and 412 reject before bytes with sanitized errors", async () => {
  const bound = { ...media, representation: { etag: '"version"', length: 24 } };
  for (const method of ["GET", "HEAD"] as const) {
    for (const reply of [
      { headers: { "content-type": "video/mp4", "content-length": "24" } },
      { headers: { "content-type": "video/mp4", "content-length": "24", etag: 'W/"version"' } },
      { headers: { "content-type": "video/mp4", "content-length": "24", etag: '"changed"' } },
      { headers: { "content-type": "video/mp4", "content-length": "25", etag: '"version"' } },
      { headers: { "content-type": "video/mp4", etag: '"version"' } },
      { status: 206, headers: { "content-type": "video/mp4", "content-length": "4", "content-range": "bytes 0-3/25", etag: '"version"' } },
      { status: 206, headers: { "content-type": "video/mp4", "content-length": "4", "content-range": "bytes 0-3/*", etag: '"version"' } },
      { status: 412, headers: { "content-type": "video/mp4", "content-length": "24", etag: '"version"' } },
    ]) {
      const f = fixture({ ...reply, hang: true });
      await assert.rejects(f.transport.relay(bound, method, reply.status === 206 ? "bytes=0-3" : undefined), errorCode("invalid_response"));
      assert.equal(f.responses[0]!.readableFlowing, false);
      assert.equal(f.requests[0]!.destroyed, true);
      assert.equal(f.responses[0]!.destroyed, true);
    }
  }
});

test("bound 416 verifies original total and validator but never trusts error-body Content-Length", async () => {
  const bound = { ...media, representation: { etag: '"version"', length: 24 } };
  const f = fixture({ status: 416, hang: true, headers: { "content-range": "bytes */24", etag: '"version"', "content-length": "99999" } });
  const response = await f.transport.relay(bound, "GET", "bytes=24-");
  assert.equal(response.status, 416);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("content-length"), "0");
  for (const headers of [{ "content-range": "bytes */25", etag: '"version"' },
    { "content-range": "bytes */24" }, { "content-range": "bytes */24", etag: 'W/"version"' }]) {
    await assert.rejects(fixture({ status: 416, headers }).transport.relay(bound, "HEAD", "bytes=25-"), errorCode("invalid_response"));
  }
});

test("evidence-bound eligibility probes cannot accept changed evidence even with genuine MP4 bytes", async () => {
  const bound = { ...media, representation: { etag: '"version"', length: 24 } };
  const good = fixture({ headers: { "content-type": "video/mp4", "content-length": "24", etag: '"version"' } });
  assert.deepEqual(await good.transport.probeEvidence(bound), { playable: true, representation: bound.representation });
  assert.equal((good.calls[0]!.options.headers as Record<string, string>)["if-match"], '"version"');
  for (const reply of [{ headers: { "content-type": "video/mp4", "content-length": "24", etag: '"changed"' } },
    { headers: { "content-type": "video/mp4", "content-length": "25", etag: '"version"' } },
    { headers: { "content-type": "video/mp4", "content-length": "24" } }, { status: 412 }]) {
    assert.deepEqual(await fixture(reply).transport.probeEvidence(bound), { playable: false, failure: { code: "invalid_response", httpStatus: reply.status ?? 200 } });
    assert.equal(await fixture(reply).transport.probe(bound), false);
  }
});

test("duplicate original-server ETag fields cannot become continuity evidence", async () => {
  const request: TransportRequest = (_url, _options, callback) => {
    const req = Object.assign(new EventEmitter(), {
      end() {
        queueMicrotask(() => {
          const response = message(200, { "content-type": "video/mp4", "content-length": "24", etag: '"version"' });
          // Node may discard duplicates from .headers for singleton fields; inspect originals too.
          response.rawHeaders = ["ETag", '"version"', "etag", '"different"'];
          callback(response);
          (response as unknown as PassThrough).end(mp4);
        });
      },
      destroy() { return req; },
    });
    return req as unknown as ClientRequest;
  };
  const f = fixture({}, { request });
  assert.deepEqual(await f.transport.probeEvidence(media), { playable: true });
  await assert.rejects(f.transport.relay({ ...media, representation: { etag: '"version"', length: 24 } }, "GET"), errorCode("invalid_response"));
});

test("mutable caller evidence cannot weaken an in-flight request after If-Match generation", async () => {
  let releaseDns: ((addresses: { address: string; family: number }[]) => void) | undefined;
  const f = fixture({ headers: { "content-type": "video/mp4", "content-length": "24", etag: '"changed"' } }, {
    resolver: () => new Promise((resolve) => { releaseDns = resolve; }),
  });
  const bound: MediaResource = { ...media, representation: { etag: '"version"', length: 24 } };
  const pending = f.transport.relay(bound, "GET");
  bound.representation!.etag = '"changed"';
  delete bound.representation;
  releaseDns!([{ address: "8.8.8.8", family: 4 }]);
  await assert.rejects(pending, errorCode("invalid_response"));
  assert.equal((f.calls[0]!.options.headers as Record<string, string>)["if-match"], '"version"');
});

test("probe and caption body deadlines bound partial responses; probe cancellation propagates", async () => {
  const f = fixture({ hang: true }, { probeTimeoutMs: 5 });
  assert.equal(await f.transport.probe(media), false);
  const abort = new AbortController();
  const g = fixture({ hang: true });
  const pending = g.transport.probe(media, abort.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, errorCode("cancelled"));
  const caption = fixture({ hang: true, headers: { "content-type": "text/vtt" } }, { captionTimeoutMs: 5 });
  await assert.rejects(caption.transport.caption({ url: "https://captions.example/file", kind: "subtitle", headers: {}, captionFormat: "vtt" }), errorCode("timeout"));
});
test("captions use separate host policy, no cookies, bounded strict UTF8 and sanitized VTT conversion", async () => {
  const subtitle: MediaResource = { url: "https://captions.example/file", kind: "subtitle", headers: { cookie: "cdn-secret", referer: "https://origin.example" }, captionFormat: "srt" };
  const body = Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nHello\n");
  const f = fixture({ body, headers: { "content-type": "application/x-subrip", "content-length": String(body.length) } });
  const vtt = await f.transport.caption(subtitle);
  assert.ok(vtt.startsWith("WEBVTT"));
  assert.ok(vtt.includes("00:00:01.000 --> 00:00:02.000"));
  assert.equal((f.calls[0]!.options.headers as Record<string, string>).cookie, undefined);
  await assert.rejects(f.transport.caption({ ...subtitle, url: media.url }), errorCode("invalid_resource"));
  await assert.rejects(f.transport.relay({ ...media, url: subtitle.url }, "GET"), errorCode("invalid_resource"));
  for (const reply of [
    { body: Buffer.alloc(512 * 1024 + 1), headers: { "content-type": "text/vtt" } },
    { headers: { "content-type": "text/vtt", "content-length": String(512 * 1024 + 1) } },
  ]) await assert.rejects(fixture(reply).transport.caption(subtitle), errorCode("too_large"));
  for (const reply of [
    { body: Buffer.from([0xff]), headers: { "content-type": "text/plain" } },
    { body, headers: { "content-type": "text/html" } },
    { body, headers: { "content-type": "text/vtt; charset=iso-8859-1" } },
    { body, headers: { "content-type": "text/vtt", "content-encoding": "gzip" } },
    { body, headers: { "content-type": "text/vtt", "content-length": "2" } },
    { status: 302, body, headers: { location: media.url } },
  ]) await assert.rejects(fixture(reply).transport.caption(subtitle), errorCode("invalid_response"));
});
test("expired resources and browser methods outside GET/HEAD never start requests", async () => {
  const f = fixture();
  await assert.rejects(f.transport.relay({ ...media, expiresAt: Date.now() - 1000 }, "GET"), errorCode("invalid_resource"));
  await assert.rejects(f.transport.relay(media, "POST" as "GET"), errorCode("invalid_resource"));
  await assert.rejects(f.transport.relay(media, "GET", "bytes=0-1,4-5"), errorCode("invalid_range"));
  assert.equal(f.calls.length, 0);
});
