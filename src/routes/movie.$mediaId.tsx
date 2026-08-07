import { createFileRoute } from "@tanstack/react-router";
import { MediaDetailsPage } from "@/features/details/components/MediaDetailsPage";
import { mediaDetailsOptions } from "@/features/details/queries";

export const Route = createFileRoute("/movie/$mediaId")({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(
      mediaDetailsOptions("movie", params.mediaId),
    );
  },
  component: () => {
    const { mediaId } = Route.useParams();
    return <MediaDetailsPage mediaType="movie" mediaId={mediaId} />;
  },
});