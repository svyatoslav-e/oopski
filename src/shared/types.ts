// Types and constants shared by the service worker, content script and extension pages.

/** Prices are USD per million tokens; used only for the cost estimate in the log summary. */
export const MODELS = {
    "claude-opus-5-5": { label: "Claude Opus 5.5", inputPrice: 4, outputPrice: 20 },
    "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", inputPrice: 2, outputPrice: 10 },
    "claude-haiku-5-5": { label: "Claude Haiku 5.5", inputPrice: 0.1, outputPrice: 0.5 },
} as const;

export type ModelId = keyof typeof MODELS;

export interface Settings {
    apiKey: string;
    model: ModelId;
    /** Language the guide writes in, as free text ("українська", "English"). */
    language: string;
    /** Extra blocked host fragments on top of the built-in list. */
    blocklist: string[];
}

export const DEFAULT_SETTINGS: Settings = {
    apiKey: "",
    model: "claude-opus-5-5",
    language: "українська",
    blocklist: [],
};

// ---- Page snapshot -------------------------------------------------------

export interface SnapshotElement {
    id: number;
    /** ARIA-like role, e.g. "button", "link", "textbox:email", "combobox". */
    role: string;
    name: string;
    /** disabled, checked, filled, expanded, collapsed, current, required. Never the field's value. */
    states: string[];
    inViewport: boolean;
    /** Label of the enclosing region (form, dialog, nav...), empty if none. */
    context: string;
    /** For links: path on the same site, or host + path elsewhere. No query string. */
    href: string;
    /** For selects: the visible option labels. */
    options: string[];
}

export interface PageSnapshot {
    /** Origin + path; the query string and hash are dropped. */
    url: string;
    title: string;
    lang: string;
    headings: string[];
    text: string;
    elements: SnapshotElement[];
    /** Hosts of visible embedded frames whose contents can't be read. */
    iframes: string[];
    /** True when the page had more interactive elements than the cap. */
    truncated: boolean;
}

export type SnapshotResult =
    | { ok: true; snapshot: PageSnapshot }
    | { ok: false; reason: "payment-fields" };

// ---- Guide step ----------------------------------------------------------

export type StepStatus = "step" | "done" | "stuck" | "need_info";
export type StepAction = "click" | "type" | "select" | "scroll" | "read";

export interface StepPlan {
    status: StepStatus;
    elementId: number | null;
    action: StepAction;
    instruction: string;
    why: string;
    outline: string[];
    /** For need_info: the answers the person can pick from. Empty otherwise. */
    options: string[];
}

/** redirected: the person skipped the step and picked a later item of the outline instead. */
export type StepOutcome = "acted" | "confirmed" | "wrong" | "navigated" | "redirected";

export interface HistoryItem {
    instruction: string;
    /** Name of the element the step pointed at, empty if none. */
    target: string;
    action: StepAction;
    status: StepStatus;
    outcome: StepOutcome;
    /** What the person typed into the panel alongside "next" or "wrong". */
    note: string;
    /** Path of the page the step was given on. */
    path: string;
}

// ---- Page tour -----------------------------------------------------------

export interface TourStop {
    elementId: number;
    title: string;
    text: string;
}

export interface TourPlan {
    /** What this site or page is, in a sentence or two. */
    summary: string;
    /** Key areas of the page, in the order worth showing them. */
    stops: TourStop[];
    /** Things a visitor typically comes here to do, phrased as goals. */
    goals: string[];
}

// ---- On-page companion ---------------------------------------------------

/** hello: greeting. looking: reading the page. shy: won't look (payment page, sensitive field). */
export type CompanionMood = "hello" | "looking" | "pointing" | "asking" | "happy" | "confused" | "shy";

export interface CompanionButton {
    label: string;
    /** Sent to the service worker when the button is clicked. */
    message: PanelMessage;
    primary?: boolean;
}

/**
 * Everything the mascot and its speech bubble show. The service worker derives it
 * from the session; the content script only draws it. The bubble starts with one
 * short line; detail and further options appear only when the person asks.
 */
export interface CompanionView {
    mood: CompanionMood;
    /** Small label above the text, such as tour progress. */
    title: string;
    text: string;
    /** Revealed by the "why" toggle. */
    detail: string;
    /** Element the mascot stands next to, or null to stay in its corner. */
    targetId: number | null;
    action: StepAction;
    /** Host a highlighted link leads to when it leaves the site. */
    destination: string;
    /** Answers or goals to pick from, always visible. */
    choices: CompanionButton[];
    /** Further ways forward, behind a toggle labelled moreLabel. */
    moreLabel: string;
    more: CompanionButton[];
    /** Compact row under the text. */
    actions: CompanionButton[];
    /** Free-text entry: "goal" starts guidance, "answer" continues with the typed note. */
    input: "goal" | "answer" | null;
}

// ---- Session -------------------------------------------------------------

export type SessionStatus =
    | "thinking"
    | "tour" // a page tour is shown; no goal yet
    | "waiting" // a step is shown, waiting for the person to act
    | "settling" // the person acted; waiting for the page to settle or navigate
    | "done"
    | "stuck"
    | "need_info"
    | "blocked"
    | "error";

export interface SessionState {
    tabId: number;
    /** Empty while the session is a page tour. */
    goal: string;
    status: SessionStatus;
    tour: TourPlan | null;
    /** -1 is the tour's opening summary; 0 and up are its stops. */
    tourIndex: number;
    /** Identifies the latest planning run so that stale results are dropped. */
    runId: string;
    /** URL the latest planning run looked at, and when it began. */
    runUrl: string;
    runStartedAt: number;
    step: StepPlan | null;
    targetName: string;
    /** Host a highlighted link leads to, when it leaves the current site. */
    targetHost: string;
    history: HistoryItem[];
    stepCount: number;
    /** Log entry of the step currently shown. */
    logId: string;
    /** Explanation for blocked / error states, or a note about the current step. */
    message: string;
}

export const MAX_STEPS_PER_SESSION = 40;

// ---- Evaluation log ------------------------------------------------------

export interface LogEntry {
    id: string;
    ts: number;
    host: string;
    goal: string;
    model: ModelId;
    /** Model that actually produced the answer (differs after a fallback). */
    servedBy: string;
    stepIndex: number;
    status: StepStatus | "tour";
    action: StepAction;
    elements: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    /** ok: the person followed the step. wrong: they pressed "Не те". null: unknown. */
    verdict: "ok" | "wrong" | null;
}

// ---- Messages ------------------------------------------------------------

/**
 * Commands to the service worker, sent by the side panel and by the on-page companion.
 * The companion leaves tabId out; the worker then uses the tab the message came from.
 */
export type PanelMessage =
    | { type: "panel/start"; tabId?: number; goal: string }
    | { type: "panel/tour"; tabId?: number }
    | { type: "panel/open" }
    | { type: "panel/tourGo"; index: number }
    | { type: "panel/next"; note: string }
    | { type: "panel/wrong"; note: string }
    | { type: "panel/jump"; target: string }
    | { type: "panel/retry" }
    | { type: "panel/stop" }
    | { type: "panel/debugSnapshot"; tabId: number }
    | { type: "panel/debugHighlight"; tabId: number; id: number };

export type ContentRequest =
    | { type: "content/snapshot" }
    | { type: "content/render"; view: CompanionView }
    | { type: "content/clear" };

export type ContentEvent = { type: "content/acted" } | { type: "content/settled" };

/** found is false when the view names a target element that is no longer on the page. */
export type RenderResult = { found: boolean };
