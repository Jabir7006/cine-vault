import { createFileRoute } from "@tanstack/react-router";
import { MediaDetailsPage } from "@/features/details/components/MediaDetailsPage";
import { mediaDetailsOptions } from "@/features/details/queries";

export const Route = createFileRoute("/tv/$mediaId")({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(mediaDetailsOptions("tv", params.mediaId));
  },
  component: () => {
    const { mediaId } = Route.useParams();
    return <MediaDetailsPage mediaType="tv" mediaId={mediaId} />;
  },
});