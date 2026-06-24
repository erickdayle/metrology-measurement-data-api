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

export function parseTolerance(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[±]/g, "<=").replace(/\s+/g, "");
  const match = cleaned.match(/^(<=|>=|<|>)?(\d+\.?\d*)$/);
  if (!match) return null;
  const operator = match[1] || "<=";
  const value = parseFloat(match[2]);
  return Number.isFinite(value) ? { operator, value } : null;
}

export function evaluateTolerance(difference, tolerance) {
  if (!tolerance || !Number.isFinite(difference)) return null;
  switch (tolerance.operator) {
    case "<=": return difference <= tolerance.value;
    case ">=": return difference >= tolerance.value;
    case "<":  return difference < tolerance.value;
    case ">":  return difference > tolerance.value;
    default:   return null;
  }
}

export function computeAsFoundRow(values) {
  const std = parseFloat(values.cf_standard_reading_as_found);
  const uut = parseFloat(values.cf_uut_as_found);
  if (!Number.isFinite(std) || !Number.isFinite(uut)) return values;

  const difference = Math.abs(std - uut);
  const tolerance = parseTolerance(values.cf_calibration_tolerance);
  const pass = evaluateTolerance(difference, tolerance);

  return {
    ...values,
    cf_difference_as_found: String(difference),
    cf_results: pass === null ? values.cf_results : (pass ? "PASS" : "FAIL"),
  };
}

export function computeAsLeftRow(values) {
  const std = parseFloat(values.cf_standard_reading_as_left);
  const uut = parseFloat(values.cf_uut_as_left);
  if (!Number.isFinite(std) || !Number.isFinite(uut)) return values;

  const difference = Math.abs(std - uut);
  const tolerance = parseTolerance(values.cf_calibration_tolerance);
  const pass = evaluateTolerance(difference, tolerance);

  return {
    ...values,
    cf_difference_as_left: String(difference),
    cf_results: pass === null ? values.cf_results : (pass ? "PASS" : "FAIL"),
  };
}

export function buildTableRows(parsedRows, computeFn = null) {
  return parsedRows.map((row) => {
    const values = row.values ?? {};
    return {
      type: "record-table-row",
      name: randomUUID(),
      attributes: computeFn ? computeFn(values) : values,
    };
  });
}
