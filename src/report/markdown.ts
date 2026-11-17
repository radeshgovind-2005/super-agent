const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The body of a "## <heading>" section: everything up to the next # or ## heading,
 * with HTML comments (template hints) removed. "" when missing or empty.
 */
export function markdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i").test(l));
  if (start === -1) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##?\s/.test(line)) break;
    body.push(line);
  }
  return body
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
