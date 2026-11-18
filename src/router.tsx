import type { RouteObject } from "react-router";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { AdminPage } from "@/pages/admin";
import { AppsPage } from "@/pages/apps";
import { DevicesPage } from "@/pages/devices";
import { DocsPage } from "@/pages/docs";
import { FeedPage } from "@/pages/feed";
import { GroupDetailPage } from "@/pages/group-detail";
import { GroupsPage } from "@/pages/groups";
import { NotFoundPage } from "@/pages/not-found";
import { SendPage } from "@/pages/send";
import { SoundsPage } from "@/pages/sounds";

export const routes: RouteObject[] = [
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <FeedPage /> },
          { path: "send", element: <SendPage /> },
          { path: "devices", element: <DevicesPage /> },
          { path: "apps", element: <AppsPage /> },
          { path: "groups", element: <GroupsPage /> },
          { path: "groups/:id", element: <GroupDetailPage /> },
          { path: "sounds", element: <SoundsPage /> },
          { path: "docs", element: <DocsPage /> },
          { path: "admin", element: <AdminPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

