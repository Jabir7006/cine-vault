import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { commitPlayback, getPlaybackState, preparePlayback } from "./api";
import { canAutoCommitRenewal, canCommitPreparation, createPlaybackOperationGuard, samePreparedGeneration } from "./playback-session";
import type { DirectSource, PreparedPlayback } from "./types";

export type ReplacementEvidence = { qualityId: string; preserveTime: boolean } | undefined;

export const usePlaybackSession = (
  initial: DirectSource, qualityId: string,
  onReplacement: (prior: DirectSource, next: DirectSource, evidence: ReplacementEvidence) => void,
) => {
  const [source, setSource] = useState(initial);
  const [pending, setPending] = useState<PreparedPlayback>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const ownerRef = useRef(source);
  const qualityRef = useRef(qualityId);
  const replacementRef = useRef(onReplacement);
  const pendingRef = useRef(pending);
  const uncertaintyRef = useRef(false);
  const stagedRef = useRef<{ pending: PreparedPlayback; qualityId: string } | undefined>(undefined);
  const guardRef = useRef(createPlaybackOperationGuard());
  const abortRef = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(() => {
    qualityRef.current = qualityId;
    replacementRef.current = onReplacement;
  });
  useLayoutEffect(() => {
    const guard = guardRef.current;
    const abortOwner = abortRef;
    guard.activate();
    return () => { guard.invalidate(); abortOwner.current?.abort(); };
  }, []);
  const rememberPending = (next?: PreparedPlayback) => { pendingRef.current = next; setPending(next); };
  const adopt = (next: DirectSource, staged?: { pending: PreparedPlayback; qualityId: string }) => {
    const prior = ownerRef.current;
    const same = staged && samePreparedGeneration(staged.pending.source, next) &&
      qualityRef.current === staged.qualityId && staged.pending.continuity.kind === "same-resource";
    const evidence = staged && same && staged.pending.continuity.kind === "same-resource"
      ? { qualityId: staged.pending.continuity.qualityId, preserveTime: true } : undefined;
    replacementRef.current(prior, next, evidence);
    ownerRef.current = next;
    setSource(next);
    rememberPending();
    stagedRef.current = undefined;
    uncertaintyRef.current = false;
    setUncertain(false);
  };

  const operate = useCallback(async (action: "renew" | "audio" | "apply" | "reconcile", audioId?: string) => {
    const guard = guardRef.current;
    const generation = guard.begin();
    if (generation === undefined) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const owner = ownerRef.current;
    const selectedQuality = qualityRef.current;
    const current = () => guard.current(generation) && ownerRef.current === owner;
    setBusy(true);
    setError(undefined);
    const reconcile = async () => {
      const reply = await getPlaybackState(owner, controller.signal);
      if (!current()) return;
      if (reply.kind !== "state") throw new Error("State unavailable");
      if (reply.source.revision === owner.revision + 1) adopt(reply.source, stagedRef.current);
      else {
        uncertaintyRef.current = false;
        setUncertain(false);
        rememberPending(reply.pending ?? undefined);
        if (!reply.pending) stagedRef.current = undefined;
        else if (!stagedRef.current || stagedRef.current.pending.preparationId !== reply.pending.preparationId) {
          stagedRef.current = { pending: reply.pending, qualityId: selectedQuality };
        }
      }
    };
    try {
      // An uncertain response must be reconciled, never blindly replayed.
      if (action === "reconcile" || uncertaintyRef.current) {
        await reconcile();
        return;
      }
      let prepared = pendingRef.current;
      if (action !== "apply") {
        if (Date.now() >= owner.controlExpiresAt) throw new Error("Control expired");
        if (action === "audio" && (!audioId || !owner.audios.some((audio) => audio.id === audioId))) throw new Error("Invalid audio");
        const reply = await preparePlayback(owner, {
          version: 1, baseRevision: owner.revision, reason: action,
          qualityId: selectedQuality, ...(audioId ? { audioId } : {}),
        }, controller.signal);
        if (!current()) return;
        if (reply.kind !== "prepared") throw new Error("Preparation failed");
        prepared = reply;
        rememberPending(prepared);
        stagedRef.current = { pending: prepared, qualityId: selectedQuality };
        if (action === "renew" && !canAutoCommitRenewal(owner, prepared, qualityRef.current, selectedQuality, Date.now())) return;
      }
      if (!prepared || !canCommitPreparation(owner, prepared, Date.now())) throw new Error("Refresh preparation expired");
      const staged = stagedRef.current;
      uncertaintyRef.current = true;
      setUncertain(true);
      const reply = await commitPlayback(owner, {
        version: 1, baseRevision: owner.revision, preparationId: prepared.preparationId,
      }, controller.signal);
      if (!current()) return;
      if (reply.kind !== "committed" || !samePreparedGeneration(prepared.source, reply.source)) throw new Error("Commit uncertain");
      adopt(reply.source, staged);
    } catch {
      if (!current()) return;
      // Both a lost prepare response and a lost commit response use read-only
      // reconciliation. Failure leaves a manual read retry, not mutation retry.
      uncertaintyRef.current = true;
      setUncertain(true);
      try { await reconcile(); } catch { /* Keep the current valid generation. */ }
      if (current()) setError("Playback update could not be confirmed. Keep playing, retry recovery, or switch provider.");
    } finally {
      guard.finish(generation);
      if (guard.current(generation)) setBusy(false);
    }
  // Operations use mount-local refs, never changing source-query candidates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renew = useCallback((automatic = false) => {
    if (automatic && !guardRef.current.claimRenewal(ownerRef.current.revision)) return;
    if (pendingRef.current && !uncertaintyRef.current) return;
    void operate(uncertaintyRef.current ? "reconcile" : "renew");
  }, [operate]);
  const expirePending = useCallback((clock: number) => {
    const staged = pendingRef.current;
    if (!staged || clock < staged.preparationExpiresAt || uncertaintyRef.current) return;
    pendingRef.current = undefined;
    stagedRef.current = undefined;
    setPending(undefined);
    setError("The prepared refresh expired. The current stream remains valid until its expiry; retry recovery or switch provider.");
  }, []);
  return {
    source, pending, busy, error, uncertain, renew, expirePending,
    apply: () => void operate(uncertaintyRef.current ? "reconcile" : "apply"),
    selectAudio: (audioId: string) => void operate("audio", audioId),
    recover: () => {
      if (uncertaintyRef.current) void operate("reconcile");
      else if (pendingRef.current && !canCommitPreparation(ownerRef.current, pendingRef.current, Date.now())) {
        rememberPending(); stagedRef.current = undefined; void operate("renew");
      } else renew();
    },
  };
};
