import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MonitorPlay, Settings2 } from "lucide-react";
import type { DirectSource, PlayerLease } from "../types";
import { replacementSelection, safeSeekTime, selectedStreamLink } from "../playback-session";
import { streamUrl } from "../player-lease";
import { launchNativePlayer, openPlayerLease } from "../api";
import { usePlaybackSession, type ReplacementEvidence } from "../use-playback-session";

interface DirectPlayerProps { source: DirectSource; title: string; durationSeconds?: number }
interface NativeSnapshot { volume: number; muted: boolean; rate: number; playing: boolean; time?: number }
const failureMessage = "This stream could not play in your browser. Retry playback recovery or switch provider.";
const selectClass = "min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-neutral-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60";
const buttonClass = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-neutral-950/95 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60";

/** A position a person reads, not a count of seconds. */
const clock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    : `${minutes}:${String(total % 60).padStart(2, "0")}`;
};

/** The parent keys explicit ownership boundaries; query refetch cannot replace this owner. */
export const DirectPlayer = ({ source, title, durationSeconds }: DirectPlayerProps) => {
  const [qualityId, setQualityId] = useState(source.qualities[0]!.id);
  const [subtitleId, setSubtitleId] = useState("off");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [copyStatus, setCopyStatus] = useState("");
  const [resumeStatus, setResumeStatus] = useState("");
  const [manualLink, setManualLink] = useState<{ revision: number; qualityId: string; url: string }>();
  const [lease, setLease] = useState<PlayerLease>();
  const [leaseError, setLeaseError] = useState(false);
  const [rung, setRung] = useState<number>();
  const [startAt, setStartAt] = useState(0);
  const [seekDraft, setSeekDraft] = useState(0);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeStatus, setNativeStatus] = useState("");
  // Retrying a stream that failed needs a fresh response, not only fresh state: the lease is
  // re-opened and the element is pointed at the result again, even when the URL is unchanged.
  const [reload, setReload] = useState(0);
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
  // An adaptive quality is one descriptor for a whole ladder: the rungs, not the qualities, are what
  // a height is chosen from. The lease's own ladder is the authority once it is known, because that
  // is the list its stream route accepts — the descriptor's is only what is on offer before then,
  // and a rung drawn from a list the route would refuse is a player that never starts.
  const adapted = quality?.stream === "adapted";
  const ladder = lease?.ladder ?? quality?.heights ?? [];
  const rungHeight = rung !== undefined && ladder.includes(rung) ? rung
    : ladder.length ? Math.min(...ladder) : undefined;
  // The lease renews its own authorization, so a capability's expiry does not end this playback.
  const expired = !adapted && now >= session.expiresAt;
  const blocked = adapted && lease !== undefined && !lease.encoder;
  const controlsLocked = operations.busy || !!operations.pending || operations.uncertain;
  const pendingExpired = operations.pending ? now >= operations.pending.preparationExpiresAt : false;

  useLayoutEffect(() => {
    mountedRef.current = true;
    selectionRef.current = { source: session, qualityId };
    return () => { mountedRef.current = false; };
  }, [session, qualityId]);

  /**
   * Open the lease this title plays through, once per page.
   *
   * Only a browser needs it: a native player is handed a lease by the backend when it is launched.
   * The session's own fields are the dependency rather than the whole source, because a renewed
   * source is a new object describing the same lease — reopening on it would be a wasted round trip.
   */
  const sessionId = session.sessionId;
  const controlToken = session.controlToken;
  useEffect(() => {
    if (!adapted || lease) return;
    const controller = new AbortController();
    setLeaseError(false);
    openPlayerLease({ sessionId, controlToken }, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setLease(value); },
      () => { if (!controller.signal.aborted) { setLeaseError(true); setLoading(false); } },
    );
    return () => controller.abort();
  }, [adapted, lease, sessionId, controlToken, reload]);

  const streamSource = adapted && lease && rungHeight !== undefined
    ? streamUrl(lease, rungHeight, startAt) : undefined;
  // Never fall back to a progressive URL for an adaptive quality: the browser cannot read a manifest,
  // and a failed element reports only that something went wrong.
  const mediaUrl = quality ? (adapted ? streamSource : quality.url) : undefined;
  const expiryRef = useRef(session.expiresAt);
  useLayoutEffect(() => { expiryRef.current = session.expiresAt; });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (!active) return;
      const clock_ = Date.now();
      setNow(clock_);
      expirePending(clock_);
      if (clock_ >= expiryRef.current) {
        if (!adapted) {
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
      }
      if (clock_ >= session.renewAt && clock_ < session.controlExpiresAt) renew(true);
      const boundaries = [session.renewAt, session.expiresAt, session.controlExpiresAt,
        ...(pending ? [pending.preparationExpiresAt] : [])].filter((time) => time > clock_);
      timer = setTimeout(check, Math.min(60_000, Math.max(1, Math.min(...boundaries, clock_ + 60_000) - clock_)));
    };
    const visible = () => { clearTimeout(timer); check(); };
    check();
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [session, renew, pending, expirePending, adapted]);

  /**
   * Refresh an adaptive session without asking.
   *
   * A renewal is only continuity evidence for a capability a player is reading directly, and this
   * page reads none: the lease serves the stream and replaces its own authorization, so applying the
   * refreshed capability is bookkeeping. A progressive stream keeps the explicit prompt, because
   * there the new capability is the stream.
   */
  const applyRef = useRef(operations.apply);
  useLayoutEffect(() => { applyRef.current = operations.apply; });
  useEffect(() => {
    if (!adapted || !pending || operations.busy || operations.uncertain) return;
    if (Date.now() >= pending.preparationExpiresAt) return;
    applyRef.current();
  }, [adapted, pending, operations.busy, operations.uncertain]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    let active = true;
    const generation = ++mediaGenerationRef.current;
    const restore = snapshotRef.current;
    snapshotRef.current = undefined;
    let restored = false;
    let seeking = false;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const current = () => active && generation === mediaGenerationRef.current && videoRef.current === video;
    const unavailable = () => {
      // The lease behind an adaptive stream outlives the capability that opened it.
      if (adapted || Date.now() < expiryRef.current) return false;
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
      video.src = mediaUrl;
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
  }, [mediaUrl, adapted, reload]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncTracks = () => {
      if (videoRef.current !== video || (!adapted && Date.now() >= session.expiresAt)) return;
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
  }, [qualityId, subtitleId, session, adapted]);

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

  /** A height or a start second is a new response, not a jump inside the one already playing. */
  const restartAt = (height: number | undefined, from: number) => {
    if (height === undefined) return;
    const target = Math.max(0, Math.floor(from));
    if (height === rungHeight && target === startAt) return;
    // Keep the volume and the paused/playing intent across the restart; the position is the new one.
    if (adapted) snapshotRef.current = snapshot(false);
    setRung(height);
    setStartAt(target);
    setSeekDraft(target);
    setLoading(true);
    setFailed(false);
  };

  /** Re-open the lease and point the element at the result: a stale lease is replaced, not renewed. */
  const reopenStream = () => {
    setLease(undefined);
    setLeaseError(false);
    setFailed(false);
    setLoading(true);
    setReload((value) => value + 1);
  };

  const openNative = async () => {
    if (!adapted || nativeBusy) return;
    setNativeBusy(true);
    setNativeStatus("");
    const controller = new AbortController();
    try {
      const control = { sessionId, controlToken };
      const opened = lease ?? await openPlayerLease(control, controller.signal);
      if (mountedRef.current) setLease(opened);
      if (!opened.native) {
        setNativeStatus("No video player was found on this machine. Install mpv, vlc, celluloid, smplayer or totem to use this.");
        return;
      }
      const player = await launchNativePlayer(control, title, controller.signal);
      setNativeStatus(`${player} was opened with this stream. It plays the signed manifest directly, with no transcode.`);
    } catch {
      setNativeStatus("The video app could not be opened. Playback in this page is unaffected.");
    } finally {
      if (mountedRef.current) setNativeBusy(false);
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
      {loading && !expired && !failed && !blocked && !leaseError ? <span role="status" className="pointer-events-none absolute bottom-14 left-3 rounded-lg bg-black/80 px-3 py-2 text-xs text-neutral-300">Loading video…</span> : null}
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
                  snapshotRef.current = snapshot(false); setLoading(true); setFailed(false); setQualityId(next);
                  setRung(undefined); setStartAt(0); setSeekDraft(0); setManualLink(undefined); setCopyStatus("");
                }}>{session.qualities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                <p className="text-xs text-neutral-400">Changing quality starts from the beginning.</p>
              </div> : null}
              {adapted && ladder.length > 0 ? <div className="space-y-1">
                <label htmlFor={`${id}-rung`} className="block text-xs text-neutral-300">Stream resolution</label>
                <select id={`${id}-rung`} value={String(rungHeight)} disabled={!lease?.encoder} className={selectClass} onChange={(event) => restartAt(Number(event.target.value), startAt)}>
                  {ladder.map((height) => <option key={height} value={height}>{height}p{height === Math.min(...ladder) ? " — lightest here" : ""}</option>)}
                </select>
                <p className="text-xs text-neutral-400">The provider signs this stream as HEVC, which no browser here decodes, so it is transcoded to H.264 on this machine. The position is kept.</p>
              </div> : null}
              {adapted && durationSeconds ? <div className="space-y-1">
                <label htmlFor={`${id}-start`} className="block text-xs text-neutral-300">Start from</label>
                <input id={`${id}-start`} type="range" min={0} max={Math.max(0, Math.floor(durationSeconds) - 5)} step={5} value={seekDraft}
                  disabled={!lease?.encoder} className="min-h-11 w-full accent-amber-400" onChange={(event) => setSeekDraft(Number(event.target.value))} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs tabular-nums text-neutral-400">{clock(seekDraft)} / {clock(durationSeconds)}</span>
                  <button type="button" disabled={!lease?.encoder || seekDraft === startAt} className={buttonClass} onClick={() => restartAt(rungHeight, seekDraft)}>Play from here</button>
                </div>
                <p className="text-xs text-neutral-400">Seeking starts a new transcode at that point, so it takes a moment. The title length shown is the one published for it.</p>
              </div> : null}
              {session.subtitles.length > 0 ? <div className="space-y-1">
                <label htmlFor={`${id}-subtitles`} className="block text-xs text-neutral-300">Subtitles</label>
                <select id={`${id}-subtitles`} value={subtitleId} disabled={expired} className={selectClass} onChange={(event) => setSubtitleId(event.target.value)}>
                  <option value="off">Off</option>{session.subtitles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div> : null}
              <div className="space-y-1">
                <label htmlFor={`${id}-audio`} className="block text-xs text-neutral-300">Audio</label>
                <select id={`${id}-audio`} value={session.selectedAudio} disabled={controlsLocked || adapted || session.audios.length < 2 || now >= session.controlExpiresAt} className={selectClass} onChange={(event) => {
                  if (!controlsLocked && event.target.value !== session.selectedAudio) operations.selectAudio(event.target.value);
                }}>{session.audios.map((audio) => <option key={audio.id} value={audio.id}>{audio.label}</option>)}</select>
                <p className="text-xs text-neutral-400">{adapted
                  ? "The audio of an adaptive stream is fixed when its player lease opens; switching it needs a new lease. Open the stream in a video app to choose another track."
                  : "Only verified audio choices are offered. Changing audio starts from the beginning; a failed update keeps the prior stream."}</p>
              </div>
              {adapted ? <div className="space-y-1">
                <button type="button" disabled={nativeBusy || !lease} className={`${buttonClass} w-full`} onClick={() => void openNative()}>
                  <MonitorPlay aria-hidden="true" className="size-4" /> {nativeBusy ? "Opening…" : lease?.native ? `Open in ${lease.native}` : "Open in video app"}
                </button>
                <p className="text-xs text-neutral-400">Runs a player on the machine hosting the backend, which reads the signed manifest with no transcode — the fullest quality and any audio track. Only works when you are viewing from that machine.</p>
                {nativeStatus ? <p role="status" className="text-xs text-neutral-300">{nativeStatus}</p> : null}
              </div> : null}
              <button type="button" disabled={expired || adapted || !quality} className={buttonClass} aria-describedby={`${id}-link-help`} onClick={() => void copyLink()}>Copy stream link</button>
              <p id={`${id}-link-help`} className="text-xs text-neutral-400">{adapted
                ? "An adaptive stream is a manifest, not a file, so it is played through this app rather than copied as a link."
                : <>Bearer link: anyone with it can play until {new Date(session.expiresAt).toLocaleTimeString()}. Keep it private. The backend must be reachable; external players do not renew automatically. Default-app playback is not guaranteed.</>}</p>
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
      {leaseError || blocked ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex max-h-[calc(100%-3rem)] flex-wrap items-center justify-center gap-2 overflow-y-auto bg-black/90 p-3 pr-16 text-center text-sm text-neutral-200">
          <p role="status" className="w-full">{leaseError
            ? "This stream could not be opened for playback. The backend serves it to this machine only, so a browser on another device cannot use it; open the title from the machine running the backend, or switch provider."
            : "This backend has no video encoder available, so the stream the provider signs cannot be converted for the browser. Open it in a video app instead, or switch provider."}</p>
          {leaseError ? <button type="button" className={`${buttonClass} pointer-events-auto`} onClick={reopenStream}>Try again</button> : null}
        </div>
      ) : operations.busy || operations.pending || operations.error || expired || failed ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex max-h-[calc(100%-3rem)] flex-wrap items-center justify-center gap-2 overflow-y-auto bg-black/90 p-3 pr-16 text-center text-sm text-neutral-200">
          <p role="status" className="w-full">{operations.busy ? "Updating playback — the current valid stream keeps playing…" :
            expired ? "This stream expired. Apply a prepared replacement, retry recovery, or switch provider." :
            operations.error ?? (failed ? failureMessage : "A refreshed stream is ready. The current stream keeps playing until expiry.")}</p>
          {operations.pending && !adapted && !operations.uncertain && !pendingExpired ? <button type="button" disabled={operations.busy} className={`${buttonClass} pointer-events-auto`} onClick={operations.apply}>
            {operations.pending.continuity.kind === "same-resource" ? "Apply refreshed stream" : "Apply refreshed stream — starts from beginning"}
          </button> : null}
          {!operations.busy && (operations.error || expired || failed || pendingExpired || operations.uncertain) ? <button type="button" disabled={!adapted && now >= session.controlExpiresAt} className={`${buttonClass} pointer-events-auto`} onClick={adapted ? reopenStream : operations.recover}>
            {operations.uncertain ? "Reconcile playback state" : adapted ? "Reopen the stream" : "Retry playback recovery"}
          </button> : null}
          {!adapted && now >= session.controlExpiresAt ? <p className="w-full text-xs">Playback control expired. Switch provider to start a fresh session.</p> : null}
        </div>
      ) : null}
    </div>
  );
};
