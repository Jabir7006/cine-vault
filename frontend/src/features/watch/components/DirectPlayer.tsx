import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import type { DirectSource } from "../types";
import { replacementSelection, safeSeekTime, selectedStreamLink } from "../playback-session";
import { usePlaybackSession, type ReplacementEvidence } from "../use-playback-session";

interface DirectPlayerProps { source: DirectSource; title: string }
interface NativeSnapshot { volume: number; muted: boolean; rate: number; playing: boolean; time?: number }
const failureMessage = "This stream could not play in your browser. Retry playback recovery or switch provider.";
const selectClass = "min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-neutral-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60";
const buttonClass = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-neutral-950/95 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60";

/** The parent keys explicit ownership boundaries; query refetch cannot replace this owner. */
export const DirectPlayer = ({ source, title }: DirectPlayerProps) => {
  const [qualityId, setQualityId] = useState(source.qualities[0]!.id);
  const [subtitleId, setSubtitleId] = useState("off");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [copyStatus, setCopyStatus] = useState("");
  const [resumeStatus, setResumeStatus] = useState("");
  const [manualLink, setManualLink] = useState<{ revision: number; qualityId: string; url: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const snapshotRef = useRef<NativeSnapshot | undefined>(undefined);
  const expirySnapshotRef = useRef<{ revision: number; snapshot: NativeSnapshot } | undefined>(undefined);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const mediaGenerationRef = useRef(0);
  const selectionRef = useRef({ source, qualityId });
  const id = useId();
  const snapshot = (preserveTime: boolean): NativeSnapshot | undefined => {
    const video = videoRef.current;
    if (!video) return undefined;
    return { volume: video.volume, muted: video.muted, rate: video.playbackRate,
      playing: !video.paused && !video.ended, ...(preserveTime ? { time: video.currentTime } : {}) };
  };
  const onReplacement = (prior: DirectSource, next: DirectSource, evidence: ReplacementEvidence) => {
    const expiredSnapshot = expirySnapshotRef.current?.revision === prior.revision ? expirySnapshotRef.current.snapshot : undefined;
    snapshotRef.current = expiredSnapshot
      ? { ...expiredSnapshot, ...(evidence?.preserveTime ? {} : { time: undefined }) }
      : snapshot(!!evidence?.preserveTime);
    expirySnapshotRef.current = undefined;
    setResumeStatus("");
    const choice = replacementSelection(prior, next, qualityId, subtitleId, evidence?.qualityId);
    setQualityId(choice.qualityId);
    setSubtitleId(choice.subtitleId);
    setLoading(true);
    setFailed(false);
    setManualLink(undefined);
    setCopyStatus("");
    setNow(Date.now());
  };
  const operations = usePlaybackSession(source, qualityId, onReplacement);
  const { renew, expirePending, pending } = operations;
  const session = operations.source;
  const quality = session.qualities.find((item) => item.id === qualityId);
  const expired = now >= session.expiresAt;
  const controlsLocked = operations.busy || !!operations.pending || operations.uncertain;
  const pendingExpired = operations.pending ? now >= operations.pending.preparationExpiresAt : false;

  useLayoutEffect(() => {
    mountedRef.current = true;
    selectionRef.current = { source: session, qualityId };
    return () => { mountedRef.current = false; };
  }, [session, qualityId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (!active) return;
      const clock = Date.now();
      setNow(clock);
      expirePending(clock);
      if (clock >= session.expiresAt) {
        // Preserve the paused/playing intent at the actual expiry boundary.
        // Replacements will snapshot that intent without auto-restarting here.
        const video = videoRef.current;
        if (video && expirySnapshotRef.current?.revision !== session.revision) {
          expirySnapshotRef.current = { revision: session.revision, snapshot: {
            volume: video.volume, muted: video.muted, rate: video.playbackRate,
            playing: !video.paused && !video.ended, time: video.currentTime,
          } };
        }
        video?.pause();
        setLoading(false);
      }
      if (clock >= session.renewAt && clock < session.controlExpiresAt) renew(true);
      const boundaries = [session.renewAt, session.expiresAt, session.controlExpiresAt,
        ...(pending ? [pending.preparationExpiresAt] : [])].filter((time) => time > clock);
      timer = setTimeout(check, Math.min(60_000, Math.max(1, Math.min(...boundaries, clock + 60_000) - clock)));
    };
    const visible = () => { clearTimeout(timer); check(); };
    check();
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [session, renew, pending, expirePending]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !quality) return;
    let active = true;
    const generation = ++mediaGenerationRef.current;
    const restore = snapshotRef.current;
    snapshotRef.current = undefined;
    let restored = false;
    let seeking = false;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const current = () => active && generation === mediaGenerationRef.current && videoRef.current === video;
    const unavailable = () => {
      if (Date.now() < session.expiresAt) return false;
      video.pause();
      if (current()) { setNow(Date.now()); setLoading(false); }
      return true;
    };
    const resume = () => {
      if (!current() || unavailable() || restored) return;
      if (seeking) return;
      if (restore?.time !== undefined) {
        const ranges: [number, number][] = [];
        for (let index = 0; index < video.seekable.length; index++) ranges.push([video.seekable.start(index), video.seekable.end(index)]);
        const target = safeSeekTime(restore.time, video.duration, ranges);
        // Do not seek or play until metadata AND the evidenced position are
        // seekable. Progress/canplay/durationchange provide bounded later tries.
        if (video.readyState < 1 || target === undefined) return;
        if (Math.abs(video.currentTime - target) > 0.05) {
          try { seeking = true; video.currentTime = target; } catch { seeking = false; return; }
          return;
        }
      }
      restored = true;
      if (restoreTimer !== undefined) clearTimeout(restoreTimer);
      if (restore?.playing) void video.play().catch(() => { /* Native controls remain usable. */ });
    };
    const seeked = () => { if (!current()) return; seeking = false; resume(); };
    const metadata = () => {
      if (!current() || unavailable()) return;
      setLoading(false);
      if (restore) { video.volume = restore.volume; video.muted = restore.muted; video.playbackRate = restore.rate; }
      resume();
    };
    const onPlay = () => {
      if (!current()) return;
      if (unavailable()) return;
      // A fresh native user gesture wins over delayed restoration callbacks.
      if (!restored) { restored = true; if (restoreTimer !== undefined) clearTimeout(restoreTimer); }
    };
    const onSeeking = () => {
      if (!current() || seeking || restored) return;
      restored = true;
      if (restoreTimer !== undefined) clearTimeout(restoreTimer);
    };
    const onError = () => {
      if (!current() || unavailable()) return;
      video.pause(); setFailed(true); setLoading(false);
    };
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", seeked);
    video.addEventListener("loadedmetadata", metadata);
    video.addEventListener("canplay", resume);
    video.addEventListener("progress", resume);
    video.addEventListener("durationchange", resume);
    video.addEventListener("play", onPlay);
    video.addEventListener("error", onError);
    if (!unavailable()) {
      if (restore) { video.volume = restore.volume; video.muted = restore.muted; video.playbackRate = restore.rate; }
      video.src = quality.url;
      video.load();
      if (restore?.time !== undefined) restoreTimer = setTimeout(() => {
        if (!current() || restored) return;
        // Missing seekability is NOT permission to start at zero automatically.
        restored = true;
        setLoading(false);
        setResumeStatus("Resume position is unavailable. Use native controls to continue; playback was not restarted automatically.");
      }, 10_000);
    }
    return () => {
      active = false;
      if (restoreTimer !== undefined) clearTimeout(restoreTimer);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("loadedmetadata", metadata);
      video.removeEventListener("canplay", resume);
      video.removeEventListener("progress", resume);
      video.removeEventListener("durationchange", resume);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("error", onError);
      video.pause(); video.removeAttribute("src"); video.load();
    };
  }, [quality, session]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncTracks = () => {
      if (videoRef.current !== video || Date.now() >= session.expiresAt) return;
      video.querySelectorAll("track").forEach((element) => {
        element.track.mode = element.dataset.subtitleId === subtitleId ? "showing" : "disabled";
      });
    };
    const tracks = video.querySelectorAll("track");
    syncTracks(); tracks.forEach((track) => track.addEventListener("load", syncTracks));
    video.textTracks.addEventListener("addtrack", syncTracks);
    return () => {
      tracks.forEach((track) => track.removeEventListener("load", syncTracks));
      video.textTracks.removeEventListener("addtrack", syncTracks);
    };
  }, [qualityId, subtitleId, session]);

  const copyLink = async () => {
    const selected = selectionRef.current;
    const url = selectedStreamLink(selected.source, selected.qualityId, Date.now());
    if (!url) { setManualLink(undefined); setCopyStatus("This stream link expired or is unavailable."); return; }
    const stillCurrent = () => mountedRef.current && selectionRef.current === selected &&
      selectedStreamLink(selected.source, selected.qualityId, Date.now()) === url;
    setManualLink(undefined);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      if (stillCurrent()) setCopyStatus("Stream link copied. Anyone with this bearer link can use it until expiry.");
    } catch {
      if (stillCurrent()) {
        setManualLink({ revision: selected.source.revision, qualityId: selected.qualityId, url });
        setCopyStatus("Clipboard unavailable. Select and copy the link below.");
      }
    }
  };
  const validManualLink = manualLink?.revision === session.revision && manualLink.qualityId === qualityId &&
    selectedStreamLink(session, qualityId, now) === manualLink.url ? manualLink.url : undefined;

  return (
    <div className="absolute inset-0 bg-black">
      <video ref={videoRef} controls playsInline crossOrigin="anonymous" preload="metadata" aria-label={title} className="absolute inset-0 h-full w-full">
        {session.subtitles.map((subtitle) => <track key={`${session.revision}:${subtitle.id}`} data-subtitle-id={subtitle.id} kind="subtitles" src={subtitle.url} srcLang={subtitle.lang} label={subtitle.label} />)}
        Your browser does not support native video. Switch provider to continue.
      </video>
      {loading && !expired && !failed ? <span role="status" className="pointer-events-none absolute bottom-14 left-3 rounded-lg bg-black/80 px-3 py-2 text-xs text-neutral-300">Loading video…</span> : null}
      <div onKeyDown={(event) => {
        if (event.key === "Escape" && settingsOpen) {
          event.preventDefault(); event.stopPropagation(); setSettingsOpen(false); settingsButtonRef.current?.focus();
        }
      }}>
        <button ref={settingsButtonRef} type="button" aria-label="Playback settings" aria-expanded={settingsOpen} aria-controls={`${id}-settings`} className={`${buttonClass} absolute right-2 top-2 z-20`} onClick={() => setSettingsOpen((open) => !open)}>
          <Settings2 aria-hidden="true" className="size-4" />
        </button>
        {settingsOpen ? (
          <div id={`${id}-settings`} role="group" aria-label="Playback settings" className="absolute right-2 top-14 z-20 max-h-[calc(100%-7rem)] w-[min(20rem,calc(100%-1rem))] overflow-y-auto rounded-xl border border-white/15 bg-neutral-950/95 p-3 text-white shadow-lg">
            <div className="space-y-3">
              {session.qualities.length > 1 ? <div className="space-y-1">
                <label htmlFor={`${id}-quality`} className="block text-xs text-neutral-300">Quality</label>
                <select id={`${id}-quality`} value={qualityId} disabled={controlsLocked || expired} className={selectClass} onChange={(event) => {
                  const next = event.target.value;
                  if (controlsLocked || next === qualityId || Date.now() >= session.expiresAt || !session.qualities.some((item) => item.id === next)) return;
                  snapshotRef.current = snapshot(false); setLoading(true); setFailed(false); setQualityId(next); setManualLink(undefined); setCopyStatus("");
                }}>{session.qualities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                <p className="text-xs text-neutral-400">Changing quality starts from the beginning.</p>
              </div> : null}
              {session.subtitles.length > 0 ? <div className="space-y-1">
                <label htmlFor={`${id}-subtitles`} className="block text-xs text-neutral-300">Subtitles</label>
                <select id={`${id}-subtitles`} value={subtitleId} disabled={expired} className={selectClass} onChange={(event) => setSubtitleId(event.target.value)}>
                  <option value="off">Off</option>{session.subtitles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div> : null}
              <div className="space-y-1">
                <label htmlFor={`${id}-audio`} className="block text-xs text-neutral-300">Audio</label>
                <select id={`${id}-audio`} value={session.selectedAudio} disabled={controlsLocked || session.audios.length < 2 || now >= session.controlExpiresAt} className={selectClass} onChange={(event) => {
                  if (!controlsLocked && event.target.value !== session.selectedAudio) operations.selectAudio(event.target.value);
                }}>{session.audios.map((audio) => <option key={audio.id} value={audio.id}>{audio.label}</option>)}</select>
                <p className="text-xs text-neutral-400">Only verified audio choices are offered. Changing audio starts from the beginning; a failed update keeps the prior stream.</p>
              </div>
              <button type="button" disabled={expired || !quality} className={buttonClass} aria-describedby={`${id}-link-help`} onClick={() => void copyLink()}>Copy stream link</button>
              <p id={`${id}-link-help`} className="text-xs text-neutral-400">Bearer link: anyone with it can play until {new Date(session.expiresAt).toLocaleTimeString()}. Keep it private. The backend must be reachable; external players do not renew automatically. Default-app playback is not guaranteed.</p>
              {copyStatus ? <p role="status" className="text-xs text-neutral-300">{copyStatus}</p> : null}
              {validManualLink ? <div className="space-y-1">
                <label htmlFor={`${id}-manual-link`} className="block text-xs text-neutral-300">Stream link — select and copy</label>
                <input id={`${id}-manual-link`} type="text" readOnly value={validManualLink} className={selectClass} onFocus={(event) => event.currentTarget.select()} />
              </div> : null}
            </div>
          </div>
        ) : null}
      </div>
      {resumeStatus ? <p role="status" className="pointer-events-none absolute bottom-14 inset-x-3 rounded-lg bg-black/80 p-2 text-xs text-neutral-300">{resumeStatus}</p> : null}
      {operations.busy || operations.pending || operations.error || expired || failed ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex max-h-[calc(100%-3rem)] flex-wrap items-center justify-center gap-2 overflow-y-auto bg-black/90 p-3 pr-16 text-center text-sm text-neutral-200">
          <p role="status" className="w-full">{operations.busy ? "Updating playback — the current valid stream keeps playing…" :
            expired ? "This stream expired. Apply a prepared replacement, retry recovery, or switch provider." :
            operations.error ?? (failed ? failureMessage : "A refreshed stream is ready. The current stream keeps playing until expiry.")}</p>
          {operations.pending && !operations.uncertain && !pendingExpired ? <button type="button" disabled={operations.busy} className={`${buttonClass} pointer-events-auto`} onClick={operations.apply}>
            {operations.pending.continuity.kind === "same-resource" ? "Apply refreshed stream" : "Apply refreshed stream — starts from beginning"}
          </button> : null}
          {!operations.busy && (operations.error || expired || failed || pendingExpired || operations.uncertain) ? <button type="button" disabled={now >= session.controlExpiresAt} className={`${buttonClass} pointer-events-auto`} onClick={operations.recover}>
            {operations.uncertain ? "Reconcile playback state" : "Retry playback recovery"}
          </button> : null}
          {now >= session.controlExpiresAt ? <p className="w-full text-xs">Playback control expired. Switch provider to start a fresh session.</p> : null}
        </div>
      ) : null}
    </div>
  );
};
