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
  | { status: "matched"; subject: SubjectDetail; alternates: SubjectDetail[] }
  | { status: "not_found" | "ambiguous" | "unverified" };
export interface MatchingMetadata {
  search(keyword: string, page?: number): Promise<SubjectIdentity[]>;
  detail(subjectId: string): Promise<SubjectDetail | undefined>;
}

/** Retain sequel numbers, diacritics and meaningful punctuation. No fuzzy/ASCII folding. */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/**
 * Row titles carry MovieBox decorations ("[Dub]", "[Hindi]", " S5", "_360P"), so a row
 * is cleaned before comparison with the canonical TMDB titles. Parenthesised qualifiers
 * are preserved: "(Part 2)" names a different title, and collapsing it would equate a
 * sequel with its predecessor.
 */
const rowTitle = (raw: string): string => cleanMovieBoxTitle(raw, { keepParenthetical: true });

/** The single title rule, shared by search filtering and identity confirmation. */
export function matchesTargetTitle(subjectTitle: string | undefined, targetTitles: string[]): boolean {
  if (typeof subjectTitle !== "string") return false;
  const cleaned = rowTitle(subjectTitle);
  if (!cleaned) return false;
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
    matchesTargetTitle(subject.title, target.titles);
}

/**
 * A film's release year identifies it in the listing too. A series is listed one row per season,
 * each carrying that season's own year under the series' subject ID, so a row's year cannot
 * identify the series — and page one need not even include the season that carries the first-air
 * year. Listing therefore asks a row only for title and subject type, and the detail (which does
 * report the series' canonical year) remains the identity authority for every type.
 */
function rowMatchesIdentity(subject: SubjectIdentity, target: Target): boolean {
  return validTarget(target) && validIdentity(subject) && subject.type === target.type &&
    matchesTargetTitle(subject.title, target.titles) && (target.type === "tv" || subject.year === target.year);
}

/**
 * MovieBox carries duplicate uploads of the same film (regional/dub variants), so
 * several rows can agree on title, type and year with no metadata signal to tell
 * them apart. Selection therefore returns every agreeing subject in a deterministic
 * order instead of failing, and the resolver verifies playback on each in turn.
 * The list is bounded so a duplicate flood still cannot trigger detail fan-out.
 */
const MAX_TIED_CANDIDATES = 3;

/** Untouched title first, then decorated variants; ties broken by ID for stability. */
const candidateRank = (subject: SubjectIdentity): number =>
  subject.title === rowTitle(subject.title!) ? 0 : 1;

export function selectCandidates(candidates: SubjectIdentity[], target: Target, diagnostic?: MatchDiagnostic):
  { status: "candidates"; subjects: SubjectIdentity[] } | { status: "not_found" | "unverified" } {
  if (!validTarget(target) || candidates.length > 4000) {
    report(diagnostic, { stage: "matching", code: !validTarget(target) ? "invalid_target" : "invalid_candidates" });
    return { status: "unverified" };
  }
  const chosen = new Map<string, SubjectIdentity>();
  let incompleteRelevant = false;
  for (const subject of candidates) {
    const titleMatches = matchesTargetTitle(subject.title, target.titles);
    const possibleType = subject.type === undefined || subject.type === target.type;
    const possibleYear = subject.year === undefined || subject.year === target.year;
    if (titleMatches && possibleType && possibleYear && !validIdentity(subject)) incompleteRelevant = true;
    if (!rowMatchesIdentity(subject, target)) continue;
    // Rows of one series differ only by season year. The row carrying the target year is the most
    // informative, so it is the one recorded under the subject ID; otherwise the first row wins.
    const existing = chosen.get(subject.subjectId);
    if (!existing || existing.year !== target.year && subject.year === target.year) chosen.set(subject.subjectId, subject);
  }
  const winners = [...chosen.values()];
  if (incompleteRelevant) { report(diagnostic, { stage: "matching", code: "identity_incomplete" }); return { status: "unverified" }; }
  if (!winners.length) { report(diagnostic, { stage: "matching", code: "not_found" }); return { status: "not_found" }; }
  // A contradictory row for a winning ID cannot be silently hidden by de-duplication.
  // Year is an identity field only for films: a series reports one row per season, each
  // carrying that season's year under a single subject ID, which is not a contradiction.
  const consistent = target.type === "tv" ? winners : winners.filter((subject) =>
    !candidates.some((row) => row.subjectId === subject.subjectId && !identityMatches(row, target)));
  if (!consistent.length) { report(diagnostic, { stage: "matching", code: "identity_conflict" }); return { status: "unverified" }; }
  const ordered = consistent
    .sort((a, b) => candidateRank(a) - candidateRank(b) || a.subjectId.localeCompare(b.subjectId))
    .slice(0, MAX_TIED_CANDIDATES);
  return { status: "candidates", subjects: ordered };
}

/** Bounded first-page searches per distinct title; detail fan-out is bounded by MAX_TIED_CANDIDATES. */
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
  const selected = selectCandidates(candidates, target, diagnostic);
  if (selected.status !== "candidates") return { status: selected.status };
  const matched: SubjectDetail[] = [];
  let missing = false;
  for (const [index, candidate] of selected.subjects.entries()) {
    let detail: SubjectDetail | undefined;
    try { detail = await metadata.detail(candidate.subjectId); }
    catch (error) {
      // The leading candidate is the authoritative lookup, so its transport failure must
      // reach the caller. A duplicate upload that cannot be loaded is simply skipped.
      if (index === 0) { report(diagnostic, movieBoxFailure("detail", error)); throw error; }
      continue;
    }
    if (!detail) { missing = true; continue; }
    if (detail.subjectId !== candidate.subjectId || !identityMatches(detail, target)) continue;
    matched.push(detail);
  }
  if (!matched.length) {
    report(diagnostic, { stage: "detail", code: missing ? "detail_missing" : "detail_mismatch" });
    return { status: "unverified" };
  }
  return { status: "matched", subject: matched[0]!, alternates: matched.slice(1) };
}

/**
 * An explicit episode list is authoritative: a season listing "1,2,4,5,6,7" has no episode 3.
 * MovieBox reports many seasons without any list, giving only `maxEp` — the highest episode that
 * actually exists, verified against play-info, which returns no stream above it and none for a
 * gap an explicit list omits. Such a season therefore proves episodes 1..maxEp and nothing more;
 * `maxEp` is never stretched past itself, and array positions are never evidence.
 */
export function hasEpisodeEvidence(
  selection: EpisodeSelection,
  seasons: readonly SeasonMetadata[],
  resources: readonly Pick<PrivateStreamMetadata, "se" | "ep">[] = [],
): boolean {
  if (!Number.isSafeInteger(selection.season) || !Number.isSafeInteger(selection.episode) || selection.season < 1 ||
    selection.episode < 1 || selection.season > 10000 || selection.episode > 10000) return false;
  return seasons.some((season) => season.se === selection.season &&
      (season.episodeNumbers.includes(selection.episode) ||
        season.episodeNumbers.length === 0 && season.maxEp !== undefined && selection.episode <= season.maxEp)) ||
    resources.some((resource) => resource.se === selection.season && resource.ep === selection.episode);
}
