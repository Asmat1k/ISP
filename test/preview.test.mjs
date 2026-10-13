import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadBundle,
  installDom,
  previewOverlay,
  clickPreviewButton,
} from "./helpers.mjs";

const { summarize, showPreview } = await loadBundle("../src/preview.ts");

const occ = (name) => ({
  date: new Date("2026-09-15T00:00:00"),
  name,
  startTime: "10:00",
});

test("summarize counts lessons, the date range, and groups subjects by name", () => {
  const summary = summarize({
    occurrences: [occ("Физика"), occ("Алгебра"), occ("Физика"), occ("Физика")],
    startDate: "2026-09-15",
    endDate: "2027-02-15",
  });
  assert.equal(summary.lessonCount, 4);
  assert.equal(summary.startDate, "2026-09-15");
  assert.equal(summary.endDate, "2027-02-15");
  assert.deepEqual(summary.subjects, [
    { name: "Алгебра", count: 1 },
    { name: "Физика", count: 3 },
  ]);
});

test("summarize on an empty list reports nothing", () => {
  assert.deepEqual(summarize({ occurrences: [], startDate: "2026-09-15", endDate: "2027-02-15" }), {
    lessonCount: 0,
    startDate: "2026-09-15",
    endDate: "2027-02-15",
    subjects: [],
  });
});

test("showPreview renders the headline, the date range, and a per-subject list", () => {
  installDom();
  showPreview({
    lessonCount: 4,
    startDate: "2026-09-15",
    endDate: "2027-02-15",
    subjects: [
      { name: "Алгебра", count: 1 },
      { name: "Физика", count: 3 },
    ],
  });
  const overlay = previewOverlay();
  assert.ok(overlay);
  assert.ok(overlay.textContent.includes("Нашёл 4 занятий, 2 предметов"));
  assert.ok(overlay.textContent.includes("Период: 2026-09-15 — 2027-02-15"));
  const items = overlay.querySelectorAll("li");
  assert.equal(items.length, 2);
  assert.ok(items[0].textContent.includes("Алгебра"));
  assert.ok(items[1].textContent.includes("Физика"));
});

test("confirming resolves true and removes the modal", async () => {
  installDom();
  const p = showPreview({
    lessonCount: 1,
    startDate: "2026-09-15",
    endDate: "2027-02-15",
    subjects: [{ name: "X", count: 1 }],
  });
  clickPreviewButton("Скачать .ics");
  assert.equal(await p, true);
  assert.equal(previewOverlay(), null);
});

test("cancelling resolves false and removes the modal", async () => {
  installDom();
  const p = showPreview({
    lessonCount: 1,
    startDate: "2026-09-15",
    endDate: "2027-02-15",
    subjects: [{ name: "X", count: 1 }],
  });
  clickPreviewButton("Отмена");
  assert.equal(await p, false);
  assert.equal(previewOverlay(), null);
});
