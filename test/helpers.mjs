import { build } from "esbuild";
import { JSDOM } from "jsdom";

const realSetTimeout = globalThis.setTimeout;

export async function withMockTimers(t, run) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const result = run();
  result.then(() => { settled = true; }, () => { settled = true; });
  for (let elapsed = 0; !settled && elapsed < 120_000; elapsed += 100) {
    t.mock.timers.tick(100);
    await new Promise(setImmediate);
  }
  if (!settled) throw new Error("Operation did not finish within two simulated minutes");
  return result;
}

export const PREVIEW_OVERLAY_ID = "itmo-ics-preview-overlay";

export const previewOverlay = () => document.getElementById(PREVIEW_OVERLAY_ID);

export function clickPreviewButton(label) {
  [...previewOverlay().querySelectorAll("button")]
    .find((b) => b.textContent === label)
    .click();
}

export async function waitFor(predicate, { timeout = 5000, step = 50 } = {}) {
  for (let waited = 0; waited < timeout && !predicate(); waited += step) {
    await new Promise((r) => realSetTimeout(r, step));
  }
  return predicate();
}

export async function loadBundle(relPath) {
  const entry = new URL(relPath, import.meta.url).pathname;
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const code = result.outputFiles[0].text;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

export function installDom(html = "<!doctype html><html><body></body></html>") {
  const dom = new JSDOM(html, { url: "https://my.itmo.ru/schedule" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
}

export function scheduleDay(date, lessons = []) {
  return { date, day_number: 1, week_number: 6, note: null, type: null, lessons, intersections: [] };
}

export function apiLesson(subject = "Базы данных", time_start = "17:10") {
  return { subject, time_start, time_end: "18:40", pair_id: 123, subject_id: 456,
    note: null, type: "Лекции", teacher_id: null, teacher_name: null, room: null,
    building: null, format: "Дистанционный", work_type: "Лекции", work_type_id: 1,
    group: "Test", flow_type_id: 2, flow_id: 789, zoom_url: null, zoom_password: null,
    zoom_info: null, bld_id: null, format_id: 3, main_bld_id: null };
}

export function mockSchedule(t, days) {
  window.localStorage.setItem("auth._token.itmoId", "Bearer test-token");
  return t.mock.method(globalThis, "fetch", async () =>
    Response.json({ code: 0, data: days }));
}

export class FixedDate extends Date {
  static fixed = new Date("2026-09-15T12:00:00").getTime();
  constructor(...args) {
    if (args.length === 0) super(FixedDate.fixed);
    else super(...args);
  }
  static now() {
    return FixedDate.fixed;
  }
}
