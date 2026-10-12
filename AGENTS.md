# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3), named **ISP (Itmo Schedule Parser)**, that
scrapes the schedule page in the ITMO student portal (`my.itmo.ru`) and exports
it as an `.ics` file for import into Google Calendar. There is no backend and no
API — everything runs as one content script that reads the rendered DOM. UI
strings are in Russian; see [README.md](README.md) for end-user instructions.

## Commands

```bash
npm install        # first time only
npm run build      # tsc --noEmit (type-check) + vite build → dist/
npm test           # node --test, runs all *.test.mjs in test/
node --test test/ics.test.mjs   # run a single test file
```

`npm run build` bundles `src/content.ts` into `dist/content.js` (a single IIFE)
and copies everything in `public/` — `manifest.json` and `icons/` — to `dist/`
as-is. Load `dist/` (not the repo root) via `chrome://extensions` → Developer
mode → Load unpacked. The version lives in both `package.json` and
`public/manifest.json` and is kept in sync by hand.

## Architecture

Content script `src/content.ts` orchestrates the rest; the flow is
scan → preview → build. Modules in `src/` (`types.ts` holds shared interfaces):

- **[src/content.ts](src/content.ts)** — entry point declared in the manifest.
  Injects the "Экспорт в Google Calendar" button next to the calendar's
  Week/Month toggle, re-adding it every 1s via `setInterval(ensureButton)`
  because the SPA re-renders. Disabled in Week view (export only works in Month
  view). On click: `scanSemester` → `showPreview(summarize(...))` → and only if
  the user confirms, builds the `.ics` and triggers a Blob download.
  `logDiagnostics` dumps DOM selector presence to the console on failure — the
  scraper depends on ITMO's markup, so this is the first place to look when
  export breaks.

- **[src/scanner.ts](src/scanner.ts)** — `scanSemester` walks the calendar
  forward month by month: clicks "Сегодня" to reset, scrapes lessons from the
  DOM (`[id^="lesson-"]` cells, skipping greyed-out adjacent-month days via the
  `text-gray-40` class), clicks the next-month arrow, and waits for the `#dates`
  label to change (`waitForMonthChange`). Stops at the first empty month or
  `maxMonths` (10). Filters to occurrences from today onward.

- **[src/preview.ts](src/preview.ts)** — `summarize` (pure: counts lessons,
  carries `monthsScanned`, groups occurrences by subject) feeds `showPreview`,
  which renders a confirmation modal (counts + scanned months + subject list)
  and returns a `Promise<boolean>` — `true` on "Скачать .ics", `false` on
  "Отмена" or backdrop click. Nothing downloads until this resolves true.

- **[src/ics.ts](src/ics.ts)** — pure functions, no DOM. `buildIcs` groups
  occurrences into series by `(name, weekday, startTime)` and emits one VEVENT
  per series. A uniform 7- or 14-day gap becomes an `RRULE` (weekly /
  bi-weekly); anything irregular falls back to explicit `RDATE`s. Handles
  RFC 5545 details: `Europe/Moscow` VTIMEZONE, 75-byte UTF-8-safe line folding,
  text escaping, and stable UIDs (via `hashKey`).

- **[src/utils.ts](src/utils.ts)** — generic, module-agnostic helpers only:
  `sleep` and `hashKey` (FNV-1a). Add shared, non-domain utilities here rather
  than re-declaring them per module.

### Key constraints from the data source

The ITMO DOM exposes only **subject name and start time** — no instructor,
room, or end time. Lesson duration is therefore hardcoded as
`LESSON_MINUTES = 90` in [src/ics.ts](src/ics.ts). Moscow is treated as a fixed
+03:00 offset (no DST). When the scraper breaks, it is almost always because
ITMO changed a class name or DOM structure that `scanner.ts`/`content.ts`
query — update the selectors there.

## Testing notes

Tests are plain `.mjs` using `node:test`. They bundle the TS source in-memory
with esbuild via `loadBundle` in [test/helpers.mjs](test/helpers.mjs) (no
separate build step) and run against a `jsdom` DOM — bundling (not single-file
transpile) is required because the modules import each other (e.g. `ics.ts`
imports `utils.ts`). `helpers.mjs` is the shared toolbox: `installDom`,
`FixedDate` (pins "now" to 2026-09-15 for deterministic dates), `waitFor`, and
the preview-modal helpers `previewOverlay` / `clickPreviewButton`. The
`scanner`/`content` tests build fake ITMO calendar markup to exercise scraping
without the live site. Put reusable test helpers in `helpers.mjs`, not inline.

## Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
