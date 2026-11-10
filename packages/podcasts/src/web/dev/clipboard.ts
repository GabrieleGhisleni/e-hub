/** Copies text; falls back to `execCommand` when the async Clipboard API is denied. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Permission denied or insecure context: try the legacy path below.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(area);
  try {
    area.select();
    if (!document.execCommand("copy")) throw new Error("copy command refused");
  } finally {
    area.remove();
  }
}
