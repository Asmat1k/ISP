import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadBundle, installDom, mockSchedule } from "./helpers.mjs";

const { requestSchedule } = await loadBundle("../src/request.ts");
beforeEach(() => installDom());

test("rejects invalid request dates before sending a request", async (t) => {
  const fetch = mockSchedule(t, []);
  for (const [start, end] of [
    ["2026-02-29", "2026-03-01"],
    ["2026-9-15", "2026-10-15"],
    ["2026-10-15", "2026-09-15"],
  ]) {
    await assert.rejects(requestSchedule(start, end), /Некорректный запрос/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
