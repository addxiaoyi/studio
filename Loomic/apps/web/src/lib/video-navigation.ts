export function openVideoWorkspace(): void {
  // A document navigation applies the isolation headers required by the renderer.
  window.location.assign("/video/");
}
