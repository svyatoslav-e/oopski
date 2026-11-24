import { getSession, getSettings, setSession } from "../shared/storage";
import {
    MAX_STEPS_PER_SESSION,
    type CompanionView,
    type ContentEvent,
    type ContentRequest,
    type PageSnapshot,
    type PanelMessage,
    type RenderResult,
    type SessionState,
    type Settings,
    type SnapshotElement,
    type SnapshotResult,
    type StepOutcome,
} from "../shared/types";
import { blockReason, PAYMENT_FIELDS_MESSAGE } from "./guard";
import { GuideError, planStep, planTour } from "./llm";
import { appendLog, setVerdict } from "./log";
import { debugView, helloView, viewOf } from "./view";

/** The page may not be read; the message says why. */
class BlockedError extends Error {}

// The toolbar icon summons the mascot onto the page; the side panel is opened from
// the mascot's bubble (or the icon's context menu) and holds settings and diagnostics.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);

chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    if (!/^https?:/.test(tab.url ?? "")) {
        // The mascot can't live on browser pages; the panel explains why. This has to be
        // called straight from the click, before anything is awaited.
        void chrome.sidePanel.open({ tabId: tab.id });
        return;
    }
    void summon(tab.id);
});

chrome.runtime.onMessage.addListener((message: PanelMessage | ContentEvent, sender, respond) => {
    if (message.type === "panel/open") {
        // Opening the panel is only allowed while the person's click is still "fresh".
        if (sender.tab?.id !== undefined) void chrome.sidePanel.open({ tabId: sender.tab.id });
        respond(null);
        return false;
    }
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
    message: Exclude<PanelMessage, { type: "panel/open" }> | ContentEvent,
    sender: chrome.runtime.MessageSender,
): Promise<unknown> {
    switch (message.type) {
        case "panel/start":
        case "panel/tour": {
            const tabId = message.tabId ?? sender.tab?.id;
            if (tabId === undefined) return null;
            await replaceSession(newSession(tabId, message.type === "panel/start" ? message.goal : ""));
            await (message.type === "panel/start" ? runStep() : runTour());
            return null;
        }
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
        case "panel/jump":
            await finishStep("redirected", message.target);
            await runStep();
            return null;
        case "panel/retry": {
            const session = await getSession();
            await (session?.goal ? runStep() : runTour());
            return null;
        }
        case "panel/stop":
            await stopSession();
            // The greeting has no session behind it; dismiss it on the tab that asked.
            if (sender.tab?.id !== undefined) await clearTab(sender.tab.id);
            return null;
        case "panel/debugSnapshot":
            return snapshotTab(message.tabId);
        case "panel/debugHighlight":
            return sendToTab<RenderResult>(message.tabId, {
                type: "content/render",
                view: debugView(message.id),
            });
        case "content/acted": {
            const session = await getSession();
            if (session?.tabId === sender.tab?.id && session?.status === "waiting") {
                await finishStep("acted", "");
                const acted = await getSession();
                if (acted) await commit({ ...acted, status: "settling" });
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
        tourIndex: -1,
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

/** Starts a new session, taking the mascot off the previous session's tab if it was elsewhere. */
async function replaceSession(session: SessionState): Promise<void> {
    const previous = await getSession();
    if (previous && previous.tabId !== session.tabId) {
        await clearTab(previous.tabId);
    }
    await setSession(session);
}

/** Saves the session and shows it on the page. Returns whether its target element is there. */
async function commit(session: SessionState): Promise<boolean> {
    await setSession(session);
    return render(session.tabId, viewOf(session));
}

async function stopSession(): Promise<void> {
    const session = await getSession();
    await setSession(null);
    if (session) {
        await clearTab(session.tabId);
    }
}

/** Puts the mascot on the page: with the session if this tab has one, otherwise with a greeting. */
async function summon(tabId: number): Promise<void> {
    const session = await getSession();
    try {
        await inject(tabId);
    } catch {
        return; // A page extensions may not touch, such as the Web Store.
    }
    await render(tabId, session?.tabId === tabId ? viewOf(session) : helloView());
}

/** Records how the step on screen ended and removes it from the session. */
async function finishStep(outcome: StepOutcome, note: string): Promise<void> {
    const session = await getSession();
    if (!session?.step) return;

    // Skipping ahead or navigating away says nothing about whether the step was right.
    const verdicts = { acted: "ok", confirmed: "ok", wrong: "wrong", navigated: null, redirected: null } as const;
    await setVerdict(session.logId, verdicts[outcome]);
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

/** Marks the session as thinking, shows that on the page, and returns it; null if the tab is gone. */
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
    // After a navigation the page has no content script yet; without it there is no mascot.
    await inject(run.tabId).catch(() => {});
    await commit(run);
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
        await commit({ ...session, status: "blocked", message: error.message });
    } else if (error instanceof GuideError) {
        await commit({ ...session, status: "error", message: error.message });
    } else {
        console.error(error);
        const detail = error instanceof Error ? error.message : String(error);
        await commit({
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
        await commit({
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

        const next: SessionState = {
            ...session,
            status: step.status === "step" ? "waiting" : step.status,
            step,
            targetName: target?.name ?? "",
            targetHost: target ? externalHost(target) : "",
            stepCount: run.stepCount + 1,
            logId,
            message: "",
        };
        const found = await commit(next);
        if (target && step.status === "step" && !found && (await ifCurrent(run.runId))) {
            await commit({ ...next, message: "Елемент щойно зник. Натисни «Не те»." });
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
        // The tour opens on its one-line summary; the stops follow one at a time.
        await commit({ ...session, status: "tour", tour, tourIndex: -1 });
    } catch (error) {
        await failRun(run.runId, error);
    }
}

/** Moves the tour to a stop; -1 is its opening summary. */
async function showTourStop(index: number): Promise<void> {
    const session = await getSession();
    if (!session?.tour || session.status !== "tour") return;
    if (index < -1 || index >= session.tour.stops.length) return;
    await commit({ ...session, tourIndex: index });
}

// ---- Talking to the page -------------------------------------------------

/**
 * Injected on demand rather than declared in the manifest: the script runs only on
 * pages where the person asked for help. It is a no-op if already present, and it
 * reads nothing from the page until asked for a snapshot.
 */
async function inject(tabId: number): Promise<void> {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function snapshotTab(tabId: number): Promise<SnapshotResult> {
    await inject(tabId);
    return sendToTab<SnapshotResult>(tabId, { type: "content/snapshot" });
}

/** Shows a view on the page. False when its target is missing or the page can't be reached. */
async function render(tabId: number, view: CompanionView): Promise<boolean> {
    try {
        const result = await sendToTab<RenderResult>(tabId, { type: "content/render", view });
        return result?.found ?? false;
    } catch {
        return false;
    }
}

async function clearTab(tabId: number): Promise<void> {
    await sendToTab(tabId, { type: "content/clear" }).catch(() => {});
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
