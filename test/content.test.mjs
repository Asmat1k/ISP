import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadBundle,
  installDom,
  FixedDate,
  previewOverlay,
  clickPreviewButton,
  waitFor,
  mockSchedule,
  scheduleDay,
  apiLesson,
} from "./helpers.mjs";

const RealDate = globalThis.Date;
const RealBlob = globalThis.Blob;
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
    <div class="b-overlay-wrap" aria-busy="false"><div class="wrapper"><div class="el-calendar-table"></div></div></div>
  </body></html>`;
}

function setActiveView(view) {
  const radios = document.getElementById("btn-radios-1");
  for (const label of radios.querySelectorAll("label")) {
    const isTarget = label.querySelector("input").value === view;
    label.classList.toggle("active", isTarget);
  }
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

afterEach(() => {
  globalThis.Date = RealDate;
  globalThis.Blob = RealBlob;
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
  assert.equal(btn.textContent, "Экспорт");
  assert.ok(btn.className.includes("btn-primary"));
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

test("in week view the button also permits API export", () => {
  installDom(headerHtml("week"));
  ensureButton();
  const btn = exportBtn();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, "Экспорт");
});

test("in month view the button is enabled and invites export", () => {
  installDom(headerHtml("month"));
  ensureButton();
  const btn = exportBtn();
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, "Экспорт");
});

test("switching views keeps the button enabled", () => {
  installDom(headerHtml("week"));
  ensureButton();
  assert.equal(exportBtn().disabled, false);

  setActiveView("month");
  ensureButton();
  assert.equal(exportBtn().disabled, false);
  assert.equal(exportBtn().textContent, "Экспорт");
});

test("export in week view loads the API and downloads only after confirmation", async (t) => {
  installDom(headerHtml("week"));
  document.querySelector(".el-calendar-table").remove();
  const todayClick = t.mock.fn();
  const nextClick = t.mock.fn();
  document.querySelector("button.btn-schedule").addEventListener("click", todayClick);
  document.querySelector(".nav-next").addEventListener("click", nextClick);
  globalThis.Date = FixedDate;
  recordTimers();

  let downloaded = null;
  globalThis.Blob = class {
    constructor(parts) {
      this.parts = parts;
    }
  };
  t.mock.method(URL, "createObjectURL", (blob) => {
    downloaded = blob.parts.join("");
    return "blob:fake";
  });
  t.mock.method(URL, "revokeObjectURL", () => {});

  const fetch = mockSchedule(t, [
    scheduleDay("2026-09-16", [apiLesson("Базы данных", "18:50")]),
    scheduleDay("2026-10-01", [apiLesson("Сети", "12:00")]),
  ]);

  ensureButton();
  exportBtn().click();

  await waitFor(() => previewOverlay(), { timeout: 15_000 });
  assert.ok(previewOverlay(), "a preview modal appeared after loading");
  assert.ok(previewOverlay().textContent.includes("Нашёл 2 занятий, 2 предметов"));
  assert.ok(previewOverlay().textContent.includes("Период: 2026-09-15 — 2027-02-15"));
  assert.equal(downloaded, null, "nothing downloads before confirming");

  clickPreviewButton("Скачать .ics");

  await waitFor(() => downloaded !== null);

  assert.ok(downloaded, "an .ics file was produced");
  assert.ok(downloaded.includes("BEGIN:VCALENDAR"));
  assert.ok(downloaded.includes("SUMMARY:Базы данных"));
  assert.ok(downloaded.includes("SUMMARY:Сети"));
  assert.equal(downloaded.split("BEGIN:VEVENT").length - 1, 2);
  assert.equal(previewOverlay(), null, "modal closes after confirming");
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(exportBtn().textContent, "Готово: 2 занятий");
  assert.equal(todayClick.mock.callCount(), 0);
  assert.equal(nextClick.mock.callCount(), 0);
});

test("cancelling the preview aborts the export without downloading", async (t) => {
  globalThis.Date = FixedDate;
  recordTimers();

  let downloaded = null;
  globalThis.Blob = class {
    constructor(parts) {
      this.parts = parts;
    }
  };
  t.mock.method(URL, "createObjectURL", (blob) => {
    downloaded = blob.parts.join("");
    return "blob:fake";
  });
  t.mock.method(URL, "revokeObjectURL", () => {});

  mockSchedule(t, [scheduleDay("2026-09-16", [apiLesson("Базы данных", "18:50")])]);

  ensureButton();
  exportBtn().click();

  await waitFor(() => previewOverlay(), { timeout: 15_000 });
  clickPreviewButton("Отмена");

  await waitFor(() => exportBtn().textContent === "Экспорт отменён");

  assert.equal(downloaded, null, "no file is produced on cancel");
  assert.equal(previewOverlay(), null, "modal closes on cancel");
  assert.equal(exportBtn().textContent, "Экспорт отменён");
});

test("on failure it reports the error without obsolete DOM diagnostics", async (t) => {
  globalThis.Date = FixedDate;
  recordTimers();

  globalThis.Blob = class {
    constructor(parts) {
      this.parts = parts;
    }
  };
  t.mock.method(URL, "createObjectURL", () => {
    throw new Error("boom");
  });
  t.mock.method(URL, "revokeObjectURL", () => {});

  const realError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);

  try {
    mockSchedule(t, [scheduleDay("2026-09-16", [apiLesson("Будущая пара", "10:00")])]);

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
    assert.ok(exportBtn().title.includes("boom"));
  } finally {
    console.error = realError;
  }
});

for (const action of ["Скачать .ics", "Отмена", "empty"]) {
  test(`logs export actions without private data: ${action}`, async (t) => {
    globalThis.Date = FixedDate;
    recordTimers();
    const info = t.mock.method(console, "info", () => {});
    t.mock.method(URL, "createObjectURL", () => "blob:fake");
    t.mock.method(URL, "revokeObjectURL", () => {});
    t.mock.method(window.HTMLAnchorElement.prototype, "click", () => {});
    mockSchedule(t, action === "empty" ? [] : [
      scheduleDay("2026-09-16", [apiLesson("Private subject")]),
    ]);
    window.localStorage.setItem("auth._token.itmoId", "Bearer private-token");

    ensureButton();
    ensureButton();
    exportBtn().click();
    if (action !== "empty") {
      assert.ok(await waitFor(() => previewOverlay()));
      clickPreviewButton(action);
    }
    assert.ok(await waitFor(() => !exportBtn().textContent.startsWith("Загрузка")));

    const messages = info.mock.calls.map(({ arguments: args }) => args[0]);
    assert.equal(messages.filter(message => message === "[ITMO export] Кнопка экспорта добавлена").length, 1);
    assert.ok(messages.includes("[ITMO export] Экспорт начат"));
    assert.ok(messages.includes("[ITMO export] Загрузка расписания"));
    assert.ok(messages.includes("[ITMO export] Расписание загружено"));
    if (action === "empty") {
      assert.ok(messages.includes("[ITMO export] Занятия не найдены"));
      assert.equal(messages.includes("[ITMO export] Предпросмотр открыт"), false);
    } else {
      assert.ok(messages.includes("[ITMO export] Предпросмотр открыт"));
      const outcome = action === "Отмена" ? "Экспорт отменён" : "Скачивание .ics запущено";
      assert.equal(messages.at(-1), `[ITMO export] ${outcome}`);
    }
    if (action !== "Скачать .ics") {
      assert.equal(messages.includes("[ITMO export] Скачивание .ics запущено"), false);
    }
    const logs = JSON.stringify(info.mock.calls.map(call => call.arguments));
    for (const privateValue of ["private-token", "Private subject", "Authorization", "time_start"]) {
      assert.equal(logs.includes(privateValue), false);
    }
  });
}
