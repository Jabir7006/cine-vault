import assert from "node:assert/strict";
import test from "node:test";
import { movieBoxPresentation } from "../../frontend/src/features/watch/moviebox-status.ts";
import type { MovieBoxSetupReason, SourcesResponse } from "../../frontend/src/features/watch/types.ts";

test("unavailable MovieBox stays visible with bounded setup reason text", () => {
  const reasons: MovieBoxSetupReason[] = ["missing_signing_key", "invalid_signing_key", "missing_tmdb_token",
    "missing_media_hosts", "invalid_relay_key", "invalid_configuration"];
  const messages = new Set<string>();
  for (const reason of reasons) {
    const presentation = movieBoxPresentation({ status: "blocked_setup", reason }, false, false, true);
    assert.equal(presentation.available, false);
    assert.equal(presentation.optionLabel, "MovieBox — unavailable");
    assert.match(presentation.message, /^MovieBox unavailable: /);
    assert.match(presentation.message, /Embed fallback candidates remain available; playback is not guaranteed\.$/);
    messages.add(presentation.message);
  }
  assert.equal(messages.size, reasons.length);
  assert.match(movieBoxPresentation({ status: "blocked_setup" }, false, false).message, /Backend setup is incomplete/);
});

test("committed direct ownership remains available during discovery changes", () => {
  for (const state of [undefined, { status: "blocked_setup", reason: "missing_signing_key" },
    { status: "unavailable" }, { status: "ready" }] as (SourcesResponse["moviebox"] | undefined)[]) {
    for (const pending of [true, false]) {
      assert.deepEqual(movieBoxPresentation(state, true, pending), {
        available: true, retryable: false, optionLabel: "MovieBox", message: "MovieBox: verified direct source available.",
      });
    }
  }
});

test("pending and failed discovery cannot invent a playable MovieBox source", () => {
  assert.deepEqual(movieBoxPresentation(undefined, false, true), {
    available: false, retryable: false, optionLabel: "MovieBox — checking…", message: "MovieBox: checking for a verified direct source…",
  });
  assert.equal(movieBoxPresentation(undefined, false, false).available, false);
  assert.equal(movieBoxPresentation({ status: "ready" }, false, false).available, false);
  assert.match(movieBoxPresentation({ status: "blocked_setup" }, false, true).message, /setup is incomplete/);
});

test("non-ready states expose distinct finite reasons without changing fallback availability", () => {
  const statuses = ["not_found", "ambiguous", "unverified", "unsupported_adaptive", "unsupported_format", "unavailable"] as const;
  // The same lookup can answer these differently, because upstream decides per request rather than per
  // title; the other two are answers, and offering to retry them would teach the viewer the button does nothing.
  const retryable = new Set(["unverified", "unsupported_adaptive", "unsupported_format", "unavailable"]);
  const messages = new Set<string>();
  for (const status of statuses) {
    const presentation = movieBoxPresentation({ status }, false, false);
    assert.equal(presentation.available, false);
    assert.equal(presentation.retryable, retryable.has(status));
    assert.equal(presentation.optionLabel, "MovieBox — unavailable");
    messages.add(presentation.message);
  }
  assert.equal(messages.size, statuses.length);
});
