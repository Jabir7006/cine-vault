import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle, MonitorPlay, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaType } from "@/features/details/types";
import { watchSourcesOptions } from "../queries";
import { playbackIdentity, resolveSource } from "../playback";
import { EmbedPlayer } from "./EmbedPlayer";
import { DirectPlayer } from "./DirectPlayer";
import { SourceSelector } from "./SourceSelector";

interface WatchPlayerProps {
  mediaType: MediaType;
  mediaId: string;
  season: number;
  episode: number;
  title: string;
  episodeControls?: ReactNode;
}

export const WatchPlayer = ({
  mediaType, mediaId, season, episode, title, episodeControls,
}: WatchPlayerProps) => {
  const [preferredProvider, setPreferredProvider] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const unavailableId = useId();
  const query = useQuery({
    ...watchSourcesOptions(mediaType, mediaId, season, episode),
    throwOnError: false,
  });
  const sources = query.data?.sources ?? [];
  const source = resolveSource(sources, preferredProvider);
  const identity = playbackIdentity(mediaType, mediaId, season, episode);
  const activeRefreshGeneration = useRef(0);

  // A pending refresh owns only the committed playback instance that started
  // it. Navigating away/back or switching provider invalidates its completion,
  // even if the final identity happens to equal the original one again.
  useLayoutEffect(() => {
    activeRefreshGeneration.current += 1;
    return () => { activeRefreshGeneration.current += 1; };
  }, [identity, source?.provider, source?.type, preferredProvider, attempt]);

  // Record the initial default too, so response reordering cannot change it.
  if (preferredProvider === undefined && source) {
    setPreferredProvider(source.provider);
  }

  return (
    <section aria-label="Watch player" className="space-y-3">
      <div data-player-slot className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black">
        {source?.type === "embed" ? (
          <EmbedPlayer
            key={`${identity}:${source.provider}:${source.embedUrl}:${attempt}`}
            src={source.embedUrl}
            title={mediaType === "tv" ? `${title} · S${season} E${episode}` : title}
          />
        ) : source?.type === "direct" ? (
          <DirectPlayer
            key={`${identity}:${source.provider}:${attempt}`}
            source={source}
            title={title}
            onRefresh={async () => {
              const generation = activeRefreshGeneration.current;
              const refreshed = await query.refetch();
              if (generation !== activeRefreshGeneration.current || refreshed.isError) return false;
              const refreshedSource = resolveSource(refreshed.data?.sources ?? [], preferredProvider);
              if (refreshedSource?.type === "direct" && refreshedSource.renewAt <= Date.now()) return false;
              setAttempt((value) => value + 1);
              return true;
            }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-neutral-400" role="status">
            {query.isPending ? (
              <><LoaderCircle aria-hidden="true" className="size-6 animate-spin text-neutral-500" /><span>Loading sources…</span></>
            ) : query.isError && !source ? (
              <>
                <span>Could not load sources.</span>
                <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={query.isFetching} onClick={() => void query.refetch()}>
                  <RefreshCw aria-hidden="true" className="size-4" /> Retry
                </Button>
              </>
            ) : (
              <span>No sources available for this episode or title.</span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-neutral-950 p-2 sm:gap-3">
        <SourceSelector sources={sources} selected={source?.provider} onSelect={(provider) => {
          if (provider !== source?.provider) setPreferredProvider(provider);
        }} />
        {episodeControls}
      </div>

      <details className="group rounded-lg text-xs text-neutral-500">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
          <span>Third-party sources</span>
          <span className="shrink-0 text-neutral-400 group-open:text-white">Actions & help <span aria-hidden="true">+</span></span>
        </summary>
        <div className="space-y-3 rounded-xl border border-white/10 bg-neutral-900 p-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={source?.type !== "embed"} onClick={() => setAttempt((value) => value + 1)}>
              <RefreshCw aria-hidden="true" className="size-4" /> Reload player
            </Button>
            {source?.type === "embed" ? (
              <Button asChild variant="outline" size="sm" className="min-h-11">
                <a href={source.embedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" className="size-4" /> Open provider
                </a>
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="min-h-11" disabled aria-describedby={unavailableId}>
              <MonitorPlay aria-hidden="true" className="size-4" /> Open in video app
            </Button>
          </div>
          {query.data && query.data.moviebox.status !== "ready" ? (
            <p>MovieBox: {query.data.moviebox.status === "blocked_setup" ? "Server setup is incomplete. Using embed fallbacks." :
              query.data.moviebox.status === "unsupported_adaptive" ? "This adaptive stream is not supported yet. Using embed fallbacks." :
              query.data.moviebox.status === "ambiguous" ? "Title matching is ambiguous. Using embed fallbacks." :
              "No verified playable direct source is available. Using embed fallbacks."}</p>
          ) : null}
          <p id={unavailableId}>Device video-app launching is not supported yet. Embed pages are not direct video files, and a web stream URL does not guarantee default-app support.</p>
          <p>Some providers reject sandboxed playback. Try another source or open the selected provider in a new tab. External pages are outside this player’s sandbox and may show ads, popups, or redirects. Playback is not guaranteed.</p>
        </div>
      </details>
    </section>
  );
};
