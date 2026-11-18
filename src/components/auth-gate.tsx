import { useQuery } from "@tanstack/react-query";
import { Clock, LogIn, ShieldX } from "lucide-react";
import { Outlet, useLocation } from "react-router";
import { FlareMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MeContext, useMeQuery } from "@/hooks/use-me";
import { ApiError, api } from "@/lib/api";
import { signOut } from "@/lib/session";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 pt-safe pb-safe text-center">
      {children}
    </div>
  );
}

function LoginScreen() {
  const location = useLocation();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const returnTo = encodeURIComponent(location.pathname + location.search);
  return (
    <Centered>
      <FlareMark className="size-16" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{config.data?.appName ?? "Flare"}</h1>
        <p className="max-w-sm text-muted-foreground">
          Push notifications from your services and scripts, delivered to your phone and browser.
        </p>
      </div>
      <Button size="lg" asChild>
        <a href={`/auth/login?returnTo=${returnTo}`}>
          <LogIn /> Sign in
        </a>
      </Button>
      {config.data && !config.data.oidc && (
        <p className="max-w-sm text-sm text-muted-foreground">
          {config.data.devAuth
            ? "OIDC isn't configured yet, so this uses the local development sign-in."
            : config.data.passwordLogin
              ? "Single sign-on isn't set up yet, so this uses a temporary admin password."
              : "Sign-in isn't configured yet. Set OIDC_ISSUER and OIDC_CLIENT_ID."}
        </p>
      )}
    </Centered>
  );
}

export function AuthGate() {
  const me = useMeQuery();

  if (me.isPending) {
    return (
      <Centered>
        <Spinner className="size-6" />
      </Centered>
    );
  }
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <LoginScreen />;
    return (
      <Centered>
        <p className="text-muted-foreground">Couldn't reach Flare: {me.error.message}</p>
        <Button variant="outline" onClick={() => me.refetch()}>
          Try again
        </Button>
      </Centered>
    );
  }

  const { user } = me.data;
  if (user.status !== "active") {
    const pending = user.status === "pending";
    return (
      <Centered>
        {pending ? <Clock className="size-10 text-muted-foreground" /> : <ShieldX className="size-10 text-destructive" />}
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{pending ? "Waiting for approval" : "Account disabled"}</h1>
          <p className="max-w-sm text-muted-foreground">
            {pending
              ? `You're signed in as ${user.email ?? user.name}. An admin needs to approve your account before you can use Flare.`
              : "An admin has disabled your account."}
          </p>
        </div>
        <div className="flex gap-2">
          {pending && (
            <Button variant="outline" onClick={() => me.refetch()}>
              Check again
            </Button>
          )}
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Centered>
    );
  }

  return (
    <MeContext value={me.data}>
      <Outlet />
    </MeContext>
  );
}
