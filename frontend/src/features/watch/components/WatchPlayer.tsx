import { useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle, MonitorPlay, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaType } from "@/features/details/types";
import { watchSourcesOptions } from "../queries";
import { playbackIdentity, resolveSource } from "../playback";
import { EmbedPlayer } from "./EmbedPlayer";
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
  const sources = query.data ?? [];
  const source = resolveSource(sources, preferredProvider);
  const identity = playbackIdentity(mediaType, mediaId, season, episode);

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
              <span>{source ? "Direct playback is not integrated yet." : "No sources available for this episode or title."}</span>
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
          <p id={unavailableId}>Device video apps need a playable direct stream. Current sources are embed pages, so this option is not available yet.</p>
          <p>Some providers reject sandboxed playback. Try another source or open the selected provider in a new tab. External pages are outside this player’s sandbox and may show ads, popups, or redirects. Playback is not guaranteed.</p>
        </div>
      </details>
    </section>
  );
};
