# Cine Vault backend

The Hono backend currently serves embed-only source candidates. MovieBox Phase2 adds a **server-only, independently testable signing/session/search client**; it does not change the source provider registry or routes, add media-resource/stream APIs, or integrate CinePro. No MovieBox credential belongs in the frontend.

## Development and offline verification

From the repository root:

```sh
npm --prefix backend run dev
npm --prefix backend test
npm --prefix backend run typecheck
npm --prefix backend run verify:moviebox
```

The verification command without `--live` skips network access. Tests inject fetch, clock, identity, and arbitrary fixture keys; they do not load dotenv or contact upstream hosts.

## MovieBox runtime setup

`MOVIEBOX_SECRET_HEX` must be supplied at runtime by the operator as **exactly 60 hexadecimal characters (30 bytes)**. There is no built-in credential or fallback. Missing, whitespace-padded, incorrectly sized, or non-hex values fail with a sanitized setup error before network access. These instructions do not provide or obtain a signing credential. Do not extract credentials from upstream source, populate committed examples, or send the key to the frontend.

The existing backend config exposes `movieboxSecretHex`; only the opt-in script imports that config. The reusable modules accept the key through constructor options and do not import dotenv. No real `.env` is created or modified by Phase2.

When a legitimate runtime key is already available, explicit live verification is:

```sh
npm --prefix backend run verify:moviebox -- --live
```

Or, from the backend directory:

```sh
npm run verify:moviebox -- --live
```

The command performs visitor login and searches for `Inception` twice. It prints only status/error code, numeric HTTP status when relevant, attempt/login/search counts, and session reuse counts. Missing setup produces `blocked_setup`, zero request counts, and a nonzero exit code. Tokens, headers, identity, response bodies, and keys are never printed. Live compatibility cannot be verified without an operator-supplied credential; offline success is not evidence of upstream compatibility.

## Client guarantees and limits

- Seven-field canonical HMAC-MD5 signing: method, accept, content type, full UTF-8 body byte length, millisecond timestamp, MD5 of the first 102400 body bytes, and canonical path/query. Absent and empty bodies differ. Decoded query keys sort in UTF-8 order; duplicate values retain order.
- One stable device identity per client, including across session refresh and host failover. No synthetic `x-forwarded-for`.
- Fixed seven observed HTTPS hosts. Only validated `/wefeed-mobile-bff/` relative paths are accepted; traversal, encoded path separators, controls, external URLs and redirects are rejected.
- Each attempt has a 12-second deadline covering fetch **and response body consumption**, with a 1 MiB body limit. Default bounded failover is three attempts; injection may configure at most seven attempts and a maximum 30-second per-attempt deadline.
- Only explicitly replay-safe operations fail over for transport/deadline failures or selected 500/502/503/504 statuses. Generic POST is not replayed unless its caller opts into `safeToReplay`; search is known read-only. Safe 401 triggers at most one refresh/replay. 403 is terminal denial; 429 immediately surfaces rate limiting without host hopping or refresh. Malformed responses, oversize bodies and redirects are not retried.
- Visitor login sends `{}`. Sessions are memory-only and login is singleflight. JWT claims are unverified lifetime metadata, **not authorization verification**: use a 60-second expiry margin, or seven days for opaque/no-exp sessions. Invalid JWT-shaped payloads/expiries are not cached. Successful `x-user` rotation replaces the current session only if valid; blank/malformed tokens and stale concurrent responses cannot overwrite it.
- Sanitized errors carry only a fixed message, error code, and optional numeric HTTP status. Diagnostics contain counts only. A failed singleflight login is cleared so a subsequent call may retry normally.

Phase2 is deliberately not wired into the embed source aggregator. Future integration and upstream live availability remain separate work. `get`/`post` return the complete decoded `data` payload (or complete top-level JSON when there is no envelope) without selecting or dropping its fields, allowing later typed metadata adapters.

Phase3 resolver/relay/player work must implement real MovieBox-Tui-like selectors: subtitles **Off + available languages**, actual alternate audio/dub mapping (which may require separate subject IDs), and resolution/**Auto** only when those choices truly exist. This phase adds no playback controls, fake options, or universal browser/codec compatibility promise.
