# Cine Vault backend

The Hono backend serves versioned source discovery with unchanged embed fallbacks. The first MovieBox integration supports conservatively matched, independently probed **progressive MP4 resources** through a closed capability relay and a native browser player. Missing setup, ambiguous matches, signed-policy resources requiring live verification, DASH/HLS, unknown codecs and unavailable media retain embeds. This is **not full MovieBox-Tui playback parity**; no live MovieBox playback has been verified. No MovieBox credential belongs in the frontend.

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

The reusable modules accept setup through constructor options and do not import dotenv. The server composes them lazily only when the runtime key, server TMDB token, relay key and explicit media-host allowlist are present and valid. Invalid setup produces `blocked_setup` while embeds stay available. No real `.env` is created or modified.

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

## Progressive integration and relay limits

- `GET /api/sources/:type/:tmdbId?s=&e=` returns `{ version: 1, sources, moviebox: { status } }`. It retains the optional `x-access-token` discovery guard. Browser-visible frontend tokens are not confidential end-user authentication.
- MovieBox lookup is bounded to four in-flight identities and a 12-second deadline; exact title/type/year and detail reconfirmation are required. TV requires explicit episode evidence. Mapping and short result caches are size-limited and separate from expiring capabilities.
- Enable the relay only with `RELAY_SIGN_KEY` set to exactly 64 random hex characters (32 bytes) and `MOVIEBOX_MEDIA_HOSTS` containing exact independently approved CDN hostnames. `MOVIEBOX_CAPTION_HOSTS` is a separate allowlist. No built-in hosts or insecure relay key are provided. Example values are empty deliberately.
- `GET`/`HEAD /media/:capability` authenticates an opaque short-lived HMAC capability, not an arbitrary URL or browser-supplied upstream headers. Native video/track requests cannot send the Axios access header. Capability URLs are bearer capabilities: do not share or log them.
- The transport validates all DNS answers, rejects nonpublic and mapped/transition addresses, pins the selected IP at connection, retains hostname TLS verification, rejects redirects and forwards only bounded descriptor-owned headers. Captions never receive CDN cookies. Only single-byte ranges and validated 200/206/416 MP4 responses are supported.
- Progressive eligibility requires actual MP4 `ftyp` evidence plus explicit H264/AVC codec and quality metadata. This does not verify every in-file audio/video codec or guarantee playback on every browser; native failures retain provider switching.
- SRT/WebVTT captions are bounded, decoded strictly and converted to plain-text WebVTT. ASS/SSA/SUB are omitted. Missing/unavailable captions do not discard verified video.
- The native player provides real manual qualities and available subtitles + Off. There is no fake progressive Auto mode. Quality changes restart at zero because timeline alignment is unproven. The current audio label is informational; alternate dub switching is **not implemented** yet.
- Sessions/capabilities are memory-local, default to five minutes and honor known upstream expiry with a 60-second margin. Restarts/eviction invalidate them; multiple instances need sticky routing or a shared implementation. This increment uses explicit playback refresh, not transparent automatic renewal.
- Signed-policy resources remain `unverified`; DASH/HLS remain unsupported. Live credentials, CDN policy and actual movie/TV/caption/dub playback must be separately verified before adding adaptive playback. The device video-app action and CinePro remain deferred.

`get`/`post` retain complete decoded API payloads; typed adapters expose only bounded private metadata. Offline fixtures and a locally generated video can verify application behavior, not upstream compatibility.
