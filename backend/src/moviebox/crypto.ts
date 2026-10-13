import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { MovieBoxError } from "./errors.js";

const md5 = (value: string | Uint8Array): string => createHash("md5").update(value).digest("hex");

/** Runtime injection only. No fallback key and no environment/dotenv dependency. */
export function runtimeKey(secretHex: unknown): Buffer {
  if (typeof secretHex !== "string" || !/^[a-fA-F0-9]{60}$/.test(secretHex)) {
    throw new MovieBoxError("setup");
  }
  return Buffer.from(secretHex, "hex");
}

export function validatePath(path: string): void {
  if (typeof path !== "string" || !path.startsWith("/wefeed-mobile-bff/") ||
      /[\\#\s\u0000-\u001f\u007f]/u.test(path)) throw new MovieBoxError("path");
  const pathname = path.split("?", 1)[0]!;
  // Reject URL normalization tricks, encoded separators and dot segments.
  if (pathname.split("/").some((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return true; }
    return decoded === "." || decoded === ".." || /[\\/%?#\s\u0000-\u001f\u007f]/u.test(decoded);
  })) throw new MovieBoxError("path");
  const url = new URL(path, "https://api6.aoneroom.com");
  if (url.origin !== "https://api6.aoneroom.com" || url.pathname !== pathname) {
    throw new MovieBoxError("path");
  }
}

/** Seven newline-separated fields, decoded sorted query keys, stable duplicate order. */
export function canonicalString(
  method: string, accept: string, contentType: string, url: string,
  body: string | undefined, timestampMs: number,
): string {
  const parsed = new URL(url);
  const groups = new Map<string, string[]>();
  for (const [key, value] of parsed.searchParams) {
    const values = groups.get(key) ?? [];
    values.push(value);
    groups.set(key, values);
  }
  // UTF-8 byte order matches Rust BTreeMap ordering, including non-BMP keys.
  const query = [...groups.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .flatMap((key) => groups.get(key)!.map((value) => `${key}=${value}`)).join("&");
  const bytes = body === undefined ? undefined : Buffer.from(body, "utf8");
  return [method.toUpperCase(), accept, contentType, bytes?.length.toString() ?? "",
    timestampMs.toString(), bytes === undefined ? "" : md5(bytes.subarray(0, 102400)),
    parsed.pathname + (query ? `?${query}` : "")].join("\n");
}

export function signature(key: Uint8Array, canonical: string, timestampMs: number): string {
  if (key.byteLength !== 30) throw new MovieBoxError("setup");
  return `${timestampMs}|2|${createHmac("md5", key).update(canonical).digest("base64")}`;
}

export function clientToken(timestampMs: number): string {
  const timestamp = timestampMs.toString();
  return `${timestamp},${md5([...timestamp].reverse().join(""))}`;
}

export interface DeviceIdentity { readonly userAgent: string; readonly clientInfo: string }

/** Created once per client, not on each request/failover; no fabricated forwarding IP. */
export function createDeviceIdentity(): DeviceIdentity {
  return Object.freeze({
    userAgent: "com.community.oneroom/50020117 (Linux; U; Android 13; en_US; 23078RKD5C; Build/TQ2A.230405.003; Cronet/135.0.7012.3)",
    clientInfo: JSON.stringify({ package_name: "com.community.oneroom", version_name: "4.0.01.0813.03",
      version_code: 50020117, os: "android", os_version: "13", install_ch: "ps",
      device_id: randomBytes(16).toString("hex"), install_store: "ps", gaid: randomUUID(),
      brand: "Redmi", model: "23078RKD5C", system_language: "en", net: "NETWORK_WIFI",
      region: "US", timezone: "Asia/Kolkata", sp_code: "40401", "X-Play-Mode": "2" }),
  });
}

export function signedHeaders(key: Uint8Array, identity: DeviceIdentity, method: string,
  url: string, body: string | undefined, timestampMs: number, token?: string): Record<string, string> {
  const [a, b, c, d] = randomBytes(4);
  const spoofedIp = `${10 + (a % 100)}.${b % 256}.${c % 256}.${d % 256}`;
  const headers: Record<string, string> = {
    "user-agent": identity.userAgent, accept: "application/json", "content-type": "application/json",
    "connection": "keep-alive",
    "x-forwarded-for": spoofedIp,
    "x-client-token": clientToken(timestampMs),
    "x-tr-signature": signature(key, canonicalString(method, "application/json", "application/json", url, body, timestampMs), timestampMs),
    "x-client-info": identity.clientInfo, "x-client-status": "0",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}
