import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load backend/.env relative to this file so it works regardless of cwd.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

function env(key: string, fallback = ""): string {
  const v = process.env[key];
  return v === undefined || v.trim() === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "8787")),
  allowedOrigins: env("ALLOWED_ORIGIN", "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  /** Optional shared secret; when set, the frontend must send it as `x-access-token`. */
  accessToken: env("ACCESS_TOKEN"),
  tmdb: {
    baseUrl: env("TMDB_API_URL", "https://api.themoviedb.org/3"),
    apiKey: env("TMDB_API_KEY"),
  },
  /** HMAC key for signing relay URLs so the stream proxy only serves URLs it minted. */
  relaySignKey: env("RELAY_SIGN_KEY", "dev-insecure-relay-key-change-me"),
  /** Server-only runtime signing key; there is no built-in credential. */
  movieboxSecretHex: env("MOVIEBOX_SECRET_HEX"),
} as const;
