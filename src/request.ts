import { z } from "zod";

const SCHEDULE_URL = "https://my.itmo.ru/api/schedule/schedule/personal";
const REQUEST_TIMEOUT_MS = 30_000;
const AUTH_ERROR = "Сессия недоступна. Обновите страницу или войдите в my.itmo.ru заново";
const REQUEST_ERROR = "Некорректный запрос API расписания";
const RESPONSE_ERROR = "Некорректный ответ API расписания";

const authorizationSchema = z.string().trim().regex(/^Bearer[ \t]+\S+$/i);
const requestSchema = z.object({
  date_start: z.iso.date(),
  date_end: z.iso.date(),
}).refine(({ date_start, date_end }) => date_start <= date_end);

const lessonSchema = z.object({
  subject: z.string().nullable(),
  group: z.string().nullable().optional(),
  subject_id: z.number().int().safe().positive().nullable().optional(),
  time_start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).transform((lesson, context) => {
  const name = lesson.subject?.trim() || lesson.group?.trim()
    || (lesson.subject_id ? `Предмет ${lesson.subject_id}` : "");
  if (!name) {
    context.addIssue({ code: "custom", message: "Lesson has no name" });
    return z.NEVER;
  }
  return { name, startTime: lesson.time_start };
});

const responseSchema = z.object({
  code: z.literal(0),
  data: z.array(z.object({ date: z.iso.date(), lessons: z.array(lessonSchema) })),
});

export type ScheduleResponse = z.infer<typeof responseSchema>;

export async function requestSchedule(date_start: string, date_end: string): Promise<ScheduleResponse> {
  const authorization = authorizationSchema.safeParse(window.localStorage.getItem("auth._token.itmoId"));
  if (!authorization.success) throw new Error(AUTH_ERROR);
  const request = requestSchema.safeParse({ date_start, date_end });
  if (!request.success) throw new Error(REQUEST_ERROR);

  const url = new URL(SCHEDULE_URL);
  url.searchParams.set("date_start", request.data.date_start);
  url.searchParams.set("date_end", request.data.date_end);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: authorization.data, Accept: "application/json" },
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

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(controller.signal.aborted
        ? "Истекло время ожидания API расписания"
        : RESPONSE_ERROR);
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new Error(RESPONSE_ERROR);
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}
