import type { MediaType } from "../providers/types.js";
import type { EpisodeSelection, PrivateStreamMetadata, SeasonMetadata, SubjectDetail, SubjectIdentity } from "./metadata.js";
import { parseMovieBoxId } from "./metadata.js";

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
    target.titles.some((title) => normalizeTitle(title) === normalizeTitle(subject.title!));
}

/** Pure selection, deduplicating repeated IDs only when their identity evidence agrees. */
export function selectUniqueCandidate(candidates: SubjectIdentity[], target: Target):
  { status: "candidate"; subject: SubjectIdentity } | { status: "not_found" | "ambiguous" | "unverified" } {
  if (!validTarget(target) || candidates.length > 4000) return { status: "unverified" };
  const exact = new Map<string, SubjectIdentity>();
  let incompleteRelevant = false;
  for (const subject of candidates) {
    const titleMatches = typeof subject.title === "string" && target.titles.some((title) => normalizeTitle(title) === normalizeTitle(subject.title!));
    const possibleType = subject.type === undefined || subject.type === target.type;
    const possibleYear = subject.year === undefined || subject.year === target.year;
    if (titleMatches && possibleType && possibleYear && !validIdentity(subject)) incompleteRelevant = true;
    if (!identityMatches(subject, target)) continue;
    exact.set(subject.subjectId, subject);
  }
  if (exact.size > 1) return { status: "ambiguous" };
  if (incompleteRelevant) return { status: "unverified" };
  const subject = [...exact.values()][0];
  if (!subject) return { status: "not_found" };
  // A contradictory row for the winning ID cannot be silently hidden by de-duplication.
  if (candidates.some((row) => row.subjectId === subject.subjectId && !identityMatches(row, target))) return { status: "unverified" };
  return { status: "candidate", subject };
}

/** Bounded first-page searches per distinct title; no hidden detail or pagination fan-out. */
export async function matchMovieBoxSubject(metadata: MatchingMetadata, target: Target): Promise<MatchResult> {
  if (!validTarget(target)) return { status: "unverified" };
  const queries = target.titles.filter((title, index) => target.titles.findIndex((other) => normalizeTitle(other) === normalizeTitle(title)) === index)
    .map((title) => title.trim());
  const candidates: SubjectIdentity[] = [];
  for (const title of queries) {
    const result = await metadata.search(title, 1);
    if (!Array.isArray(result) || result.length > 500) return { status: "unverified" };
    candidates.push(...result);
  }
  const selected = selectUniqueCandidate(candidates, target);
  if (selected.status !== "candidate") return selected;
  const detail = await metadata.detail(selected.subject.subjectId);
  if (!detail || detail.subjectId !== selected.subject.subjectId || !identityMatches(detail, target)) return { status: "unverified" };
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
