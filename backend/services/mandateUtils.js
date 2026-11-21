// Normalize mandate product restrictions from current and legacy formats.
function normalizeAllowedItems(value) {
  if (value === undefined || value === null || value === "") return "*";
  if (value === "*") return "*";

  let parsed = value;
  for (let attempt = 0; attempt < 3 && typeof parsed === "string"; attempt++) {
    const trimmed = parsed.trim();
    if (!trimmed) return "*";
    if (trimmed === "*") return "*";
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      break;
    }
  }

  const rawItems = Array.isArray(parsed)
    ? parsed.flat(Infinity)
    : typeof parsed === "string"
      ? parsed.split(",")
      : [];

  const items = rawItems
    .filter(item => typeof item === "string")
    .map(item => item.trim().replace(/^[\s\[\]"]+|[\s\[\]"]+$/g, "").trim())
    .filter(Boolean);

  if (items.includes("*")) return "*";
  return [...new Set(items.map(item => item.replace(/\s+/g, " ")))];
}

function allowedItemsMatch(value, description) {
  const items = normalizeAllowedItems(value);
  if (items === "*") return true;
  const target = String(description || "").trim().replace(/\s+/g, " ").toLowerCase();
  return target.length > 0 && items.some(item =>
    item.replace(/\s+/g, " ").toLowerCase() === target
  );
}

module.exports = { normalizeAllowedItems, allowedItemsMatch };
