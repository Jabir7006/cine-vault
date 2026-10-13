import type { MediaType } from "../providers/types.js";
import type { EpisodeSelection, PrivateStreamMetadata, SeasonMetadata, SubjectDetail, SubjectIdentity } from "./metadata.js";
import { parseMovieBoxId, cleanMovieBoxTitle } from "./metadata.js";
import { movieBoxFailure } from "./diagnostics";
import type { DiscoveryFailure } from "./diagnostics";
type MatchDiagnostic = (failure: DiscoveryFailure) => void;
const report = (callback: MatchDiagnostic | undefined, failure: DiscoveryFailure) => {
  try { callback?.(failure); } catch { /* Optional diagnostics cannot affect matching. */ }
};

/** Canonical/original titles come from a trusted metadata adapter, not browser subject IDs. */
export interface Target { type: MediaType; titles: string[]; year: number }
export type MatchResult =
  | { status: "matched"; subject: SubjectDetail }
  | { status: "not_found" | "ambiguous" | "unverified" };
export interface MatchingMetadata {
  search(keyword: string, page?: number): Promise<SubjectIdentity[]>;
  detail(subjectId: string): Promise<SubjectDetail | undefined>;
}

/** Retain sequel numbers, diacritics and meaningful punctuation. No fuzzy/ASCII folding. */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Strict title comparison for dub/identity matching (no MovieBox title cleaning). */
function validTitleMatch(subjectTitle: string | undefined, targetTitles: string[]): boolean {
  if (typeof subjectTitle !== "string") return false;
  return targetTitles.some((title) => normalizeTitle(title) === normalizeTitle(subjectTitle));
}

/** Cleaned title comparison for search result matching (strips MovieBox release tags). */
export function matchesTargetTitle(subjectTitle: string | undefined, targetTitles: string[]): boolean {
  if (typeof subjectTitle !== "string") return false;
  const cleaned = cleanMovieBoxTitle(subjectTitle);
  return targetTitles.some((title) => normalizeTitle(title) === normalizeTitle(cleaned));
}

function validTarget(target: Target): boolean {
  return (target.type === "movie" || target.type === "tv") && Number.isSafeInteger(target.year) && target.year >= 1000 && target.year <= 9999 &&
    Array.isArray(target.titles) && target.titles.length > 0 && target.titles.length <= 8 &&
    target.titles.every((title) => typeof title === "string" && title.length <= 256 && normalizeTitle(title).length > 0 && !/[\u0000-\u001f\u007f]/u.test(title));
}
function validIdentity(subject: SubjectIdentity): boolean {
  return parseMovieBoxId(subject.subjectId) === subject.subjectId && typeof subject.title === "string" && subject.title.length <= 512 &&
    !!normalizeTitle(subject.title) && (subject.type === "movie" || subject.type === "tv") && Number.isSafeInteger(subject.year) &&
    subject.year! >= 1000 && subject.year! <= 9999;
}
export function identityMatches(subject: SubjectIdentity, target: Target): boolean {
  return validTarget(target) && validIdentity(subject) && subject.type === target.type && subject.year === target.year &&
    validTitleMatch(subject.title, target.titles);
}

/** Pure selection, deduplicating repeated IDs only when their identity evidence agrees. */
export function selectUniqueCandidate(candidates: SubjectIdentity[], target: Target, diagnostic?: MatchDiagnostic):
  { status: "candidate"; subject: SubjectIdentity } | { status: "not_found" | "ambiguous" | "unverified" } {
  if (!validTarget(target) || candidates.length > 4000) {
    report(diagnostic, { stage: "matching", code: !validTarget(target) ? "invalid_target" : "invalid_candidates" });
    return { status: "unverified" };
  }
  const exact = new Map<string, SubjectIdentity>();
  const yearUnknown = new Map<string, SubjectIdentity>();
  let incompleteRelevant = false;
  for (const subject of candidates) {
    const titleMatches = matchesTargetTitle(subject.title, target.titles);
    const possibleType = subject.type === undefined || subject.type === target.type;
    const possibleYear = subject.year === undefined || subject.year === target.year;
    if (titleMatches && possibleType && possibleYear && !validIdentity(subject)) incompleteRelevant = true;
    if (!identityMatches(subject, target)) continue;
    if (subject.year === target.year) exact.set(subject.subjectId, subject);
    else yearUnknown.set(subject.subjectId, subject);
  }
  // Prefer exact year matches; fall back to year-unknown candidates only if no exact match exists.
  const winners = exact.size ? [...exact.values()] : [...yearUnknown.values()];
  if (winners.length > 1) { report(diagnostic, { stage: "matching", code: "ambiguous" }); return { status: "ambiguous" }; }
  if (incompleteRelevant) { report(diagnostic, { stage: "matching", code: "identity_incomplete" }); return { status: "unverified" }; }
  const subject = winners[0];
  if (!subject) { report(diagnostic, { stage: "matching", code: "not_found" }); return { status: "not_found" }; }
  // A contradictory row for the winning ID cannot be silently hidden by de-duplication.
  if (candidates.some((row) => row.subjectId === subject.subjectId && !identityMatches(row, target))) {
    report(diagnostic, { stage: "matching", code: "identity_conflict" }); return { status: "unverified" };
  }
  return { status: "candidate", subject };
}

/** Bounded first-page searches per distinct title; no hidden detail or pagination fan-out. */
export async function matchMovieBoxSubject(metadata: MatchingMetadata, target: Target, diagnostic?: MatchDiagnostic): Promise<MatchResult> {
  if (!validTarget(target)) { report(diagnostic, { stage: "matching", code: "invalid_target" }); return { status: "unverified" }; }
  const queries = target.titles.filter((title, index) => target.titles.findIndex((other) => normalizeTitle(other) === normalizeTitle(title)) === index)
    .map((title) => title.trim());
  const candidates: SubjectIdentity[] = [];
  for (const title of queries) {
    let result: SubjectIdentity[];
    try { result = await metadata.search(title, 1); }
    catch (error) { report(diagnostic, movieBoxFailure("matching", error)); throw error; }
    if (!Array.isArray(result) || result.length > 500) {
      report(diagnostic, { stage: "matching", code: "invalid_candidates" }); return { status: "unverified" };
    }
    candidates.push(...result);
  }
  const selected = selectUniqueCandidate(candidates, target, diagnostic);
  if (selected.status !== "candidate") return selected;
  let detail: SubjectDetail | undefined;
  try { detail = await metadata.detail(selected.subject.subjectId); }
  catch (error) { report(diagnostic, movieBoxFailure("detail", error)); throw error; }
  if (!detail || detail.subjectId !== selected.subject.subjectId || !identityMatches(detail, target)) {
    report(diagnostic, { stage: "detail", code: !detail ? "detail_missing" : "detail_mismatch" }); return { status: "unverified" };
  }
  return { status: "matched", subject: detail };
}

/** maxEp and array positions are never accepted as evidence of a requested episode. */
export function hasEpisodeEvidence(
  selection: EpisodeSelection,
  seasons: readonly SeasonMetadata[],
  resources: readonly Pick<PrivateStreamMetadata, "se" | "ep">[] = [],
): boolean {
  if (!Number.isSafeInteger(selection.season) || !Number.isSafeInteger(selection.episode) || selection.season < 1 ||
    selection.episode < 1 || selection.season > 10000 || selection.episode > 10000) return false;
  return seasons.some((season) => season.se === selection.season && season.episodeNumbers.includes(selection.episode)) ||
    resources.some((resource) => resource.se === selection.season && resource.ep === selection.episode);
}
