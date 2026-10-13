import { randomBytes } from "node:crypto";

let processKey: string | undefined;

/** Memory-local registries may share a cryptographically random process key. */
export function resolveRelaySigningKey(configured: string): string {
  if (configured === "") return processKey ??= randomBytes(32).toString("hex");
  if (!/^[a-fA-F0-9]{64}$/.test(configured)) throw new Error("Invalid relay signing configuration");
  return configured;
}
