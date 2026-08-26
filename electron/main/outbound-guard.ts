const secretPattern =
  /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:gh[opusr]_|github_pat_|sk-|xox[baprs]-|AKIA)[A-Za-z0-9_\-]{8,}|\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=])/i;
const localPathPattern =
  /(?:\b[A-Za-z]:[\\/](?:Users|Documents|Desktop|AppData)[\\/]|\/(?:Users|home|etc|var)\/)/i;
const contactPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function assertSafeOutboundText(
  value: string,
  label = "outbound request",
) {
  const text = value.replace(/[\r\n\0]+/g, " ").trim();
  if (!text) throw new Error(`${label} is empty`);
  if (text.length > 240)
    throw new Error(`${label} was blocked because it is too detailed`);
  if (
    secretPattern.test(text) ||
    localPathPattern.test(text) ||
    contactPattern.test(text) ||
    /data:(?:image|audio|video|application)\//i.test(text) ||
    /\b(?:function|const|let|class|import|export)\b[^\n]*[{}();=]/i.test(text)
  )
    throw new Error(`${label} was blocked to protect local data`);
  const punctuation = (text.match(/[{}[\]<>`$\\]/g) || []).length;
  if (punctuation > 4)
    throw new Error(`${label} looks like code or local data and was blocked`);
  return text;
}

export function assertSafeExternalPayload(value: unknown) {
  const text = JSON.stringify(value ?? {});
  if (text.length > 8_000)
    throw new Error("External tool input was blocked because it is too large");
  if (
    secretPattern.test(text) ||
    localPathPattern.test(text) ||
    contactPattern.test(text) ||
    /data:(?:image|audio|video|application)\//i.test(text) ||
    /(?:^|["'\s])(?:function|class|import|export)\s+[A-Za-z_$]/i.test(text)
  )
    throw new Error(
      "External tool input was blocked to protect project and personal data",
    );
  return value;
}

export function assertReceiveOnlyPublicUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Only credential-free public HTTPS pages are allowed");
  if (url.search)
    assertSafeOutboundText(
      decodeURIComponent(url.search.slice(1)),
      "Page address",
    );
  return url;
}

export type BrowserRequestDetails = {
  method: string;
  url: string;
  resourceType?: string;
  uploadData?: unknown[];
};

export function receiveOnlyBrowserRequest(details: BrowserRequestDetails) {
  const method = details.method.toUpperCase();
  if (!new Set(["GET", "HEAD"]).has(method))
    return { allowed: false, reason: `${method} requests are blocked` };
  if (details.uploadData?.length)
    return { allowed: false, reason: "Uploads are blocked" };
  if (["webSocket", "ping", "cspReport"].includes(details.resourceType || ""))
    return { allowed: false, reason: "Outbound background traffic is blocked" };
  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return { allowed: false, reason: "The address is invalid" };
  }
  if (!["https:", "http:", "file:", "data:", "blob:"].includes(url.protocol))
    return { allowed: false, reason: "That network protocol is blocked" };
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return { allowed: false, reason: "Public browsing requires HTTPS" };
  if (["https:", "http:"].includes(url.protocol)) {
    try {
      assertSafeOutboundText(
        decodeURIComponent(`${url.pathname}${url.search}`),
        "Page request",
      );
    } catch (error) {
      return {
        allowed: false,
        reason:
          error instanceof Error ? error.message : "Local data was blocked",
      };
    }
  }
  return { allowed: true, reason: "" };
}

export function strippedReceiveOnlyHeaders(headers: Record<string, string>) {
  const blocked = new Set([
    "authorization",
    "cookie",
    "origin",
    "proxy-authorization",
    "referer",
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !blocked.has(name.toLowerCase()),
    ),
  );
}
