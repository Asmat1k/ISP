import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadBundle, installDom, FixedDate, withMockTimers, scheduleDay, apiLesson, mockSchedule } from "./helpers.mjs";

let scanSemester;
const RealDate = globalThis.Date;
before(async () => ({ scanSemester } = await loadBundle("../src/scanner.ts")));
beforeEach(() => {
  globalThis.Date = FixedDate;
  installDom();
});
afterEach(() => { globalThis.Date = RealDate; });

test("loads the complete five-month range in one authenticated request", async (t) => {
  const fetch = mockSchedule(t, [
    scheduleDay("2026-09-16", [apiLesson()]),
    scheduleDay("2026-10-01"),
    scheduleDay("2027-02-15", [apiLesson("Сети", "12:00")]),
  ]);
  const result = await scanSemester();
  assert.equal(result.startDate, "2026-09-15");
  assert.equal(result.endDate, "2027-02-15");
  assert.deepEqual(result.occurrences, [
    { date: new Date(2026, 8, 16), name: "Базы данных", startTime: "17:10" },
    { date: new Date(2027, 1, 15), name: "Сети", startTime: "12:00" },
  ]);
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(String(url),
    "https://my.itmo.ru/api/schedule/schedule/personal?date_start=2026-09-15&date_end=2027-02-15");
  assert.equal(options.headers.Authorization, "Bearer test-token");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.redirect, "error");
});

test("includes both date boundaries and excludes lessons outside the requested range", async (t) => {
  mockSchedule(t, ["2026-09-14", "2026-09-15", "2027-02-15", "2027-02-16"]
    .map(date => scheduleDay(date, [apiLesson(date)])));
  const result = await scanSemester();
  assert.deepEqual(result.occurrences.map(lesson => lesson.name), ["2026-09-15", "2027-02-15"]);
});

test("keeps lessons with null subjects using their group names", async (t) => {
  mockSchedule(t, [
    scheduleDay("2026-10-15", [{ ...apiLesson(null, "18:50"), subject_id: 60209, group: "ВРЭФ  1" }]),
    scheduleDay("2026-10-16", [{ ...apiLesson(null, "18:50"), subject_id: 57979, group: "ПРВРЭС 1" }]),
    scheduleDay("2026-10-19", [
      { ...apiLesson(null, "17:10"), subject_id: 26432, group: "СВТиСУК (ВебТех) 1" },
      { ...apiLesson(null, "18:50"), subject_id: 26432, group: "СВТиСУК (ВебТех) 1.1" },
      { ...apiLesson(null, "20:30"), subject_id: 26432, group: "СВТиСУК (ВебТех) 1.1" },
    ]),
  ]);
  const result = await scanSemester();
  assert.deepEqual(result.occurrences, [
    { date: new Date(2026, 9, 15), name: "ВРЭФ  1", startTime: "18:50" },
    { date: new Date(2026, 9, 16), name: "ПРВРЭС 1", startTime: "18:50" },
    { date: new Date(2026, 9, 19), name: "СВТиСУК (ВебТех) 1", startTime: "17:10" },
    { date: new Date(2026, 9, 19), name: "СВТиСУК (ВебТех) 1.1", startTime: "18:50" },
    { date: new Date(2026, 9, 19), name: "СВТиСУК (ВебТех) 1.1", startTime: "20:30" },
  ]);
});

test("prefers subject names and falls back to group or subject ID for empty names", async (t) => {
  mockSchedule(t, [scheduleDay("2026-10-15", [
    { ...apiLesson(" Базы данных "), group: "Group" },
    { ...apiLesson("  "), group: " Group " },
    { ...apiLesson(null), group: null, subject_id: 60209 },
    { ...apiLesson(""), group: " ", subject_id: 57979 },
  ])]);
  const result = await scanSemester();
  assert.deepEqual(result.occurrences.map(lesson => lesson.name), [
    "Базы данных", "Group", "Предмет 60209", "Предмет 57979",
  ]);
});

test("rejects malformed lessons or lessons without any usable name", async (t) => {
  for (const fields of [
    { subject: 123 },
    { subject: null, time_start: "25:00" },
    ...[undefined, null, "60209", 0, -1, 1.5].map(subject_id =>
      ({ subject: null, group: null, subject_id })),
  ]) {
    mockSchedule(t, [scheduleDay("2026-10-15", [{ ...apiLesson(), ...fields }])]);
    await assert.rejects(scanSemester(), /Некорректный ответ API расписания/);
  }
});

test("rejects malformed optional fields even when a subject name is present", async (t) => {
  for (const fields of [
    { group: 42 },
    { subject_id: "456" },
    { subject_id: -1 },
    { subject_id: 1.5 },
  ]) {
    mockSchedule(t, [scheduleDay("2026-10-15", [{ ...apiLesson(), ...fields }])]);
    await assert.rejects(scanSemester(), /Некорректный ответ API расписания/);
  }
});

