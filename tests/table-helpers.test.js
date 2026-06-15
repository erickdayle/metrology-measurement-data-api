import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTableField, buildTableRows } from "../utils/table-helpers.js";

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
    // Each UUID should be unique
    assert.notEqual(rows[0].name, rows[1].name);
  });

  it("spreads values directly into attributes", () => {
    const input = [
      {
        name: "old-uuid",
        values: {
          cf_data_points: "123",
          cf_unit: "°C",
          cf_results: "Pass",
        },
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
});
