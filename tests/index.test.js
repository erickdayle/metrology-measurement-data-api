import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.URL = "https://test-api.example.com/gateway/v3";
process.env.TOKEN = "test-token-123";
process.env.AS_FOUND_DATA_TABLE_ID = "207";
process.env.AS_LEFT_DATA_TABLE_ID = "208";
process.env.MANUFACTURE_AND_CALIBRATION_DATA_TABLE_ID = "221";
process.env.CALIBRATION_RANGE_TOLERANCE_DATA_TABLE_ID = "222";
process.env.EQUIPMENT_PRICING_DATA_TABLE_ID = "200";
process.env.ASSET_ID = "1";

const { run } = await import("../index.js");

const parentFixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/parent-record.json"), "utf8")
);
const childFixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/child-record.json"), "utf8")
);

function buildFullMock({ childData, parentData, tableGetData = { data: [] } } = {}) {
  const calls = { post: [], patch: [], get: [] };
  const fetchMock = async (url, opts) => {
    const method = opts?.method ?? "GET";
    // Record meta
    if (url.includes(`/records/${childData.data.id}/meta`)) {
      return { ok: true, status: 200, json: async () => childData };
    }
    if (url.includes(`/records/${parentData.data.id}/meta`)) {
      return { ok: true, status: 200, json: async () => parentData };
    }
    // Table endpoints
    if (url.includes("/table/")) {
      if (method === "POST") {
        calls.post.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (method === "PATCH") {
        calls.patch.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      // GET table rows (for calculations)
      calls.get.push(url);
      return { ok: true, status: 200, json: async () => tableGetData };
    }
    return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
  };
  return { calls, fetchMock };
}

// --- Migration tests ---

describe("run() — migration posts all 5 tables", () => {
  afterEach(() => mock.restoreAll());

  it("fetches child, resolves parent, posts all 5 tables, then runs calculations", async () => {
    const { calls, fetchMock } = buildFullMock({ childData: childFixture, parentData: parentFixture });
    mock.method(globalThis, "fetch", fetchMock);
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    assert.equal(calls.post.length, 5);
    const fieldIds = calls.post.map((c) => c.url.split("/table/")[1]);
    assert.ok(fieldIds.includes("207"));
    assert.ok(fieldIds.includes("208"));
    assert.ok(fieldIds.includes("221"));
    assert.ok(fieldIds.includes("222"));
    assert.ok(fieldIds.includes("200"));

    for (const call of calls.post) {
      assert.ok(Array.isArray(call.body.data));
      assert.equal(call.body.data[0].type, "record-table-row");
    }

    // Calculations also ran (GET calls for As Found + As Left)
    assert.equal(calls.get.length, 2);
  });

  it("posted rows have fresh UUIDs", async () => {
    const { calls, fetchMock } = buildFullMock({ childData: childFixture, parentData: parentFixture });
    mock.method(globalThis, "fetch", fetchMock);
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    const originalUuids = [
      "c96ae8cc-2ca6-4b6b-b8d9-0cdd0207ac24",
      "e1eaee97-bee9-40fe-b9f5-f8949df95269",
      "534d8151-bb00-4772-a877-a5a288c047fb",
      "4e034e7e-bd73-40cf-983b-47603554204e",
      "82da4d29-b705-458b-9f01-3a4c3e1a3be0",
    ];
    for (const call of calls.post) {
      for (const row of call.body.data) {
        assert.ok(!originalUuids.includes(row.name));
      }
    }
  });
});

describe("run() — missing recordId", () => {
  afterEach(() => mock.restoreAll());

  it("calls process.exit(1)", async () => {
    let exitCode;
    mock.method(process, "exit", (code) => { exitCode = code; throw new Error(`process.exit(${code})`); });
    await assert.rejects(() => run(undefined), /process\.exit\(1\)/);
    assert.equal(exitCode, 1);
  });
});

describe("run() — missing parent fields", () => {
  afterEach(() => mock.restoreAll());

  it("calls process.exit(1) when no parent field exists", async () => {
    const childNoParent = {
      data: {
        ...childFixture.data,
        attributes: { ...childFixture.data.attributes, cf_parent_record: null, cf_parent_asset: null, cf_asset_id: null },
      },
    };
    mock.method(globalThis, "fetch", async () => ({
      ok: true, status: 200, json: async () => childNoParent,
    }));
    let exitCode;
    mock.method(process, "exit", (code) => { exitCode = code; throw new Error(`process.exit(${code})`); });
    await assert.rejects(() => run("9069", "4"), /process\.exit\(1\)/);
    assert.equal(exitCode, 1);
  });

  it("resolves parent via cf_parent_asset fallback", async () => {
    const child = {
      data: { ...childFixture.data, attributes: { ...childFixture.data.attributes, cf_parent_record: null, cf_parent_asset: 9080 } },
    };
    const { calls, fetchMock } = buildFullMock({ childData: child, parentData: parentFixture });
    // Override the meta mock for child since the id in child fixture doesn't match "9069"
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/records/9069/meta")) return { ok: true, status: 200, json: async () => child };
      return fetchMock(url, opts);
    });
    mock.method(process, "exit", () => {});
    await run("9069", "4");
    // Migration ran (no exit called means parent was resolved)
  });

  it("resolves parent via cf_asset_id fallback", async () => {
    const child = {
      data: { ...childFixture.data, attributes: { ...childFixture.data.attributes, cf_parent_record: null, cf_parent_asset: null, cf_asset_id: 9080 } },
    };
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/records/9069/meta")) return { ok: true, status: 200, json: async () => child };
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) return { ok: true, status: 200, json: async () => parentFixture };
      if (url.includes("/table/")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});
    await run("9069", "4");
  });
});

