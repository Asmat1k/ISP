import type { LessonOccurrence, ScanResult } from "./types";

const CALENDAR_LOAD_TIMEOUT_MS = 30_000;

function findButtonByText(text: string): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>("button.btn-schedule");
  for (const b of buttons) {
    if (b.textContent?.trim() === text) return b;
  }
  return null;
}

function nextMonthButton(): HTMLElement | null {
  const arrow = document.querySelector(".el-calendar-header-switch .icon-arrow-right");
  return (arrow?.closest("button") as HTMLElement) ?? null;
}

function datesLabel(): string {
  return document.getElementById("dates")?.textContent?.trim() ?? "";
}

function waitForCalendar(action: () => void, previousMonth?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const initialMonth = datesLabel();
    let loadingStarted = false;
    const observer = new MutationObserver((records) => queueMicrotask(() => check(records)));
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Не удалось дождаться загрузки месяца расписания"));
    }, CALENDAR_LOAD_TIMEOUT_MS);

    function check(records: MutationRecord[] = []): void {
      const header = document.querySelector(".el-calendar-header-switch");
      const table = document.querySelector(".el-calendar-table");
      if (!header || !table) return;

      const overlays = [header, table].map((el) => el.closest(".b-overlay-wrap"));
      const isLoading = overlays.some((el) => el?.getAttribute("aria-busy") === "true");
      const tableOverlay = overlays[1];
      loadingStarted ||= tableOverlay?.getAttribute("aria-busy") === "true" || records.some((record) =>
        record.oldValue === "true" && record.target === tableOverlay,
      );

      const currentMonth = datesLabel();
      if (!currentMonth || currentMonth === previousMonth || isLoading) return;
      const changedMonth = previousMonth !== undefined || currentMonth !== initialMonth;
      if (changedMonth && !loadingStarted) return;

      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-busy"],
      attributeOldValue: true,
    });
    try {
      action();
      queueMicrotask(check);
    } catch (error) {
      observer.disconnect();
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function scrapeMonth(year: number, month: number): LessonOccurrence[] {
  const out: LessonOccurrence[] = [];
  const lessons = document.querySelectorAll<HTMLElement>(
    '.el-calendar-table [id^="lesson-"]',
  );
  for (const el of lessons) {
    const cell = el.closest(".day-cell");
    const cellDate = cell?.querySelector(".cell-date");
    if (!cellDate || cellDate.classList.contains("text-gray-40")) continue;

    const day = parseInt(cellDate.textContent?.trim() ?? "", 10);
    if (!Number.isFinite(day)) continue;

    const name = el.querySelector(".item-name")?.textContent?.trim() ?? "";
    const startTime = el.querySelector(".item-time")?.textContent?.trim() ?? "";
    if (!name || !/^\d{1,2}:\d{2}$/.test(startTime)) continue;

    out.push({ date: new Date(year, month, day), name, startTime });
  }
  return out;
}

export async function scanSemester(
  onProgress: (month: number) => void,
  maxMonths = 5,
): Promise<ScanResult> {
  const anchor = new Date();
  let year = anchor.getFullYear();
  let month = anchor.getMonth();

  const collected: LessonOccurrence[] = [];
  let monthsScanned = 0;

  try {
    await waitForCalendar(() => findButtonByText("Сегодня")?.click());
    for (let i = 0; i < maxMonths; i++) {
      const monthLessons = scrapeMonth(year, month);
      monthsScanned++;
      onProgress(monthsScanned);
      collected.push(...monthLessons);
      if (monthLessons.length === 0 || monthsScanned === maxMonths) break;

      const prev = datesLabel();
      const next = nextMonthButton();
      if (!next) throw new Error("Не найдена кнопка переключения месяца");
      await waitForCalendar(() => next.click(), prev);

      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
    }
  } finally {
    findButtonByText("Сегодня")?.click();
  }

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const occurrences = collected.filter((o) => o.date >= todayMidnight);

  return { occurrences, monthsScanned };
}
