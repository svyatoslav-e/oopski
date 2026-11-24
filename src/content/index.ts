import type { ContentRequest, HighlightResult, SnapshotResult } from "../shared/types";
import { clearHighlight, showHighlight } from "./highlight";
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
            respond: (result: SnapshotResult | HighlightResult | null) => void,
        ) => {
            switch (request.type) {
                case "content/snapshot":
                    unwatch();
                    clearHighlight();
                    respond(takeSnapshot());
                    break;
                case "content/highlight": {
                    const el = elementById(request.id);
                    if (el) {
                        showHighlight(el, request);
                        watchTarget(el, request.action, clearHighlight);
                    }
                    respond({ found: el !== null });
                    break;
                }
                case "content/clear":
                    unwatch();
                    clearHighlight();
                    respond(null);
                    break;
            }
            return false;
        },
    );
}
