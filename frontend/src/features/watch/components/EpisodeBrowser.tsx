import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  filterEpisodes, getAdjacentEpisodes, getSupportedSeasons, hasSelectedEpisode, isUpcomingEpisode,
} from "../episodes";
import { seasonMetadataOptions } from "../queries";
import type { TMDBSeasonSummary } from "@/features/details/types";
import { EpisodeCard } from "./EpisodeCard";

interface EpisodeBrowserProps {
  mediaId: string;
  seasons: TMDBSeasonSummary[] | undefined;
  playingSeason: number;
  playingEpisode: number;
  onChangeEpisode: (season: number, episode: number) => void;
}

export const EpisodeBrowser = ({
  mediaId, seasons, playingSeason, playingEpisode, onChangeEpisode,
}: EpisodeBrowserProps) => {
  const selectId = useId();
  const searchId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const supported = getSupportedSeasons(seasons);
  const supportedPlayingSeason = supported?.some((item) => item.season_number === playingSeason);
  const initialSeason = supportedPlayingSeason ? playingSeason : supported?.[0]?.season_number;
  const playbackKey = `${mediaId}-${playingSeason}-${playingEpisode}`;
  const [browser, setBrowser] = useState({ playbackKey, requestedSeason: initialSeason, search: "" });

  // Adjust only on an external playback change (including browser Back/Forward), not browsing.
  // Guarded render-time adjustment avoids effect-driven setState and a stale dialog frame.
  if (browser.playbackKey !== playbackKey) {
    setBrowser({ playbackKey, requestedSeason: initialSeason, search: "" });
  }
  const requestedSeason = browser.playbackKey === playbackKey ? browser.requestedSeason : initialSeason;
  const search = browser.playbackKey === playbackKey ? browser.search : "";
  const browsedSeason = supported?.find((item) => item.season_number === requestedSeason)?.season_number
    ?? initialSeason;

  // Keep current metadata available for navigation even while the picker is closed.
  // Both observers share seasonMetadataOptions' cache key when browsing the current season.
  const currentMetadata = useQuery({
    ...seasonMetadataOptions(mediaId, playingSeason),
    enabled: supportedPlayingSeason === true,
    throwOnError: false,
  });
  const metadata = useQuery({
    ...seasonMetadataOptions(mediaId, browsedSeason ?? 1),
    enabled: open && browsedSeason !== undefined,
    throwOnError: false,
  });
  const { previous, next } = getAdjacentEpisodes(
    supportedPlayingSeason ? currentMetadata.data : undefined,
    playingSeason,
    playingEpisode,
  );
  const invalidSeason = supported !== undefined && !supportedPlayingSeason;
  const missingEpisode = supportedPlayingSeason && currentMetadata.data !== undefined &&
    hasSelectedEpisode(currentMetadata.data, playingSeason, playingEpisode) === false;
  const todayUTC = new Date().toISOString().slice(0, 10);
  const episodes = filterEpisodes(metadata.data?.episodes ?? [], search);

  useEffect(() => {
    if (!open) return;
    // Radix Portal may mount one commit later; wait for its list before measuring.
    const frame = requestAnimationFrame(() => {
      const results = resultsRef.current;
      if (!results) return;
      const selected = search.trim() ? null : results.querySelector<HTMLButtonElement>('button[aria-current="true"]');
      if (!selected) {
        results.scrollTop = 0;
        return;
      }
      const viewport = results.getBoundingClientRect();
      const row = selected.getBoundingClientRect();
      // Move only this list: scrollIntoView would also move the watch page/player.
      if (row.top < viewport.top) results.scrollTop += row.top - viewport.top;
      else if (row.bottom > viewport.bottom) results.scrollTop += row.bottom - viewport.bottom;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, browsedSeason, metadata.data, playingSeason, playingEpisode, search]);

  const changeOpen = (value: boolean) => {
    if (value) setBrowser({ playbackKey, requestedSeason: initialSeason, search: "" });
    setOpen(value);
  };
  const selectEpisode = (season: number, episode: number) => {
    setOpen(false);
    onChangeEpisode(season, episode);
  };
  const retry = (
    <Button
      type="button"
      variant="outline"
      className="h-11 border-white/15 bg-neutral-900 text-white hover:bg-neutral-800"
      disabled={metadata.isFetching}
      onClick={() => void metadata.refetch()}
    >
      <RefreshCw aria-hidden="true" className="size-4" />
      {metadata.isFetching ? "Retrying…" : "Retry"}
    </Button>
  );
  const controlClass = "size-11 border-white/15 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white focus-visible:ring-amber-400";

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <div role="group" aria-label="Episode controls" className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <Button
          type="button" variant="outline" size="icon" className={controlClass}
          aria-label="Previous episode" title="Previous episode"
          disabled={!previous || isUpcomingEpisode(previous.air_date, todayUTC)}
          onClick={() => previous && onChangeEpisode(previous.season_number, previous.episode_number)}
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </Button>
        <DialogTrigger asChild>
          <Button
            type="button" variant="outline"
            className="h-11 min-w-0 flex-1 gap-2 border-white/15 bg-white/5 px-3 text-white hover:bg-white/10 focus-visible:ring-amber-400 sm:flex-none"
            aria-label={`Choose episode, currently season ${playingSeason}, episode ${playingEpisode}`}
          >
            <span className="truncate">S{playingSeason} · E{playingEpisode}</span>
            <ChevronDown aria-hidden="true" className="size-4 text-neutral-400" />
          </Button>
        </DialogTrigger>
        <Button
          type="button" variant="outline" size="icon" className={controlClass}
          aria-label="Next episode" title="Next episode"
          disabled={!next || isUpcomingEpisode(next.air_date, todayUTC)}
          onClick={() => next && onChangeEpisode(next.season_number, next.episode_number)}
        >
          <ChevronRight aria-hidden="true" className="size-5" />
        </Button>
      </div>
      <DialogPortal>
        <DialogOverlay className="z-60 bg-black/70" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-70 flex h-[min(85dvh,44rem)] min-h-0 flex-col overflow-hidden rounded-t-2xl border border-white/15 bg-neutral-950 text-white shadow-2xl outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-[min(80dvh,44rem)] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            headingRef.current?.focus();
          }}
        >
          <div className="shrink-0 space-y-4 border-b border-white/10 px-4 pb-4 pt-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <DialogTitle ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">Choose episode</DialogTitle>
                <DialogDescription className="text-xs text-neutral-400">
                  Playing S{playingSeason} · E{playingEpisode}. Browsing does not change playback.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Close episode picker">
                  <X aria-hidden="true" className="size-5" />
                </Button>
              </DialogClose>
            </div>
            {supported && supported.length > 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 sm:w-48 sm:shrink-0">
                  <label htmlFor={selectId} className="sr-only">Browse season</label>
                  <select
                    id={selectId} value={browsedSeason}
                    onChange={(event) => setBrowser({ playbackKey, requestedSeason: Number(event.target.value), search: "" })}
                    className="h-11 w-full min-w-0 rounded-lg border border-white/15 bg-neutral-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    {supported.map((item) => (
                      <option key={item.season_number} value={item.season_number}>
                        {item.name === `Season ${item.season_number}` ? item.name : `Season ${item.season_number} · ${item.name}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative min-w-0 flex-1">
                  <label htmlFor={searchId} className="sr-only">Search by episode number or title</label>
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-neutral-500" />
                  <input
                    id={searchId} type="search" value={search} placeholder="Episode number or title"
                    onChange={(event) => setBrowser({ playbackKey, requestedSeason: browsedSeason, search: event.target.value })}
                    className="h-11 w-full min-w-0 rounded-lg border border-white/15 bg-neutral-900 pl-9 pr-3 text-base text-white placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:text-sm"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div ref={resultsRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
            {invalidSeason ? (
              <p role="status" className="text-sm text-amber-400">
                Season {playingSeason} is not listed among the supported seasons. Playback has not been changed.
              </p>
            ) : missingEpisode ? (
              <p role="status" className="text-sm text-amber-400">
                Episode {playingEpisode} is not listed in season {playingSeason}. Choose another episode. Playback has not been changed.
              </p>
            ) : null}
            {metadata.isError && metadata.data ? (
              <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
                <span>Could not refresh episodes. Showing the saved list.</span>
                {retry}
              </div>
            ) : null}
            {supported === undefined ? (
              <p role="status" className="text-sm text-neutral-400">Season information is unavailable or malformed. Playback has not been changed.</p>
            ) : browsedSeason === undefined ? (
              <p role="status" className="text-sm text-neutral-400">No supported seasons are listed. Specials are not included.</p>
            ) : metadata.isPending ? (
              <div role="status" aria-label="Loading episodes" className="space-y-2">
                <span className="sr-only">Loading episodes…</span>
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} aria-hidden="true" className="h-24 w-full rounded-lg bg-neutral-800" />
                ))}
              </div>
            ) : metadata.isError && !metadata.data ? (
              <div role="alert" className="space-y-3 text-sm text-neutral-400">
                <p>{metadata.error instanceof Error && metadata.error.message.includes("metadata")
                  ? "Episode metadata is unavailable or malformed. Please try again."
                  : `Could not load episodes for season ${browsedSeason}. Playback is still available.`}</p>
                {retry}
              </div>
            ) : metadata.data.episodes.length === 0 ? (
              <div role="status" className="space-y-3 text-sm text-neutral-400">
                <p>No episodes are listed for season {browsedSeason} yet.</p>
                {retry}
              </div>
            ) : episodes.length === 0 ? (
              <p role="status" className="text-sm text-neutral-400">No episodes match “{search.trim()}”. Try an exact episode number or part of its title.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-neutral-500">{episodes.length} episodes · Upcoming episodes cannot be selected.</p>
                {episodes.map((item) => (
                  <EpisodeCard
                    key={`${item.season_number}-${item.episode_number}-${item.still_path}`}
                    episode={item}
                    selected={item.season_number === playingSeason && item.episode_number === playingEpisode}
                    todayUTC={todayUTC}
                    onSelect={() => selectEpisode(item.season_number, item.episode_number)}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
