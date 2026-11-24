import { getSession, getSettings, setSession } from "../shared/storage";
import {
    MAX_STEPS_PER_SESSION,
    type ContentEvent,
    type ContentRequest,
    type HighlightResult,
    type PageSnapshot,
    type PanelMessage,
    type SessionState,
    type Settings,
    type SnapshotElement,
    type SnapshotResult,
    type StepOutcome,
} from "../shared/types";
import { blockReason, PAYMENT_FIELDS_MESSAGE } from "./guard";
import { GuideError, planStep, planTour } from "./llm";
import { appendLog, setVerdict } from "./log";

/** The page may not be read; the message says why. */
class BlockedError extends Error {}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onMessage.addListener((message: PanelMessage | ContentEvent, sender, respond) => {
    // Responding only when the work is done keeps the service worker alive through the model call.
    handle(message, sender).then(respond, (error) => {
        console.error(error);
        respond(null);
    });
    return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === "complete") {
        void onPageLoaded(tabId, tab.url ?? "");
    }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const session = await getSession();
    if (session?.tabId === tabId) {
        await setSession(null);
    }
});

async function handle(
    message: PanelMessage | ContentEvent,
    sender: chrome.runtime.MessageSender,
): Promise<unknown> {
    switch (message.type) {
        case "panel/start":
            await setSession(newSession(message.tabId, message.goal));
            await runStep();
            return null;
        case "panel/tour":
            await setSession(newSession(message.tabId, ""));
            await runTour();
            return null;
        case "panel/tourGo":
            await showTourStop(message.index);
            return null;
        case "panel/next":
            await finishStep("confirmed", message.note);
            await runStep();
            return null;
        case "panel/wrong":
            await finishStep("wrong", message.note);
            await runStep();
            return null;
        case "panel/retry": {
            const session = await getSession();
            await (session?.goal ? runStep() : runTour());
            return null;
        }
        case "panel/stop":
            await stopSession();
            return null;
        case "panel/debugSnapshot":
            return snapshotTab(message.tabId);
        case "panel/debugHighlight":
            return sendToTab<HighlightResult>(message.tabId, {
                type: "content/highlight",
                id: message.id,
                action: "read",
                instruction: `Елемент №${message.id}`,
                why: "",
                destination: "",
            });
        case "content/acted": {
            const session = await getSession();
            if (session?.tabId === sender.tab?.id && session?.status === "waiting") {
                await finishStep("acted", "");
                await patchSession({ status: "settling" });
            }
            return null;
        }
        case "content/settled": {
            const session = await getSession();
            if (session?.tabId === sender.tab?.id && session?.status === "settling") {
                await runStep();
            }
            return null;
        }
    }
}

// ---- Session lifecycle ---------------------------------------------------

function newSession(tabId: number, goal: string): SessionState {
    return {
        tabId,
        goal,
        status: "thinking",
        tour: null,
        tourIndex: 0,
        runId: "",
        runUrl: "",
        runStartedAt: 0,
        step: null,
        targetName: "",
        targetHost: "",
        history: [],
        stepCount: 0,
        logId: "",
        message: "",
    };
}

async function patchSession(patch: Partial<SessionState>): Promise<SessionState | null> {
    const session = await getSession();
    if (!session) return null;
    const next = { ...session, ...patch };
    await setSession(next);
    return next;
}

async function stopSession(): Promise<void> {
    const session = await getSession();
    await setSession(null);
    if (session) {
        await sendToTab(session.tabId, { type: "content/clear" }).catch(() => {});
    }
}

/** Records how the step on screen ended and removes it from the session. */
async function finishStep(outcome: StepOutcome, note: string): Promise<void> {
    const session = await getSession();
    if (!session?.step) return;

    await setVerdict(session.logId, outcome === "wrong" ? "wrong" : outcome === "navigated" ? null : "ok");
    await setSession({
        ...session,
        step: null,
        logId: "",
        history: [
            ...session.history,
            {
                instruction: session.step.instruction,
                target: session.targetName,
                action: session.step.action,
                status: session.step.status,
                outcome,
                note: note.trim(),
                path: pathOf(session.runUrl),
            },
        ],
    });
}

async function onPageLoaded(tabId: number, url: string): Promise<void> {
    const session = await getSession();
    if (!session || session.tabId !== tabId) return;

    switch (session.status) {
        case "done":
        case "error":
            return;
        case "tour":
            // The stops belonged to the previous page.
            await setSession(null);
            return;
        case "thinking":
            // Some pages report "complete" twice for one load; don't plan the same page twice.
            if (url === session.runUrl && Date.now() - session.runStartedAt < 2000) return;
            break;
        default:
            await finishStep("navigated", "");
    }
    await (session.goal ? runStep() : runTour());
}

// ---- Planning runs -------------------------------------------------------

/** Marks the session as thinking and returns it, or null if the tab is gone. */
async function beginRun(): Promise<SessionState | null> {
    const session = await getSession();
    if (!session) return null;
    let url: string;
    try {
        url = (await chrome.tabs.get(session.tabId)).url ?? "";
    } catch {
        await setSession(null);
        return null;
    }
    const run: SessionState = {
        ...session,
        status: "thinking",
        runId: crypto.randomUUID(),
        runUrl: url,
        runStartedAt: Date.now(),
        message: "",
    };
    await setSession(run);
    return run;
}

