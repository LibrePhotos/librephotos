import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import type { RouteComponent } from "@tanstack/react-router";
import { act } from "react";

type TestPage = Readonly<{
  path: string;
  component: RouteComponent;
  validateSearch?: (search: Record<string, unknown>) => object;
}>;

/**
 * A real TanStack router over an in-memory history, for tests that check what a page does to the
 * address (push, replace, Back) rather than which navigate call it made. Render it with
 * `<RouterProvider router={router} />` and let it settle with `settle(router)`.
 */
export function createTestRouter(pages: readonly TestPage[], initialUrl: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = pages.map(({ path, component, validateSearch }) =>
    createRoute({ getParentRoute: () => rootRoute, path, component, validateSearch })
  );
  return createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
}

export type TestRouter = ReturnType<typeof createTestRouter>;

/** Waits until the router has loaded and rendered the current entry. */
export async function settle(router: TestRouter): Promise<void> {
  await act(async () => {
    await router.load();
  });
}

/** The current entry's search params as the address holds them. */
export const searchOf = (router: TestRouter): URLSearchParams => new URLSearchParams(router.state.location.searchStr);
