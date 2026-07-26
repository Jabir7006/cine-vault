import { Outlet, createRootRoute } from "@tanstack/react-router";
import Header from "../components/layout/Header";

export const Route = createRootRoute({
  component: () => {
    return (
      <>
        <Header />
        <Outlet />
      </>
    );
  },
});
