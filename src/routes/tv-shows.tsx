import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tv-shows")({
  component: TvShowsComponent,
});

function TvShowsComponent() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">TV Shows</h1>
    </div>
  );
}
