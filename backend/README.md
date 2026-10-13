# Cine Vault backend

The Hono backend serves versioned source discovery with unchanged embed fallbacks. MovieBox integration supports conservatively matched, independently probed **progressive MP4 resources** through a closed capability relay and a native browser player. Playback controls use isolated viewer sessions and independently verified alternate-subject editions, not fabricated audio tracks. Missing setup, ambiguous matches, signed-policy resources requiring live verification, DASH/HLS, unknown codecs and unavailable media retain embeds. This is **not full MovieBox-Tui playback parity**; no live MovieBox playback has been verified. No MovieBox signing credential belongs in the frontend.

## Development and offline verification

From the repository root:

```sh
npm --prefix backend run dev
npm --prefix backend test
npm --prefix backend run typecheck
npm --prefix backend run verify:moviebox
```

The verification command without `--live` skips network access. Tests inject fetch, clock, identity, and arbitrary fixture keys; they do not load dotenv or contact upstream hosts.

The server explicitly binds to `HOST`, defaulting to `127.0.0.1`, rather than a wildcard listener. It accepts exact unscoped IPv4/IPv6 literals (for example `::1`); hostnames and URLs are rejected. LAN/container use requires an explicit bind such as `0.0.0.0` and appropriate deployment access controls. The startup log reports the configured binding, with IPv6 brackets; a wildcard address is not a client connection URL. A loopback listener does not prevent exposure through a reverse proxy or forwarding tunnel, and never removes the approved-host requirement.

## Automatic visitor sessions (no user login)

Viewers do not create a MovieBox account, enter a username/password, paste a session token or call `init()`. The first metadata operation automatically establishes an anonymous visitor session with an empty `{}` request. Concurrent operations share that initialization, and subsequent requests reuse the memory-only session. Expiry or a replay-safe 401 permits a bounded automatic refresh.

This background visitor initialization is separate from **server API signing configuration**. `MOVIEBOX_SECRET_HEX` is not a user password or a visitor token; this implementation requires operator-provided request-signing setup. An automatically issued visitor session does not supply that setup. Missing server configuration remains `blocked_setup`, without prompting viewers to log in. These manual configuration requirements belong to this backend implementation, not to MovieBox-Tui's user setup. Automatic visitor login and passing offline fixtures do not mean this backend provides turnkey MovieBox playback.

## MovieBox runtime setup

`MOVIEBOX_SECRET_HEX` must be supplied at runtime by the operator as **exactly 60 hexadecimal characters (30 bytes)**. There is no built-in credential or fallback. Missing, whitespace-padded, incorrectly sized, or non-hex values fail with a sanitized setup error before network access. These instructions do not provide or obtain a signing credential. Do not extract credentials from upstream source, populate committed examples, or send the key to the frontend.

The reusable modules accept setup through constructor options and do not import dotenv. The server composes them lazily only when the runtime MovieBox key, server TMDB token and explicit media-host allowlist are present and valid. The relay signing key is generated automatically when absent; a malformed explicit relay key still fails setup. Invalid setup produces `blocked_setup` while embeds stay available. No real `.env` is created or modified.

When a legitimate runtime key is already available, explicit live verification is:

```sh
npm --prefix backend run verify:moviebox -- --live
```

Or, from the backend directory:

```sh
npm run verify:moviebox -- --live
```

The command performs visitor login and searches for `Inception` twice. It prints only status/error code, numeric HTTP status when relevant, attempt/login/search counts, and session reuse counts. Missing setup produces `blocked_setup`, zero request counts, and a nonzero exit code. Tokens, headers, identity, response bodies, and keys are never printed. Live compatibility cannot be verified without an operator-supplied credential; offline success is not evidence of upstream compatibility.

## Failed-discovery diagnostics

MovieBox discovery failures are diagnosed in the **backend terminal**, not the browser console. Runtime warnings contain only fixed stage/reason codes, known sanitized error codes and numeric upstream HTTP status when available. They do not print raw exceptions, request/response bodies, titles, media IDs, hostnames, URLs, cookies, headers, keys, tokens, policy contents or representation validators. A generic transport failure does not establish whether TLS or the remote connection failed.

For example (illustrative, not observed live failures):

```text
[moviebox] discovery_failed status=unverified stage=stream code=authorization_metadata
[moviebox] discovery_failed status=unverified stage=media_probe code=invalid_response httpStatus=403
```

`authorization_metadata` means the stream carries authorization metadata that the current integration cannot verify, so no video probe is attempted. `codec_missing`/`height_missing` identify absent required metadata; `episode_evidence_missing` identifies missing exact episode proof; `stage=tmdb code=no_target` means the TMDB bridge could not supply an identity. Media-probe `invalid_resource` groups descriptor/approved-host policy failures, `blocked_address` identifies rejected address evidence, `invalid_container` identifies failed MP4-prefix evidence, and `invalid_response` groups response-validation failures. `upstream` does not distinguish connection and TLS errors. `unknown` or `probe_rejected` explicitly means no more-specific trusted cause was retained; logs do not infer missing evidence.

