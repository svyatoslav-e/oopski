import type { CompanionButton, CompanionView, PanelMessage } from "../shared/types";
import { MASCOT_CSS, MASCOT_SIZE, MASCOT_SVG } from "./mascot";

// The on-page companion: a ring around the current element, the mascot standing
// next to it, and a small speech bubble. Everything lives in one fixed-position
// closed shadow root, so the page's layout and styles are untouched and the
// page's scripts cannot read what the bubble says.

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 13px/1.4 system-ui, sans-serif; color: #1c1c1c; }
.ring {
    position: fixed; box-sizing: border-box; border: 3px solid #f5a300; border-radius: 8px;
    box-shadow: 0 0 0 4px rgba(245, 163, 0, 0.3), 0 0 0 100vmax rgba(0, 0, 0, 0.14);
    animation: oopski-pulse 1.6s ease-in-out infinite;
}
.buddy { position: fixed; left: 0; top: 0; pointer-events: auto; transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1); }
.buddy.instant { transition: none; }
.bubble {
    position: absolute; box-sizing: border-box; width: max-content; min-width: 170px; max-width: 264px;
    padding: 9px 11px; border: 1px solid #d9d9d4; border-radius: 12px; background: #fff;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.22);
}
.head { display: flex; align-items: center; gap: 6px; margin: -3px -4px 2px 0; min-height: 18px; }
.title { flex: 1; font-size: 11px; color: #6b6b64; }
.icon { width: 20px; height: 20px; padding: 0; border: none; border-radius: 6px; background: none; color: #8a8a82; font: 14px/1 system-ui; cursor: pointer; }
.icon:hover { background: #f0f0ec; color: #1c1c1c; }
.text { font-weight: 600; overflow-wrap: anywhere; }
.detail, .destination { margin-top: 5px; font-size: 12px; color: #55554f; overflow-wrap: anywhere; }
.list { display: flex; flex-direction: column; gap: 5px; margin-top: 7px; }
.row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
button.btn { padding: 5px 10px; border: 1px solid #d9d9d4; border-radius: 8px; background: #f6f6f3; color: #1c1c1c; font: inherit; cursor: pointer; text-align: left; }
button.btn:hover { border-color: #b8b8b0; }
button.btn.primary { border-color: #f5a300; background: #f5a300; color: #2a1b00; font-weight: 600; }
button.btn.toggle { border-color: transparent; background: none; color: #8a5200; padding: 5px 4px; }
.entry { display: flex; gap: 5px; margin-top: 8px; }
.entry input { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid #d9d9d4; border-radius: 8px; background: #fff; color: #1c1c1c; font: inherit; }
.entry input:focus { outline: 2px solid rgba(245, 163, 0, 0.5); border-color: #f5a300; }
[hidden] { display: none !important; }
@keyframes oopski-pulse { 50% { box-shadow: 0 0 0 8px rgba(245, 163, 0, 0.15), 0 0 0 100vmax rgba(0, 0, 0, 0.14); } }
@media (prefers-reduced-motion: reduce) { .ring { animation: none; } .buddy { transition: none; } }
${MASCOT_CSS}`;

const RING_PAD = 4;
const GAP = 6;
const EDGE = 6;
const HOME_MARGIN = 20;
const PUPIL_REACH = 2.4;

interface Parts {
    host: HTMLElement;
    ring: HTMLElement;
    buddy: HTMLElement;
    mascot: SVGElement;
    bubble: HTMLElement;
    stopListening: AbortController;
}

let parts: Parts | null = null;
let target: Element | null = null;
let mood: CompanionView["mood"] = "hello";
let sensitiveFocus = false;
let frame = 0;

/** Draws the view; `el` is the element it points at, already looked up by the caller. */
export function renderCompanion(view: CompanionView, el: Element | null): void {
    const fresh = parts === null;
    const p = ensureParts();
    target = el;
    mood = view.mood;
    p.ring.hidden = el === null;
    p.bubble.hidden = false;
    fillBubble(p.bubble, view);
    updateFace();

    if (el) {
        const rect = el.getBoundingClientRect();
        const offscreen = rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth;
        if (offscreen) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
    // On first appearance the mascot is simply there; afterwards it glides between places.
    p.buddy.classList.toggle("instant", fresh);
    cancelAnimationFrame(frame);
    place();
    if (fresh) requestAnimationFrame(() => p.buddy.classList.remove("instant"));
}

/** The person acted or the page is being re-read: drop the ring, keep the mascot busy. */
export function showBusy(text: string): void {
    if (!parts) return;
    target = null;
    mood = "looking";
    parts.ring.hidden = true;
    // Still a full bubble, so the close button stays within reach while it works.
    fillBubble(parts.bubble, {
        mood: "looking",
        title: "",
        text,
        detail: "",
        targetId: null,
        action: "read",
        destination: "",
        choices: [],
        moreLabel: "",
        more: [],
        actions: [],
        input: null,
    });
    updateFace();
}

export function removeCompanion(): void {
    cancelAnimationFrame(frame);
    parts?.stopListening.abort();
    parts?.host.remove();
    parts = null;
    target = null;
    sensitiveFocus = false;
}

// ---- Building ------------------------------------------------------------

function ensureParts(): Parts {
    if (parts) return parts;

    const host = document.createElement("oopski-overlay");
    const root = host.attachShadow({ mode: "closed" });
    const style = node("style", "", STYLE);
    const layer = node("div", "layer");
    const ring = node("div", "ring");
    const buddy = node("div", "buddy");
    buddy.innerHTML = MASCOT_SVG; // static markup from mascot.ts, no page or model text
    const mascot = buddy.querySelector("svg") as SVGElement;
    const bubble = node("div", "bubble");
    buddy.append(bubble);
    layer.append(ring, buddy);
    root.append(style, layer);
    document.documentElement.append(host);

    // Clicking the mascot folds the bubble away so the page underneath can be seen.
    mascot.addEventListener("click", () => (bubble.hidden = !bubble.hidden));
    // Keystrokes typed into the bubble must not trigger the page's own shortcuts.
    for (const type of ["keydown", "keyup", "keypress"]) {
        bubble.addEventListener(type, (event) => event.stopPropagation());
    }

    // The mascot covers its eyes while the person is in a password or card field.
    const stopListening = new AbortController();
    const onFocus = (event: Event): void => {
        const focused = event.composedPath()[0];
        sensitiveFocus = event.type === "focusin" && focused instanceof Element && isSensitive(focused);
        updateFace();
    };
    document.addEventListener("focusin", onFocus, { capture: true, signal: stopListening.signal });
    document.addEventListener("focusout", onFocus, { capture: true, signal: stopListening.signal });

    parts = { host, ring, buddy, mascot, bubble, stopListening };
    return parts;
}

function fillBubble(bubble: HTMLElement, view: CompanionView): void {
    const head = node("div", "head");
    head.append(
        node("div", "title", view.title),
        iconButton("⋯", "Панель Oopski", { type: "panel/open" }),
        iconButton("✕", "Закрити", { type: "panel/stop" }),
    );

    const detail = node("div", "detail", view.detail);
    detail.hidden = true;
    const more = node("div", "list");
    more.hidden = true;
    more.append(...view.more.map(commandButton));

    const choices = node("div", "list");
    choices.append(...view.choices.map(commandButton));
    choices.hidden = view.choices.length === 0;

    const actions = node("div", "row");
    actions.append(...view.actions.map(commandButton));
    if (view.detail) actions.append(toggleButton("Чому?", detail));
    if (view.more.length > 0) actions.append(toggleButton(view.moreLabel, more));
    actions.hidden = actions.childElementCount === 0;

    const destination = node("div", "destination", view.destination ? `→ ${view.destination}` : "");
    destination.hidden = !view.destination;

    bubble.replaceChildren(head, node("div", "text", view.text), destination, detail, choices);
    if (view.input) bubble.append(entry(view.input));
    bubble.append(actions, more);
}

function entry(kind: "goal" | "answer"): HTMLElement {
    const row = node("div", "entry");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = kind === "goal" ? "напр. записатися до лікаря" : "своя відповідь";
    const submit = (): void => {
        const value = input.value.trim();
        if (!value) {
            input.focus();
            return;
        }
        send(kind === "goal" ? { type: "panel/start", goal: value } : { type: "panel/next", note: value });
    };
    input.addEventListener("keydown", (event) => event.key === "Enter" && submit());
    const go = node("button", "btn primary", "→");
    go.addEventListener("click", submit);
    row.append(input, go);
    return row;
}

function commandButton(button: CompanionButton): HTMLElement {
    const el = node("button", button.primary ? "btn primary" : "btn", button.label);
    el.addEventListener("click", () => send(button.message));
    return el;
}

function toggleButton(label: string, section: HTMLElement): HTMLElement {
    const el = node("button", "btn toggle", label);
    el.addEventListener("click", () => (section.hidden = !section.hidden));
    return el;
}

function iconButton(glyph: string, label: string, message: PanelMessage): HTMLElement {
    const el = node("button", "icon", glyph);
    el.title = label;
    el.setAttribute("aria-label", label);
    el.addEventListener("click", () => send(message));
    return el;
}

function send(message: PanelMessage): void {
    // The extension may have been reloaded since this script was injected.
    chrome.runtime.sendMessage(message).catch(() => {});
    if (message.type === "panel/stop") {
        removeCompanion();
    } else if (message.type !== "panel/open" && message.type !== "panel/tourGo") {
        // Answer at once; the next view replaces this when the service worker has it.
        showBusy("Секунду…");
    }
}

function node(tag: string, className: string, text = ""): HTMLElement {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

// ---- Face ----------------------------------------------------------------

function updateFace(): void {
    if (!parts) return;
    const covered = mood === "shy" || sensitiveFocus || (target !== null && isSensitive(target));
    parts.mascot.dataset.mood = mood;
    parts.mascot.dataset.eyes = covered ? "covered" : "open";
}

const SENSITIVE_NAME = /pass|pwd|card|cvv|cvc|iban|ssn|pesel|passport|secret|token|otp|\bpin\b/i;

/** Fields whose contents the mascot makes a point of not watching. */
function isSensitive(el: Element): boolean {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === "password") return true;
    const autocomplete = el.autocomplete || "";
    if (/^cc-|password|one-time-code/.test(autocomplete)) return true;
    return SENSITIVE_NAME.test(`${el.name} ${el.id}`);
}

// ---- Placement -----------------------------------------------------------

/** Runs every frame: keeps the ring on the target and the mascot and bubble beside it and on screen. */
function place(): void {
    if (!parts) return;
    const { ring, buddy, mascot, bubble } = parts;
    if (target && !target.isConnected) {
        target = null;
        ring.hidden = true;
    }

    let x = innerWidth - MASCOT_SIZE - HOME_MARGIN;
    let y = innerHeight - MASCOT_SIZE - HOME_MARGIN;
    let point: "left" | "right" | "none" = "none";
    let lookX = 0;
    let lookY = 0;

    if (target) {
        const rect = target.getBoundingClientRect();
        ring.style.left = `${rect.left - RING_PAD}px`;
        ring.style.top = `${rect.top - RING_PAD}px`;
        ring.style.width = `${rect.width + RING_PAD * 2}px`;
        ring.style.height = `${rect.height + RING_PAD * 2}px`;

        // Stand to the right of the element, else to its left, else underneath it.
        const right = rect.right + RING_PAD + GAP;
        const left = rect.left - RING_PAD - GAP - MASCOT_SIZE;
        if (right + MASCOT_SIZE <= innerWidth - EDGE) {
            x = right;
            point = "left";
        } else if (left >= EDGE) {
            x = left;
            point = "right";
        } else {
            x = clamp(rect.left, EDGE, innerWidth - MASCOT_SIZE - EDGE);
        }
        y = point === "none" ? rect.bottom + RING_PAD + GAP : rect.top + rect.height / 2 - MASCOT_SIZE / 2;
        y = clamp(y, EDGE, innerHeight - MASCOT_SIZE - EDGE);

        lookX = rect.left + rect.width / 2 - (x + MASCOT_SIZE / 2);
        lookY = rect.top + rect.height / 2 - (y + MASCOT_SIZE / 2);
    }

    buddy.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    mascot.dataset.point = point;
    const distance = Math.hypot(lookX, lookY) || 1;
    mascot.style.setProperty("--px", `${target ? (lookX / distance) * PUPIL_REACH : 0}px`);
    mascot.style.setProperty("--py", `${target ? (lookY / distance) * PUPIL_REACH : 0}px`);

    // The bubble hangs under the mascot when there is room, otherwise sits above it,
    // and is shifted sideways as far as needed to stay on screen.
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const below = MASCOT_SIZE + GAP;
    const above = -height - GAP;
    const fitsBelow = y + below + height <= innerHeight - EDGE;
    const fitsAbove = y + above >= EDGE;
    bubble.style.top = `${fitsBelow || !fitsAbove ? below : above}px`;
    bubble.style.left = `${clamp(0, EDGE - x, innerWidth - EDGE - width - x)}px`;

    frame = requestAnimationFrame(place);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, Math.max(min, max)));
}
