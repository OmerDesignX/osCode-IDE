const trustedUpdateHosts = new Set([
  "api.github.com",
  "github.com",
  "downloads.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export function isTrustedUpdateUrl(enabled: boolean, rawUrl: string) {
  if (!enabled) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && trustedUpdateHosts.has(url.hostname);
  } catch {
    return false;
  }
}
