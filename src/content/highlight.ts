// Draws a ring around one element and a note beside it. Everything lives in a
// fixed-position shadow host, so the page's own layout and styles are untouched.

interface Note {
    instruction: string;
    why: string;
    /** Host a link leads to when it leaves the current site; empty otherwise. */
    destination: string;
}

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 14px/1.4 system-ui, sans-serif; }
.ring {
    position: fixed; box-sizing: border-box; border: 3px solid #f5a300; border-radius: 8px;
    box-shadow: 0 0 0 4px rgba(245, 163, 0, 0.3), 0 0 0 100vmax rgba(0, 0, 0, 0.18);
    animation: pulse 1.6s ease-in-out infinite;
}
.note {
    position: fixed; box-sizing: border-box; max-width: 320px; padding: 10px 12px; border-radius: 10px;
    background: #1f1f1f; color: #fff; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}
.instruction { font-weight: 600; }
.why { margin-top: 4px; font-size: 13px; opacity: 0.85; }
.destination { margin-top: 6px; font-size: 12px; opacity: 0.7; }
.why:empty, .destination:empty { display: none; }
@keyframes pulse {
    50% { box-shadow: 0 0 0 8px rgba(245, 163, 0, 0.15), 0 0 0 100vmax rgba(0, 0, 0, 0.18); }
}
@media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
`;

const RING_PAD = 4;
const GAP = 10;

let host: HTMLElement | null = null;
let ring: HTMLElement | null = null;
let note: HTMLElement | null = null;
let target: Element | null = null;
let frame = 0;

export function showHighlight(el: Element, content: Note): void {
    clearHighlight();
    target = el;

    host = document.createElement("oopski-overlay");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;

    const layer = document.createElement("div");
    layer.className = "layer";
    ring = document.createElement("div");
    ring.className = "ring";
    note = document.createElement("div");
    note.className = "note";
    note.append(
        line("instruction", content.instruction),
        line("why", content.why),
        line("destination", content.destination ? `→ ${content.destination}` : ""),
    );
    layer.append(ring, note);
    root.append(style, layer);
    document.documentElement.append(host);

    const rect = el.getBoundingClientRect();
    const offscreen = rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth;
    if (offscreen) {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
    position();
}

export function clearHighlight(): void {
    cancelAnimationFrame(frame);
    host?.remove();
    host = ring = note = target = null;
}

export function highlightedElement(): Element | null {
    return target;
}

function line(className: string, text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    return el;
}

/** Re-reads the target's box every frame so the ring follows scrolling and layout shifts. */
function position(): void {
    if (!target || !ring || !note) return;
    if (!target.isConnected) {
        clearHighlight();
        return;
    }
    const rect = target.getBoundingClientRect();
    ring.style.left = `${rect.left - RING_PAD}px`;
    ring.style.top = `${rect.top - RING_PAD}px`;
    ring.style.width = `${rect.width + RING_PAD * 2}px`;
    ring.style.height = `${rect.height + RING_PAD * 2}px`;

    const noteRect = note.getBoundingClientRect();
    const below = rect.bottom + RING_PAD + GAP;
    const above = rect.top - RING_PAD - GAP - noteRect.height;
    const top = below + noteRect.height <= innerHeight || above < 0 ? below : above;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - noteRect.width - 8));
    note.style.top = `${Math.min(Math.max(8, top), Math.max(8, innerHeight - noteRect.height - 8))}px`;
    note.style.left = `${left}px`;

    frame = requestAnimationFrame(position);
}
