import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import Header from "../components/layout/Header";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: () => {
    return (
      // Use bg-background instead of hardcoded neutral-950 so the dark/light
      // toggle works correctly via the .dark class on <html>.
      <div className="min-h-screen bg-background text-foreground antialiased selection:bg-foreground/20">
        <Header />
        <main>
          <Outlet />
        </main>
      </div>
    );
  },
});
