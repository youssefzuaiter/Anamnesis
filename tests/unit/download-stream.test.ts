import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@/lib/api-response";
import { downloadResponse, errorStatus } from "@/lib/download-stream";

async function* failing(error: unknown): AsyncGenerator<string> {
  throw error;
  yield "never";
}
const file = { filename: "x.json", contentType: "application/json" };

test("a failure before the first byte is a 500 unless the caller says which failures are a size refusal", async () => {
  const refusal = new AppError("VALIDATION_ERROR", "An export needs an account.");
  assert.equal((await downloadResponse(failing(refusal), file)).status, 500, "the JSON export's behaviour, as it was");
  assert.equal((await downloadResponse(failing(refusal), file, { statusOf: errorStatus })).status, 413);
  assert.equal((await downloadResponse(failing(new Error("db down")), file, { statusOf: errorStatus })).status, 500);
  const body = await (await downloadResponse(failing(new Error("secret detail")), file)).json();
  assert.equal(body.success, false);
  assert.ok(!JSON.stringify(body).includes("secret detail"));
});

test("a stream is sent in order with the headers of a download that no cache keeps", async () => {
  async function* two() {
    yield "ab";
    yield new Uint8Array([99]);
  }
  const response = await downloadResponse(two(), file);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="x.json"');
  assert.equal(await response.text(), "abc");
});
