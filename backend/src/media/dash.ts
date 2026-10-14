/**
 * Signed-DASH helpers for the MovieBox CDN.
 *
 * The API answers an unserved title with a downgrade advertisement and keeps the real content behind a
 * signed DASH manifest. The location is never guessable: it is carried inside the per-stream
 * authorization (an `urlprefix` cache cookie or a CloudFront policy document), so these helpers only
 * *read out* a destination the CDN already authorized and never construct one.
 *
 * Everything here is pure: no fetch, no state, no logging. The transport validates the resulting URL
 * against its host allowlist before a byte leaves the process.
 */

/** The live manifest is ~72KB; the reference client refuses anything past 10MB. */
export const DASH_MANIFEST_LIMIT_BYTES = 10 * 1024 * 1024;
/** Authorization strings are small header/query values. */
const AUTHORIZATION_LIMIT = 8192;
const JSON_LIMIT = 4096;
const MAX_REPRESENTATIONS = 64;

const decodeBase64 = (value: string): string | undefined => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - normalized.length % 4) % 4;
  try {
    // A malformed authorization is simply not a manifest source; it is never an error to report.
    const bytes = Buffer.from(normalized + "=".repeat(padding), "base64");
    if (!bytes.length) return undefined;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return undefined; }
};

/**
 * A signed prefix names the manifest's own directory; the manifest is always `index.mpd` inside it.
 * Only the CDN's `dash/` tree carries media, so a prefix pointing anywhere else is not usable here.
 */
const manifestFromPrefix = (prefix: string): string | undefined => {
  const base = prefix.trim().replace(/\/+$/, "");
  if (base.length > AUTHORIZATION_LIMIT || !base.startsWith("https://") || /[\s\\]/.test(base) || !base.includes("/dash/")) return undefined;
  return `${base}/index.mpd`;
};

/** CloudFront policy documents are base64url with a `~` stand-in for `/`. */
const manifestFromPolicy = (policy: string): string | undefined => {
  const decoded = decodeBase64(policy.replace(/~/g, "/").replace(/_/g, "="));
  if (decoded === undefined || decoded.length > JSON_LIMIT) return undefined;
  let resource: unknown;
  try {
    const parsed: unknown = JSON.parse(decoded);
    resource = (parsed as { Statement?: { Resource?: unknown }[] })?.Statement?.[0]?.Resource;
  } catch { return undefined; }
  if (typeof resource !== "string") return undefined;
  return manifestFromPrefix(resource.replace(/\*+$/, "").replace(/\/+$/, ""));
};

/**
 * Read the authorized DASH manifest out of a stream's authorization metadata.
 *
 * Both carriers are accepted because the API has used each: an `Edge-Cache-Cookie` `urlprefix` token,
 * and a `CloudFront-Policy` document whose first statement names the same directory. A bare policy
 * value is also tried as a document, since the API has sent it both prefixed and unprefixed.
 */
export function authorizedDashManifest(authorization: string | undefined): string | undefined {
  if (typeof authorization !== "string" || !authorization.length || authorization.length > AUTHORIZATION_LIMIT) return undefined;
  for (const part of authorization.split(";")) {
    const entry = part.trim();
    const index = entry.indexOf("urlprefix=");
    if (index >= 0) {
      const token = entry.slice(index + "urlprefix=".length).split(":", 1)[0]!.trim();
      const decoded = decodeBase64(token);
      const manifest = decoded === undefined ? undefined : manifestFromPrefix(decoded);
      if (manifest) return manifest;
    }
    if (entry.startsWith("CloudFront-Policy=")) {
      const manifest = manifestFromPolicy(entry.slice("CloudFront-Policy=".length));
      if (manifest) return manifest;
    }
  }
  return undefined;
}

/**
 * The manifest a stream row authorizes, across every carrier the API has used.
 *
 * One stream row is answered with and without its authorization, so a caller that needs to know
 * whether a row can play at all asks this and gets nothing when the row carries no usable one.
 */
export function streamManifestUrl(carriers: { signCookie?: string; policy?: string }): string | undefined {
  return authorizedDashManifest(carriers.signCookie) ?? authorizedDashManifest(carriers.policy) ??
    authorizedDashManifest(carriers.policy === undefined ? undefined : `CloudFront-Policy=${carriers.policy}`);
}

/**
 * Segment names are flat file names inside the manifest's own directory. A slash can therefore never
 * appear, which makes traversal impossible by construction; the extension check keeps the relay from
 * becoming a reader for anything else that happens to live beside the media.
 */
export function isDashSegmentName(name: string): boolean {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.(?:m4s|mp4|cmf[vt])$/.test(name) && !name.includes("..");
}