test("an empty range needs only one request", async (t) => {
  const fetch = mockSchedule(t, []);
  assert.deepEqual(await scanSemester(), {
    occurrences: [], startDate: "2026-09-15", endDate: "2027-02-15",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

for (const [today, endDate] of [
  ["2026-09-30", "2027-02-28"],
  ["2027-09-30", "2028-02-29"],
  ["2026-01-31", "2026-06-30"],
  ["2026-12-15", "2027-05-15"],
]) {
  test(`adds five calendar months: ${today} → ${endDate}`, async (t) => {
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [`${today}T12:00:00`])); }
    };
    const fetch = mockSchedule(t, []);
    const result = await scanSemester();
    assert.equal(result.startDate, today);
    assert.equal(result.endDate, endDate);
    assert.equal(fetch.mock.callCount(), 1);
    const url = new URL(fetch.mock.calls[0].arguments[0]);
    assert.equal(url.searchParams.get("date_start"), today);
    assert.equal(url.searchParams.get("date_end"), endDate);
  });
}

for (const token of [null, "", "false", "Bearer "]) {
  test(`rejects absent or unusable authorization (${token}) without a request`, async (t) => {
    const fetch = mockSchedule(t, []);
    if (token === null) window.localStorage.removeItem("auth._token.itmoId");
    else window.localStorage.setItem("auth._token.itmoId", token);
    await assert.rejects(scanSemester(), error => error.message.toLowerCase().includes("войдите"));
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test("reads the current access token for each request", async (t) => {
  const fetch = mockSchedule(t, [scheduleDay("2026-09-16", [apiLesson()])]);
  await scanSemester();
  window.localStorage.setItem("auth._token.itmoId", "Bearer renewed");
  await scanSemester();
  assert.equal(fetch.mock.calls[1].arguments[1].headers.Authorization, "Bearer renewed");
});

for (const status of [401, 403, 500]) {
  test(`fails on HTTP ${status} without returning a schedule`, async (t) => {
    mockSchedule(t, []);
    t.mock.method(globalThis, "fetch", async () => new Response("private server details", { status }));
    await assert.rejects(scanSemester(), error => error.message.includes(status === 500 ? "HTTP 500" : "войдите"));
  });
}

for (const data of [null, { code: 1, data: [] }, { code: 0 }, { code: 0, data: [{}] },
  { code: 0, data: [scheduleDay("2026-09-31", [apiLesson()])] },
  { code: 0, data: [scheduleDay("2026-09-16", [{ subject: "Bad", time_start: "25:00" }])] }]) {
  test(`rejects malformed API data: ${JSON.stringify(data)}`, async (t) => {
    mockSchedule(t, []);
    t.mock.method(globalThis, "fetch", async () => Response.json(data));
    await assert.rejects(scanSemester(), error => error.message.toLowerCase().includes("ответ") || error.message.toLowerCase().includes("api"));
  });
}

test("rejects invalid JSON without exposing the response body", async (t) => {
  mockSchedule(t, []);
  t.mock.method(globalThis, "fetch", async () => new Response("private response"));
  await assert.rejects(scanSemester(), error => error.message.includes("Некорректный ответ"));
});

test("reports a network failure", async (t) => {
  mockSchedule(t, []);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(scanSemester(), error => error.message.toLowerCase().includes("загрузить расписание"));
});

test("aborts a stalled request after the timeout", async (t) => {
  mockSchedule(t, []);
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  await assert.rejects(withMockTimers(t, () => scanSemester()), error => error.message.toLowerCase().includes("время ожидания"));
});

test("validates authorization, dates and times without accepting noncanonical values", async (t) => {
  for (const token of ["BearerToken", "Basic token", "Bearer two tokens"]) {
    const fetch = mockSchedule(t, []);
    window.localStorage.setItem("auth._token.itmoId", token);
    await assert.rejects(scanSemester());
    assert.equal(fetch.mock.callCount(), 0);
  }

  for (const date of ["2026-9-16", "2026-09-16 ", "2026-09-16T00:00:00", "2026-02-29"]) {
    mockSchedule(t, [scheduleDay(date, [apiLesson()])]);
    await assert.rejects(scanSemester());
  }
  for (const time of ["9:00", "09:0", "24:00", "23:60", "-1:00", "1e1:00", " 1:00", "12:00:00"]) {
    mockSchedule(t, [scheduleDay("2026-09-16", [apiLesson("Lesson", time)])]);
    await assert.rejects(scanSemester());
  }

  for (const time of ["00:00", "09:05", "23:59"]) {
    mockSchedule(t, [scheduleDay("2026-09-16", [apiLesson("Lesson", time)])]);
    window.localStorage.setItem("auth._token.itmoId", "  bEaReR\t  token  ");
    const result = await scanSemester();
    assert.equal(result.occurrences[0].startTime, time);
  }
});
