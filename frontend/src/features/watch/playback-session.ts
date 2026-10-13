import type { DirectSource, PreparedPlayback, Subtitle } from "./types";
import { samePlaybackOwner } from "./session-response";

/** A mount-local guard; away/back invalidation cannot be undone by equal IDs. */
export const createPlaybackOperationGuard = () => {
  let generation = 0;
  let active = true;
  let inFlight = false;
  const renewed = new Set<number>();
  return {
    begin: () => { if (!active || inFlight) return undefined; inFlight = true; return ++generation; },
    current: (value: number) => active && value === generation,
    finish: (value: number) => { if (value === generation) inFlight = false; },
    invalidate: () => { active = false; inFlight = false; generation += 1; },
    activate: () => { active = true; generation += 1; },
    claimRenewal: (revision: number) => {
      if (!active || inFlight || renewed.has(revision)) return false;
      renewed.add(revision);
      return true;
    },
  };
};

export const canCommitPreparation = (owner: DirectSource, pending: PreparedPlayback, now: number): boolean =>
  samePlaybackOwner(owner, pending.source) && pending.baseRevision === owner.revision &&
  pending.source.revision === owner.revision + 1 && now < pending.preparationExpiresAt &&
  now < owner.controlExpiresAt && now < pending.source.expiresAt;

export const canAutoCommitRenewal = (
  owner: DirectSource, pending: PreparedPlayback, selectedQualityId: string,
  preparedForQualityId: string, now: number,
): boolean => canCommitPreparation(owner, pending, now) && selectedQualityId === preparedForQualityId &&
  owner.selectedAudio === pending.source.selectedAudio && pending.continuity.kind === "same-resource" &&
  owner.qualities.some((quality) => quality.id === selectedQualityId) &&
  pending.source.qualities.some((quality) => pending.continuity.kind === "same-resource" && quality.id === pending.continuity.qualityId);

export const replacementSelection = (
  prior: DirectSource, next: DirectSource, qualityId: string, subtitleId: string,
  mappedQualityId?: string,
): { qualityId: string; subtitleId: string } => {
  const subtitle: Subtitle | undefined = prior.subtitles.find((item) => item.id === subtitleId);
  return {
    qualityId: next.qualities.find((item) => item.id === mappedQualityId)?.id ??
      next.qualities.find((item) => item.id === qualityId)?.id ?? next.qualities[0]!.id,
    subtitleId: subtitleId === "off" ? "off" : next.subtitles.find((item) => item.id === subtitleId)?.id ??
      next.subtitles.find((item) => item.lang.toLowerCase() === subtitle?.lang.toLowerCase())?.id ?? "off",
  };
};

/** Only the selected committed media capability, never a control capability. */
export const selectedStreamLink = (source: DirectSource, qualityId: string, now: number): string | undefined => {
  if (now >= source.expiresAt) return undefined;
  const quality = source.qualities.find((item) => item.id === qualityId);
  if (!quality) return undefined;
  try {
    const url = new URL(quality.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        !/^\/media\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(url.pathname) ||
        quality.url.includes(source.controlToken)) return undefined;
    return quality.url;
  } catch { return undefined; }
};

export const safeSeekTime = (position: number, duration: number, ranges: readonly [number, number][]): number | undefined => {
  if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0) return undefined;
  const target = Math.min(position, Math.max(0, duration - 0.05));
  for (const [start, end] of ranges) {
    if (Number.isFinite(start) && Number.isFinite(end) && start <= target && target <= end) return target;
  }
  return undefined;
};

export const samePreparedGeneration = (prepared: DirectSource, committed: DirectSource): boolean =>
  samePlaybackOwner(prepared, committed) && prepared.revision === committed.revision &&
  prepared.selectedAudio === committed.selectedAudio && prepared.issuedAt === committed.issuedAt &&
  prepared.expiresAt === committed.expiresAt && prepared.renewAt === committed.renewAt &&
  prepared.qualities.length === committed.qualities.length &&
  prepared.subtitles.length === committed.subtitles.length && prepared.audios.length === committed.audios.length &&
  prepared.subtitles.every((subtitle) => committed.subtitles.some((item) => item.id === subtitle.id && item.url === subtitle.url && item.lang === subtitle.lang)) &&
  prepared.audios.every((audio) => committed.audios.some((item) => item.id === audio.id && item.lang === audio.lang)) &&
  prepared.qualities.every((quality) => committed.qualities.some((item) => item.id === quality.id && item.url === quality.url));
