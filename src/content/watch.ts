import type { ContentEvent, StepAction } from "../shared/types";

// Notices when the person does what the current step asked, tells the service
// worker straight away, and reports again once the page has stopped changing.

const QUIET_MS = 600;
const MAX_WAIT_MS = 3000;

let stopWatching: (() => void) | null = null;

export function watchTarget(target: Element, action: StepAction, onActed: () => void): void {
    unwatch();
    if (action === "read" || action === "scroll") {
        return; // Nothing to observe; the person confirms in the panel.
    }

    const controller = new AbortController();
    const { signal } = controller;
    stopWatching = () => controller.abort();

    const acted = (): void => {
        unwatch();
        onActed();
        send({ type: "content/acted" });
        waitUntilSettled().then((stillHere) => {
            if (stillHere) send({ type: "content/settled" });
        });
    };

    const hitsTarget = (event: Event): boolean => event.composedPath().includes(target);

    if (action === "click") {
        document.addEventListener("click", (event) => hitsTarget(event) && acted(), {
            capture: true,
            signal,
        });
    } else {
        // Typing and selecting count once the value is committed.
        document.addEventListener("change", (event) => hitsTarget(event) && acted(), {
            capture: true,
            signal,
        });
        document.addEventListener(
            "keydown",
            (event) => event.key === "Enter" && hitsTarget(event) && acted(),
            { capture: true, signal },
        );
    }
}

export function unwatch(): void {
    stopWatching?.();
    stopWatching = null;
}

/** Resolves true once the DOM has been quiet for a moment, false if the page is being left. */
function waitUntilSettled(): Promise<boolean> {
    return new Promise((resolve) => {
        let quietTimer = 0;
        const finish = (stillHere: boolean): void => {
            observer.disconnect();
            clearTimeout(quietTimer);
            clearTimeout(maxTimer);
            removeEventListener("pagehide", leaving);
            resolve(stillHere);
        };
        const leaving = (): void => finish(false);
        const restartQuietTimer = (): void => {
            clearTimeout(quietTimer);
            quietTimer = window.setTimeout(() => finish(true), QUIET_MS);
        };
        const observer = new MutationObserver(restartQuietTimer);
        const maxTimer = window.setTimeout(() => finish(true), MAX_WAIT_MS);

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
        });
        addEventListener("pagehide", leaving);
        restartQuietTimer();
    });
}

function send(event: ContentEvent): void {
    // The extension may have been reloaded since this script was injected.
    chrome.runtime.sendMessage(event).catch(() => {});
}
