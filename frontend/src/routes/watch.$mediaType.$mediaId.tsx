import { Suspense } from "react";
import {
  CatchBoundary,
  createFileRoute,
} from "@tanstack/react-router";

import SectionError from "@/components/common/SectionError";
import { mediaDetailsOptions } from "@/features/details/queries";
import type { MediaType } from "@/features/details/types";
import { WatchPage } from "@/features/watch/components/WatchPage";

interface WatchSearch {
  s?: number;
  e?: number;
}

const toMediaType = (raw: string): MediaType => {
  if (raw === "tv" || raw === "movie") return raw;
  throw new Error("Invalid media type");
};

const episodeParam = (raw: unknown, max: number): number => {
  if (raw === undefined) return 1;
  if ((typeof raw !== "string" && typeof raw !== "number") || !/^\d+$/.test(String(raw))) {
    throw new Error("Invalid season or episode");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error("Invalid season or episode");
  }
  return value;
};

export const Route = createFileRoute("/watch/$mediaType/$mediaId")({
  // Season and episode are part of a series URL only. A film has neither, so an absent pair stays
  // absent in the address instead of being materialized as ?s=1&e=1 on every movie link.
  validateSearch: (search: Record<string, unknown>): WatchSearch => ({
    ...(search.s === undefined ? {} : { s: episodeParam(search.s, 99) }),
    ...(search.e === undefined ? {} : { e: episodeParam(search.e, 9999) }),
  }),
  beforeLoad: ({ params }) => {
    toMediaType(params.mediaType);
    if (!/^\d{1,20}$/.test(params.mediaId) || !/[1-9]/.test(params.mediaId)) {
      throw new Error("Invalid media ID");
    }
  },
  loader: ({ context: { queryClient }, params }) => {
    const mediaType = toMediaType(params.mediaType);
    void queryClient.prefetchQuery(
      mediaDetailsOptions(mediaType, params.mediaId),
    );
  },
  component: WatchRoute,
});

function WatchRoute() {
  const { mediaType: rawType, mediaId } = Route.useParams();
  const { s, e } = Route.useSearch();
  const { queryClient } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const mediaType = toMediaType(rawType);

  return (
    <CatchBoundary
      getResetKey={() => `watch-${mediaType}-${mediaId}`}
      errorComponent={({ error, reset }) => (
        <div className="mx-auto max-w-5xl px-5 pt-24 sm:px-8">
          <SectionError
            error={error}
            reset={() => {
              void queryClient.resetQueries({
                queryKey: mediaDetailsOptions(mediaType, mediaId).queryKey,
                exact: true,
              });
              reset();
            }}
            queryKey={mediaDetailsOptions(mediaType, mediaId).queryKey}
            title="title details"
          />
        </div>
      )}
    >
      <Suspense
        fallback={
          <div className="mx-auto min-h-[70dvh] max-w-5xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-20 text-neutral-400 sm:px-8 sm:pt-24">
            Loading title details…
          </div>
        }
      >
        <WatchPage
          mediaType={mediaType}
          mediaId={mediaId}
          season={s ?? 1}
          episode={e ?? 1}
          onChangeEpisode={(season, episode) =>
            navigate({
              search: (previous) => ({ ...previous, s: season, e: episode }),
              resetScroll: false,
            })
          }
        />
      </Suspense>
    </CatchBoundary>
  );
}
