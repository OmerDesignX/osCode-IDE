import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

export function AiMessageContent({ content }: { content: string }) {
  const html = useMemo(() => {
    const clean = DOMPurify.sanitize(marked.parse(content) as string, {
      FORBID_TAGS: [
        "audio",
        "embed",
        "iframe",
        "img",
        "object",
        "style",
        "video",
      ],
    });
    const document = new DOMParser().parseFromString(clean, "text/html");
    for (const link of document.querySelectorAll("a")) {
      const href = link.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) link.removeAttribute("href");
      link.setAttribute("rel", "noreferrer noopener");
      link.setAttribute("target", "_blank");
    }
    return document.body.innerHTML;
  }, [content]);

  return (
    <div
      className="ai-message-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
