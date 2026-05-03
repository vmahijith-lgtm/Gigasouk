/** Shared chat title: lead with product description, then title. */
export function shortDesignChatLabel(design: {
  description?: string | null;
  title?: string | null;
} | null): string {
  if (!design) return "Conversation";
  const raw = (design.description || "").trim().replace(/\s+/g, " ");
  if (raw.length > 0) return raw.length > 100 ? `${raw.slice(0, 97)}…` : raw;
  return design.title || "Design";
}
