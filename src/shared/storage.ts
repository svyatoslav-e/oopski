import { DEFAULT_SETTINGS, type SessionState, type Settings } from "./types";

export const SETTINGS_KEY = "settings";
export const SESSION_KEY = "session";
export const LOG_KEY = "log";

export async function getSettings(): Promise<Settings> {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
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
