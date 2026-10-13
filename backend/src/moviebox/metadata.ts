import type { MovieBoxClient } from "./client.js";
import { MovieBoxError } from "./errors.js";

/** Server-only adapter data. None of these descriptors are public playback capabilities. */
export type MovieBoxTransport = Pick<MovieBoxClient, "get" | "search">;
export type SubjectType = "movie" | "tv";
export interface SubjectIdentity {
  subjectId: string;
  title?: string;
  type?: SubjectType;
  year?: number;
}
export interface SeasonMetadata {
  se: number;
  episodeNumbers: number[];
  /** Listing metadata only; never evidence that 1..maxEp exists. */
  maxEp?: number;
}
export interface DubMetadata extends SubjectIdentity {
  lang?: string;
  label?: string;
}
export interface SubjectDetail extends SubjectIdentity {
  seasons: SeasonMetadata[];
  /** Explicit alternate-subject relationships only, not verified audio tracks. */
  dubs: DubMetadata[];
}
export interface EpisodeSelection { season: number; episode: number }
export interface PrivateStreamMetadata {
  resourceId?: string;
  url?: string;
  format?: string;
  height?: number;
  quality?: string;
  codec?: string;
  resolutions: number[];
  size?: number;
  fileName?: string;
  title?: string;
  language?: string;
  uploadBy?: string;
  source?: string;
  /** Only an explicit epoch-millisecond field is retained; no inferred lifetime. */
  expiresAt?: number;
  se?: number;
  ep?: number;
  headers: Readonly<Record<string, string>>;
  cookie?: string;
  /** Opaque upstream strings, never decoded or transformed into a destination. */
  signCookie?: string;
  policy?: string;
  requiresVerification: boolean;
}
export interface PrivateCaptionMetadata {
  id?: string;
  resourceId?: string;
  url: string;
  lang?: string;
  label?: string;
  format?: string;
  size?: number;
  headers: Readonly<Record<string, string>>;
  cookie?: string;
  signCookie?: string;
  policy?: string;
  requiresVerification: boolean;
}
export interface ResourcePage {
  page: number;
  perPage: number;
  resources: PrivateStreamMetadata[];
  /** Unknown means unknown: do not infer a next page from array length. */
  hasMore?: boolean;
}
export type StreamClassification =
  | { status: "unsupported_adaptive"; reason: "dash" | "hls" }
  | { status: "unverified"; reason: "signed_policy" | "media_evidence_required" }
  | { status: "unsupported_format"; reason: "notice" | "invalid_url" | "missing_url" | "format" };

const PREFIX = "/wefeed-mobile-bff/subject-api/";
const MAX_ITEMS = 500;
const MAX_SEASONS = 500;
const MAX_EPISODE = 10000;
const MAX_PAGE = 100;
const MAX_PER_PAGE = 100;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const malformed = (): never => { throw new MovieBoxError("malformed"); };
const invalidRequest = (): never => { throw new MovieBoxError("request"); };

