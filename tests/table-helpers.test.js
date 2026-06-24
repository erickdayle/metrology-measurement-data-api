import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTableField,
  buildTableRows,
  parseTolerance,
  evaluateTolerance,
  computeAsFoundRow,
  computeAsLeftRow,
} from "../utils/table-helpers.js";

describe("parseTableField", () => {
  it("parses a valid stringified JSON array", () => {
    const raw = JSON.stringify([{ name: "abc", values: { cf_data_points: "5" } }]);
    const result = parseTableField(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].values.cf_data_points, "5");
  });

  it("returns [] for null", () => {
    assert.deepEqual(parseTableField(null), []);
  });

  it("returns [] for undefined", () => {
    assert.deepEqual(parseTableField(undefined), []);
  });

  it("returns [] for empty string", () => {
    assert.deepEqual(parseTableField(""), []);
  });

  it("returns [] for malformed JSON", () => {
    assert.deepEqual(parseTableField("{not valid json"), []);
  });

  it("returns [] when parsed value is not an array", () => {
    assert.deepEqual(parseTableField(JSON.stringify({ key: "value" })), []);
  });

  it("parses multiple rows", () => {
    const raw = JSON.stringify([
      { name: "uuid-1", values: { cf_data_points: "1" } },
      { name: "uuid-2", values: { cf_data_points: "2" } },
    ]);
    assert.equal(parseTableField(raw).length, 2);
  });
});

describe("buildTableRows", () => {
  it("returns the same number of rows as input", () => {
    const input = [
      { name: "old-uuid-1", values: { cf_data_points: "10" } },
      { name: "old-uuid-2", values: { cf_data_points: "20" } },
    ];
    assert.equal(buildTableRows(input).length, 2);
  });

  it("sets type to record-table-row on each row", () => {
    const input = [{ name: "old-uuid", values: { cf_data_points: "10" } }];
    const rows = buildTableRows(input);
    assert.equal(rows[0].type, "record-table-row");
  });

  it("generates a fresh UUID for each row name", () => {
    const input = [
      { name: "old-uuid-1", values: { cf_data_points: "10" } },
      { name: "old-uuid-2", values: { cf_data_points: "20" } },
    ];
    const rows = buildTableRows(input);
    assert.notEqual(rows[0].name, "old-uuid-1");
    assert.notEqual(rows[1].name, "old-uuid-2");
    assert.notEqual(rows[0].name, rows[1].name);
  });

  it("spreads values directly into attributes", () => {
    const input = [
      {
        name: "old-uuid",
        values: { cf_data_points: "123", cf_unit: "°C", cf_results: "Pass" },
      },
    ];
    const rows = buildTableRows(input);
    assert.deepEqual(rows[0].attributes, input[0].values);
  });

  it("uses empty object for attributes when values is missing", () => {
    const input = [{ name: "old-uuid" }];
    const rows = buildTableRows(input);
    assert.deepEqual(rows[0].attributes, {});
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(buildTableRows([]), []);
  });

  it("applies computeFn when provided", () => {
    const input = [{ name: "uuid", values: { a: "1" } }];
    const fn = (v) => ({ ...v, computed: "yes" });
    const rows = buildTableRows(input, fn);
    assert.equal(rows[0].attributes.computed, "yes");
  });
});

describe("parseTolerance", () => {
  it("parses <=1.0", () => {
    const t = parseTolerance("<=1.0");
    assert.equal(t.operator, "<=");
    assert.equal(t.value, 1.0);
  });

  it("parses >=0.5", () => {
    const t = parseTolerance(">=0.5");
    assert.equal(t.operator, ">=");
    assert.equal(t.value, 0.5);
  });

  it("parses <2", () => {
    const t = parseTolerance("<2");
    assert.equal(t.operator, "<");
    assert.equal(t.value, 2);
  });

  it("parses >3.5", () => {
    const t = parseTolerance(">3.5");
    assert.equal(t.operator, ">");
    assert.equal(t.value, 3.5);
  });

  it("parses ± 0.005 as <=0.005", () => {
    const t = parseTolerance("± 0.005");
    assert.equal(t.operator, "<=");
    assert.equal(t.value, 0.005);
  });

  it("defaults to <= when no operator is given", () => {
    const t = parseTolerance("1.0");
    assert.equal(t.operator, "<=");
    assert.equal(t.value, 1.0);
  });

  it("returns null for empty string", () => {
    assert.equal(parseTolerance(""), null);
  });

  it("returns null for null", () => {
    assert.equal(parseTolerance(null), null);
  });

  it("returns null for non-parseable string", () => {
    assert.equal(parseTolerance("abc"), null);
  });
});

