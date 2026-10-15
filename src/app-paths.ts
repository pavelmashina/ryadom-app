/** Vite's base path is the one source of truth for PWA assets. */
export function appUrl(file = ""): URL {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(file, base);
}
export function appScope(): string {
  return appUrl().href;
}
