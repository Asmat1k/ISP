import type { ScanResult, PreviewSummary } from "./types";

const OVERLAY_ID = "itmo-ics-preview-overlay";

export function summarize({ occurrences, startDate, endDate }: ScanResult): PreviewSummary {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) {
    counts.set(occurrence.name, (counts.get(occurrence.name) ?? 0) + 1);
  }
  const subjects = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { lessonCount: occurrences.length, startDate, endDate, subjects };
}

export function showPreview(summary: PreviewSummary): Promise<boolean> {
  return new Promise((resolve) => {
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "100000",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "#fff",
      color: "#000",
      borderRadius: "8px",
      padding: "20px",
      width: "360px",
      maxWidth: "90vw",
      maxHeight: "80vh",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      fontFamily: "sans-serif",
    });

    const title = document.createElement("div");
    title.textContent = `Нашёл ${summary.lessonCount} занятий, ${summary.subjects.length} предметов`;
    Object.assign(title.style, { fontWeight: "600", fontSize: "16px" });

    const meta = document.createElement("div");
    meta.textContent = `Период: ${summary.startDate} — ${summary.endDate}`;
    Object.assign(meta.style, { color: "#888", fontSize: "13px" });

    const list = document.createElement("ul");
    Object.assign(list.style, {
      margin: "0",
      padding: "0",
      listStyle: "none",
      overflowY: "auto",
    });
    for (const subject of summary.subjects) {
      const item = document.createElement("li");
      Object.assign(item.style, {
        display: "flex",
        justifyContent: "space-between",
        gap: "12px",
        padding: "6px 0",
        borderBottom: "1px solid #eee",
        fontSize: "14px",
      });
      const name = document.createElement("span");
      name.textContent = subject.name;
      const count = document.createElement("span");
      count.textContent = String(subject.count);
      count.style.color = "#888";
      item.append(name, count);
      list.appendChild(item);
    }

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
    });

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn btn-default btn-sm";
    cancelButton.textContent = "Отмена";

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "btn btn-primary btn-sm";
    downloadButton.textContent = "Скачать .ics";

    const close = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };
    cancelButton.addEventListener("click", () => close(false));
    downloadButton.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });

    footer.append(cancelButton, downloadButton);
    card.append(title, meta, list, footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}
