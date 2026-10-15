import { requestSchedule, type ScheduleResponse } from "./request";
import type { LessonOccurrence, ScanResult } from "./types";

const MONTHS_AHEAD = 5;

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function collectOccurrences(payload: ScheduleResponse, start: Date, end: Date): LessonOccurrence[] {
  const occurrences: LessonOccurrence[] = [];
  for (const day of payload.data) {
    const date = new Date(`${day.date}T00:00:00`);
    if (date < start || date > end) continue;
    for (const lesson of day.lessons) {
      occurrences.push({ date, name: lesson.name, startTime: lesson.startTime });
    }
  }
  return occurrences;
}

export async function scanSemester(): Promise<ScanResult> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + MONTHS_AHEAD + 1, 0);
  end.setDate(Math.min(start.getDate(), end.getDate()));

  console.info("[ITMO export] Загрузка расписания");
  const payload = await requestSchedule(formatDate(start), formatDate(end));
  const occurrences = collectOccurrences(payload, start, end);
  console.info("[ITMO export] Расписание загружено", { lessonCount: occurrences.length });
  return { occurrences, startDate: formatDate(start), endDate: formatDate(end) };
}
