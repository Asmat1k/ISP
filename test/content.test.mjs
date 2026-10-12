import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadBundle,
  installDom,
  FixedDate,
  previewOverlay,
  clickPreviewButton,
  waitFor,
} from "./helpers.mjs";

const RealDate = globalThis.Date;
const realSetInterval = globalThis.setInterval;
const realSetTimeout = globalThis.setTimeout;

let ensureButton;
const pendingTimers = [];

function headerHtml(view = "month") {
  const active = (v) => (v === view ? " active" : "");
  return `<!doctype html><html><body>
    <div class="el-calendar-header-switch">
      <button class="btn-schedule">Сегодня</button>
      <a id="dates">init</a>
      <button class="nav-next"><span class="icon icon-arrow-right"></span></button>
      <div class="toggle-wrap"><div id="btn-radios-1">
        <label class="btn${active("week")}"><input type="radio" value="week"><span>Неделя</span></label>
        <label class="btn${active("month")}"><input type="radio" value="month"><span>Месяц</span></label>
      </div></div>
    </div>
    <div class="wrapper"><div class="el-calendar-table"></div></div>
  </body></html>`;
}

function setActiveView(view) {
  const radios = document.getElementById("btn-radios-1");
  for (const label of radios.querySelectorAll("label")) {
    const isTarget = label.querySelector("input").value === view;
    label.classList.toggle("active", isTarget);
  }
}

// Wires month navigation onto the header so scanSemester can drive a real scan.
function setupCalendar(months) {
  const table = document.querySelector(".el-calendar-table");
  const dates = document.getElementById("dates");
  const render = (i) => {
    const month = months[i] ?? [];
    table.innerHTML = month
      .map(
        (l) => `<div class="day-cell"><div class="el-calendar-cell-content">
          <div class="cell-date"><div>${l.day}</div></div>
          <div><div><div id="lesson-${l.day}" class="el-calendar-month-item">
            <div class="item-name">${l.name}</div>
            <div class="item-time">${l.time}</div>
          </div></div></div></div></div>`,
      )
      .join("");
    dates.textContent = "M" + i;
  };
  let idx = 0;
  document.querySelector("button.btn-schedule").addEventListener("click", () => {
    idx = 0;
    render(0);
  });
  document.querySelector(".nav-next").addEventListener("click", () => {
    idx++;
    render(idx);
  });
}

function recordTimers() {
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const id = realSetTimeout(fn, ms, ...rest);
    pendingTimers.push(id);
    return id;
  };
}

before(async () => {
  globalThis.setInterval = (fn) => {
    ensureButton = fn;
    return 0;
  };
  installDom(headerHtml());
  await loadBundle("../src/content.ts");
  globalThis.setInterval = realSetInterval;
});

beforeEach(() => {
  installDom(headerHtml());
});

after(() => {
  globalThis.Date = RealDate;
  globalThis.setTimeout = realSetTimeout;
  pendingTimers.forEach((id) => clearTimeout(id));
});

const exportBtn = () => document.getElementById("itmo-ics-export-btn");

test("injects the export button next to the Неделя/Месяц toggle", () => {
  ensureButton();
  const btn = exportBtn();
  assert.ok(btn);
  assert.equal(btn.textContent, "Экспорт в Google Calendar");
  assert.match(btn.className, /btn-primary/);
  assert.equal(btn.parentElement, document.getElementById("btn-radios-1").parentElement);
});

test("lays the toggle and button in a row at the right edge", () => {
  ensureButton();
  const wrap = document.getElementById("btn-radios-1").parentElement;
  assert.equal(wrap.style.display, "flex");
  assert.equal(wrap.style.alignItems, "center");
  assert.ok(wrap.style.gap);
});

test("never injects a second button", () => {
  ensureButton();
  ensureButton();
  ensureButton();
  assert.equal(document.querySelectorAll("#itmo-ics-export-btn").length, 1);
});

test("does nothing when the toggle is absent", () => {
  installDom("<!doctype html><html><body><div>no toolbar</div></body></html>");
  ensureButton();
  assert.equal(exportBtn(), null);
});

test("in week view the button is disabled and shows a hint", () => {
  installDom(headerHtml("week"));
  ensureButton();
  const btn = exportBtn();
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, "Доступно в виде «Месяц»");
});

