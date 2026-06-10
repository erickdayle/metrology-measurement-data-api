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

const { run } = await import("../index.js");

// Load fixtures
const parentFixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/parent-record.json"), "utf8")
);
const childFixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/child-record.json"), "utf8")
);

function buildFetchMock(childData, parentData, tablePostResponse = { success: true }) {
  return async (url) => {
    // Child record meta
    if (url.includes(`/records/${childData.data.id}/meta`)) {
      return { ok: true, status: 200, json: async () => childData };
    }
    // Parent record meta
    if (url.includes(`/records/${parentData.data.id}/meta`)) {
      return { ok: true, status: 200, json: async () => parentData };
    }
    // Table POST endpoints
    if (url.includes("/table/")) {
      return { ok: true, status: 200, json: async () => tablePostResponse };
    }
    return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
  };
}

describe("run() — happy path", () => {
  afterEach(() => mock.restoreAll());

  it("fetches child, resolves parent, and posts all 4 tables", async () => {
    const postCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/")) {
        postCalls.push({ url, body: JSON.parse(opts?.body ?? "{}") });
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      if (url.includes(`/records/${childFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => childFixture };
      }
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => parentFixture };
      }
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });

    // Suppress process.exit for this test
    const exitMock = mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    // All 4 tables should have been POSTed
    assert.equal(postCalls.length, 4);

    // Check each table endpoint was called with the right field ID
    const fieldIds = postCalls.map((c) => c.url.split("/table/")[1]);
    assert.ok(fieldIds.includes("207"), "As Found table (207) was posted");
    assert.ok(fieldIds.includes("208"), "As Left table (208) was posted");
    assert.ok(fieldIds.includes("221"), "Manufacture table (221) was posted");
    assert.ok(fieldIds.includes("222"), "Cal Range table (222) was posted");

    // Each POST body should have type: "table" and at least 1 row
    for (const call of postCalls) {
      assert.equal(call.body.type, "table");
      assert.ok(Array.isArray(call.body.table));
      assert.ok(call.body.table.length > 0);
    }

    exitMock.mock.restore();
  });

  it("posted rows have fresh UUIDs (not the parent's original UUIDs)", async () => {
    const postedTables = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/")) {
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
    ];

    for (const payload of postedTables) {
      for (const row of payload.table) {
        assert.ok(!originalUuids.includes(row.name), `Row name ${row.name} should be a fresh UUID`);
      }
    }
  });
});

describe("run() — missing childRecordId", () => {
  afterEach(() => mock.restoreAll());

  it("calls process.exit(1) when no childRecordId is provided", async () => {
    let exitCode;
    mock.method(process, "exit", (code) => { exitCode = code; throw new Error(`process.exit(${code})`); });

    await assert.rejects(() => run(undefined), /process\.exit\(1\)/);
    assert.equal(exitCode, 1);
  });
});

describe("run() — missing cf_parent_record", () => {
  afterEach(() => mock.restoreAll());

  it("calls process.exit(1) when child has no cf_parent_record", async () => {
    const childWithoutParent = {
      data: {
        ...childFixture.data,
        attributes: { ...childFixture.data.attributes, cf_parent_record: null },
      },
    };

    mock.method(globalThis, "fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => childWithoutParent,
    }));

    let exitCode;
    mock.method(process, "exit", (code) => { exitCode = code; throw new Error(`process.exit(${code})`); });

    await assert.rejects(() => run("9069", "4"), /process\.exit\(1\)/);
    assert.equal(exitCode, 1);
  });
});

describe("run() — parent missing a table field", () => {
  afterEach(() => mock.restoreAll());

  it("skips the missing table and still posts the remaining ones", async () => {
    const parentWithMissingTable = {
      data: {
        ...parentFixture.data,
        attributes: {
          ...parentFixture.data.attributes,
          cf_as_found_data_table: null, // Remove one table
        },
      },
    };

    const postCalls = [];
    mock.method(globalThis, "fetch", async (url, opts) => {
      if (url.includes("/table/")) {
        postCalls.push(url);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.includes(`/records/${childFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => childFixture };
      }
      if (url.includes(`/records/${parentFixture.data.id}/meta`)) {
        return { ok: true, status: 200, json: async () => parentWithMissingTable };
      }
      return { ok: false, status: 404, text: async () => "Not Found", headers: { get: () => null } };
    });
    mock.method(process, "exit", () => {});

    await run(childFixture.data.id, "4");

    // Only 3 of 4 tables should be posted
    assert.equal(postCalls.length, 3);
    // Field 207 (As Found) should NOT have been called
    assert.ok(!postCalls.some((url) => url.includes("/table/207")));
  });
});
