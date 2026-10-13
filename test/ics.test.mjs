import { test } from "node:test";
import assert from "node:assert/strict";
import ICAL from "ical.js";
import { loadBundle } from "./helpers.mjs";

// Bundle ics.ts (and its ./utils import) in-memory and load it, so the test
// exercises the real source without a separate build step.
const { buildIcs } = await loadBundle("../src/ics.ts");

const occ = (dateStr, name, time) => ({
  date: new Date(dateStr + "T00:00:00"),
  name,
  startTime: time,
});

const weekly = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"].map((x) =>
  occ(x, "Исследование экосистем веб-языков и веб-технологий", "17:10"),
);
const biweekly = ["2026-09-03", "2026-09-17", "2026-10-01"].map((x) =>
  occ(x, "Базы данных и знаний", "18:50"),
);
const irregular = ["2026-09-04", "2026-09-11", "2026-10-02"].map((x) =>
  occ(x, "Научно-исследовательская работа", "15:30"),
);
const single = [occ("2026-09-05", "Разовая пара", "20:30")];

const ics = buildIcs([...weekly, ...biweekly, ...irregular, ...single]);
const calendar = new ICAL.Component(ICAL.parse(ics));
const events = calendar.getAllSubcomponents("vevent");

test("weekly series → RRULE INTERVAL=1, UNTIL in UTC (Moscow 17:10 → 14:10Z)", () => {
  const rule = events[0].getFirstPropertyValue("rrule");
  assert.equal(rule.freq, "WEEKLY");
  assert.equal(rule.interval, 1);
  assert.equal(rule.until.toString(), "2026-09-22T14:10:00Z");
});

test("biweekly series → RRULE INTERVAL=2, UNTIL in UTC (Moscow 18:50 → 15:50Z)", () => {
  const rule = events[1].getFirstPropertyValue("rrule");
  assert.equal(rule.freq, "WEEKLY");
  assert.equal(rule.interval, 2);
  assert.equal(rule.until.toString(), "2026-10-01T15:50:00Z");
});

test("irregular series → RDATE with TZID, no RRULE", () => {
  assert.ok(ics.includes("RDATE;TZID=Europe/Moscow:20260911T153000,20261002T153000"));
});

test("single occurrence → no recurrence rule", () => {
  const block = ics.split("Разовая")[1].split("END:VEVENT")[0];
  assert.equal(block.includes("RRULE"), false);
  assert.equal(block.includes("RDATE"), false);
});

test("events carry an explicit Europe/Moscow timezone", () => {
  const timezoneStart = ics.indexOf("BEGIN:VTIMEZONE");
  const timezoneId = ics.indexOf("TZID:Europe/Moscow", timezoneStart);
  const timezoneEnd = ics.indexOf("END:VTIMEZONE", timezoneId);
  assert.ok(timezoneStart >= 0 && timezoneId > timezoneStart && timezoneEnd > timezoneId);
  assert.ok(ics.includes("DTSTART;TZID=Europe/Moscow:20260901T171000"));
});

test("four VEVENTs are emitted", () => {
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, 4);
});

test("long Russian SUMMARY is folded under 75 octets", () => {
  assert.ok(ics.includes("\r\n "));
  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  }
});

test("subject text survives escaping and UTF-8 folding", () => {
  const name = "Русский текст 🧪; запятая, слеш \\ и перенос\n".repeat(8);
  const output = buildIcs([occ("2026-09-05", name, "20:30")]);
  const parsed = new ICAL.Component(ICAL.parse(output));
  assert.equal(parsed.getFirstSubcomponent("vevent").getFirstPropertyValue("summary"), name);
  for (const line of output.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  }
});

test("90-minute lessons cross midnight in Moscow", () => {
  const output = buildIcs([occ("2026-12-31", "Поздняя пара", "23:30")]);
  assert.ok(output.includes("DTSTART;TZID=Europe/Moscow:20261231T233000"));
  assert.ok(output.includes("DTEND;TZID=Europe/Moscow:20270101T010000"));
  const event = new ICAL.Event(new ICAL.Component(ICAL.parse(output)).getFirstSubcomponent("vevent"));
  assert.equal(event.startDate.convertToZone(ICAL.Timezone.utcTimezone).toString(), "2026-12-31T20:30:00Z");
});

test("empty input produces a calendar without events", () => {
  const parsed = new ICAL.Component(ICAL.parse(buildIcs([])));
  assert.equal(parsed.getAllSubcomponents("vevent").length, 0);
  assert.equal(parsed.getFirstPropertyValue("version"), "2.0");
});

test("calendar uses CRLF line endings", () => {
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
});

test("UID is deterministic and order-independent (no duplicates on re-import)", () => {
  const a = buildIcs([...weekly, ...biweekly]);
  const b = buildIcs([...biweekly, ...weekly]); // reversed input order
  const uids = (calendar) => calendar.split("\r\n")
    .filter((line) => line.startsWith("UID:"))
    .map((line) => line.slice(4).trim())
    .sort();
  assert.deepEqual(uids(a), uids(b));
});
