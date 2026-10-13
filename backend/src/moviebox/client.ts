import { createDeviceIdentity, runtimeKey, signedHeaders, validatePath } from "./crypto.js";
import type { DeviceIdentity } from "./crypto.js";
import { MovieBoxError } from "./errors.js";

export const MOVIEBOX_HOSTS = Object.freeze([
  "https://api6.aoneroom.com", "https://api5.aoneroom.com", "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com", "https://api3.aoneroom.com", "https://api6sg.aoneroom.com",
  "https://api.inmoviebox.com",
]);
const LOGIN_PATH = "/wefeed-mobile-bff/user-api/visitor-login";
const SEARCH_PATH = "/wefeed-mobile-bff/subject-api/search/v2";
const MAX_BODY_BYTES = 1024 * 1024;
const NO_EXP_LIFETIME_MS = 7 * 24 * 3600 * 1000;

export interface MovieBoxOptions {
  movieboxSecretHex?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  identity?: DeviceIdentity;
  attemptTimeoutMs?: number;
  maxAttempts?: number;
}
interface Session { token: string; userId?: string; expiresAt?: number; createdAt: number }
interface Reply { data: unknown; rotation?: Session }
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const userId = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : undefined;

/** JWT claims are unverified lifetime metadata, never proof of authorization. */
function sessionFrom(value: unknown, now: number): Session | undefined {
  const payload = object(value);
  const token = payload?.token;
  if (typeof token !== "string" || !token.trim() || token.length > 16384 || /[^\x21-\x7e]/u.test(token)) return;
  let claims: Record<string, unknown> | undefined;
  const parts = token.split(".");
  if (parts.length > 1) {
    const part = parts[1];
    if (parts.length !== 3 || !part || !/^[A-Za-z0-9_-]+={0,2}$/.test(part)) return;
    try { claims = object(JSON.parse(Buffer.from(part, "base64url").toString("utf8"))); }
    catch { return; }
    if (!claims) return;
  } // Opaque tokens (without JWT shape) use the bounded no-exp lifetime.
  const rawExp = claims?.exp;
  const exp = typeof rawExp === "number" ? rawExp :
    typeof rawExp === "string" && /^\d+$/.test(rawExp) ? Number(rawExp) : undefined;
  // A present but invalid expiry fails closed instead of extending to seven days.
  if (rawExp !== undefined && (exp === undefined || !Number.isSafeInteger(exp) || exp < 0 || exp > Number.MAX_SAFE_INTEGER / 1000)) return;
  return { token, userId: userId(payload?.uid ?? payload?.userId ?? claims?.userId ?? claims?.uid ?? claims?.sub),
    expiresAt: exp === undefined ? undefined : exp * 1000, createdAt: now };
}
function valid(session: Session, now: number): boolean {
  return session.expiresAt === undefined ? now < session.createdAt + NO_EXP_LIFETIME_MS : now + 60000 < session.expiresAt;
}
function cancelBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) {
    cancelBody(response);
    throw new MovieBoxError("size");
  }
  if (!response.body) throw new MovieBoxError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new MovieBoxError("timeout");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new MovieBoxError("size");
      chunks.push(value);
    }
    if (signal.aborted) throw new MovieBoxError("timeout");
    try { return JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown; }
    catch { throw new MovieBoxError("malformed"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

/** Server-only runtime transport; typed metadata and media relay live in separate modules. */
export class MovieBoxClient {
  #key: Buffer;
  #fetch: typeof globalThis.fetch;
  #now: () => number;
  #identity: DeviceIdentity;
  #timeout: number;
  #maxAttempts: number;
  #activeHost = 0;
  #session?: Session;
  #loginFlight?: Promise<Session>;
  #counts = { httpAttempts: 0, loginRequests: 0, searchRequests: 0, sessionReuses: 0 };

  constructor(options: MovieBoxOptions) {
    this.#key = runtimeKey(options.movieboxSecretHex);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#identity = Object.freeze({ ...(options.identity ?? createDeviceIdentity()) });
    this.#timeout = options.attemptTimeoutMs ?? 12000;
    this.#maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(this.#maxAttempts) || this.#maxAttempts < 1 || this.#maxAttempts > MOVIEBOX_HOSTS.length ||
        !Number.isInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 30000) throw new MovieBoxError("request");
  }

  /** Safe diagnostics only: never return tokens, identity, headers, key, or session. */
  diagnostics(): Readonly<{ httpAttempts: number; loginRequests: number; searchRequests: number; sessionReuses: number }> {
    return Object.freeze({ ...this.#counts });
  }
  async init(): Promise<void> { await this.#ensureSession(); }

  async #ensureSession(): Promise<Session> {
    if (this.#session && valid(this.#session, this.#now())) {
      this.#counts.sessionReuses++;
      return this.#session;
    }
    if (this.#loginFlight) return this.#loginFlight;
    const flight = this.#login();
    this.#loginFlight = flight;
    try { return await flight; }
    finally { if (this.#loginFlight === flight) this.#loginFlight = undefined; }
  }

  async #login(): Promise<Session> {
    this.#counts.loginRequests++;
    const reply = await this.#requestHosts("POST", LOGIN_PATH, "{}", undefined, true);
    const session = reply.rotation ?? sessionFrom(reply.data, this.#now());
    if (!session || !valid(session, this.#now())) throw new MovieBoxError("session");
    this.#session = session;
    return session;
  }

  async get(path: string, signal?: AbortSignal): Promise<unknown> { return this.#request("GET", path, undefined, true, signal); }

  /** POST has no implicit replay. Opt in only for a known read-only operation. */
  async post(path: string, body: unknown, options: { safeToReplay?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
    let serialized: string | undefined;
    try { serialized = JSON.stringify(body); } catch { throw new MovieBoxError("request"); }
    if (serialized === undefined) throw new MovieBoxError("request");
    return this.#request("POST", path, serialized, options.safeToReplay === true, options.signal);
  }

  async search(keyword: string, page = 1, signal?: AbortSignal): Promise<unknown> {
    if (typeof keyword !== "string" || !keyword.trim() || keyword.length > 256 || !Number.isSafeInteger(page) || page < 1) {
      throw new MovieBoxError("request");
    }
    this.#counts.searchRequests++;
    return this.post(SEARCH_PATH, { keyword, page, perPage: 15, subjectType: 0 }, { safeToReplay: true, signal });
  }

  async #request(method: string, path: string, body: string | undefined, safeToReplay: boolean, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new MovieBoxError("timeout");
    validatePath(path); // Reject paths before login or any network activity.
    if (body !== undefined && Buffer.byteLength(body) > MAX_BODY_BYTES) throw new MovieBoxError("request");
    let session = await this.#ensureSession();
    for (let refresh = 0; refresh < 2; refresh++) {
      try {
        const reply = await this.#requestHosts(method, path, body, session.token, safeToReplay, signal);
        // Ignore stale concurrent responses after a newer token/session won.
        if (reply.rotation && this.#session?.token === session.token && valid(reply.rotation, this.#now())) {
          this.#session = reply.rotation;
        }
        return reply.data;
      } catch (error) {
        if (!(error instanceof MovieBoxError) || error.code !== "unauthorized" || !safeToReplay || refresh !== 0) throw error;
        if (this.#session?.token === session.token) this.#session = undefined;
        session = await this.#ensureSession(); // singleflight; refresh once, never for 403/429.
      }
    }
    throw new MovieBoxError("unauthorized", 401);
  }

  async #requestHosts(method: string, path: string, body: string | undefined, token: string | undefined, safeToReplay: boolean, signal?: AbortSignal): Promise<Reply> {
    validatePath(path);
    const start = this.#activeHost;
    const attempts = safeToReplay ? this.#maxAttempts : 1;
    let lastError = new MovieBoxError("network");
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (signal?.aborted) throw new MovieBoxError("timeout");
      const index = (start + attempt) % MOVIEBOX_HOSTS.length;
      const url = MOVIEBOX_HOSTS[index]! + path;
      const headers = signedHeaders(this.#key, this.#identity, method, url, body, this.#now(), token);
      this.#counts.httpAttempts++;
      try {
        const reply = await this.#attempt(url, { method, headers, body, redirect: "manual" }, signal);
        this.#activeHost = index;
        return reply;
      } catch (error) {
        const sanitized = error instanceof MovieBoxError ? error : new MovieBoxError("network");
        if (!(sanitized.code === "network" || sanitized.code === "timeout" ||
              (sanitized.code === "http" && [500, 502, 503, 504].includes(sanitized.status ?? 0)))) throw sanitized;
        lastError = sanitized;
      }
    }
    throw lastError;
  }

  async #attempt(url: string, init: RequestInit, signal?: AbortSignal): Promise<Reply> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new MovieBoxError("timeout"));
        controller.abort();
      }, this.#timeout);
    });
    const work = async (): Promise<Reply> => {
      const response = await this.#fetch(url, { ...init, signal: controller.signal });
      if (controller.signal.aborted) { cancelBody(response); throw new MovieBoxError("timeout"); }
      const status = response.status;
      if (response.redirected || (response.url && response.url !== url) || (status >= 300 && status < 400)) {
        cancelBody(response);
        throw new MovieBoxError("redirect", status);
      }
      if (!response.ok) {
        cancelBody(response);
        throw new MovieBoxError(status === 401 ? "unauthorized" : status === 403 ? "denied" : status === 429 ? "rate_limit" : "http", status);
      }
      const raw = await boundedJson(response, controller.signal);
      let rotation: Session | undefined;
      const xUser = response.headers.get("x-user");
      if (xUser && xUser.length <= 32768) {
        try { rotation = sessionFrom(JSON.parse(xUser), this.#now()); } catch { /* Ignore malformed rotation metadata. */ }
      }
      const record = object(raw);
      return { data: record && Object.hasOwn(record, "data") ? record.data : raw, rotation };
    };
    try { return await Promise.race([work(), deadline]); }
    catch (error) { throw error instanceof MovieBoxError ? error : new MovieBoxError("network"); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); }
  }
}