describe("evaluateTolerance", () => {
  it("<= PASS when difference equals tolerance", () => {
    assert.equal(evaluateTolerance(1.0, { operator: "<=", value: 1.0 }), true);
  });

  it("<= FAIL when difference exceeds tolerance", () => {
    assert.equal(evaluateTolerance(1.5, { operator: "<=", value: 1.0 }), false);
  });

  it(">= PASS when difference meets threshold", () => {
    assert.equal(evaluateTolerance(2.0, { operator: ">=", value: 1.0 }), true);
  });

  it("< PASS when difference is below tolerance", () => {
    assert.equal(evaluateTolerance(0.9, { operator: "<", value: 1.0 }), true);
  });

  it("< FAIL when difference equals tolerance", () => {
    assert.equal(evaluateTolerance(1.0, { operator: "<", value: 1.0 }), false);
  });

  it("> PASS when difference exceeds threshold", () => {
    assert.equal(evaluateTolerance(1.1, { operator: ">", value: 1.0 }), true);
  });

  it("returns null when tolerance is null", () => {
    assert.equal(evaluateTolerance(1.0, null), null);
  });

  it("returns null when difference is NaN", () => {
    assert.equal(evaluateTolerance(NaN, { operator: "<=", value: 1.0 }), null);
  });
});

describe("computeAsFoundRow", () => {
  it("computes difference and PASS result, matching standard's decimal places", () => {
    const values = {
      cf_standard_reading_as_found: "10.00",
      cf_uut_as_found: "10.30",
      cf_calibration_tolerance: "<=1.0",
      cf_difference_as_found: "",
      cf_results: "",
    };
    const result = computeAsFoundRow(values);
    assert.equal(result.cf_difference_as_found, "0.30");
    assert.equal(result.cf_results, "PASS");
  });

  it("computes difference and FAIL result", () => {
    const values = {
      cf_standard_reading_as_found: "10.0",
      cf_uut_as_found: "12.0",
      cf_calibration_tolerance: "<=1.0",
      cf_difference_as_found: "",
      cf_results: "",
    };
    const result = computeAsFoundRow(values);
    assert.equal(result.cf_difference_as_found, "2.0");
    assert.equal(result.cf_results, "FAIL");
  });

  it("removes polarity (negative sign)", () => {
    const values = {
      cf_standard_reading_as_found: "5.0",
      cf_uut_as_found: "8.0",
      cf_calibration_tolerance: "<=5.0",
      cf_difference_as_found: "",
      cf_results: "",
    };
    const result = computeAsFoundRow(values);
    assert.equal(result.cf_difference_as_found, "3.0");
    assert.equal(result.cf_results, "PASS");
  });

  it("uses 0 decimal places when standard has no decimals", () => {
    const values = {
      cf_standard_reading_as_found: "10",
      cf_uut_as_found: "12",
      cf_calibration_tolerance: "<=5",
      cf_difference_as_found: "",
      cf_results: "",
    };
    const result = computeAsFoundRow(values);
    assert.equal(result.cf_difference_as_found, "2");
  });

  it("returns values unchanged when readings are empty", () => {
    const values = {
      cf_standard_reading_as_found: "",
      cf_uut_as_found: "",
      cf_calibration_tolerance: "<=1.0",
      cf_difference_as_found: "",
      cf_results: "",
    };
    const result = computeAsFoundRow(values);
    assert.equal(result.cf_difference_as_found, "");
    assert.equal(result.cf_results, "");
  });

  it("computes difference but leaves result unchanged when tolerance is empty", () => {
    const values = {
      cf_standard_reading_as_found: "10.0",
      cf_uut_as_found: "10.5",
      cf_calibration_tolerance: "",
      cf_difference_as_found: "",
      cf_results: "",
    };
    const result = computeAsFoundRow(values);
    assert.equal(result.cf_difference_as_found, "0.5");
    assert.equal(result.cf_results, "");
  });
});

describe("computeAsLeftRow", () => {
  it("computes difference and PASS result, matching standard's decimal places", () => {
    const values = {
      cf_standard_reading_as_left: "10.00",
      cf_uut_as_left: "10.20",
      cf_calibration_tolerance: "<=1.0",
      cf_difference_as_left: "",
      cf_results: "",
    };
    const result = computeAsLeftRow(values);
    assert.equal(result.cf_difference_as_left, "0.20");
    assert.equal(result.cf_results, "PASS");
  });

  it("computes difference and FAIL result", () => {
    const values = {
      cf_standard_reading_as_left: "10.0",
      cf_uut_as_left: "12.0",
      cf_calibration_tolerance: "<=1.0",
      cf_difference_as_left: "",
      cf_results: "",
    };
    const result = computeAsLeftRow(values);
    assert.equal(result.cf_difference_as_left, "2.0");
    assert.equal(result.cf_results, "FAIL");
  });

  it("returns values unchanged when readings are empty", () => {
    const values = {
      cf_standard_reading_as_left: "",
      cf_uut_as_left: "",
      cf_calibration_tolerance: "<=1.0",
      cf_difference_as_left: "",
      cf_results: "",
    };
    const result = computeAsLeftRow(values);
    assert.equal(result.cf_difference_as_left, "");
    assert.equal(result.cf_results, "");
  });
});
