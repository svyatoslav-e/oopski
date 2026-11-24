import type { PageSnapshot, SnapshotElement, SnapshotResult } from "../shared/types";

const INTERACTIVE = [
    "a[href]",
    "button",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="textbox"]',
    "[onclick]",
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(",");

const PAYMENT_FIELDS = [
    'input[autocomplete^="cc-"]',
    'input[name*="cardnumber" i]',
    'input[name*="card-number" i]',
    'input[name*="card_number" i]',
    'input[id*="cardnumber" i]',
    'input[id*="card-number" i]',
    'input[id*="card_number" i]',
].join(",");

/** Hosts whose visible frames hold card forms the page itself can't see into. */
const PAYMENT_FRAME_HOSTS = [
    "js.stripe.com",
    "checkout.stripe.com",
    "adyen.com",
    "braintreegateway.com",
    "paypal.com",
    "liqpay.ua",
    "wayforpay.com",
    "portmone.com.ua",
    "checkout.com",
    "klarna.com",
];

const MAX_ELEMENTS = 300;
const MAX_NAME = 80;
const MAX_TEXT = 1500;
const MAX_HEADINGS = 20;
const MAX_OPTIONS = 12;

/** Elements of the latest snapshot, by the id the model refers to them with. */
let elementsById = new Map<number, Element>();

export function elementById(id: number): Element | null {
    const el = elementsById.get(id);
    return el?.isConnected ? el : null;
}

export function takeSnapshot(): SnapshotResult {
    if (hasPaymentFields()) {
        return { ok: false, reason: "payment-fields" };
    }

    const candidates = collectInteractive(document).filter(isVisible).filter(isOutermostTarget);
    const chosen = pickWithinCap(candidates);

    elementsById = new Map();
    const elements: SnapshotElement[] = [];
    chosen.forEach((el, index) => {
        const id = index + 1;
        elementsById.set(id, el);
        elements.push(describe(el, id));
    });

    const snapshot: PageSnapshot = {
        url: location.origin + location.pathname,
        title: clip(document.title, 120),
        lang: document.documentElement.lang || "",
        headings: collectHeadings(),
        text: collectText(),
        elements,
        iframes: collectFrames().map((frame) => frame.host),
        truncated: candidates.length > chosen.length,
    };
    return { ok: true, snapshot };
}

// ---- Collection ----------------------------------------------------------

/** Interactive elements in document order, including those inside open shadow roots. */
function collectInteractive(root: Document | ShadowRoot): Element[] {
    const found: Element[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node as Element;
        if (el.matches(INTERACTIVE)) {
            found.push(el);
        }
        if (el.shadowRoot) {
            found.push(...collectInteractive(el.shadowRoot));
        }
    }
    return found;
}

function isVisible(el: Element): boolean {
    if (el.closest('[aria-hidden="true"], [inert]')) {
        return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
        return false;
    }
    return el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
}

/** A span with tabindex inside a link is the same click target as the link; keep only the link. */
function isOutermostTarget(el: Element): boolean {
    const wrapper = el.parentElement?.closest('a[href], button, [role="button"], [role="link"]');
    return !wrapper;
}

function pickWithinCap(candidates: Element[]): Element[] {
    if (candidates.length <= MAX_ELEMENTS) {
        return candidates;
    }
    // Over the cap: keep what is most likely to matter, then restore document order.
    const scored = candidates.map((el, order) => ({ el, order, score: priority(el) }));
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored
        .slice(0, MAX_ELEMENTS)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.el);
}

function priority(el: Element): number {
    let score = 0;
    if (el.closest('dialog[open], [role="dialog"], [aria-modal="true"]')) score += 4;
    if (inViewport(el)) score += 2;
    if (el.closest('main, [role="main"], form')) score += 1;
    if (el.closest("footer")) score -= 1;
    return score;
}

function inViewport(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

// ---- Describing one element ----------------------------------------------

function describe(el: Element, id: number): SnapshotElement {
    return {
        id,
        role: roleOf(el),
        name: nameOf(el),
        states: statesOf(el),
        inViewport: inViewport(el),
        context: contextOf(el),
        href: hrefOf(el),
        options: optionsOf(el),
    };
}

function roleOf(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (el instanceof HTMLAnchorElement) return "link";
    if (el instanceof HTMLButtonElement) return "button";
    if (el instanceof HTMLSelectElement) return "combobox";
    if (el instanceof HTMLTextAreaElement) return "textbox";
    if (el instanceof HTMLInputElement) {
        switch (el.type) {
            case "submit":
            case "button":
            case "reset":
            case "image":
                return "button";
            case "checkbox":
            case "radio":
                return el.type;
            case "search":
                return "searchbox";
            case "text":
                return "textbox";
            default:
                return `textbox:${el.type}`;
        }
    }
    if (el.tagName === "SUMMARY") return "disclosure";
    if (el.getAttribute("contenteditable") === "true") return "textbox";
    return "clickable";
}

function nameOf(el: Element): string {
    const labelled = el.getAttribute("aria-label") || textOfIds(el.getAttribute("aria-labelledby"));
    if (labelled) return clip(labelled, MAX_NAME);

    if (el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type)) {
        return clip(el.value || el.type, MAX_NAME);
    }
    if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
    ) {
        const label = Array.from(el.labels ?? [])
            .map((item) => item.innerText)
            .join(" ");
        const placeholder = "placeholder" in el ? el.placeholder : "";
        const alt = el instanceof HTMLInputElement ? el.alt : "";
        return clip(label || placeholder || el.title || alt || el.name, MAX_NAME);
    }

    const text = el instanceof HTMLElement ? el.innerText : (el.textContent ?? "");
    if (text.trim()) return clip(text, MAX_NAME);

    // Icon-only controls: fall back to whatever labels the icon.
    const fallback =
        el.getAttribute("title") ||
        el.querySelector("img[alt]")?.getAttribute("alt") ||
        el.querySelector("svg title")?.textContent ||
        el.querySelector("[aria-label]")?.getAttribute("aria-label") ||
        "";
    return clip(fallback, MAX_NAME);
}

