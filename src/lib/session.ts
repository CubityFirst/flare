import { api } from "./api";

export async function signOut() {
  try {
    const res = await api.logout();
    window.location.href = res.redirect ?? "/";
  } catch {
    window.location.href = "/";
  }
}
