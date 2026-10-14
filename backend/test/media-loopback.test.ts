import assert from "node:assert/strict";
import test from "node:test";
import { isLoopback, peerAddress } from "../src/media/loopback.ts";

test("only a loopback peer is accepted, in each of the spellings a socket may report", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.5", "127.1.2.3"]) {
    assert.equal(isLoopback(address), true, address);
  }
  for (const address of ["10.0.0.1", "192.168.1.4", "::ffff:10.0.0.1", "0.0.0.0", "::", "localhost", "127.0.0.1 ", "127.0.0.256", ""]) {
    assert.equal(isLoopback(address), false, address);
  }
  // A peer that cannot be established is never assumed to be local.
  assert.equal(isLoopback(undefined), false);
});

test("a peer address is read only from a well-formed socket, never guessed", () => {
  assert.equal(peerAddress({ incoming: { socket: { remoteAddress: "127.0.0.1" } } }), "127.0.0.1");
  assert.equal(peerAddress({ incoming: { socket: { remoteAddress: 12345 } } }), undefined);
  assert.equal(peerAddress({ incoming: { socket: {} } }), undefined);
  assert.equal(peerAddress({ incoming: {} }), undefined);
  assert.equal(peerAddress({}), undefined);
  assert.equal(peerAddress(undefined), undefined);
  assert.equal(peerAddress("127.0.0.1"), undefined);
  assert.equal(peerAddress({ incoming: { socket: { remoteAddress: "a".repeat(65) } } }), undefined);
});