/** The session, if `runId` is still its latest run; otherwise the result is stale and must be dropped. */
async function ifCurrent(runId: string): Promise<SessionState | null> {
    const session = await getSession();
    return session?.runId === runId ? session : null;
}

async function readPage(run: SessionState): Promise<{ settings: Settings; snapshot: PageSnapshot }> {
    const settings = await getSettings();
    if (!settings.apiKey) {
        throw new GuideError("Спершу додай API-ключ у налаштуваннях.");
    }
    const blocked = blockReason(run.runUrl, settings.blocklist);
    if (blocked) {
        throw new BlockedError(blocked);
    }
    const result = await snapshotTab(run.tabId);
    if (!result.ok) {
        throw new BlockedError(PAYMENT_FIELDS_MESSAGE);
    }
    return { settings, snapshot: result.snapshot };
}

async function failRun(runId: string, error: unknown): Promise<void> {
    const session = await ifCurrent(runId);
    if (!session) return;
    if (error instanceof BlockedError) {
        await setSession({ ...session, status: "blocked", message: error.message });
    } else if (error instanceof GuideError) {
        await setSession({ ...session, status: "error", message: error.message });
    } else {
        console.error(error);
        const detail = error instanceof Error ? error.message : String(error);
        await setSession({
            ...session,
            status: "error",
            message: `Не вдалося прочитати цю сторінку: ${detail}`,
        });
    }
}

async function runStep(): Promise<void> {
    const run = await beginRun();
    if (!run) return;
    if (run.stepCount >= MAX_STEPS_PER_SESSION) {
        await setSession({
            ...run,
            status: "error",
            message: `Досягнуто межі в ${MAX_STEPS_PER_SESSION} кроків. Зупини й почни з уточненою метою.`,
        });
        return;
    }

    try {
        const { settings, snapshot } = await readPage(run);
        const result = await planStep(settings, run.goal, run.history, snapshot);
        const session = await ifCurrent(run.runId);
        if (!session) return;

        const target = snapshot.elements.find((el) => el.id === result.output.elementId) ?? null;
        const step = { ...result.output, elementId: target?.id ?? null };
        const logId = await appendLog({
            host: hostOf(run.runUrl),
            goal: run.goal,
            model: settings.model,
            servedBy: result.servedBy,
            stepIndex: run.stepCount,
            status: step.status,
            action: step.action,
            elements: snapshot.elements.length,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
        });

        const targetHost = target ? externalHost(target) : "";
        // Saved before the highlight goes up, so a fast click finds the session already waiting.
        await setSession({
            ...session,
            status: step.status === "step" ? "waiting" : step.status,
            step,
            targetName: target?.name ?? "",
            targetHost,
            stepCount: run.stepCount + 1,
            logId,
            message: "",
        });

        if (target && step.status === "step") {
            const shown = await sendToTab<HighlightResult>(run.tabId, {
                type: "content/highlight",
                id: target.id,
                action: step.action,
                instruction: step.instruction,
                why: step.why,
                destination: targetHost,
            });
            if (!shown.found && (await ifCurrent(run.runId))) {
                await patchSession({
                    message: "Елемент щойно зник зі сторінки. Натисни «Не те», щоб отримати інший крок.",
                });
            }
        }
    } catch (error) {
        await failRun(run.runId, error);
    }
}

async function runTour(): Promise<void> {
    const run = await beginRun();
    if (!run) return;

    try {
        const { settings, snapshot } = await readPage(run);
        const result = await planTour(settings, snapshot);
        const session = await ifCurrent(run.runId);
        if (!session) return;

        const known = new Set(snapshot.elements.map((el) => el.id));
        const tour = {
            ...result.output,
            stops: result.output.stops.filter((stop) => known.has(stop.elementId)),
        };
        await appendLog({
            host: hostOf(run.runUrl),
            goal: "",
            model: settings.model,
            servedBy: result.servedBy,
            stepIndex: 0,
            status: "tour",
            action: "read",
            elements: snapshot.elements.length,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
        });
        await setSession({ ...session, status: "tour", tour, tourIndex: 0 });
        await showTourStop(0);
    } catch (error) {
        await failRun(run.runId, error);
    }
}

async function showTourStop(index: number): Promise<void> {
    const session = await getSession();
    const stop = session?.tour?.stops[index];
    if (!session || session.status !== "tour" || !stop) return;

    await setSession({ ...session, tourIndex: index });
    await sendToTab<HighlightResult>(session.tabId, {
        type: "content/highlight",
        id: stop.elementId,
        action: "read",
        instruction: stop.title,
        why: stop.text,
        destination: "",
    }).catch(() => {});
}

// ---- Talking to the page -------------------------------------------------

async function snapshotTab(tabId: number): Promise<SnapshotResult> {
    // Injected on demand rather than declared in the manifest: the script runs
    // only on pages where the person asked for help. It is a no-op if already present.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return sendToTab<SnapshotResult>(tabId, { type: "content/snapshot" });
}

function sendToTab<Result>(tabId: number, request: ContentRequest): Promise<Result> {
    return chrome.tabs.sendMessage<ContentRequest, Result>(tabId, request);
}

// ---- URL helpers ---------------------------------------------------------

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return "";
    }
}

function pathOf(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return "";
    }
}

/** For a link that leaves the current site, the host it leads to, so the person sees it before clicking. */
function externalHost(el: SnapshotElement): string {
    if (el.role !== "link" || !el.href || el.href.startsWith("/") || el.href.endsWith(":")) {
        return "";
    }
    return el.href.split("/")[0] ?? "";
}
