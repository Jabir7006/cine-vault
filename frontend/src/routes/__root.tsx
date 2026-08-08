import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import Footer from "../components/layout/Footer";
import Header from "../components/layout/Header";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: () => {
    return (
      <div className="min-h-screen bg-background text-foreground antialiased selection:bg-foreground/20">
        <Header />
        <main>
          <Outlet />
        </main>
        <Footer />
      </div>
    );
  },
});
