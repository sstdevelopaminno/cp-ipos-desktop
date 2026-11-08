const ITEM_DETAIL_MARKER = "[[CPIPOS_ITEM_DETAIL]]:";

/** Render the canonical POS item-note envelope without leaking encoded fields. */
export function formatReceiptItemNotes(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const options: string[] = [];
  const details: string[] = [];
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const value = line.trim();
    if (!value) continue;
    if (value.startsWith(ITEM_DETAIL_MARKER)) {
      try {
        const detail = decodeURIComponent(value.slice(ITEM_DETAIL_MARKER.length)).trim();
        if (detail && !detail.includes(ITEM_DETAIL_MARKER)) details.push("รายละเอียด: " + detail);
      } catch { /* malformed encoded metadata is never printed */ }
    } else {
      options.push(value);
    }
  }
  return [...options, ...details].join("\n");
}