Successful canonical playback stays silent even if optional subtitles, qualities or dubs fail. Shared discovery work emits one failure warning; a cached negative result does not emit a fresh warning. The negative cache lasts up to 15 seconds. After changing configuration, restart the backend; when diagnosing a repeated attempt, wait for that cache to expire and reload the watch page. The public source status remains unchanged, and diagnostic logging never removes verification or host-approval gates.

## Client guarantees and limits

- Seven-field canonical HMAC-MD5 signing: method, accept, content type, full UTF-8 body byte length, millisecond timestamp, MD5 of the first 102400 body bytes, and canonical path/query. Absent and empty bodies differ. Decoded query keys sort in UTF-8 order; duplicate values retain order.
- One stable device identity per client, including across session refresh and host failover. No synthetic `x-forwarded-for`.
- Fixed seven observed HTTPS hosts. Only validated `/wefeed-mobile-bff/` relative paths are accepted; traversal, encoded path separators, controls, external URLs and redirects are rejected.
- Each attempt has a 12-second deadline covering fetch **and response body consumption**, with a 1 MiB body limit. Default bounded failover is three attempts; injection may configure at most seven attempts and a maximum 30-second per-attempt deadline.
- Only explicitly replay-safe operations fail over for transport/deadline failures or selected 500/502/503/504 statuses. Generic POST is not replayed unless its caller opts into `safeToReplay`; search is known read-only. Safe 401 triggers at most one refresh/replay. 403 is terminal denial; 429 immediately surfaces rate limiting without host hopping or refresh. Malformed responses, oversize bodies and redirects are not retried.
- Visitor login sends `{}`. Sessions are memory-only and login is singleflight. JWT claims are unverified lifetime metadata, **not authorization verification**: use a 60-second expiry margin, or seven days for opaque/no-exp sessions. Invalid JWT-shaped payloads/expiries are not cached. Successful `x-user` rotation replaces the current session only if valid; blank/malformed tokens and stale concurrent responses cannot overwrite it.
- Sanitized errors carry only a fixed message, error code, and optional numeric HTTP status. Diagnostics contain counts only. A failed singleflight login is cleared so a subsequent call may retry normally.

## Progressive integration and relay limits

