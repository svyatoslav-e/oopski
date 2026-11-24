import { clearLog, readLog } from "../background/log";
import { getSettings, saveSettings } from "../shared/storage";
import { MODELS, type LogEntry, type ModelId } from "../shared/types";

const apiKey = byId<HTMLInputElement>("apiKey");
const model = byId<HTMLSelectElement>("model");
const language = byId<HTMLInputElement>("language");
const blocklist = byId<HTMLTextAreaElement>("blocklist");
const saved = byId("saved");
const summary = byId("summary");

for (const [id, info] of Object.entries(MODELS)) {
    model.add(new Option(info.label, id));
}

byId("save").addEventListener("click", async () => {
    await saveSettings({
        apiKey: apiKey.value.trim(),
        model: model.value as ModelId,
        language: language.value.trim() || "українська",
        blocklist: blocklist.value.split("\n").map((line) => line.trim()).filter(Boolean),
    });
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 2000);
});

byId("exportLog").addEventListener("click", async () => {
    const blob = new Blob([JSON.stringify(await readLog(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "oopski-log.json";
    link.click();
    URL.revokeObjectURL(link.href);
});

byId("clearLog").addEventListener("click", async () => {
    if (confirm("Видалити всі записи журналу? Це не можна скасувати.")) {
        await clearLog();
        renderSummary([]);
    }
});

void load();

async function load(): Promise<void> {
    const settings = await getSettings();
    apiKey.value = settings.apiKey;
    model.value = settings.model;
    language.value = settings.language;
    blocklist.value = settings.blocklist.join("\n");
    renderSummary(await readLog());
}

function renderSummary(log: LogEntry[]): void {
    summary.replaceChildren();
    for (const id of Object.keys(MODELS) as ModelId[]) {
        const entries = log.filter((entry) => entry.model === id);
        if (entries.length === 0) continue;

        const judged = entries.filter((entry) => entry.verdict !== null);
        const wrong = judged.filter((entry) => entry.verdict === "wrong").length;
        const inputTokens = sum(entries.map((entry) => entry.inputTokens));
        const outputTokens = sum(entries.map((entry) => entry.outputTokens));
        const cost =
            (inputTokens * MODELS[id].inputPrice + outputTokens * MODELS[id].outputPrice) / 1_000_000;

        summary.append(
            row([
                MODELS[id].label,
                String(entries.length),
                judged.length > 0 ? `${wrong} з ${judged.length}` : "—",
                (median(entries.map((entry) => entry.latencyMs)) / 1000).toFixed(1),
                String(Math.round((inputTokens + outputTokens) / entries.length)),
                cost.toFixed(3),
            ]),
        );
    }
    if (summary.childElementCount === 0) {
        summary.append(row(["Поки що порожньо", "", "", "", "", ""]));
    }
}

function row(cells: string[]): HTMLElement {
    const tr = document.createElement("tr");
    for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
    }
    return tr;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length === 0) return 0;
    return sorted.length % 2 === 1
        ? (sorted[middle] ?? 0)
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
}
