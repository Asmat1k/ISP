import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadBundle, installDom, FixedDate, withMockTimers } from "./helpers.mjs";

function dayCell(day, lesson) {
  const greyClass = lesson?.grey ? " text-gray-40" : "";
  const inner = lesson
    ? `<div><div><div id="lesson-${day}" class="el-calendar-month-item">
         <div class="item-name">${lesson.name}</div>
         <div class="item-time">${lesson.time}</div>
       </div></div></div>`
    : "<div></div>";
  return `<div class="day-cell"><div class="el-calendar-cell-content">
      <div class="cell-date${greyClass}"><div>${day}</div></div>${inner}
    </div></div>`;
}

function buildCalendar(months, { labelDelay = 0, lessonDelay = 0, todayDelay = 0, keepPrevious = false } = {}) {
  installDom(`<!doctype html><html><body>
    <div class="b-overlay-wrap" aria-busy="false"><div class="el-calendar-header-switch">
      <button class="btn-schedule">Сегодня</button>
      <a id="dates">init</a>
      <button class="nav-next"><span class="icon icon-arrow-right"></span></button>
    </div></div>
    <div class="b-overlay-wrap" aria-busy="false"><div class="wrapper"><div class="el-calendar-table"></div></div></div>
  </body></html>`);

  const table = document.querySelector(".el-calendar-table");
  const dates = document.getElementById("dates");
  const state = { todayClicks: 0 };
  const tableOverlay = table.closest(".b-overlay-wrap");

  const render = (idx, headingDelay = 0, contentDelay = 0) => {
    const month = months[idx] ?? [];
    const headerOverlay = dates.closest(".b-overlay-wrap");
    headerOverlay.setAttribute("aria-busy", "true");
    tableOverlay.setAttribute("aria-busy", "true");
    const content = () => {
      table.innerHTML = month.map((l) => dayCell(l.day, l)).join("");
      tableOverlay.setAttribute("aria-busy", "false");
    };
    const heading = () => {
      dates.textContent = "M" + idx;
      headerOverlay.setAttribute("aria-busy", "false");
    };
    if (headingDelay) setTimeout(heading, headingDelay);
    else heading();
    if (contentDelay) {
      if (!keepPrevious) table.innerHTML = "";
      setTimeout(content, contentDelay);
    } else content();
  };

  let idx = 0;
  document.querySelector("button.btn-schedule").addEventListener("click", () => {
    idx = 0;
    state.todayClicks++;
    render(0, todayDelay, todayDelay);
  });
  document.querySelector(".nav-next").addEventListener("click", () => {
    idx++;
    render(idx, labelDelay, lessonDelay);
  });

  return state;
}

let scanSemester;
const RealDate = globalThis.Date;

before(async () => {
  ({ scanSemester } = await loadBundle("../src/scanner.ts"));
});

after(() => {
  globalThis.Date = RealDate;
});

test("scrapes lessons across months and stops at the first empty month", async () => {
  globalThis.Date = FixedDate;
  const state = buildCalendar([
    [{ day: 16, name: "Базы данных", time: "18:50" }],
    [{ day: 1, name: "Сети", time: "12:00" }],
    [], // empty → stop
  ]);

  const { occurrences, monthsScanned } = await scanSemester(() => {});

  assert.equal(monthsScanned, 3);
  assert.equal(occurrences.length, 2);
  assert.deepEqual(
    occurrences.map((o) => o.name).sort(),
    ["Базы данных", "Сети"],
  );
  assert.equal(state.todayClicks, 2);
});

test("ignores lessons in greyed adjacent-month cells", async () => {
  globalThis.Date = FixedDate;
  buildCalendar([
    [
      { day: 16, name: "Своя пара", time: "10:00" },
      { day: 20, name: "Чужой месяц", time: "15:30", grey: true },
    ],
    [],
  ]);

  const { occurrences } = await scanSemester(() => {});

  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].name, "Своя пара");
});

