import { LOG_KEY } from "../shared/storage";
import type { LogEntry } from "../shared/types";

// One entry per model call, kept locally, so that "does this work?" can be
// answered with numbers: how often a step was wrong, how long it took, what it cost.

const MAX_ENTRIES = 1000;

export async function readLog(): Promise<LogEntry[]> {
    const stored = await chrome.storage.local.get(LOG_KEY);
    return (stored[LOG_KEY] as LogEntry[] | undefined) ?? [];
}

export async function appendLog(entry: Omit<LogEntry, "id" | "ts" | "verdict">): Promise<string> {
    const id = crypto.randomUUID();
    const log = await readLog();
    log.push({ ...entry, id, ts: Date.now(), verdict: null });
    await chrome.storage.local.set({ [LOG_KEY]: log.slice(-MAX_ENTRIES) });
    return id;
}

export async function setVerdict(id: string, verdict: LogEntry["verdict"]): Promise<void> {
    if (!id) return;
    const log = await readLog();
    const entry = log.find((item) => item.id === id);
    if (!entry) return;
    entry.verdict = verdict;
    await chrome.storage.local.set({ [LOG_KEY]: log });
}

export async function clearLog(): Promise<void> {
    await chrome.storage.local.remove(LOG_KEY);
}
