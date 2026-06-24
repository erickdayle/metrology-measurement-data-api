import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set env vars before importing the module
process.env.URL = "https://test-api.example.com/gateway/v3";
process.env.TOKEN = "test-token-123";
process.env.AS_FOUND_DATA_TABLE_ID = "207";
process.env.AS_LEFT_DATA_TABLE_ID = "208";
process.env.MANUFACTURE_AND_CALIBRATION_DATA_TABLE_ID = "221";
process.env.CALIBRATION_RANGE_TOLERANCE_DATA_TABLE_ID = "222";
process.env.EQUIPMENT_PRICING_DATA_TABLE_ID = "200";
process.env.ASSET_ID = "1";

const { run } = await import("../index.js");

// Load fixtures
const parentFixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/parent-record.json"), "utf8")
);
const childFixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/child-record.json"), "utf8")
);

// --- Migration flow tests (projectId !== ASSET_ID) ---

describe("runMigration — happy path", () => {
  afterEach(() => mock.restoreAll());

  it("fetches child, resolves parent, and posts all 5 tables", async () => {
    const postCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/") && opts?.method === "POST") {
        postCalls.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes(`/records/${childFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => childFixture };
      }
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => parentFixture };
      }
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    assert.equal(postCalls.length, 5);
    const fieldIds = postCalls.map((c) => c.url.split("/table/")[1]);
    assert.ok(fieldIds.includes("207"));
    assert.ok(fieldIds.includes("208"));
    assert.ok(fieldIds.includes("221"));
    assert.ok(fieldIds.includes("222"));
    assert.ok(fieldIds.includes("200"));

    for (const call of postCalls) {
      assert.ok(Array.isArray(call.body.data));
      assert.equal(call.body.data[0].type, "record-table-row");
    }
  });

  it("posted rows have fresh UUIDs", async () => {
    const postedTables = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/") && opts?.method === "POST") {
        postedTables.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes(`/records/${childFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => childFixture };
      }
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => parentFixture };
      }
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    const originalUuids = [
      "c96ae8cc-2ca6-4b6b-b8d9-0cdd0207ac24",
      "e1eaee97-bee9-40fe-b9f5-f8949df95269",
      "534d8151-bb00-4772-a877-a5a288c047fb",
      "4e034e7e-bd73-40cf-983b-47603554204e",
      "82da4d29-b705-458b-9f01-3a4c3e1a3be0",
    ];

    for (const payload of postedTables) {
      for (const row of payload.data) {
        assert.ok(!originalUuids.includes(row.name));
      }
    }
  });

  it("does NOT apply calculations during migration", async () => {
    const postedBodies = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/") && opts?.method === "POST") {
        postedBodies.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes(`/records/${childFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => childFixture };
      }
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => parentFixture };
      }
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    const asFoundPost = postedBodies.find((p) => p.url.includes("/table/207"));
    assert.equal(asFoundPost.body.data[0].attributes.cf_difference_as_found, "");
    assert.equal(asFoundPost.body.data[0].attributes.cf_results, "");
  });
});

describe("runMigration — missing recordId", () => {
  afterEach(() => mock.restoreAll());

  it("calls process.exit(1)", async () => {
    let exitCode;
    mock.method(process, "exit", (code) => { exitCode = code; throw new Error(`process.exit(${code})`); });
    await assert.rejects(() => run(undefined), /process\.exit\(1\)/);
    assert.equal(exitCode, 1);
  });
});

describe("runMigration — missing parent fields", () => {
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
      data: {
        ...childFixture.data,
        attributes: { ...childFixture.data.attributes, cf_parent_record: null, cf_parent_asset: 9080 },
      },
    };
    const postCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/") && opts?.method === "POST") { postCalls.push(url); return { ok: true, status: 200, json: async () => ({}) }; }
      if (url.includes("/records/9069/meta")) return { ok: true, status: 200, json: async () => child };
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) return { ok: true, status: 200, json: async () => parentFixture };
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});
    await run("9069", "4");
    assert.equal(postCalls.length, 5);
  });

  it("resolves parent via cf_asset_id fallback", async () => {
    const child = {
      data: {
        ...childFixture.data,
        attributes: { ...childFixture.data.attributes, cf_parent_record: null, cf_parent_asset: null, cf_asset_id: 9080 },
      },
    };
    const postCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/") && opts?.method === "POST") { postCalls.push(url); return { ok: true, status: 200, json: async () => ({}) }; }
      if (url.includes("/records/9069/meta")) return { ok: true, status: 200, json: async () => child };
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) return { ok: true, status: 200, json: async () => parentFixture };
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});
    await run("9069", "4");
    assert.equal(postCalls.length, 5);
  });
});

describe("runMigration — parent missing a table field", () => {
  afterEach(() => mock.restoreAll());

  it("skips the missing table and posts the rest", async () => {
    const parentMissing = {
      data: {
        ...parentFixture.data,
        attributes: { ...parentFixture.data.attributes, cf_as_found_data_table: null },
      },
    };
    const postCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/") && opts?.method === "POST") { postCalls.push(url); return { ok: true, status: 200, json: async () => ({}) }; }
      if (url.includes(`/records/${childFixture.data.id}/meta`)) return { ok: true, status: 200, json: async () => childFixture };
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) return { ok: true, status: 200, json: async () => parentMissing };
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});
    await run(childFixture.data.id, "4");
    assert.equal(postCalls.length, 4);
    assert.ok(!postCalls.some((url) => url.includes("/table/207")));
  });
});

// --- Calculation flow tests (projectId === ASSET_ID) ---

describe("runCalculations — happy path", () => {
  afterEach(() => mock.restoreAll());

  it("GETs As Found and As Left tables, computes, and PATCHes them", async () => {
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
      if (opts?.method === "PATCH") {
        patchCalls.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes("/table/207")) return { ok: true, status: 200, json: async () => asFoundRows };
      if (url.includes("/table/208")) return { ok: true, status: 200, json: async () => asLeftRows };
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});

    await run("9080", "1");

    assert.equal(patchCalls.length, 2);

    // As Found: |10.0 - 10.5| = 0.5, <= 1.0 → PASS
    const asFoundPatch = patchCalls.find((c) => c.url.includes("/table/207"));
    assert.ok(Math.abs(parseFloat(asFoundPatch.body.data[0].attributes.cf_difference_as_found) - 0.5) < 0.001);
    assert.equal(asFoundPatch.body.data[0].attributes.cf_results, "PASS");
    assert.equal(asFoundPatch.body.data[0].name, "row-1");

    // As Left: |20.0 - 22.0| = 2.0, <= 1.0 → FAIL
    const asLeftPatch = patchCalls.find((c) => c.url.includes("/table/208"));
    assert.equal(asLeftPatch.body.data[0].attributes.cf_difference_as_left, "2");
    assert.equal(asLeftPatch.body.data[0].attributes.cf_results, "FAIL");
    assert.equal(asLeftPatch.body.data[0].name, "row-2");
  });

  it("preserves existing row UUIDs (PATCH, not POST)", async () => {
    const tableRows = {
      data: [{
        name: "existing-uuid-abc",
        values: {
          cf_standard_reading_as_found: "5",
          cf_uut_as_found: "5",
          cf_calibration_tolerance: "<=1.0",
          cf_difference_as_found: "",
          cf_results: "",
        },
      }],
    };

    const patchCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (opts?.method === "PATCH") { patchCalls.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({}) }; }
      if (url.includes("/table/")) return { ok: true, status: 200, json: async () => tableRows };
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});

    await run("9080", "1");

    assert.equal(patchCalls[0].data[0].name, "existing-uuid-abc");
  });

  it("skips tables with no rows", async () => {
    const patchCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (opts?.method === "PATCH") { patchCalls.push(url); return { ok: true, status: 200, json: async () => ({}) }; }
      if (url.includes("/table/")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});

    await run("9080", "1");
    assert.equal(patchCalls.length, 0);
  });
});
