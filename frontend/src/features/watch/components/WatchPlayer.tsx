import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaType } from "@/features/details/types";
import { watchSourcesOptions } from "../queries";
import { playbackIdentity, resolveOwnedSource, resolveSource } from "../playback";
import { movieBoxPresentation } from "../moviebox-status";
import { sourcesWithEmbedFallback } from "../embed-fallback";
import { discoveryFailureMessage } from "../discovery-error";
import { EmbedPlayer } from "./EmbedPlayer";
import { DirectPlayer } from "./DirectPlayer";
import { SourceSelector } from "./SourceSelector";
import type { DirectSource } from "../types";

// Discovery identity is not an authorization capability. A module-local
// monotonic owner works on HTTP/LAN contexts without secure-context crypto.
let nextDiscoveryOwner = 0;
const createDiscoveryOwner = () => `watch-owner-${++nextDiscoveryOwner}`;

interface WatchPlayerProps {
  mediaType: MediaType;
  mediaId: string;
  season: number;
  episode: number;
  title: string;
  /** The length published for this title, when there is one; a stream cannot report its own. */
  durationSeconds?: number;
  episodeControls?: ReactNode;
}

export const WatchPlayer = (props: WatchPlayerProps) => {
  const [preferredProvider, setPreferredProvider] = useState<string>();
  const identity = playbackIdentity(props.mediaType, props.mediaId, props.season, props.episode);
  // Session ownership resets across episodes; provider preference does not.
  return <OwnedWatchPlayer key={identity} {...props} preferredProvider={preferredProvider} onProviderPreference={setPreferredProvider} />;
};

const OwnedWatchPlayer = ({
  mediaType, mediaId, season, episode, title, durationSeconds, episodeControls, preferredProvider, onProviderPreference,
}: WatchPlayerProps & { preferredProvider?: string; onProviderPreference: (provider: string) => void }) => {
  const [attempt, setAttempt] = useState(0);
  const [discoveryOwner, setDiscoveryOwner] = useState(createDiscoveryOwner);
  const [committed, setCommitted] = useState<DirectSource>();
  const query = useQuery({
    ...watchSourcesOptions(mediaType, mediaId, season, episode, discoveryOwner),
    throwOnError: false,
  });
  const sources = sourcesWithEmbedFallback(query.data?.sources, query.isError, mediaType, mediaId, season, episode);
  const candidate = resolveSource(sources, preferredProvider);
  const source = resolveOwnedSource(sources, preferredProvider, committed);
  const selectorSources = committed && !sources.some((item) => item.provider === committed.provider)
    ? [committed, ...sources] : sources;
  const hasEmbeds = selectorSources.some((item) => item.type === "embed");
  const moviebox = movieBoxPresentation(query.data?.moviebox, selectorSources.some((item) => item.type === "direct"), query.isPending, hasEmbeds);
  const identity = playbackIdentity(mediaType, mediaId, season, episode);

  // Capture direct ownership once; candidate removal/reordering/refetch cannot
  // unmount the active session. Provider selection explicitly releases it.
  if (!committed && candidate?.type === "direct") setCommitted(candidate);
  useEffect(() => {
    // Only a verified direct source claims the default preference. Latching whichever candidate
    // happens to be first would pin the viewer to an embed fallback for the whole session, and a
    // later MovieBox success for the same title would then be discovered but never played.
    if (preferredProvider === undefined && source?.type === "direct" && query.data && !query.isError) {
      onProviderPreference(source.provider);
    }
  }, [preferredProvider, source, query.data, query.isError, onProviderPreference]);

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
            durationSeconds={durationSeconds}
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
        <SourceSelector sources={selectorSources} selected={source?.provider} moviebox={moviebox} onSelect={(provider) => {
          if (provider !== source?.provider) {
            setCommitted(undefined);
            onProviderPreference(provider);
            // Switching local embed candidates does not need a new backend session.
            if (committed) setDiscoveryOwner(createDiscoveryOwner());
            setAttempt((value) => value + 1);
          }
        }} />
        {episodeControls}
      </div>
      {query.isError ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-amber-300">
          <p role="status">{discoveryFailureMessage(query.error, hasEmbeds)}</p>
          <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden="true" className="size-4" /> Retry discovery
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <p role="status" className={`text-xs ${moviebox.available ? "text-neutral-400" : "text-amber-300"}`}>
          {moviebox.message}
        </p>
        {moviebox.retryable ? (
          // A fresh owner is a fresh discovery session: the previous answer was one the same
          // request can answer differently, so asking again is a real attempt, not a re-render.
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setDiscoveryOwner(createDiscoveryOwner())}>
            <RefreshCw aria-hidden="true" className="size-4" /> Check MovieBox again
          </Button>
        ) : null}
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
          </div>
          <p>Playing a direct stream in a video app on the machine running the backend is offered in the player&rsquo;s own settings, next to the stream&rsquo;s quality and audio, because that is where the stream being played is known.</p>
          <p>Some providers reject sandboxed playback. Try another source or open the selected provider in a new tab. External pages are outside this player’s sandbox and may show ads, popups, or redirects. Playback is not guaranteed.</p>
        </div>
      </details>
    </section>
  );
};