test("drops lessons earlier than today (forward only)", async () => {
  globalThis.Date = FixedDate; // today = 2026-09-15
  buildCalendar([
    [
      { day: 10, name: "Прошедшая пара", time: "17:10" },
      { day: 16, name: "Будущая пара", time: "17:10" },
    ],
    [],
  ]);

  const { occurrences } = await scanSemester(() => {});

  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].name, "Будущая пара");
});

test("maps day numbers to dates anchored at the current month", async () => {
  globalThis.Date = FixedDate; // anchor = September 2026
  buildCalendar([
    [{ day: 16, name: "Сентябрьская", time: "09:00" }],
    [{ day: 1, name: "Октябрьская", time: "09:00" }],
    [],
  ]);

  const { occurrences } = await scanSemester(() => {});
  const byName = Object.fromEntries(occurrences.map((o) => [o.name, o.date]));

  assert.equal(byName["Сентябрьская"].getMonth(), 8); // September (0-based)
  assert.equal(byName["Сентябрьская"].getDate(), 16);
  assert.equal(byName["Октябрьская"].getMonth(), 9); // October
  assert.equal(byName["Октябрьская"].getDate(), 1);
});

test("reports progress once per scanned month", async () => {
  globalThis.Date = FixedDate;
  buildCalendar([
    [{ day: 16, name: "A", time: "10:00" }],
    [{ day: 16, name: "B", time: "10:00" }],
    [],
  ]);

  const seen = [];
  await scanSemester((m) => seen.push(m));

  assert.deepEqual(seen, [1, 2, 3]);
});

test("waits for a month heading that takes longer than three seconds", async (t) => {
  globalThis.Date = FixedDate;
  buildCalendar([
    [{ day: 16, name: "September", time: "10:00" }],
    [{ day: 1, name: "October", time: "11:00" }],
    [],
  ], { labelDelay: 3500, lessonDelay: 3500 });

  const result = await withMockTimers(t, () => scanSemester(() => {}));
  assert.equal(result.monthsScanned, 3);
  assert.deepEqual(result.occurrences.map((o) => [o.name, o.date.getMonth()]), [
    ["September", 8], ["October", 9],
  ]);
});

for (const keepPrevious of [false, true]) {
  test(`waits for lessons after the heading changes (keep previous: ${keepPrevious})`, async (t) => {
    globalThis.Date = FixedDate;
    buildCalendar([
      [{ day: 16, name: "September", time: "10:00" }],
      [{ day: 1, name: "October", time: "11:00" }],
      [],
    ], { lessonDelay: 12_500, keepPrevious });

    const result = await withMockTimers(t, () => scanSemester(() => {}));
    assert.equal(result.monthsScanned, 3);
    assert.deepEqual(result.occurrences.map((o) => [o.name, o.date.getMonth()]), [
      ["September", 8], ["October", 9],
    ]);
  });
}

test("waits for lessons after resetting to today", async (t) => {
  globalThis.Date = FixedDate;
  buildCalendar([[{ day: 16, name: "September", time: "10:00" }], []], { todayDelay: 2000 });
  const result = await withMockTimers(t, () => scanSemester(() => {}));
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.monthsScanned, 2);
});

test("rejects a stuck month transition and restores today instead of returning a partial scan", async (t) => {
  globalThis.Date = FixedDate;
  const state = buildCalendar([[{ day: 16, name: "September", time: "10:00" }]]);
  const next = document.querySelector(".nav-next");
  next.replaceWith(next.cloneNode(true)); // No navigation handler.

  await assert.rejects(withMockTimers(t, () => scanSemester(() => {})), /месяц/i);
  assert.equal(state.todayClicks, 2);
});