/** Never coerce an unsafe numeric ID: its original decimal digits have already been lost. */
export function parseMovieBoxId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length <= 128 && /^[1-9][0-9]*$/u.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}
function integer(value: unknown, max: number, min = 1): number | undefined {
  const n = typeof value === "number" ? value :
    typeof value === "string" && value.length <= 16 && /^(?:0|[1-9][0-9]*)$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
}
function text(value: unknown, max = 512): string | undefined {
  return typeof value === "string" && value.length <= max && value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    ? value.trim() : undefined;
}
function list(value: unknown, max = MAX_ITEMS): unknown[] {
  if (!Array.isArray(value) || value.length > max) return malformed();
  return value;
}
function idField(row: Record<string, unknown>, keys: string[]): string | undefined {
  const values = keys.filter((key) => Object.hasOwn(row, key)).map((key) => parseMovieBoxId(row[key]));
  return values.length && values.every((id) => id !== undefined && id === values[0]) ? values[0] : undefined;
}
function typeField(row: Record<string, unknown>): SubjectType | undefined {
  const values = ["subjectType", "stype"].filter((key) => Object.hasOwn(row, key)).map((key) => integer(row[key], 2));
  if (!values.length || values.some((value) => value === undefined || value !== values[0])) return;
  return values[0] === 1 ? "movie" : "tv";
}
function releaseYear(value: unknown): number | undefined {
  if (typeof value === "number") return integer(value, 9999, 1000);
  const s = text(value, 256);
  if (!s) return;
  // Only an explicit leading year is evidence; no arbitrary four-digit substring search.
  const match = /^(\d{4})(?:$|[-/\s·(年])/u.exec(s);
  return match ? integer(match[1], 9999, 1000) : undefined;
}
function yearField(row: Record<string, unknown>): number | undefined {
  const values = ["year", "releaseDate", "releaseInfo"].filter((key) => Object.hasOwn(row, key)).map((key) => {
    if (key === "year") return integer(row[key], 9999, 1000);
    return releaseYear(row[key]);
  });
  return values.length && values.every((value) => value !== undefined && value === values[0]) ? values[0] : undefined;
}
function identity(value: unknown): SubjectIdentity | undefined {
  const row = record(value);
  if (!row) return;
  const subjectId = idField(row, ["subjectId", "id"]);
  if (!subjectId) return;
  return { subjectId, title: text(row.title ?? row.name), type: typeField(row), year: yearField(row) };
}

/** Missing title/type/year is preserved as missing evidence, never supplied by defaults. */
export function parseSearchSubjects(value: unknown): SubjectIdentity[] {
  const root = record(value);
  if (!root) return malformed();
  const containers: unknown[][] = [];
  if (Object.hasOwn(root, "results")) {
    for (const group of list(root.results)) {
      const row = record(group);
      if (!row) return malformed();
      if (Object.hasOwn(row, "subjects")) containers.push(list(row.subjects));
      if (Object.hasOwn(row, "list")) containers.push(list(row.list));
    }
  }
  if (Object.hasOwn(root, "subjects")) containers.push(list(root.subjects));
  if (Object.hasOwn(root, "list")) containers.push(list(root.list));
  if (!containers.length && !Object.hasOwn(root, "results")) return malformed();
  if (containers.length > MAX_ITEMS) return malformed();
  if (containers.reduce((sum, items) => sum + items.length, 0) > MAX_ITEMS) return malformed();
  return containers.flatMap((items) => items.flatMap((item) => { const parsed = identity(item); return parsed ? [parsed] : []; }));
}

export function parseSeasonInfo(value: unknown): SeasonMetadata[] {
  const root = record(value);
  if (!root && !Array.isArray(value)) return malformed();
  const nested = record(root?.subject);
  if (root && Object.hasOwn(root, "subject") && !nested) return malformed();
  const seasons = Array.isArray(value) ? value : (nested ?? root)?.seasons;
  if (seasons === undefined) return [];
  return list(seasons, MAX_SEASONS).map((value) => {
    const row = record(value);
    const se = integer(row?.se, MAX_EPISODE);
    if (!row || se === undefined) return malformed();
    const episodeNumbers = row.episodeNumbers === undefined ? [] : list(row.episodeNumbers, MAX_EPISODE).map((ep) => {
      const parsed = integer(ep, MAX_EPISODE);
      return parsed === undefined ? malformed() : parsed;
    });
    const maxEp = row.maxEp === undefined ? undefined : integer(row.maxEp, MAX_EPISODE, 0);
    if (row.maxEp !== undefined && maxEp === undefined) return malformed();
    return { se, episodeNumbers: [...new Set(episodeNumbers)], maxEp };
  });
}
export function parseSubjectDetail(value: unknown): SubjectDetail | undefined {
  const root = record(value);
  if (!root) return malformed();
  const row = Object.hasOwn(root, "subject") ? record(root.subject) : root;
  if (!row) return malformed();
  const parsed = identity(row);
  if (!parsed) return;
  const rawDubs = row.dubs ?? root.dubs;
  const dubs = rawDubs === undefined ? [] : list(rawDubs).flatMap((value) => {
    const dub = identity(value);
    const data = record(value);
    return dub && data ? [{ ...dub, lang: text(data.lang ?? data.language, 64), label: text(data.label ?? data.name, 128) }] : [];
  });
  return { ...parsed, seasons: parseSeasonInfo(row.seasons === undefined ? root : row), dubs };
}

function privateUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port && url.port !== "443" || url.hash) return;
    return value;
  } catch { return; }
}
function headers(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  const row = record(value);
  if (!row || Object.keys(row).length > 32) return malformed();
  const entries = Object.entries(row);
  if (entries.some(([key, value]) => !/^[A-Za-z0-9-]{1,64}$/u.test(key) || typeof value !== "string" || value.length > 8192 || /[\u0000-\u001f\u007f]/u.test(value))) return malformed();
  return Object.fromEntries(entries) as Record<string, string>;
}
function authorizationMetadata(row: Record<string, unknown>) {
  // Presence alone is a verification gate, including opaque object policies we do not inspect.
  const parsedHeaders = headers(row.headers);
  const requiresVerification = ["signCookie", "policy", "cookie"].some((key) => Object.hasOwn(row, key)) ||
    Object.keys(parsedHeaders).some((key) => /^(?:cookie|authorization)$/iu.test(key));
  return { headers: parsedHeaders, cookie: text(row.cookie, 16384), signCookie: text(row.signCookie, 16384),
    policy: text(row.policy, 16384), requiresVerification };
}
function stream(value: unknown): PrivateStreamMetadata | undefined {
  const row = record(value);
  if (!row) return;
  const resourceId = idField(row, ["resourceId", "id"]);
  if (["resourceId", "id"].some((key) => Object.hasOwn(row, key)) && !resourceId) return;
  const rawUrl = row.url ?? row.resourceLink ?? row.streamUrl;
  const url = privateUrl(rawUrl);
  if (rawUrl !== undefined && !url) return;
  const se = row.se === undefined ? undefined : integer(row.se, MAX_EPISODE);
  const ep = row.ep === undefined ? undefined : integer(row.ep, MAX_EPISODE);
  if ((row.se !== undefined || row.ep !== undefined) && (se === undefined || ep === undefined)) return;
  const resolutions = row.resolutions === undefined ? [] : list(row.resolutions, 32).map((height) => {
    const parsed = integer(height, 8640);
    return parsed === undefined ? malformed() : parsed;
  });
  return { resourceId, url, format: text(row.format, 64), height: integer(row.height ?? row.resolution, 8640),
    quality: text(row.quality, 64), codec: text(row.codecName ?? row.codec, 128), resolutions: [...new Set(resolutions)],
    size: integer(row.size, Number.MAX_SAFE_INTEGER, 0), fileName: text(row.fileName), title: text(row.title),
    language: text(row.language ?? row.lanName, 64), uploadBy: text(row.uploadBy, 128), source: text(row.source, 128),
    expiresAt: integer(row.expiresAt, Number.MAX_SAFE_INTEGER), se, ep, ...authorizationMetadata(row) };
}
function rows(value: unknown, keys: string[]): { root: Record<string, unknown>; items: unknown[] } {
  if (Array.isArray(value)) return { root: {}, items: list(value) };
  const root = record(value);
  if (!root) return malformed();
  for (const key of keys) if (Object.hasOwn(root, key)) return { root, items: list(root[key]) };
  // A single descriptor is allowed, but arbitrary objects are not an empty success.
  if (Object.hasOwn(root, "url") || Object.hasOwn(root, "resourceLink") || Object.hasOwn(root, "streamUrl") || Object.hasOwn(root, "signCookie") || Object.hasOwn(root, "policy")) return { root, items: [root] };
  return malformed();
}
export function parsePlayInfo(value: unknown): PrivateStreamMetadata[] {
  const { root, items } = rows(value, ["streams", "resources", "list"]);
  const inherited = authorizationMetadata(root);
  return items.flatMap((item) => {
    const parsed = stream(item);
    if (!parsed) return [];
    // Root auth metadata stays private and is never decoded into URLs.
    return [{ ...parsed, headers: { ...inherited.headers, ...parsed.headers }, cookie: parsed.cookie ?? inherited.cookie,
      signCookie: parsed.signCookie ?? inherited.signCookie, policy: parsed.policy ?? inherited.policy,
      requiresVerification: parsed.requiresVerification || inherited.requiresVerification }];
  });
}
export function parseResourcePage(value: unknown, page: number, perPage: number): ResourcePage {
  if (integer(page, MAX_PAGE) !== page || integer(perPage, MAX_PER_PAGE) !== perPage) return invalidRequest();
  const { root, items } = rows(value, ["resources", "list"]);
  if (items.length > perPage) return malformed();
  if (root.hasMore !== undefined && typeof root.hasMore !== "boolean") return malformed();
  return { page, perPage, resources: parsePlayInfo(value), hasMore: root.hasMore as boolean | undefined };
}
export function parseCaptions(value: unknown): PrivateCaptionMetadata[] {
  const { root, items } = rows(value, ["extCaptions", "captions", "list"]);
  const inherited = authorizationMetadata(root);
  return items.flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    const url = privateUrl(row.url);
    const id = idField(row, ["captionId", "id"]);
    const resourceId = row.resourceId === undefined ? undefined : parseMovieBoxId(row.resourceId);
    if (!url || (["captionId", "id"].some((key) => Object.hasOwn(row, key)) && !id) || (row.resourceId !== undefined && !resourceId)) return [];
    const auth = authorizationMetadata(row);
    return [{ id, resourceId, url, lang: text(row.lang ?? row.lan ?? row.language, 64), label: text(row.label ?? row.lanName ?? row.name, 128),
      format: text(row.format, 64), size: integer(row.size, Number.MAX_SAFE_INTEGER, 0), ...auth, headers: { ...inherited.headers, ...auth.headers },
      cookie: auth.cookie ?? inherited.cookie, signCookie: auth.signCookie ?? inherited.signCookie, policy: auth.policy ?? inherited.policy,
      requiresVerification: auth.requiresVerification || inherited.requiresVerification }];
  });
}

