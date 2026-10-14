export interface MediaRepresentation {
  /** Private original-server strong ETag; never part of the public source contract. */
  etag: string;
  /** Complete representation byte length, not a returned range/prefix length. */
  length: number;
}

export function isStrongMediaEtag(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1_024 && value.endsWith('"') && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

export function isMediaRepresentation(value: unknown): value is MediaRepresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const representation = value as Partial<MediaRepresentation>;
  return isStrongMediaEtag(representation.etag) && typeof representation.length === "number" &&
    Number.isSafeInteger(representation.length) && representation.length > 0;
}

export const mediaProbeFailureCodes = [
  "invalid_resource", "invalid_range", "blocked_address", "busy", "cancelled", "timeout", "upstream",
  "invalid_response", "too_large", "invalid_container", "range_unsatisfied", "unknown",
] as const;
export type MediaProbeFailureCode = typeof mediaProbeFailureCodes[number];
export interface MediaProbeFailure {
  code: MediaProbeFailureCode;
  /** Only an observed numeric upstream status; no response/descriptor contents. */
  httpStatus?: number;
}
export interface MediaProbeEvidence {
  playable: boolean;
  representation?: MediaRepresentation;
  /** Private finite failure evidence, never exposed in the public source contract. */
  failure?: MediaProbeFailure;
}

export interface MediaResource {
  url: string;
  kind: "video" | "subtitle" | "manifest";
  headers: Readonly<Record<string, string>>;
  expiresAt?: number;
  height?: number;
  codec?: string;
  resourceId?: string;
  lang?: string;
  label?: string;
  captionFormat?: "srt" | "vtt";
  representation?: MediaRepresentation;
  /** Adaptive manifest ladder, in the manifest's own order. Only meaningful for a manifest. */
  heights?: readonly number[];
}

/** A signed adaptive manifest, read once and served to a player through the relay. */
export interface DashManifest {
  xml: string;
  heights: number[];
  audioRepresentationId?: string;
}

export interface MediaTransport {
  probe(resource: MediaResource, signal?: AbortSignal): Promise<boolean>;
  probeEvidence?(resource: MediaResource, signal?: AbortSignal): Promise<MediaProbeEvidence>;
  caption(resource: MediaResource, signal?: AbortSignal): Promise<string>;
  relay(resource: MediaResource, method: "GET" | "HEAD", range?: string, signal?: AbortSignal): Promise<Response>;
  /** Adaptive playback: read a manifest, serve it rewritten, and relay its segments. */
  readManifest?(resource: MediaResource, signal?: AbortSignal): Promise<DashManifest>;
  relayManifest?(resource: MediaResource, publicBase: string, method: "GET" | "HEAD", signal?: AbortSignal): Promise<Response>;
  relaySegment?(resource: MediaResource, name: string, range: string | undefined, signal?: AbortSignal): Promise<Response>;
}

export interface MediaRegistry {
  register(resource: MediaResource, expiresAt: number): string;
  /** Atomic bounded admission: no live eviction, one actual clipped deadline. */
  registerBatch(resources: readonly MediaResource[], expiresAt: number): { tokens: string[]; expiresAt: number };
  expiresAt(token: string): number | undefined;
  resolve(token: string, method: string): MediaResource | undefined;
  revoke(token: string): void;
}