/**
 * The directory holding the manifest, or nothing when the manifest sits at the host root.
 *
 * A manifest at the root would make its directory the whole origin, so every absolute reference in
 * *any* document would match a rewrite. Media never lives there, and refusing it keeps rewriting
 * scoped to a real bucket path. It is also the identity of one signed stream: every segment of a
 * representation lives beside its manifest, so this string is what a relay keys the stream's
 * credentials by.
 */
export function dashDirectory(url: string): string | undefined {
  const authorityEnd = url.indexOf("/", "https://".length);
  const cut = url.lastIndexOf("/");
  if (authorityEnd <= 0 || cut <= authorityEnd + 1) return undefined;
  return url.slice(0, cut + 1);
}

/** Resolve a segment name against the manifest's directory, refusing anything outside it. */
export function dashSegmentUrl(manifestUrl: string, name: string): string | undefined {
  if (!isDashSegmentName(name)) return undefined;
  const directory = dashDirectory(manifestUrl);
  return directory === undefined ? undefined : `${directory}${name}`;
}

/**
 * Point every absolute reference inside the manifest at our own relay.
 *
 * Segment templates are relative in the API's manifests, so they already resolve against whatever path
 * the manifest is served from: serving it as `<publicBase>index.mpd` is what makes them come back to us.
 * Absolute references (a `<BaseURL>` or an absolute template) are rewritten by replacing the authorized
 * directory prefix, which leaves unrelated URLs — XML namespaces, schema locations — untouched.
 */
export function rewriteDashManifest(xml: string, manifestUrl: string, publicBase: string): string {
  const directory = dashDirectory(manifestUrl);
  if (directory === undefined || directory === publicBase) return xml;
  // split/join keeps `$` sequences in either side literal.
  return xml.split(directory).join(publicBase);
}

/** Advertised video heights, in the manifest's own order and without duplicates. */
export function dashManifestHeights(xml: string): number[] {
  const heights: number[] = [];
  const pattern = /<Representation\b[^>]*>/g;
  for (let match = pattern.exec(xml), seen = 0; match && seen < MAX_REPRESENTATIONS; match = pattern.exec(xml), seen++) {
    const height = /\bheight="(\d{3,4})"/.exec(match[0]);
    if (!height) continue;
    const value = Number(height[1]);
    if (Number.isInteger(value) && value >= 144 && value <= 8192 && !heights.includes(value)) heights.push(value);
  }
  return heights;
}

/**
 * The representation carrying audio, read from the manifest rather than assumed.
 *
 * The API numbers video first and audio last, but a title with a different ladder would silently lose
 * its audio prefetch if that layout were hard-coded.
 */
export function dashAudioRepresentationId(xml: string): string | undefined {
  for (const set of xml.match(/<AdaptationSet\b[\s\S]{0,4096}?<\/AdaptationSet>/g) ?? []) {
    if (!/\bcontentType="audio"/.test(set.slice(0, 512))) continue;
    const id = /<Representation\b[^>]*\bid="([A-Za-z0-9_.-]{1,32})"/.exec(set);
    if (id) return id[1];
  }
  return undefined;
}

const CHUNK_NAME = /^(chunk-stream)([0-9]{1,3})-([0-9]{1,9})(\.(?:m4s|mp4|cmf[vt]))$/;

/**
 * The next segment names to fetch ahead of the one being served.
 *
 * A single request against this CDN is throttled to well under a video bitrate — measured at 0.5 Mbit/s
 * for a whole 5MB segment against ~24 Mbit/s for parallel range requests — so a player that only ever
 * requests the segment it is about to show cannot keep up. Naming the successors is all that is needed;
 * the relay fetches them in the background while the current segment is being written out.
 */
export function nextDashSegmentNames(name: string, count: number, audioRepresentationId?: string): string[] {
  const match = CHUNK_NAME.exec(name);
  if (!match || !Number.isInteger(count) || count < 1 || count > 8) return [];
  const [, prefix, representation, digits, extension] = match as unknown as [string, string, string, string, string];
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) return [];
  const named = (stream: string, value: number) => `${prefix}${stream}-${String(value).padStart(digits.length, "0")}${extension}`;
  const names: string[] = [];
  for (let step = 1; step <= count; step++) names.push(named(representation, number + step));
  // Audio is fetched by the player at the same time, so one lookahead of it is enough.
  if (audioRepresentationId !== undefined && audioRepresentationId !== representation) {
    names.push(named(audioRepresentationId, number), named(audioRepresentationId, number + 1));
  }
  return names;
}
