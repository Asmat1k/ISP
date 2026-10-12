import { buildIcs } from "./ics";
import { scanSemester } from "./scanner";
import { showPreview, summarize } from "./preview";

const BUTTON_ID = "itmo-ics-export-btn";
const EXPORT_LABEL = "Экспорт";
const WEEK_VIEW_LABEL = "Доступно в виде «Месяц»";

function isWeekView(): boolean {
  const active = document.querySelector<HTMLInputElement>(
    "#btn-radios-1 label.active input",
  );
  return active?.value === "week";
}

function applyViewState(btn: HTMLButtonElement): void {
  if (btn.dataset.busy === "1") return;
  if (isWeekView()) {
    btn.disabled = true;
    btn.textContent = WEEK_VIEW_LABEL;
  } else {
    btn.disabled = false;
    btn.textContent = EXPORT_LABEL;
  }
}

function logDiagnostics(error: unknown): void {
  const has = (sel: string) => !!document.querySelector(sel);
  const hasToday = [...document.querySelectorAll("button.btn-schedule")].some(
    (b) => b.textContent?.trim() === "Сегодня",
  );
  console.error("[ITMO export] Ошибка экспорта:", error);
  console.error("[ITMO export] Диагностика DOM:", {
    headerSwitch: has(".el-calendar-header-switch"),
    toggle: has("#btn-radios-1"),
    todayButton: hasToday,
    nextButton: has(".el-calendar-header-switch .icon-arrow-right"),
    datesLabel: document.getElementById("dates")?.textContent?.trim() ?? null,
    lessonsInView: document.querySelectorAll('.el-calendar-table [id^="lesson-"]').length,
    view: isWeekView() ? "week" : "month",
  });
}

function downloadIcs(content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "itmo-schedule.ics";
  a.click();
  URL.revokeObjectURL(url);
}

async function onExport(btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.busy === "1" || isWeekView()) return;
  btn.dataset.busy = "1";
  btn.disabled = true;
  try {
    const { occurrences, monthsScanned } = await scanSemester((m) => {
      btn.textContent = `Сканирование… (${m})`;
    });

    if (occurrences.length === 0) {
      btn.textContent = "Занятия не найдены";
    } else if (!(await showPreview(summarize(occurrences, monthsScanned)))) {
      btn.textContent = "Экспорт отменён";
    } else {
      downloadIcs(buildIcs(occurrences));
      btn.textContent = `Готово: ${occurrences.length} занятий (${monthsScanned} мес.)`;
    }
  } catch (e) {
    logDiagnostics(e);
    btn.textContent = "Ошибка экспорта";
  } finally {
    setTimeout(() => {
      btn.dataset.busy = "0";
      applyViewState(btn);
    }, 4000);
  }
}

function createButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.className = "btn btn-primary btn-sm";
  btn.textContent = EXPORT_LABEL;
  btn.addEventListener("click", () => void onExport(btn));
  return btn;
}

function ensureButton(): void {
  const toggle = document.getElementById("btn-radios-1");
  const group = toggle?.parentElement;
  if (!group) return;
  let btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!btn) {
    group.style.display = "flex";
    group.style.alignItems = "center";
    group.style.gap = "8px";
    btn = createButton();
    group.appendChild(btn);
  }
  applyViewState(btn);
}

ensureButton();
setInterval(ensureButton, 1000);
