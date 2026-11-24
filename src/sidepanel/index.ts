import { getSession, SESSION_KEY } from "../shared/storage";
import type { HighlightResult, PanelMessage, SessionState, SnapshotResult } from "../shared/types";

// The panel is a view of the session kept in storage: it sends commands to the
// service worker and re-renders whenever the stored session changes.

const startSection = byId("start");
const sessionSection = byId("session");
const goalInput = byId<HTMLTextAreaElement>("goal");
const startError = byId("startError");
const goalLine = byId("goalLine");
const content = byId("content");
const noteBox = byId("noteBox");
const noteInput = byId<HTMLInputElement>("note");
const actions = byId("actions");
const debugOutput = byId("debugOutput");

byId("startButton").addEventListener("click", () => start(goalInput.value));
byId("tourButton").addEventListener("click", async () => {
    const tabId = await activeTabId();
    if (tabId !== null) send({ type: "panel/tour", tabId });
});
goalInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) start(goalInput.value);
});
byId("optionsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());

byId("debugSnapshot").addEventListener("click", async () => {
    const tabId = await activeTabId();
    if (tabId === null) return;
    const result = await send<SnapshotResult>({ type: "panel/debugSnapshot", tabId });
    showDebug(describeSnapshot(result));
});
byId("debugHighlight").addEventListener("click", async () => {
    const tabId = await activeTabId();
    const id = Number(byId<HTMLInputElement>("debugId").value);
    if (tabId === null || !id) return;
    const result = await send<HighlightResult>({ type: "panel/debugHighlight", tabId, id });
    if (!result?.found) showDebug(`Елемента №${id} немає в останньому знімку.`);
});

chrome.storage.session.onChanged.addListener((changes) => {
    if (SESSION_KEY in changes) {
        render((changes[SESSION_KEY]?.newValue as SessionState | undefined) ?? null);
    }
});
void getSession().then(render);

// ---- Commands ------------------------------------------------------------

async function start(goal: string): Promise<void> {
    const trimmed = goal.trim();
    if (!trimmed) {
        showStartError("Напиши, що хочеш зробити.");
        return;
    }
    const tabId = await activeTabId();
    if (tabId !== null) send({ type: "panel/start", tabId, goal: trimmed });
}

async function activeTabId(): Promise<number | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
        showStartError("Не знайшов активної вкладки.");
        return null;
    }
    return tab.id;
}

function send<Result = null>(message: PanelMessage): Promise<Result | null> {
    return chrome.runtime.sendMessage<PanelMessage, Result | null>(message).catch((error) => {
        console.error(error);
        return null;
    });
}

function takeNote(): string {
    const note = noteInput.value;
    noteInput.value = "";
    return note;
}

// ---- Rendering -----------------------------------------------------------

function render(session: SessionState | null): void {
    startSection.hidden = session !== null;
    sessionSection.hidden = session === null;
    startError.hidden = true;
    if (!session) return;

    goalLine.textContent = session.goal ? `Мета: ${session.goal}` : "Огляд сторінки";
    content.replaceChildren();
    actions.replaceChildren();
    noteBox.hidden = true;

    const stop = button("Зупинити", () => send({ type: "panel/stop" }));

    switch (session.status) {
        case "thinking":
            content.append(card("", "Дивлюсь на сторінку…"));
            actions.append(stop);
            break;
        case "settling":
            content.append(card("", "Чекаю, поки сторінка оновиться…"));
            actions.append(stop);
            break;
        case "tour":
            renderTour(session, stop);
            break;
        case "blocked":
        case "error":
            content.append(card(session.status === "blocked" ? "Тут не працюю" : "Помилка", session.message));
            actions.append(button("Спробувати ще", () => send({ type: "panel/retry" }), true), stop);
            break;
        default:
            renderStep(session, stop);
    }
}

