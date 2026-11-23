import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import FlarePush from "../../modules/flare-push";
import { type Api, createApi, postPublic } from "./api";
import { pkcePair } from "./pkce";
import { defaultDeviceName, unregisterDevice } from "./push";

export const DEFAULT_URL: string = (Constants.expoConfig?.extra?.flareUrl as string | undefined) ?? "https://flare.cubityfir.st";

/** Where the browser hands the finished sign-in back to the app. */
const REDIRECT = "flare://auth";

interface SessionValue {
  baseUrl: string;
  /** Null when signed out. */
  api: Api | null;
  /** `dev` uses a local `cf dev` server's dev sign-in instead of the identity provider. */
  signIn(baseUrl?: string, opts?: { dev?: boolean }): Promise<"ok" | "cancelled">;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * The signed-in session. The token lives in the native module's private storage, where the
 * push service also reads it (to fetch custom sounds and acknowledge alerts with the app closed).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(() => {
    const s = FlarePush.getSession();
    return { baseUrl: s.baseUrl ?? DEFAULT_URL, token: s.token };
  });

  const clear = useCallback(() => {
    FlarePush.setSession(session.baseUrl, null, null);
    setSession((s) => ({ ...s, token: null }));
    queryClient.clear();
  }, [queryClient, session.baseUrl]);

  const api = useMemo(
    () => (session.token ? createApi(session.baseUrl, session.token, clear) : null),
    [session.baseUrl, session.token, clear],
  );

  const signIn = useCallback(
    async (baseUrl = session.baseUrl, opts: { dev?: boolean } = {}) => {
      const base = baseUrl.replace(/\/+$/, "");
      const { verifier, challenge } = await pkcePair();
      const path = opts.dev ? "/auth/dev-login" : "/auth/login";
      const result = await WebBrowser.openAuthSessionAsync(`${base}${path}?mobile=${challenge}`, REDIRECT, {
        showInRecents: true,
      });
      if (result.type !== "success") return "cancelled";
      const code = Linking.parse(result.url).queryParams?.code;
      if (typeof code !== "string") throw new Error("Flare didn't return a sign-in code.");
      const { token } = await postPublic<{ token: string }>(base, "/auth/mobile/token", { code, verifier });
      FlarePush.setSession(base, token, FlarePush.getSession().deviceName ?? defaultDeviceName());
      setSession({ baseUrl: base, token });
      return "ok";
    },
    [session.baseUrl],
  );

  const signOut = useCallback(async () => {
    if (api) {
      // Best effort: the phone should stop getting this account's alerts, and the session end.
      await unregisterDevice(api).catch(() => {});
      await api.post("/auth/logout").catch(() => {});
    }
    clear();
  }, [api, clear]);

  const value = useMemo(
    () => ({ baseUrl: session.baseUrl, api, signIn, signOut }),
    [session.baseUrl, api, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** The API, for screens that only render when signed in. */
export function useApi(): Api {
  const { api } = useSession();
  if (!api) throw new Error("Not signed in");
  return api;
}
