import { useEffect, useId, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import type { DirectSource } from "../types";

interface DirectPlayerProps {
  source: DirectSource;
  title: string;
  onRefresh: () => Promise<boolean>;
}

const failureMessage = "This stream could not play in your browser. Refresh or switch provider.";
const selectClass = "min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-neutral-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";
const buttonClass = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-neutral-950/95 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60";

/**
 * One keyed instance owns one playback session. Background source refetches do
 * not replace it. The parent must change the key for an episode/provider change
 * or an explicit, successful refresh (for example identity:provider:attempt).
 */
export const DirectPlayer = ({ source, title, onRefresh }: DirectPlayerProps) => {
  const [session] = useState(() => ({
    ...source,
    qualities: source.qualities.map((quality) => ({ ...quality })),
    subtitles: source.subtitles.map((subtitle) => ({ ...subtitle })),
    audios: source.audios.map((audio) => ({ ...audio })),
  }));
  const [qualityId, setQualityId] = useState(session.qualities[0]?.id ?? "");
  const [subtitleId, setSubtitleId] = useState("off");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(() => Date.now() >= session.renewAt);
  const [sessionExpired, setSessionExpired] = useState(() => Date.now() >= session.expiresAt);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const mountedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const expiredRef = useRef(sessionExpired);
  const refreshRequestedRef = useRef(false);
  const hasPlayedRef = useRef(false);
  const resumeRef = useRef(false);
  const id = useId();
  const quality = session.qualities.find((item) => item.id === qualityId);
  const selectedAudio = session.audios.find((audio) => audio.id === session.selectedAudio);
  const hasSettings = session.qualities.length > 1 || session.subtitles.length > 0 || !!selectedAudio;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkExpiry = () => {
      if (!active || expiredRef.current) return;
      const now = Date.now();
      if (now >= session.renewAt) setNeedsRefresh(true);
      const remaining = session.expiresAt - now;
      if (remaining <= 0) {
        expiredRef.current = true;
        resumeRef.current = false;
        videoRef.current?.pause();
        setNeedsRefresh(true);
        setSessionExpired(true);
        setSettingsOpen(false);
        setLoading(false);
      } else {
        // Renewal is a manual offer, not an early playback cutoff. Only actual
        // capability expiry pauses playback. No auto-renewal or replay loop.
        const nextBoundary = now < session.renewAt ? session.renewAt - now : remaining;
        timer = setTimeout(checkExpiry, Math.min(nextBoundary, 60_000));
      }
    };
    const onVisibility = () => {
      if (timer !== undefined) clearTimeout(timer);
      checkExpiry();
    };
    checkExpiry();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !quality) return;
    let active = true;
    const isCurrent = () => active && videoRef.current === video;
    const expired = () => {
      if (expiredRef.current || Date.now() >= session.expiresAt) {
        expiredRef.current = true;
        resumeRef.current = false;
        video.pause();
        if (isCurrent()) {
          setNeedsRefresh(true);
          setSessionExpired(true);
          setLoading(false);
          setSettingsOpen(false);
        }
        return true;
      }
      return false;
    };
    const onMetadata = () => {
      if (!isCurrent() || expired()) return;
      setLoading(false);
      // Distinct progressive resources have no proven shared timeline. Loading
      // a new node starts at zero; do not seek to the previous resource's time.
      if (resumeRef.current && hasPlayedRef.current) {
        resumeRef.current = false;
        void video.play().catch(() => {
          // Autoplay policies may reject a resumed play. Keep native controls
          // usable for a new user gesture, without a retry loop.
        });
      }
    };
    const onPlay = () => {
      if (!isCurrent() || expired()) return;
      hasPlayedRef.current = true;
    };
    const onError = () => {
      if (!isCurrent() || expired()) return;
      resumeRef.current = false;
      video.pause();
      setFailed(true);
      setLoading(false);
    };
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("error", onError);
    if (!expired()) {
      video.src = quality.url;
      video.load();
    }
    return () => {
      active = false;
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("error", onError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [quality, session]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncTracks = () => {
      if (videoRef.current !== video || expiredRef.current) return;
      const tracks = video.querySelectorAll("track");
      tracks.forEach((element) => {
        element.track.mode = element.dataset.subtitleId === subtitleId ? "showing" : "disabled";
      });
    };
    const tracks = video.querySelectorAll("track");
    syncTracks();
    tracks.forEach((track) => track.addEventListener("load", syncTracks));
    video.textTracks.addEventListener("addtrack", syncTracks);
    return () => {
      tracks.forEach((track) => track.removeEventListener("load", syncTracks));
      video.textTracks.removeEventListener("addtrack", syncTracks);
    };
  }, [qualityId, subtitleId]);

  const requestRefresh = async () => {
    if (refreshRequestedRef.current) return;
    refreshRequestedRef.current = true;
    resumeRef.current = false;
    videoRef.current?.pause();
    setRefreshRequested(true);
    let refreshed = false;
    try { refreshed = await onRefresh(); } catch { /* Keep the bounded retry UI. */ }
    if (!refreshed && mountedRef.current) {
      refreshRequestedRef.current = false;
      setRefreshRequested(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-black">
      <video
        key={qualityId}
        ref={videoRef}
        controls
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        aria-label={title}
        className="absolute inset-0 h-full w-full"
      >
        {session.subtitles.map((subtitle) => (
          <track key={subtitle.id} data-subtitle-id={subtitle.id} kind="subtitles" src={subtitle.url} srcLang={subtitle.lang} label={subtitle.label} />
        ))}
        Your browser does not support native video. Switch provider to continue.
      </video>

      {loading && !needsRefresh && !failed ? (
        <span role="status" className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/80 px-3 py-2 text-xs text-neutral-300">Loading video…</span>
      ) : null}

      {hasSettings && !sessionExpired ? (
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape" && settingsOpen) {
              event.preventDefault();
              event.stopPropagation();
              setSettingsOpen(false);
              settingsButtonRef.current?.focus();
            }
          }}
        >
          <button
            ref={settingsButtonRef}
            type="button"
            aria-label="Playback settings"
            aria-expanded={settingsOpen}
            aria-controls={`${id}-settings`}
            className={`${buttonClass} absolute right-2 top-2 z-10`}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 aria-hidden="true" className="size-4" />
          </button>
          {settingsOpen ? (
            <div id={`${id}-settings`} role="group" aria-label="Playback settings" className="absolute right-2 top-14 z-10 max-h-[calc(100%-7rem)] w-[min(18rem,calc(100%-1rem))] overflow-y-auto rounded-xl border border-white/15 bg-neutral-950/95 p-3 text-white shadow-lg">
              <div className="flex flex-wrap gap-3">
                {session.qualities.length > 1 ? (
                  <div className="min-w-0 flex-1 basis-40 space-y-1">
                    <label htmlFor={`${id}-quality`} className="block text-xs text-neutral-300">Quality</label>
                    <select id={`${id}-quality`} value={qualityId} className={selectClass} onChange={(event) => {
                      const next = event.target.value;
                      if (next === qualityId || !session.qualities.some((item) => item.id === next) || expiredRef.current) return;
                      resumeRef.current = hasPlayedRef.current && !!videoRef.current && !videoRef.current.paused;
                      videoRef.current?.pause();
                      setLoading(true);
                      setFailed(false);
                      setQualityId(next);
                    }}>
                      {session.qualities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                    <p className="text-xs text-neutral-400">Changing quality starts from the beginning.</p>
                  </div>
                ) : null}
                {session.subtitles.length > 0 ? (
                  <div className="min-w-0 flex-1 basis-40 space-y-1">
                    <label htmlFor={`${id}-subtitles`} className="block text-xs text-neutral-300">Subtitles</label>
                    <select id={`${id}-subtitles`} value={subtitleId} className={selectClass} onChange={(event) => setSubtitleId(event.target.value)}>
                      <option value="off">Off</option>
                      {session.subtitles.map((subtitle) => <option key={subtitle.id} value={subtitle.id}>{subtitle.label}</option>)}
                    </select>
                  </div>
                ) : null}
                {selectedAudio ? (
                  <p className="w-full wrap-break-word text-xs text-neutral-300">Audio: {selectedAudio.label} <span className="text-neutral-500">(current track)</span></p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {needsRefresh && !sessionExpired && !failed ? (
        <button type="button" aria-label="Refresh playback session before loading another resource" disabled={refreshRequested} className={`${buttonClass} absolute left-2 top-2 z-10`} onClick={() => void requestRefresh()}>
          {refreshRequested ? "Refresh requested…" : "Refresh session"}
        </button>
      ) : null}

      {sessionExpired || failed || !quality ? (
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-0 flex max-h-[calc(100%-3rem)] flex-wrap items-center justify-center gap-2 overflow-y-auto bg-black/90 p-3 text-center text-sm text-neutral-200 ${hasSettings && !sessionExpired ? "pr-16" : ""}`}>
          <p role="status" className="w-full">{sessionExpired ? "This playback session expired. Refresh or switch provider to continue." : failureMessage}</p>
          <button type="button" disabled={refreshRequested} className={`${buttonClass} pointer-events-auto`} onClick={() => void requestRefresh()}>
            {refreshRequested ? "Refresh requested…" : "Refresh playback"}
          </button>
        </div>
      ) : null}
    </div>
  );
};
