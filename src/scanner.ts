import type { LessonOccurrence, ScanResult } from "./types";
import { sleep } from "./utils";

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

async function waitForMonthChange(prev: string, timeout = 10_000): Promise<void> {
  const step = 100;
  for (let waited = 0; waited < timeout; waited += step) {
    await sleep(step);
    if (datesLabel() && datesLabel() !== prev) return;
  }
  throw new Error("Не удалось переключить месяц расписания");
}

function calendarContent(): string | null {
  return document.querySelector(".el-calendar-table")?.innerHTML ?? null;
}

async function readMonth(year: number, month: number, previous: string | null): Promise<LessonOccurrence[]> {
  const step = 100;
  let lastContent = calendarContent();
  let stableFor = 0;
  for (let waited = 0; waited < 10_000; waited += step) {
    await sleep(step);
    const content = calendarContent();
    stableFor = content === lastContent ? stableFor + step : 0;
    lastContent = content;
    if (content === null || stableFor < 500 || content === previous) continue;

    const lessons = scrapeMonth(year, month);
    if (lessons.length > 0) return lessons;
  }
  if (lastContent === null || stableFor < 500) {
    throw new Error("Не удалось дождаться загрузки расписания");
  }
  return scrapeMonth(year, month);
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
  let previousContent = calendarContent();

  try {
    findButtonByText("Сегодня")?.click();
    for (let i = 0; i < maxMonths; i++) {
      const monthLessons = await readMonth(year, month, previousContent);
      monthsScanned++;
      onProgress(monthsScanned);
      collected.push(...monthLessons);
      if (monthLessons.length === 0 || monthsScanned === maxMonths) break;

      const prev = datesLabel();
      previousContent = calendarContent();
      const next = nextMonthButton();
      if (!next) throw new Error("Не найдена кнопка переключения месяца");
      next.click();
      await waitForMonthChange(prev);

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
