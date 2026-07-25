import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/movies")({
  component: MoviesComponent,
});

function MoviesComponent() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Movies</h1>
    </div>
  );
}
