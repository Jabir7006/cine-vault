import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { mediaDetailsOptions } from "@/features/details/queries";
import { getMediaTitle, getMediaYear, type MediaType } from "@/features/details/types";
import { WatchPlayer } from "./WatchPlayer";
import { EpisodeBrowser } from "./EpisodeBrowser";

interface WatchPageProps {
  mediaType: MediaType;
  mediaId: string;
  season: number;
  episode: number;
  onChangeEpisode: (season: number, episode: number) => void;
}

export const WatchPage = ({ mediaType, mediaId, season, episode, onChangeEpisode }: WatchPageProps) => {
  const { data: details } = useSuspenseQuery(mediaDetailsOptions(mediaType, mediaId));
  const title = getMediaTitle(details);
  const year = getMediaYear(details);

  return (
    <div className="mx-auto min-h-[70dvh] max-w-5xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-20 sm:px-8 sm:pt-24">
      <Link
        to={mediaType === "movie" ? "/movie/$mediaId" : "/tv/$mediaId"}
        params={{ mediaId }}
        className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-neutral-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to details
      </Link>

      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-xl font-semibold text-white sm:text-2xl" title={title}>
          {title}{year ? <span className="ml-2 text-sm font-normal text-neutral-500">{year}</span> : null}
        </h1>
        {mediaType === "tv" ? (
          <span className="shrink-0 text-sm tabular-nums text-neutral-400">S{season} · E{episode}</span>
        ) : null}
      </div>

      <WatchPlayer
        key={`${mediaType}-${mediaId}`}
        mediaType={mediaType}
        mediaId={mediaId}
        season={season}
        episode={episode}
        title={title}
        episodeControls={mediaType === "tv" ? (
          <EpisodeBrowser
            mediaId={mediaId}
            seasons={details.seasons}
            playingSeason={season}
            playingEpisode={episode}
            onChangeEpisode={onChangeEpisode}
          />
        ) : undefined}
      />
    </div>
  );
};
