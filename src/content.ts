import { buildIcs } from "./ics";
import { scanSemester } from "./scanner";
import { showPreview, summarize } from "./preview";

const BUTTON_ID = "itmo-ics-export-btn";
const EXPORT_LABEL = "Экспорт";

function resetButton(button: HTMLButtonElement): void {
  if (button.dataset.busy === "1") return;
  button.disabled = false;
  button.textContent = EXPORT_LABEL;
}

function downloadIcs(content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "itmo-schedule.ics";
  link.click();
  URL.revokeObjectURL(url);
}

async function onExport(button: HTMLButtonElement): Promise<void> {
  if (button.dataset.busy === "1") return;
  button.dataset.busy = "1";
  button.disabled = true;
  button.title = "";
  button.textContent = "Загрузка…";
  console.info("[ITMO export] Экспорт начат");
  try {
    const schedule = await scanSemester();
    const { occurrences } = schedule;

    if (occurrences.length === 0) {
      button.textContent = "Занятия не найдены";
      console.info("[ITMO export] Занятия не найдены");
      return;
    }

    console.info("[ITMO export] Предпросмотр открыт");
    const confirmed = await showPreview(summarize(schedule));
    if (!confirmed) {
      button.textContent = "Экспорт отменён";
      console.info("[ITMO export] Экспорт отменён");
      return;
    }

    console.info("[ITMO export] Формирование .ics");
    downloadIcs(buildIcs(occurrences));
    console.info("[ITMO export] Скачивание .ics запущено");
    button.textContent = `Готово: ${occurrences.length} занятий`;
  } catch (error) {
    console.error("[ITMO export] Ошибка экспорта:", error);
    button.title = error instanceof Error ? error.message : "Не удалось экспортировать расписание";
    button.textContent = "Ошибка экспорта";
  } finally {
    setTimeout(() => {
      button.dataset.busy = "0";
      resetButton(button);
    }, 4000);
  }
}

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "btn btn-primary btn-sm";
  button.textContent = EXPORT_LABEL;
  button.addEventListener("click", () => void onExport(button));
  return button;
}

function ensureButton(): void {
  const toggle = document.getElementById("btn-radios-1");
  const group = toggle?.parentElement;
  if (!group) return;
  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!button) {
    group.style.display = "flex";
    group.style.alignItems = "center";
    group.style.gap = "8px";
    button = createButton();
    group.appendChild(button);
    console.info("[ITMO export] Кнопка экспорта добавлена");
  }
  resetButton(button);
}

ensureButton();
setInterval(ensureButton, 1000);
