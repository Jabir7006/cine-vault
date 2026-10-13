import { isIP } from "node:net";

/** Bind only to an explicit IP literal; hostnames would introduce DNS-dependent binding. */
export function parseListenerHost(value?: string): string {
  if (value === undefined || value.trim() === "") return "127.0.0.1";
  if (!isIP(value) || value.includes("%")) throw new Error("Invalid listener host configuration");
  return value;
}

export function listenerUrl(host: string, port: number): string {
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}
