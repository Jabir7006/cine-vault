import { createFileRoute } from "@tanstack/react-router";
import HomeComponent from "@/features/Home/Home";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});
