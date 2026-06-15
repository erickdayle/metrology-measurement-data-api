import { describe, it, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// Set env vars before importing the module so apiFetch can read them
process.env.URL = "https://test-api.example.com/gateway/v3";
process.env.TOKEN = "test-token-123";

const { getRecordMetadata, postTableRows } = await import("../services/ace-api.js");

function makeFetchMock(status, body, headers = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headers[key] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  });
}

describe("getRecordMetadata", () => {
  afterEach(() => mock.restoreAll());

  it("returns response.data on a successful fetch", async () => {
    const mockData = {
      data: {
        type: "records",
        id: "9080",
        attributes: { cf_parent_record: 9069 },
      },
    };
    mock.method(globalThis, "fetch", makeFetchMock(200, mockData));

    const result = await getRecordMetadata("9080");
    assert.deepEqual(result, mockData.data);
  });

  it("sends a GET request to the correct endpoint", async () => {
    let capturedUrl;
    mock.method(globalThis, "fetch", async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: "9080", attributes: {} } }),
      };
    });

    await getRecordMetadata("9080");
    assert.equal(capturedUrl, "https://test-api.example.com/gateway/v3/records/9080/meta");
  });

  it("includes Bearer token in Authorization header", async () => {
    let capturedHeaders;
    mock.method(globalThis, "fetch", async (url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: "9080", attributes: {} } }),
      };
    });

    await getRecordMetadata("9080");
    assert.equal(capturedHeaders.Authorization, "Bearer test-token-123");
  });

  it("throws on a non-retryable 4xx error", async () => {
    mock.method(globalThis, "fetch", makeFetchMock(404, "Not Found"));

    await assert.rejects(
      () => getRecordMetadata("9999"),
      /API Error: 404/
    );
  });
});

describe("postTableRows", () => {
  afterEach(() => mock.restoreAll());

  it("sends a POST request to the correct table endpoint", async () => {
    let capturedUrl, capturedOpts;
    mock.method(globalThis, "fetch", async (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });

    const rows = [{ name: "uuid-1", values: { cf_data_points: "5" } }];
    await postTableRows("9069", "207", rows);

    assert.equal(capturedUrl, "https://test-api.example.com/gateway/v3/records/9069/table/207");
    assert.equal(capturedOpts.method, "POST");
  });

  it("sends the correct body payload", async () => {
    let capturedBody;
    mock.method(globalThis, "fetch", async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });

    const rows = [{ name: "uuid-1", values: { cf_data_points: "5" } }];
    await postTableRows("9069", "207", rows);

    assert.equal(capturedBody.data.type, "record-table");
    assert.deepEqual(capturedBody.data.rows, rows);
  });

  it("throws on API error", async () => {
    mock.method(globalThis, "fetch", makeFetchMock(400, "Bad Request"));

    await assert.rejects(
      () => postTableRows("9069", "207", []),
      /API Error: 400/
    );
  });
});
