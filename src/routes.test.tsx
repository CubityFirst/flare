/**
 * Renders every route of the real route tree, signed in, and fails if any page throws.
 * Rendering is server-side (no DOM), so only the first render pass is covered: queries
 * other than `me` stay pending. That's enough to catch crashes like a page reading
 * context it can't reach.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";
import type { Me } from "@shared/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "./router";

const ME: Me = {
  user: {
    id: "u1",
    email: "admin@example.com",
    name: "Admin",
    picture: null,
    role: "admin",
    status: "active",
    createdAt: 0,
    lastLoginAt: 0,
  },
  vapidPublicKey: "BExampleKey",
  appName: "Flare",
};

const PATHS = ["/", "/send", "/devices", "/apps", "/groups", "/groups/g1", "/sounds", "/docs", "/admin", "/nope"];

beforeAll(() => {
  // Pages read a few browser globals during render; give them inert stand-ins.
  const g = globalThis as Record<string, unknown>;
  g.window ??= {
    location: { origin: "https://flare.test", pathname: "/", search: "" },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  g.document ??= { title: "", visibilityState: "visible" };
});

function render(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], ME);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  // Errors in a route render as React Router's error element instead of throwing.
  const errors: unknown[] = [];
  const unsubscribe = router.subscribe((state) => {
    if (state.errors) errors.push(...Object.values(state.errors));
  });
  const html = renderToString(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  unsubscribe();
  return { html, errors: [...errors, ...Object.values(router.state.errors ?? {})] };
}

describe("routes render when signed in", () => {
  for (const path of PATHS) {
    it(path, () => {
      const { html, errors } = render(path);
      expect(errors).toEqual([]);
      expect(html).not.toContain("Unexpected Application Error");
    });
  }
});