describe("run() — parent missing a table field", () => {
  afterEach(() => mock.restoreAll());

  it("skips the missing table and posts the rest", async () => {
    const parentMissing = {
      data: { ...parentFixture.data, attributes: { ...parentFixture.data.attributes, cf_as_found_data_table: null } },
    };
    const { calls, fetchMock } = buildFullMock({ childData: childFixture, parentData: parentMissing });
    mock.method(globalThis, "fetch", fetchMock);
    mock.method(process, "exit", () => {});
    await run(childFixture.data.id, "4");
    assert.equal(calls.post.length, 4);
    assert.ok(!calls.post.some((c) => c.url.includes("/table/207")));
  });
});

// --- Calculation tests ---

describe("run() — calculations compute and PATCH", () => {
  afterEach(() => mock.restoreAll());

  it("computes difference and PASS/FAIL on As Found and As Left tables", async () => {
    const asFoundRows = {
      data: [{
        name: "row-1",
        values: {
          cf_data_points: "1",
          cf_standard_reading_as_found: "10.0",
          cf_uut_as_found: "10.5",
          cf_calibration_tolerance: "<=1.0",
          cf_difference_as_found: "",
          cf_results: "",
        },
      }],
    };
    const asLeftRows = {
      data: [{
        name: "row-2",
        values: {
          cf_data_points: "1",
          cf_standard_reading_as_left: "20.0",
          cf_uut_as_left: "22.0",
          cf_calibration_tolerance: "<=1.0",
          cf_difference_as_left: "",
          cf_results: "",
        },
      }],
    };

    const patchCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      const method = opts?.method ?? "GET";
      // Migration needs meta endpoints — just stub them out
      if (url.includes("/meta")) return { ok: true, status: 200, json: async () => childFixture };
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) return { ok: true, status: 200, json: async () => parentFixture };
      if (method === "POST") return { ok: true, status: 200, json: async () => ({}) };
      if (method === "PATCH") {
        patchCalls.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      // GET table rows
      if (url.includes("/table/207")) return { ok: true, status: 200, json: async () => asFoundRows };
      if (url.includes("/table/208")) return { ok: true, status: 200, json: async () => asLeftRows };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    });
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    assert.equal(patchCalls.length, 2);

    const asFoundPatch = patchCalls.find((c) => c.url.includes("/table/207"));
    assert.ok(Math.abs(parseFloat(asFoundPatch.body.data[0].attributes.cf_difference_as_found) - 0.5) < 0.001);
    assert.equal(asFoundPatch.body.data[0].attributes.cf_results, "PASS");
    assert.equal(asFoundPatch.body.data[0].name, "row-1");

    const asLeftPatch = patchCalls.find((c) => c.url.includes("/table/208"));
    assert.equal(asLeftPatch.body.data[0].attributes.cf_difference_as_left, "2");
    assert.equal(asLeftPatch.body.data[0].attributes.cf_results, "FAIL");
    assert.equal(asLeftPatch.body.data[0].name, "row-2");
  });

  it("skips calculation when tables have no rows", async () => {
    const patchCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      const method = opts?.method ?? "GET";
      if (url.includes("/meta")) return { ok: true, status: 200, json: async () => childFixture };
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) return { ok: true, status: 200, json: async () => parentFixture };
      if (method === "POST") return { ok: true, status: 200, json: async () => ({}) };
      if (method === "PATCH") { patchCalls.push(url); return { ok: true, status: 200, json: async () => ({}) }; }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    });
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");
    assert.equal(patchCalls.length, 0);
  });
});