/** Pure hints only: even an MP4 extension/label needs independent media/container verification. */
export function classifyStream(resource: Pick<PrivateStreamMetadata, "url" | "format" | "requiresVerification" | "signCookie" | "policy" | "cookie">): StreamClassification {
  let path: string | undefined;
  if (resource.url !== undefined) {
    if (!privateUrl(resource.url)) return { status: "unsupported_format", reason: "invalid_url" };
    // Decode the path only for marker detection. Never decode cookies, policy or query data.
    try { path = decodeURIComponent(new URL(resource.url).pathname).toLowerCase(); }
    catch { return { status: "unsupported_format", reason: "invalid_url" }; }
  }
  if (path && /(?:^|[\/_.-])(?:notice|deprecated|deprecation)(?:[\/_.-]|$)/u.test(path)) return { status: "unsupported_format", reason: "notice" };
  if (path && (path.includes("/dash/") || path.endsWith(".mpd"))) return { status: "unsupported_adaptive", reason: "dash" };
  if (path && (path.includes("/hls/") || path.endsWith(".m3u8"))) return { status: "unsupported_adaptive", reason: "hls" };
  if (resource.requiresVerification || resource.signCookie !== undefined || resource.policy !== undefined || resource.cookie !== undefined) return { status: "unverified", reason: "signed_policy" };
  const format = resource.format?.trim().toLowerCase();
  if (["dash", "mpd", "application/dash+xml"].includes(format ?? "")) return { status: "unsupported_adaptive", reason: "dash" };
  if (["hls", "m3u8", "application/vnd.apple.mpegurl"].includes(format ?? "")) return { status: "unsupported_adaptive", reason: "hls" };
  if (!path) return { status: "unsupported_format", reason: "missing_url" };
  if (format && !["mp4", "video/mp4"].includes(format) || /\.(?:mkv|avi|flv|webm|mov|ts|html?)(?:$)/u.test(path)) return { status: "unsupported_format", reason: "format" };
  return { status: "unverified", reason: "media_evidence_required" };
}

