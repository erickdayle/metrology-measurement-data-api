import { randomUUID } from "node:crypto";

export function parseTableField(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function buildTableRows(parsedRows) {
  return parsedRows.map((row) => ({
    type: "record-table-row",
    name: randomUUID(),
    attributes: row.values ?? {},
  }));
}