function renderStep(session: SessionState, stop: HTMLElement): void {
    const step = session.step;
    if (!step) return;

    const labels = {
        waiting: `Крок ${session.stepCount}`,
        done: "Готово",
        stuck: "Не бачу шляху далі",
        need_info: "Потрібне твоє рішення",
    } as const;
    const label = labels[session.status as keyof typeof labels] ?? "";

    const stepCard = card(label, step.instruction);
    if (step.why) stepCard.append(paragraph(step.why, "muted"));
    if (session.targetHost) stepCard.append(paragraph(`Посилання веде на ${session.targetHost}`, "muted"));
    if (session.message) stepCard.append(paragraph(session.message, "error"));
    content.append(stepCard);

    if (step.outline.length > 0 && session.status !== "done") {
        const outline = card("Що, ймовірно, далі", "");
        const list = document.createElement("ol");
        list.append(...step.outline.map((item) => listItem(item)));
        outline.append(list);
        content.append(outline);
    }

    const next = (): Promise<null> => send({ type: "panel/next", note: takeNote() });
    const wrong = (): Promise<null> => send({ type: "panel/wrong", note: takeNote() });
    noteBox.hidden = false;

    switch (session.status) {
        case "done":
            noteBox.hidden = true;
            actions.append(button("Завершити", () => send({ type: "panel/stop" }), true), button("Ще не все", wrong));
            break;
        case "need_info":
            actions.append(button("Відповісти й далі", next, true), stop);
            break;
        case "stuck":
            actions.append(button("Спробувати ще", next, true), stop);
            break;
        default:
            actions.append(button("Зроблено, далі", next, true), button("Не те", wrong), stop);
    }
}

function renderTour(session: SessionState, stop: HTMLElement): void {
    const tour = session.tour;
    if (!tour) return;
    content.append(card("Що це за сторінка", tour.summary));

    const current = tour.stops[session.tourIndex];
    if (current) {
        const stopCard = card(`Зупинка ${session.tourIndex + 1} із ${tour.stops.length}`, current.title);
        stopCard.append(paragraph(current.text, "muted"));
        content.append(stopCard);

        const go = (index: number) => () => send({ type: "panel/tourGo", index });
        const back = button("Назад", go(session.tourIndex - 1));
        const forward = button("Далі", go(session.tourIndex + 1), true);
        back.disabled = session.tourIndex === 0;
        forward.disabled = session.tourIndex >= tour.stops.length - 1;
        actions.append(back, forward);
    }
    actions.append(stop);

    if (tour.goals.length > 0) {
        const goals = card("Що тут можна зробити", "");
        const chips = document.createElement("div");
        chips.className = "chips";
        chips.append(...tour.goals.map((goal) => button(goal, () => start(goal))));
        goals.append(chips);
        content.append(goals);
    }
}

function describeSnapshot(result: SnapshotResult | null): string {
    if (!result) return "Не вдалося прочитати сторінку (службова сторінка або немає доступу).";
    if (!result.ok) return "Знімок не зроблено: на сторінці є платіжні поля.";
    const { snapshot } = result;
    const lines = snapshot.elements.map((el) => {
        const extras = [el.states.join(","), el.href, el.context, el.inViewport ? "" : "поза екраном"];
        return `[${el.id}] ${el.role} "${el.name}" ${extras.filter(Boolean).join(" · ")}`.trim();
    });
    const header = [
        snapshot.url,
        `Елементів: ${snapshot.elements.length}${snapshot.truncated ? " (обрізано)" : ""}`,
        snapshot.iframes.length > 0 ? `Вбудовані фрейми: ${snapshot.iframes.join(", ")}` : "",
    ];
    return [...header.filter(Boolean), "", ...lines].join("\n");
}

// ---- DOM helpers ---------------------------------------------------------

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
}

function card(label: string, title: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "card";
    if (label) el.append(paragraph(label, "label"));
    if (title) el.append(paragraph(title, "title"));
    return el;
}

function paragraph(text: string, className: string): HTMLElement {
    const el = document.createElement("p");
    el.className = className;
    el.textContent = text;
    return el;
}

function listItem(text: string): HTMLElement {
    const el = document.createElement("li");
    el.textContent = text;
    return el;
}

function button(text: string, onClick: () => unknown, primary = false): HTMLButtonElement {
    const el = document.createElement("button");
    el.textContent = text;
    if (primary) el.className = "primary";
    el.addEventListener("click", onClick);
    return el;
}

function showStartError(text: string): void {
    startError.textContent = text;
    startError.hidden = false;
}

function showDebug(text: string): void {
    debugOutput.textContent = text;
    debugOutput.hidden = false;
}