function statesOf(el: Element): string[] {
    const states: string[] = [];
    const disabled =
        ("disabled" in el && el.disabled === true) || el.getAttribute("aria-disabled") === "true";
    if (disabled) states.push("disabled");

    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        if (el.checked) states.push("checked");
    } else if (el.getAttribute("aria-checked") === "true") {
        states.push("checked");
    } else if (isTextEntry(el) && el.value !== "") {
        // Only the fact that something is entered leaves the page, never the value itself.
        states.push("filled");
    }

    const expanded = el.getAttribute("aria-expanded");
    if (expanded === "true") states.push("expanded");
    if (expanded === "false") states.push("collapsed");
    if (el.getAttribute("aria-selected") === "true" || el.hasAttribute("aria-current")) {
        states.push("current");
    }
    if (("required" in el && el.required === true) || el.getAttribute("aria-required") === "true") {
        states.push("required");
    }
    return states;
}

function isTextEntry(
    el: Element,
): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
    );
}

const contextCache = new WeakMap<Element, string>();

/** Label of the nearest enclosing region, so that two "Search" buttons can be told apart. */
function contextOf(el: Element): string {
    const region = el.parentElement?.closest(
        'dialog, [role="dialog"], form, fieldset, nav, [role="navigation"], header, footer, aside, section, article',
    );
    if (!region) return "";
    const cached = contextCache.get(region);
    if (cached !== undefined) return cached;

    const kind = region.getAttribute("role") || region.tagName.toLowerCase();
    const label =
        region.getAttribute("aria-label") ||
        textOfIds(region.getAttribute("aria-labelledby")) ||
        region.querySelector(":scope > legend, h1, h2, h3, h4")?.textContent ||
        "";
    const context = clip(label ? `${kind}: ${label}` : kind, 60);
    contextCache.set(region, context);
    return context;
}

function hrefOf(el: Element): string {
    if (!(el instanceof HTMLAnchorElement) || !el.href) return "";
    try {
        const url = new URL(el.href);
        if (!/^https?:$/.test(url.protocol)) return url.protocol;
        const path = url.pathname === "/" ? "" : url.pathname;
        return clip(url.host === location.host ? path || "/" : url.host + path, 60);
    } catch {
        return "";
    }
}

function optionsOf(el: Element): string[] {
    if (!(el instanceof HTMLSelectElement)) return [];
    return Array.from(el.options)
        .slice(0, MAX_OPTIONS)
        .map((option) => clip(option.label, 40))
        .filter(Boolean);
}

// ---- Page context --------------------------------------------------------

function collectHeadings(): string[] {
    return Array.from(document.querySelectorAll("h1, h2, h3"))
        .filter(isVisible)
        .map((heading) => clip(heading.textContent ?? "", MAX_NAME))
        .filter(Boolean)
        .slice(0, MAX_HEADINGS);
}

function collectText(): string {
    const source = document.querySelector<HTMLElement>('main, [role="main"]') ?? document.body;
    return clip(source?.innerText ?? "", MAX_TEXT);
}

function collectFrames(): { host: string }[] {
    const frames: { host: string }[] = [];
    for (const frame of document.querySelectorAll("iframe")) {
        const rect = frame.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 30 || !frame.checkVisibility()) continue;
        try {
            const host = new URL(frame.src, location.href).host;
            if (host && host !== location.host) frames.push({ host });
        } catch {
            // A frame without a usable src has nothing to report.
        }
    }
    return frames;
}

function hasPaymentFields(): boolean {
    if (document.querySelector(PAYMENT_FIELDS)) return true;
    return collectFrames().some(({ host }) =>
        PAYMENT_FRAME_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`)),
    );
}

// ---- Text helpers --------------------------------------------------------

function textOfIds(ids: string | null): string {
    if (!ids) return "";
    return ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
}

function clip(text: string, max: number): string {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
