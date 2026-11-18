import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { Me } from "@shared/types";
import { api } from "@/lib/api";

export const meQuery = { queryKey: ["me"], queryFn: api.me, staleTime: 60_000 } as const;

export function useMeQuery() {
  return useQuery(meQuery);
}

/**
 * Provided by <AuthGate> around the whole signed-in app. (Router outlet context only
 * reaches the immediate child route, so it can't be used for pages nested in the shell.)
 */
export const MeContext = createContext<Me | null>(null);

/** The signed-in, approved user. Only valid below <AuthGate>. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe() must be used below <AuthGate>");
  return me;
}