function requestId(value: unknown): string { return parseMovieBoxId(value) ?? invalidRequest(); }
function selectionParams(selection: EpisodeSelection | undefined): Record<string, string> {
  if (selection === undefined) return {};
  const season = integer(selection.season, MAX_EPISODE);
  const episode = integer(selection.episode, MAX_EPISODE);
  if (season === undefined || episode === undefined) return invalidRequest();
  return { se: String(season), ep: String(episode) };
}
/** Narrow transport adapter. Pagination/deadlines are controlled by the caller, not hidden loops. */
export class MovieBoxMetadata {
  constructor(private readonly client: MovieBoxTransport) {}
  private get(endpoint: string, params: Record<string, string>): Promise<unknown> {
    return this.client.get(`${PREFIX}${endpoint}?${new URLSearchParams(params).toString()}`);
  }
  async search(keyword: string, page = 1): Promise<SubjectIdentity[]> {
    if (!text(keyword, 256) || integer(page, MAX_PAGE) !== page) return invalidRequest();
    return parseSearchSubjects(await this.client.search(keyword, page));
  }
  async detail(subjectId: string | number): Promise<SubjectDetail | undefined> {
    return parseSubjectDetail(await this.get("get", { subjectId: requestId(subjectId) }));
  }
  async seasons(subjectId: string | number): Promise<SeasonMetadata[]> {
    return parseSeasonInfo(await this.get("season-info", { subjectId: requestId(subjectId) }));
  }
  async playInfo(subjectId: string | number, selection?: EpisodeSelection): Promise<PrivateStreamMetadata[]> {
    return parsePlayInfo(await this.get("play-info/v2", { subjectId: requestId(subjectId), ...selectionParams(selection) }));
  }
  async resources(subjectId: string | number, options: { page: number; perPage: number; selection?: EpisodeSelection }): Promise<ResourcePage> {
    if (integer(options.page, MAX_PAGE) !== options.page || integer(options.perPage, MAX_PER_PAGE) !== options.perPage) return invalidRequest();
    return parseResourcePage(await this.get("resource", { subjectId: requestId(subjectId), ...selectionParams(options.selection),
      page: String(options.page), perPage: String(options.perPage) }), options.page, options.perPage);
  }
  async captions(subjectId: string | number, resourceId: string | number): Promise<PrivateCaptionMetadata[]> {
    return parseCaptions(await this.get("get-ext-captions", { subjectId: requestId(subjectId), resourceId: requestId(resourceId) }));
  }
}
