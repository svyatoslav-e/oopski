import type { CompanionButton, CompanionView, SessionState } from "../shared/types";

// Turns the session into what the mascot says and offers. The rule throughout:
// one short line first; explanations and further options only behind a toggle.

const EMPTY: CompanionView = {
    mood: "looking",
    title: "",
    text: "",
    detail: "",
    targetId: null,
    action: "read",
    destination: "",
    choices: [],
    moreLabel: "",
    more: [],
    actions: [],
    input: null,
};

const RETRY: CompanionButton = { label: "Спробувати ще", message: { type: "panel/retry" }, primary: true };

/** Shown when the mascot is summoned on a page with no session yet. */
export function helloView(): CompanionView {
    return {
        ...EMPTY,
        mood: "hello",
        text: "Привіт! Що хочеш тут зробити?",
        input: "goal",
        choices: [{ label: "Покажи, що тут є", message: { type: "panel/tour" } }],
    };
}

/** Points at one element by number without a session; used by the panel's diagnostics. */
export function debugView(id: number): CompanionView {
    return { ...EMPTY, mood: "pointing", text: `Елемент №${id}`, targetId: id };
}

export function viewOf(session: SessionState): CompanionView {
    switch (session.status) {
        case "thinking":
            return { ...EMPTY, text: "Дивлюсь, що тут є…" };
        case "settling":
            return { ...EMPTY, text: "Секунду…" };
        case "blocked":
            return {
                ...EMPTY,
                mood: "shy",
                text: "Тут я не підглядаю.",
                detail: session.message,
                actions: [RETRY],
            };
        case "error":
            return { ...EMPTY, mood: "confused", text: session.message, actions: [RETRY] };
        case "tour":
            return tourView(session);
        default:
            return stepView(session);
    }
}

function stepView(session: SessionState): CompanionView {
    const step = session.step;
    if (!step) return { ...EMPTY, text: "Секунду…" };

    const next = (note: string): CompanionButton["message"] => ({ type: "panel/next", note });
    const wrong: CompanionButton = { label: "Не те", message: { type: "panel/wrong", note: "" } };
    const base: CompanionView = { ...EMPTY, text: step.instruction, detail: step.why };

    switch (session.status) {
        case "need_info":
            return {
                ...base,
                mood: "asking",
                choices: step.options.map((option) => ({ label: option, message: next(option) })),
                input: "answer",
            };
        case "done":
            return {
                ...base,
                mood: "happy",
                actions: [
                    { label: "Дякую!", message: { type: "panel/stop" }, primary: true },
                    { ...wrong, label: "Ще не все" },
                ],
            };
        case "stuck":
            return {
                ...base,
                mood: "confused",
                actions: [{ label: "Спробувати ще", message: next(""), primary: true }],
                input: "answer",
            };
        default:
            return {
                ...base,
                // session.message is set when the element vanished before it could be shown.
                mood: session.message ? "confused" : "pointing",
                text: session.message || step.instruction,
                targetId: step.elementId,
                action: step.action,
                destination: session.targetHost,
                actions: [{ label: "Далі", message: next(""), primary: true }, wrong],
                moreLabel: "Що далі?",
                more: step.outline.map((item) => ({
                    label: item,
                    message: { type: "panel/jump", target: item },
                })),
            };
    }
}

function tourView(session: SessionState): CompanionView {
    const tour = session.tour;
    if (!tour) return { ...EMPTY, text: "Секунду…" };

    const goals: CompanionButton[] = tour.goals.map((goal) => ({
        label: goal,
        message: { type: "panel/start", goal },
    }));
    const go = (index: number): CompanionButton["message"] => ({ type: "panel/tourGo", index });
    const index = session.tourIndex;
    const stop = tour.stops[index];
    const last = tour.stops.length - 1;

    if (!stop) {
        // The opening line of the tour, before the first stop.
        return {
            ...EMPTY,
            mood: "hello",
            text: tour.summary,
            actions: last >= 0 ? [{ label: "Покажи", message: go(0), primary: true }] : [],
            choices: last >= 0 ? [] : goals,
            moreLabel: "Що тут можна?",
            more: last >= 0 ? goals : [],
        };
    }

    const atEnd = index === last;
    return {
        ...EMPTY,
        mood: "pointing",
        title: `${index + 1} / ${tour.stops.length} · ${stop.title}`,
        text: stop.text,
        targetId: stop.elementId,
        actions: [
            { label: "Назад", message: go(index - 1) },
            ...(atEnd ? [] : [{ label: "Далі", message: go(index + 1), primary: true }]),
        ],
        // At the end of the tour the natural next move is to pick something to do.
        choices: atEnd ? goals : [],
        moreLabel: "Що тут можна?",
        more: atEnd ? [] : goals,
    };
}
