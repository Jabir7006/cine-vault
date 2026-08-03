import { Outlet, createRootRoute } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import Header from "../components/layout/Header";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRoute<MyRouterContext>({
  component: () => {
    return (
      <>
        <Header />
        <Outlet />
      </>
    );
  },
});
