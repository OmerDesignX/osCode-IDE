const interactiveBlock = /```oschat-(?:artifact|widget)\b[\s\S]*?```/gi;
const unfinishedInteractiveBlock = /```oschat-(?:artifact|widget)\b[\s\S]*$/gi;

export function chatSearchPreview(content: string) {
  const publicText = content
    .replace(interactiveBlock, "")
    .replace(unfinishedInteractiveBlock, "")
    .replace(/\s+/g, " ")
    .trim();
  return publicText || "Interactive result";
}
