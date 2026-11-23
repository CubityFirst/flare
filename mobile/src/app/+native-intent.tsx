/**
 * flare://auth?code=… ends the browser sign-in. openAuthSessionAsync reads the code itself, so
 * the router should just stay where it is (the feed, or sign-in if that failed) rather than
 * look for an "auth" screen.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^(flare:\/\/|\/)?auth(\/|\?|$)/.test(path)) return "/";
    return path;
  } catch {
    return "/";
  }
}
