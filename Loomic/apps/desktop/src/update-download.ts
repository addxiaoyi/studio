export const DESKTOP_DOWNLOADS_URL = "https://studio.0st.top/downloads/";

export function isPortableManualUpdate(state: {
  status: string;
  reason?: string;
}): boolean {
  return state.status === "not-available" && state.reason === "portable build requires manual update";
}