test("in month view the button is enabled and invites export", () => {
  installDom(headerHtml("month"));
  ensureButton();
  const btn = exportBtn();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, "Экспорт в Google Calendar");
});

test("switching from week to month re-enables the button", () => {
  installDom(headerHtml("week"));
  ensureButton();
  assert.equal(exportBtn().disabled, true);

  setActiveView("month");
  ensureButton();
  assert.equal(exportBtn().disabled, false);
  assert.equal(exportBtn().textContent, "Экспорт в Google Calendar");
});

test("clicking export scans the schedule and downloads a valid .ics", async () => {
  globalThis.Date = FixedDate;
  recordTimers();

  let downloaded = null;
  globalThis.Blob = class {
    constructor(parts) {
      this.parts = parts;
    }
  };
  globalThis.URL = {
    createObjectURL: (blob) => {
      downloaded = blob.parts.join("");
      return "blob:fake";
    },
    revokeObjectURL: () => {},
  };

  setupCalendar([
    [{ day: 16, name: "Базы данных", time: "18:50" }],
    [{ day: 1, name: "Сети", time: "12:00" }],
    [],
  ]);

  ensureButton();
  exportBtn().click();

  await waitFor(() => previewOverlay(), { timeout: 15_000 });
  assert.ok(previewOverlay(), "a preview modal appeared after scanning");
  assert.match(previewOverlay().textContent, /Нашёл 2 занятий, 2 предметов/);
  assert.match(previewOverlay().textContent, /Просканировано: 3 мес\./);
  assert.equal(downloaded, null, "nothing downloads before confirming");

  clickPreviewButton("Скачать .ics");

  await waitFor(() => downloaded !== null);

  assert.ok(downloaded, "an .ics file was produced");
  assert.match(downloaded, /BEGIN:VCALENDAR/);
  assert.match(downloaded, /SUMMARY:Базы данных/);
  assert.match(downloaded, /SUMMARY:Сети/);
  assert.equal((downloaded.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal(previewOverlay(), null, "modal closes after confirming");
});

test("cancelling the preview aborts the export without downloading", async () => {
  globalThis.Date = FixedDate;
  recordTimers();

  let downloaded = null;
  globalThis.Blob = class {
    constructor(parts) {
      this.parts = parts;
    }
  };
  globalThis.URL = {
    createObjectURL: (blob) => {
      downloaded = blob.parts.join("");
      return "blob:fake";
    },
    revokeObjectURL: () => {},
  };

  setupCalendar([[{ day: 16, name: "Базы данных", time: "18:50" }], []]);

  ensureButton();
  exportBtn().click();

  await waitFor(() => previewOverlay(), { timeout: 15_000 });
  clickPreviewButton("Отмена");

  await waitFor(() => exportBtn().textContent === "Экспорт отменён");

  assert.equal(downloaded, null, "no file is produced on cancel");
  assert.equal(previewOverlay(), null, "modal closes on cancel");
  assert.equal(exportBtn().textContent, "Экспорт отменён");
});

test("on failure it logs DOM diagnostics to the console", async () => {
  globalThis.Date = FixedDate;
  recordTimers();

  globalThis.Blob = class {
    constructor(parts) {
      this.parts = parts;
    }
  };
  globalThis.URL = {
    createObjectURL: () => {
      throw new Error("boom");
    },
    revokeObjectURL: () => {},
  };

  const realError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);

  try {
    setupCalendar([[{ day: 16, name: "Будущая пара", time: "10:00" }], []]);

    ensureButton();
    exportBtn().click();

    await waitFor(() => previewOverlay(), { timeout: 15_000 });
    clickPreviewButton("Скачать .ics");

    await waitFor(() => exportBtn().textContent === "Ошибка экспорта");

    assert.equal(exportBtn().textContent, "Ошибка экспорта");
    assert.ok(
      calls.some((args) => String(args[0]).startsWith("[ITMO export]")),
      "logs a prefixed error line",
    );
    const dump = calls
      .map((args) => args[1])
      .find((a) => a && typeof a === "object" && "headerSwitch" in a);
    assert.ok(dump, "logs a diagnostics object");
    assert.equal(dump.view, "month");
    assert.equal(dump.lessonsInView, 1); // view restored to current month before the throw
    assert.equal(dump.toggle, true);
  } finally {
    console.error = realError;
  }
});
