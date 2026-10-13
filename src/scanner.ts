import type { LessonOccurrence, ScanResult } from "./types";

const SCHEDULE_URL = "https://my.itmo.ru/api/schedule/schedule/personal";
const MONTHS_AHEAD = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const AUTH_ERROR = "Сессия недоступна. Обновите страницу или войдите в my.itmo.ru заново";
const RESPONSE_ERROR = "Некорректный ответ API расписания";

interface ScheduleResponse {
  code: number;
  data: { date: string; lessons: {
    subject: string | null;
    subject_id?: number | null;
    group?: string | null;
    time_start: string;
  }[] }[];
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readAuthorization(): string {
  const authorization = window.localStorage.getItem("auth._token.itmoId")?.trim() ?? "";
  const token = authorization.slice(6).trim();
  const hasBearerPrefix = authorization.slice(0, 6).toLowerCase() === "bearer"
    && authorization[6]?.trim() === "";
  const hasWhitespace = [...token].some((character) => character.trim() === "");
  if (!hasBearerPrefix || !token || hasWhitespace) throw new Error(AUTH_ERROR);
  return authorization;
}

function isStartTime(value: string): boolean {
  if (value.length !== 5) return false;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23
    || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return false;
  return value === `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseSchedule(payload: ScheduleResponse, start: Date, end: Date): LessonOccurrence[] {
  if (!payload || payload.code !== 0 || !Array.isArray(payload.data)) {
    throw new Error(RESPONSE_ERROR);
  }

  const occurrences: LessonOccurrence[] = [];
  for (const day of payload.data) {
    if (!day || typeof day.date !== "string" || day.date.length !== 10
      || !Array.isArray(day.lessons)) throw new Error(RESPONSE_ERROR);
    const date = new Date(`${day.date}T00:00:00`);
    if (formatDate(date) !== day.date) throw new Error(RESPONSE_ERROR);
    if (date < start || date > end) continue;

    for (const lesson of day.lessons) {
      if (!lesson || (lesson.subject !== null && typeof lesson.subject !== "string")
        || typeof lesson.time_start !== "string" || !isStartTime(lesson.time_start)) {
        throw new Error(RESPONSE_ERROR);
      }
      const name = lesson.subject?.trim()
        || (typeof lesson.group === "string" ? lesson.group.trim() : "")
        || (typeof lesson.subject_id === "number" && Number.isSafeInteger(lesson.subject_id)
          && lesson.subject_id > 0 ? `Предмет ${lesson.subject_id}` : "");
      if (!name) throw new Error(RESPONSE_ERROR);
      occurrences.push({ date, name, startTime: lesson.time_start });
    }
  }
  return occurrences;
}

async function fetchRange(start: Date, end: Date): Promise<LessonOccurrence[]> {
  const authorization = readAuthorization();

  const url = new URL(SCHEDULE_URL);
  url.searchParams.set("date_start", formatDate(start));
  url.searchParams.set("date_end", formatDate(end));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: authorization, Accept: "application/json" },
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new Error(controller.signal.aborted
        ? "Истекло время ожидания API расписания"
        : "Не удалось загрузить расписание. Проверьте соединение и повторите экспорт");
    }
    if (response.status === 401 || response.status === 403) throw new Error(AUTH_ERROR);
    if (!response.ok) throw new Error(`Ошибка API расписания: HTTP ${response.status}`);

    let payload: ScheduleResponse;
    try {
      payload = await response.json();
    } catch {
      throw new Error(controller.signal.aborted
        ? "Истекло время ожидания API расписания"
        : RESPONSE_ERROR);
    }
    return parseSchedule(payload, start, end);
  } finally {
    clearTimeout(timeout);
  }
}

export async function scanSemester(): Promise<ScanResult> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + MONTHS_AHEAD + 1, 0);
  end.setDate(Math.min(start.getDate(), end.getDate()));

  console.info("[ITMO export] Загрузка расписания");
  const occurrences = await fetchRange(start, end);
  console.info("[ITMO export] Расписание загружено", { lessonCount: occurrences.length });
  return { occurrences, startDate: formatDate(start), endDate: formatDate(end) };
}
