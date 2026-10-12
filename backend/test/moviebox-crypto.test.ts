import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalString, clientToken, runtimeKey, signature, validatePath } from "../src/moviebox/crypto.js";
import { MovieBoxError } from "../src/moviebox/errors.js";

// Arbitrary offline fixture only: sequential bytes 0..29, not an upstream credential.
const FIXTURE_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d";
const TIMESTAMP = 1700000000123;
const URL = "https://api6.aoneroom.com/wefeed-mobile-bff/subject-api/search?b=2&a=%E9%9B%AA&a=two+words";

test("strict runtime key validation fails safely and never echoes input", () => {
  for (const value of [undefined, "", " ", "ab".repeat(29), "ab".repeat(31), "zz".repeat(30), ` ${FIXTURE_HEX}`, `${FIXTURE_HEX}\n`]) {
    assert.throws(() => runtimeKey(value), (error: unknown) => error instanceof MovieBoxError && error.code === "setup" && !error.message.includes(FIXTURE_HEX));
  }
  assert.equal(runtimeKey(FIXTURE_HEX).length, 30);
  assert.deepEqual(runtimeKey(FIXTURE_HEX.toUpperCase()), runtimeKey(FIXTURE_HEX));
});

test("canonical seven fields and independently computed fixture signature", () => {
  const canonical = canonicalString("get", "application/json", "application/json", URL, undefined, TIMESTAMP);
  assert.equal(canonical, "GET\napplication/json\napplication/json\n\n1700000000123\n\n/wefeed-mobile-bff/subject-api/search?a=雪&a=two words&b=2");
  assert.equal(canonical.split("\n").length, 7);
  assert.equal(signature(runtimeKey(FIXTURE_HEX), canonical, TIMESTAMP), "1700000000123|2|7MmeQqFP83GsejNCqUriuw==");
  assert.equal(clientToken(TIMESTAMP), "1700000000123,8bb2b37cedae787f581503a05e847ec5");
});

test("absent and empty bodies differ; query sorting preserves duplicate and Unicode ordering", () => {
  const absent = canonicalString("GET", "", "", URL, undefined, 1).split("\n");
  const empty = canonicalString("GET", "", "", URL, "", 1).split("\n");
  assert.equal(absent[3], ""); assert.equal(absent[5], "");
  assert.equal(empty[3], "0"); assert.equal(empty[5], "d41d8cd98f00b204e9800998ecf8427e");
  const unicode = canonicalString("GET", "", "", "https://api6.aoneroom.com/a?😀=x&%EE%80%80=y&a=2&a=1&empty=&plus=%2B", undefined, 1);
  assert.equal(unicode.split("\n")[6], "/a?a=2&a=1&empty=&plus=+&=y&😀=x");
});

test("body hash covers first 102400 bytes, full UTF-8 byte length retained", () => {
  const body = "a".repeat(102399) + "雪" + "z".repeat(10);
  const fields = canonicalString("POST", "application/json", "application/json", URL, body, TIMESTAMP).split("\n");
  assert.equal(fields[3], "102412");
  assert.equal(fields[5], createHash("md5").update(Buffer.from(body).subarray(0, 102400)).digest("hex"));
  assert.notEqual(fields[5], createHash("md5").update(body).digest("hex"));
});

test("internal relative paths reject redirects, traversal, malformed encodings and control tricks", () => {
  validatePath("/wefeed-mobile-bff/subject-api/search?q=two+words&x=%E9%9B%AA");
  for (const path of ["https://evil.test/", "//evil.test/path", "/unrelated", "/wefeed-mobile-bff/../foo", "/wefeed-mobile-bff/%2e%2e/foo", "/wefeed-mobile-bff/%252e%252e/foo", "/wefeed-mobile-bff/a%2fb", "/wefeed-mobile-bff/a%5cb", "/wefeed-mobile-bff/a%00b", "/wefeed-mobile-bff/a%", "/wefeed-mobile-bff/a#fragment", "/wefeed-mobile-bff/\\evil", "/wefeed-mobile-bff/a\n"]) {
    assert.throws(() => validatePath(path), (error: unknown) => error instanceof MovieBoxError && error.code === "path");
  }
});