test("accepts identical lesson markup in consecutive months and respects the scan limit", async (t) => {
  globalThis.Date = FixedDate;
  const lesson = [{ day: 16, name: "Same lesson", time: "10:00" }];
  buildCalendar([lesson, lesson]);
  let nextClicks = 0;
  document.querySelector(".nav-next").addEventListener("click", () => nextClicks++);

  const result = await withMockTimers(t, () => scanSemester(() => {}, 2));
  assert.deepEqual(result.occurrences.map((o) => o.date.getMonth()), [8, 9]);
  assert.equal(result.monthsScanned, 2);
  assert.equal(nextClicks, 1);
});

test("rejects a missing calendar rather than treating it as an empty month", async (t) => {
  globalThis.Date = FixedDate;
  const state = buildCalendar([[{ day: 16, name: "September", time: "10:00" }]]);
  document.querySelector(".el-calendar-table").remove();

  await assert.rejects(withMockTimers(t, () => scanSemester(() => {})), /загрузки/i);
  assert.equal(state.todayClicks, 2);
});

test("reads an already loaded empty month without advancing any timers", async (t) => {
  globalThis.Date = FixedDate;
  buildCalendar([[]]);
  document.body.insertAdjacentHTML("beforeend", '<div class="b-overlay-wrap" aria-busy="true"></div>');
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = await scanSemester(() => {});
  assert.equal(result.monthsScanned, 1);
  assert.deepEqual(result.occurrences, []);
});

test("waits for busy state queued by the portal after a navigation click", async (t) => {
  globalThis.Date = FixedDate;
  buildCalendar([[{ day: 16, name: "September", time: "10:00" }], []]);
  const table = document.querySelector(".el-calendar-table");
  const overlay = table.closest(".b-overlay-wrap");
  let loaded = false;
  document.querySelector(".nav-next").addEventListener("click", () => {
    queueMicrotask(() => {
      overlay.setAttribute("aria-busy", "true");
      setTimeout(() => {
        loaded = true;
        overlay.setAttribute("aria-busy", "false");
      }, 1500);
    });
  });

  await withMockTimers(t, () => scanSemester((month) => {
    if (month === 2) assert.equal(loaded, true);
  }));
});

test("rejects a loader that never finishes even when the month heading changes", async (t) => {
  globalThis.Date = FixedDate;
  const state = buildCalendar([[{ day: 16, name: "September", time: "10:00" }], []]);
  document.querySelector(".nav-next").addEventListener("click", () => {
    document.querySelector(".el-calendar-table").closest(".b-overlay-wrap")
      .setAttribute("aria-busy", "true");
  });

  await assert.rejects(withMockTimers(t, () => scanSemester(() => {})), /загрузки/i);
  assert.equal(state.todayClicks, 2);
});

test("waits when the month changes before the loader starts", async (t) => {
  globalThis.Date = FixedDate;
  buildCalendar([[{ day: 16, name: "September", time: "10:00" }]]);
  const next = document.querySelector(".nav-next");
  const replacement = next.cloneNode(true);
  next.replaceWith(replacement);
  const table = document.querySelector(".el-calendar-table");
  const overlay = table.closest(".b-overlay-wrap");
  let month = 0;
  replacement.addEventListener("click", () => {
    month++;
    const headerOverlay = document.getElementById("dates").closest(".b-overlay-wrap");
    headerOverlay.setAttribute("aria-busy", "true");
    document.getElementById("dates").textContent = "M" + month;
    headerOverlay.setAttribute("aria-busy", "false");
    table.innerHTML = "";
    setTimeout(() => overlay.setAttribute("aria-busy", "true"), 100);
    setTimeout(() => {
      table.innerHTML = month === 1 ? dayCell(1, { name: "October", time: "11:00" }) : "";
      overlay.setAttribute("aria-busy", "false");
    }, 2000);
  });

  const result = await withMockTimers(t, () => scanSemester(() => {}));
  assert.equal(result.monthsScanned, 3);
  assert.deepEqual(result.occurrences.map((o) => [o.name, o.date.getMonth()]), [
    ["September", 8], ["October", 9],
  ]);
});
