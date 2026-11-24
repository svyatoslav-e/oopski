import type { ContentRequest, RenderResult, SnapshotResult } from "../shared/types";
import { removeCompanion, renderCompanion, showBusy } from "./companion";
import { elementById, takeSnapshot } from "./snapshot";
import { unwatch, watchTarget } from "./watch";

declare global {
    interface Window {
        __oopskiLoaded?: boolean;
    }
}

// The service worker injects this file before every step; register only once per page.
if (!window.__oopskiLoaded) {
    window.__oopskiLoaded = true;

    chrome.runtime.onMessage.addListener(
        (
            request: ContentRequest,
            _sender,
            respond: (result: SnapshotResult | RenderResult | null) => void,
        ) => {
            switch (request.type) {
                case "content/snapshot":
                    // Element ids are about to be reassigned, so the old target no longer holds.
                    unwatch();
                    showBusy("Дивлюсь, що тут є…");
                    respond(takeSnapshot());
                    break;
                case "content/render": {
                    const { view } = request;
                    const el = view.targetId === null ? null : elementById(view.targetId);
                    renderCompanion(view, el);
                    if (el) {
                        watchTarget(el, view.action, () => showBusy("Секунду…"));
                    } else {
                        unwatch();
                    }
                    respond({ found: view.targetId === null || el !== null });
                    break;
                }
                case "content/clear":
                    unwatch();
                    removeCompanion();
                    respond(null);
                    break;
            }
            return false;
        },
    );
}
