import { DEFAULT_SETTINGS, type SessionState, type Settings } from "./types";

export const SETTINGS_KEY = "settings";
export const SESSION_KEY = "session";
export const LOG_KEY = "log";

/** Replaced by build.mjs with ANTHROPIC_API_KEY from the environment or .env; empty if unset. */
declare const __BUILD_API_KEY__: string;

/** True when the bundle was built with a key, so none has to be entered in the browser. */
export const HAS_BUILD_API_KEY = __BUILD_API_KEY__ !== "";

/** Settings as saved on the options page, without the build-time key filled in. */
export async function getStoredSettings(): Promise<Settings> {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

/** Settings to act on: a key entered on the options page wins over the build-time one. */
export async function getSettings(): Promise<Settings> {
    const settings = await getStoredSettings();
    return { ...settings, apiKey: settings.apiKey || __BUILD_API_KEY__ };
}

export async function saveSettings(settings: Settings): Promise<void> {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** The session lives in session storage: it survives service worker restarts but not a browser restart. */
export async function getSession(): Promise<SessionState | null> {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    return (stored[SESSION_KEY] as SessionState | undefined) ?? null;
}

export async function setSession(session: SessionState | null): Promise<void> {
    if (session) {
        await chrome.storage.session.set({ [SESSION_KEY]: session });
    } else {
        await chrome.storage.session.remove(SESSION_KEY);
    }
}
