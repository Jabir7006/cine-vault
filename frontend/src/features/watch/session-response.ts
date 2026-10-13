import { parseDirectSource } from "./source-response";
import type { DirectSource, PlaybackReply, PreparedPlayback } from "./types";

const invalid = (): never => { throw new Error("Playback operation returned an invalid response."); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const fields = (item: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(item).some((key) => !allowed.includes(key))) invalid();
};
const positive = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return invalid();
  return value;
};
const opaque = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,127}$/.test(value)) return invalid();
  return value;
};
export const samePlaybackOwner = (a: DirectSource, b: DirectSource): boolean =>
  a.sessionId === b.sessionId && a.controlToken === b.controlToken;

const prepared = (value: unknown, owner: DirectSource): PreparedPlayback => {
  const item = record(value);
  fields(item, ["version", "kind", "baseRevision", "preparationId", "preparationExpiresAt", "source", "continuity"]);
  if (item.version !== 1 || item.kind !== "prepared") return invalid();
  const baseRevision = positive(item.baseRevision);
  const source = parseDirectSource(item.source);
  const preparationExpiresAt = positive(item.preparationExpiresAt);
  if (!samePlaybackOwner(source, owner) || baseRevision !== owner.revision || source.revision !== baseRevision + 1 ||
      preparationExpiresAt > owner.controlExpiresAt || preparationExpiresAt > source.expiresAt ||
      preparationExpiresAt > source.issuedAt + 60_000) return invalid();
  const evidence = record(item.continuity);
  let continuity: PreparedPlayback["continuity"];
  if (evidence.kind === "none") {
    fields(evidence, ["kind"]);
    continuity = { kind: "none" };
  } else if (evidence.kind === "same-resource") {
    fields(evidence, ["kind", "qualityId"]);
    const qualityId = opaque(evidence.qualityId);
    if (!source.qualities.some((quality) => quality.id === qualityId) || source.selectedAudio !== owner.selectedAudio) return invalid();
    continuity = { kind: "same-resource", qualityId };
  } else return invalid();
  return { version: 1, kind: "prepared", baseRevision, preparationId: opaque(item.preparationId), preparationExpiresAt, source, continuity };
};

/** Parse relative media paths first; the API normalizes only after validation. */
export const parsePlaybackReply = (value: unknown, owner: DirectSource): PlaybackReply => {
  const item = record(value);
  if (item.version !== 1) return invalid();
  if (item.kind === "prepared") return prepared(item, owner);
  if (item.kind === "error") {
    fields(item, ["version", "kind", "code"]);
    if (typeof item.code !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(item.code)) return invalid();
    return { version: 1, kind: "error", code: item.code };
  }
  if (item.kind !== "state" && item.kind !== "committed") return invalid();
  fields(item, ["version", "kind", "source", "pending"]);
  const source = parseDirectSource(item.source);
  if (!samePlaybackOwner(source, owner) || source.revision < owner.revision || source.revision > owner.revision + 1 ||
      (item.kind === "committed" && source.revision !== owner.revision + 1)) return invalid();
  const pending = item.pending === undefined ? undefined : item.pending === null ? null : prepared(item.pending, source);
  return { version: 1, kind: item.kind, source, ...(pending !== undefined ? { pending } : {}) };
};
