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

function versionParts(value: string) {
  return value
    .replace(/^v/i, "")
    .split(/[.+-]/, 3)
    .map((part) => Number(part.replace(/\D.*/, "")) || 0);
}

export function isNewerVersion(candidate: string, current: string) {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return false;
}

export function updateAssetName(version: string, platform = process.platform) {
  if (platform === "win32") return `osCode-Setup-${version}.exe`;
  if (platform === "darwin") return `osCode-${version}.dmg`;
  return "";
}
