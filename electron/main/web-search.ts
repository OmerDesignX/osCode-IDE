import dns from "node:dns/promises";
import net from "node:net";

function privateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const value = address.toLowerCase();
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:")
  );
}

async function safeUrl(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Only public HTTPS pages can be opened");
  if (
    url.hostname === "localhost" ||
    (net.isIP(url.hostname) && privateAddress(url.hostname))
  )
    throw new Error("Private network addresses are blocked");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => privateAddress(item.address))
  )
    throw new Error("Private network addresses are blocked");
  return url;
}

async function boundedFetch(
  raw: string,
  redirects = 0,
): Promise<{ url: string; text: string }> {
  const url = await safeUrl(raw);
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "osCode/0.1 local-assistant" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status >= 300 && response.status < 400 && redirects < 3) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Page redirect was invalid");
    return boundedFetch(new URL(location, url).toString(), redirects + 1);
  }
  if (!response.ok) throw new Error(`Page request failed (${response.status})`);
  const type = response.headers.get("content-type") || "";
  if (!/(text\/|application\/(json|xml|xhtml))/i.test(type))
    throw new Error("Only text pages can be opened");
  const body = (await response.text()).slice(0, 750_000);
  return { url: url.toString(), text: body };
}

function plainText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchWeb(query: string) {
  const q = query.trim().slice(0, 300);
  if (!q) throw new Error("Search query is empty");
  const { text } = await boundedFetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  );
  const results: Array<{ title: string; url: string }> = [];
  const expression =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(expression)) {
    if (results.length >= 8) break;
    let target = match[1].replace(/&amp;/g, "&");
    try {
      const redirect = new URL(target, "https://duckduckgo.com");
      target = redirect.searchParams.get("uddg") || redirect.toString();
      const checked = await safeUrl(target);
      results.push({
        title: plainText(match[2]).slice(0, 180),
        url: checked.toString(),
      });
    } catch {
      /* Unsafe results are omitted. */
    }
  }
  return JSON.stringify(results);
}

export async function fetchWebPage(url: string) {
  const page = await boundedFetch(url.slice(0, 2000));
  return `${page.url}\n\n${plainText(page.text).slice(0, 24_000)}`;
}
