import type { LessonOccurrence, Series } from "./types";
import { hashKey } from "./utils";

const LESSON_MINUTES = 90;

const TZID = "Europe/Moscow";
const MOSCOW_OFFSET_HOURS = 3;

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0300",
  "TZNAME:MSK",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

const pad = (n: number) => String(n).padStart(2, "0");

function formatLocalDateTime(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function formatUtcDateTime(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function moscowWallToUtc(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours() - MOSCOW_OFFSET_HOURS,
      date.getMinutes(),
      date.getSeconds(),
    ),
  );
}

function atTime(day: Date, startTime: string): Date {
  const [hours, minutes] = startTime.split(":").map(Number);
  const date = new Date(day);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    limit = 74;
  }
  return chunks.join("\r\n ");
}

function groupSeries(occurrences: LessonOccurrence[]): Series[] {
  const seriesByKey = new Map<string, Series>();
  for (const occurrence of occurrences) {
    const weekday = occurrence.date.getDay();
    const key = `${occurrence.name}||${weekday}||${occurrence.startTime}`;
    let series = seriesByKey.get(key);
    if (!series) {
      series = { name: occurrence.name, startTime: occurrence.startTime, dates: [] };
      seriesByKey.set(key, series);
    }
    series.dates.push(occurrence.date);
  }
  const allSeries = [...seriesByKey.values()];
  for (const series of allSeries) series.dates.sort((a, b) => a.getTime() - b.getTime());
  return allSeries;
}

const DAY_MS = 86_400_000;

function uniformIntervalDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const intervalDays = Math.round((dates[1].getTime() - dates[0].getTime()) / DAY_MS);
  if (intervalDays !== 7 && intervalDays !== 14) return null;
  for (let i = 2; i < dates.length; i++) {
    const gap = Math.round((dates[i].getTime() - dates[i - 1].getTime()) / DAY_MS);
    if (gap !== intervalDays) return null;
  }
  return intervalDays;
}

function buildEvent(series: Series, timestamp: string): string {
  const weekday = series.dates[0].getDay();
  const uid = `itmo-${hashKey(`${series.name}|${weekday}|${series.startTime}`)}@itmo-schedule-export`;
  const start = atTime(series.dates[0], series.startTime);
  const end = new Date(start.getTime() + LESSON_MINUTES * 60_000);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${timestamp}`,
    `DTSTART;TZID=${TZID}:${formatLocalDateTime(start)}`,
    `DTEND;TZID=${TZID}:${formatLocalDateTime(end)}`,
    `SUMMARY:${escapeText(series.name)}`,
  ];

  if (series.dates.length > 1) {
    const interval = uniformIntervalDays(series.dates);
    if (interval) {
      const lastStart = atTime(series.dates[series.dates.length - 1], series.startTime);
      lines.push(
        `RRULE:FREQ=WEEKLY;INTERVAL=${interval / 7};UNTIL=${formatUtcDateTime(moscowWallToUtc(lastStart))}`,
      );
    } else {
      const recurrenceDates = series.dates
        .slice(1)
        .map((date) => formatLocalDateTime(atTime(date, series.startTime)))
        .join(",");
      lines.push(`RDATE;TZID=${TZID}:${recurrenceDates}`);
    }
  }

  lines.push("END:VEVENT");
  return lines.map(foldLine).join("\r\n");
}

export function buildIcs(occurrences: LessonOccurrence[]): string {
  const timestamp = formatUtcDateTime(new Date());
  const series = groupSeries(occurrences);
  const events = series.map((series) => buildEvent(series, timestamp));

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//itmo-schedule-export//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    VTIMEZONE,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