- `GET /api/sources/:type/:tmdbId?s=&e=` returns `{ version: 2, sources, moviebox: { status, reason? } }`. Only `blocked_setup` can include a fixed diagnostic reason: `missing_signing_key`, `invalid_signing_key`, `missing_tmdb_token`, `missing_media_hosts`, `invalid_relay_key` or `invalid_configuration`. Reasons never include configuration values, URLs, headers or raw exception text. Older responses without a reason remain valid. The player shows MovieBox's unavailable state and reason next to source controls, not as a fake playable candidate; an already committed direct source remains owned across discovery changes. The API retains the optional `x-access-token` discovery guard. Browser-visible frontend tokens are not confidential end-user authentication.
- MovieBox lookup is bounded to four in-flight identities and a 12-second deadline; exact title/type/year and detail reconfirmation are required. TV requires explicit episode evidence. Mapping and short result caches are size-limited and separate from expiring capabilities.
- A whole source-discovery request failure is distinct from a successful API response saying MovieBox is unavailable. For valid movie/TV routes, the frontend can rebuild only the five existing embed URLs after such a failure, without inventing a direct source or relaxing response validation. It does not auto-select an embed while initial discovery is pending, and synthetic fallback does not create a provider preference that prevents MovieBox becoming primary on a successful retry. These third-party embeds do not grant backend MovieBox/media access or prove a provider will play.
- Only a resource-list `MovieBoxError` with `code=http` and observed HTTP 400 stops listing and permits the existing play-info lookup. This is not a retry or alternate-host request, and does not diagnose or repair the resource endpoint's rejection. The fallback still requires independently verified progressive video; TV needs explicit episode evidence in seasons/resources or the fallback's exact `se`/`ep`. Resource-list 401/403/429 and other failures remain terminal. If fallback supplies nothing and no more-specific failure is known, terminal diagnostics retain the resource-list 400.
- `RELAY_SIGN_KEY` is optional: leaving it empty generates a cryptographically random 32-byte memory-only key, reused within that backend process. An explicit key must contain exactly 64 hex characters. Restart already invalidates memory-local sessions and media capabilities; a stable key alone does not make them persistent. `MOVIEBOX_MEDIA_HOSTS` still requires exact independently approved CDN hostnames; `MOVIEBOX_CAPTION_HOSTS` is a separate allowlist. No built-in hosts or fixed fallback relay key are provided.
- `GET`/`HEAD /media/:capability` authenticates an opaque short-lived HMAC capability, not an arbitrary URL or browser-supplied upstream headers. Native video/track requests cannot send the Axios access header. Capability URLs are bearer capabilities: do not share or log them.
- The transport validates all DNS answers, rejects nonpublic and mapped/transition addresses, pins the selected IP at connection, retains hostname TLS verification, rejects redirects and forwards only bounded descriptor-owned headers. Captions never receive CDN cookies. Only single-byte ranges and validated 200/206/416 MP4 responses are supported.
- Progressive eligibility requires actual MP4 `ftyp` evidence plus explicit H264/AVC codec and quality metadata. This does not verify every in-file audio/video codec or guarantee playback on every browser; native failures retain provider switching.
- SRT/WebVTT captions are bounded, decoded strictly and converted to plain-text WebVTT. ASS/SSA/SUB are omitted. Missing/unavailable captions do not discard verified video.
- The native player provides real manual qualities and available subtitles + Off. There is no fake progressive Auto mode. Quality and alternate-edition changes start at zero because cross-edition timeline alignment is unproven. An unknown current audio stays labeled `Source audio`, not `Original`. Selectable dubs require explicit relationships, reconfirmed exact identity, independent episode evidence and probed progressive resources; incomplete metadata is omitted rather than guessed.
- Media capabilities are memory-local, default to five minutes and honor known upstream expiry with a 60-second margin. Playback controls have a separate bounded lifetime and recovery grace; neither permits use of expired media. Restarts/eviction invalidate state; multiple instances need sticky routing or a shared implementation.
- Renewal prepares a replacement without stopping still-valid playback. Position-preserving application requires the same exact resource URI and strong representation evidence bound and enforced by the relay. Without that proof, the player offers explicit application from the beginning; it does not silently restart every five minutes. Native source replacement may buffer and is not gapless playback.
- Signed-policy resources remain `unverified`; DASH/HLS remain unsupported. Authorized runtime/CDN-policy and actual movie/TV/caption/dub/browser playback must be separately verified before claiming upstream compatibility or adding adaptive playback. CinePro remains deferred.
- `Copy stream link` exports only the committed, selected, unexpired backend media capability after an explicit user action. The link grants temporary bearer access: do not publish it, paste it into public support logs, or share it unintentionally. An external app/device needs backend network reachability and does not inherit renewal. This is **not** a guaranteed default-device-video-app launch; embed pages are not exportable media files.

## Playback session controls

Each successful discovery issues a fresh isolated playback session; concurrent viewers may share private discovery work but never a mutable control session. Direct sources carry an opaque session ID, revision, issue/expiry times and a distinct random 256-bit control capability. The viewer keeps this capability in memory only. It is temporary bearer authority for that one session, **not** a MovieBox account token, signing key or confidential end-user identity.

Fixed endpoints require the `x-playback-control` header and, when configured, the existing deployment `x-access-token` guard:

- `GET /api/playback/:sessionId`: committed state and any pending preparation for lost-response reconciliation.
- `POST /api/playback/:sessionId/prepare`: `{ version: 1, baseRevision, reason: "renew" | "audio", audioId?, qualityId? }`, using session-owned option IDs only.
- `POST /api/playback/:sessionId/commit`: `{ version: 1, baseRevision, preparationId }`.

Preparation validates and stages a replacement without changing committed playback. Commit compares the expected revision atomically. A stale request cannot overwrite a newer edition; an uncertain commit must be reconciled instead of blindly replayed. A bare session ID, media capability, arbitrary subject ID, URL or browser-provided upstream header never authorizes these operations. Responses and sanitized failures use `no-store`; operation request bodies are bounded to 2 KiB with a three-second read deadline.

The service bounds sessions, cached descriptors, in-flight work, preparation rates and resource generations. A preparation lasts at most 60 seconds and cannot outlive control authority. Control authority lasts no later than 30 minutes after original session issuance or committed media expiry plus 30 seconds, whichever is earlier. Reads/preparations do not extend it. Brief grace only permits replacement of known bound session state; expired media stays invalid. Abandoned staged capabilities are revoked; previous committed capabilities retire at their natural expiry so replacement does not terminate an existing read prematurely. Expiry of control authority removes session state and pending preparations but does not shorten independently issued committed media capabilities; those retain their original bounded deadline.

A bounded MP4 probe can retain private strong ETag and full-representation length evidence. Evidence-bound relay requests generate `If-Match` from the server-owned descriptor and reject missing/changed/weak validators or contradictory lengths before forwarding bytes. Such evidence establishes only the same representation at the same URI; it does not align different qualities, dubs or signed URLs.

`get`/`post` retain complete decoded API payloads; typed adapters expose only bounded private metadata. Offline fixtures and a locally generated video can verify application behavior, not upstream compatibility.
