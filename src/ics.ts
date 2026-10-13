import ICAL from "ical.js";
import type { LessonOccurrence, Series } from "./types";
import { hashKey } from "./utils";

const LESSON_MINUTES = 90;

const TZID = "Europe/Moscow";

ICAL.foldLength = 74;

function moscowTimezone(): ICAL.Timezone {
  const component = new ICAL.Component("vtimezone");
  component.addPropertyWithValue("tzid", TZID);
  const standard = new ICAL.Component("standard");
  standard.addPropertyWithValue("dtstart", ICAL.Time.fromDateTimeString("1970-01-01T00:00:00"));
  standard.addPropertyWithValue("tzoffsetfrom", ICAL.UtcOffset.fromString("+03:00"));
  standard.addPropertyWithValue("tzoffsetto", ICAL.UtcOffset.fromString("+03:00"));
  standard.addPropertyWithValue("tzname", "MSK");
  component.addSubcomponent(standard);
  return new ICAL.Timezone({ component, tzid: TZID });
}

function atTime(day: Date, startTime: string, zone: ICAL.Timezone): ICAL.Time {
  const [hour, minute] = startTime.split(":").map(Number);
  return ICAL.Time.fromData({
    year: day.getFullYear(),
    month: day.getMonth() + 1,
    day: day.getDate(),
    hour,
    minute,
    second: 0,
    isDate: false,
  }, zone);
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

function buildEvent(series: Series, timestamp: ICAL.Time, zone: ICAL.Timezone): ICAL.Component {
  const weekday = series.dates[0].getDay();
  const uid = `itmo-${hashKey(`${series.name}|${weekday}|${series.startTime}`)}@itmo-schedule-export`;
  const event = new ICAL.Event();
  event.uid = uid;
  event.component.addPropertyWithValue("dtstamp", timestamp);
  event.startDate = atTime(series.dates[0], series.startTime, zone);
  const end = event.startDate.clone();
  end.adjust(0, 0, LESSON_MINUTES, 0);
  event.endDate = end;
  event.summary = series.name;

  if (series.dates.length > 1) {
    const interval = uniformIntervalDays(series.dates);
    if (interval) {
      const lastStart = atTime(series.dates[series.dates.length - 1], series.startTime, zone);
      event.component.addPropertyWithValue("rrule", new ICAL.Recur({
        freq: "WEEKLY",
        interval: interval / 7,
        until: lastStart.convertToZone(ICAL.Timezone.utcTimezone),
      }));
    } else {
      const recurrenceDates = new ICAL.Property("rdate");
      recurrenceDates.setParameter("tzid", TZID);
      recurrenceDates.setValues(series.dates.slice(1).map((date) => atTime(date, series.startTime, zone)));
      event.component.addProperty(recurrenceDates);
    }
  }

  return event.component;
}

export function buildIcs(occurrences: LessonOccurrence[]): string {
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//itmo-schedule-export//RU");
  calendar.addPropertyWithValue("calscale", "GREGORIAN");
  calendar.addPropertyWithValue("method", "PUBLISH");
  const zone = moscowTimezone();
  calendar.addSubcomponent(zone.component);
  const timestamp = ICAL.Time.fromJSDate(new Date(), true);
  for (const series of groupSeries(occurrences)) {
    calendar.addSubcomponent(buildEvent(series, timestamp, zone));
  }
  return ICAL.stringify(calendar.toJSON());
}
