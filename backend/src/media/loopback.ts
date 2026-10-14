import { isIPv4 } from "node:net";

/**
 * Who is on the other end of a request.
 *
 * The player routes run a native decoder and, on request, an encoder on this machine. Neither is
 * something a remote caller may ask for, so those routes accept loopback peers only and refuse when
 * the peer cannot be established at all — an unknown peer is never assumed to be local.
 */
/** `::ffff:127.0.0.1` is how a dual-stack socket reports an IPv4 loopback connection. */
const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isLoopback(address: string | undefined): boolean {
  if (typeof address !== "string") return false;
  if (address === "::1") return true;
  const v4 = MAPPED.exec(address)?.[1] ?? address;
  // Node's own parser decides what an octet may be, so `127.0.0.256` is not accepted as an address.
  return isIPv4(v4) && v4.startsWith("127.");
}

/** Node's peer address for a request, when the server can report one. */
export function peerAddress(env: unknown): string | undefined {
  const incoming = (env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined)?.incoming;
  const address = incoming?.socket?.remoteAddress;
  return typeof address === "string" && address.length <= 64 ? address : undefined;
}
