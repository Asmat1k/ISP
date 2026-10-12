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
  const dom = new JSDOM(html);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
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
