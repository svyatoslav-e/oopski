// Drives the built service worker through whole sessions with in-memory fakes
// for chrome.* and fetch. No API is called. Run with `npm test`.
import assert from "node:assert/strict";

const store = { local: {}, session: {} };
const area = (name) => ({
    get: async (key) => (key in store[name] ? { [key]: structuredClone(store[name][key]) } : {}),
    set: async (obj) => {
        Object.assign(store[name], structuredClone(obj));
    },
    remove: async (key) => {
        delete store[name][key];
    },
});
const listeners = {};
const ev = (name) => ({ addListener: (fn) => (listeners[name] = fn) });

// The fake page: what the content script would answer, and everything sent to it.
const page = { url: "https://praxis.example/", payment: false, targetFound: true, canInject: true, toTab: [], panelOpened: [] };
const SNAPSHOT = {
    url: "https://praxis.example/", title: "Praxis", lang: "de", headings: [], text: "", iframes: [], truncated: false,
    elements: [
        { id: 1, role: "link", name: "Termin buchen", states: [], inViewport: true, context: "nav", href: "/termin", options: [] },
        { id: 2, role: "link", name: "Rezept", states: [], inViewport: true, context: "nav", href: "partner.example.org/rezept", options: [] },
    ],
};
globalThis.chrome = {
    storage: { local: area("local"), session: area("session") },
    sidePanel: { setPanelBehavior: async () => {}, open: async (o) => page.panelOpened.push(o.tabId) },
    action: { onClicked: ev("action") },
    runtime: { onMessage: ev("message") },
    scripting: {
        executeScript: async () => {
            if (!page.canInject) throw new Error("Cannot access contents of the page");
        },
    },
    tabs: {
        onUpdated: ev("updated"),
        onRemoved: ev("removed"),
        get: async (id) => {
            if (id !== 7 && id !== 8) throw new Error("No tab");
            return { id, url: page.url };
        },
        sendMessage: async (tabId, request) => {
            page.toTab.push({ tabId, ...request });
            if (request.type === "content/snapshot") {
                return page.payment ? { ok: false, reason: "payment-fields" } : { ok: true, snapshot: SNAPSHOT };
            }
            if (request.type === "content/render") {
                return { found: request.view.targetId === null || page.targetFound };
            }
            return null;
        },
    },
};

const requests = [];
let nextAnswers = [];
let gate = null; // when set, the fake API waits on it before answering
const STEP = { status: "step", elementId: 1, action: "click", instruction: "Натисни Termin buchen", why: "бо так", outline: ["Обрати дату"], options: [] };
globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (gate) await gate;
    const answer = nextAnswers.shift() ?? STEP;
    return new Response(
        JSON.stringify({
            id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
            content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 900, output_tokens: 60 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
    );
};

await import("../dist-test/background.js");

const send = (message, tabId) => new Promise((res) => listeners.message(message, tabId ? { tab: { id: tabId } } : {}, res));
const session = () => store.session.session ?? null;
const log = () => store.local.log ?? [];
const tick = () => new Promise((r) => setTimeout(r, 20));
const lastUser = () => requests.at(-1).messages[0].content;
/** The view the mascot is showing now. */
const view = () => page.toTab.filter((m) => m.type === "content/render").at(-1).view;
const labels = (buttons) => buttons.map((b) => b.label);
const ok = (name) => console.log("ok  ", name);
const step = (extra) => ({ ...STEP, ...extra });

// 1. Summoning the mascot: greeting on a normal page, side panel on a browser page
listeners.action({ id: 7, url: "https://praxis.example/" }); await tick();
assert.equal(view().mood, "hello"); assert.equal(view().input, "goal"); assert.deepEqual(labels(view().choices), ["Покажи, що тут є"]);
assert.equal(session(), null);
listeners.action({ id: 7, url: "chrome://extensions" }); await tick();
assert.deepEqual(page.panelOpened, [7]);
await send({ type: "panel/open" }, 7);
assert.deepEqual(page.panelOpened, [7, 7]);
await send({ type: "panel/stop" }, 7);
assert.equal(page.toTab.at(-1).type, "content/clear");
ok("icon click -> greeting; browser page -> side panel; bubble can open the panel and be dismissed");

// 2. No API key
await send({ type: "panel/start", goal: "записатися" }, 7);
assert.equal(session().status, "error"); assert.equal(session().tabId, 7); assert.equal(requests.length, 0);
assert.equal(view().mood, "confused"); assert.match(view().text, /API-ключ/); assert.deepEqual(labels(view().actions), ["Спробувати ще"]);
ok("no key -> confused mascot with the reason, no API call");

// 3. First step: the mascot looks, then points
store.local.settings = { apiKey: "k", model: "claude-opus-5-5", language: "українська", blocklist: ["blocked.example"] };
const before3 = page.toTab.length;
await send({ type: "panel/start", goal: "записатися" }, 7);
const moods = page.toTab.slice(before3).filter((m) => m.type === "content/render").map((m) => m.view.mood);
assert.deepEqual(moods, ["looking", "pointing"]);
assert.equal(session().status, "waiting"); assert.equal(session().stepCount, 1);
assert.equal(view().text, "Натисни Termin buchen"); assert.equal(view().detail, "бо так"); assert.equal(view().targetId, 1); assert.equal(view().action, "click");
assert.deepEqual(labels(view().actions), ["Далі", "Не те"]); assert.equal(view().moreLabel, "Що далі?"); assert.deepEqual(labels(view().more), ["Обрати дату"]);
assert.deepEqual(view().more[0].message, { type: "panel/jump", target: "Обрати дату" });
assert.equal(log().length, 1); assert.equal(log()[0].verdict, null); assert.equal(log()[0].inputTokens, 900);
ok("start from the bubble -> looking, then pointing with one line, why and outline tucked away");

// 4. The person acts: ignored from other tabs, recorded from the session's tab
await send({ type: "content/acted" }, 99);
assert.equal(session().status, "waiting");
await send({ type: "content/acted" }, 7);
assert.equal(session().status, "settling"); assert.equal(session().step, null); assert.equal(view().mood, "looking");
assert.equal(session().history[0].outcome, "acted"); assert.equal(log()[0].verdict, "ok");
const before4 = requests.length;
await send({ type: "content/settled" }, 7);
assert.equal(requests.length, before4 + 1); assert.equal(session().status, "waiting"); assert.equal(session().stepCount, 2);
assert.match(lastUser(), /1\. \[\/\] step\/click on "Termin buchen": "Натисни Termin buchen" -> the person did it/);
ok("acted -> settling -> settled -> next step with history");

// 5. Wrong with a note; a link leaving the site shows where it leads
nextAnswers = [step({ elementId: 2, instruction: "Rezept" })];
await send({ type: "panel/wrong", note: " не та кнопка " });
assert.equal(session().history[1].outcome, "wrong"); assert.equal(session().history[1].note, "не та кнопка");
assert.equal(log()[1].verdict, "wrong"); assert.match(lastUser(), /says this step was wrong; they added: "не та кнопка"/);
assert.equal(view().destination, "partner.example.org");
ok("wrong -> recorded with note, verdict wrong, external host shown");

// 6. Jumping to an outline item
const jumpLog = log().at(-1).id;
await send({ type: "panel/jump", target: "Відкрити «Metody płatności»" });
assert.equal(session().history.at(-1).outcome, "redirected"); assert.equal(log().find((e) => e.id === jumpLog).verdict, null);
assert.match(lastUser(), /asked to go straight to something else; they want: "Відкрити «Metody płatności»"/);
ok("jump to outline item -> redirected, verdict untouched, wish in history");

// 7. Navigation while waiting
page.url = "https://praxis.example/termin";
listeners.updated(7, { status: "loading" }, { url: page.url }); await tick();
const history7 = session().history.length;
listeners.updated(7, { status: "complete" }, { url: page.url }); await tick(); await tick();
assert.equal(session().history.length, history7 + 1); assert.equal(session().history.at(-1).outcome, "navigated");
assert.equal(session().status, "waiting"); assert.equal(session().runUrl, page.url);
listeners.updated(99, { status: "complete" }, { url: "https://other.example/" }); await tick();
assert.equal(session().history.length, history7 + 1);
ok("navigation -> step closed as navigated, re-planned; other tabs ignored");

// 8. Unknown element id; a question with options; done
nextAnswers = [step({ elementId: 77 })];
await send({ type: "panel/next", note: "" });
assert.equal(session().step.elementId, null); assert.equal(view().targetId, null);
nextAnswers = [step({ status: "need_info", elementId: null, action: "read", instruction: "Яке страхування?", outline: [], options: ["державне", "приватне"] })];
await send({ type: "panel/next", note: "" });
assert.equal(session().status, "need_info"); assert.equal(view().mood, "asking"); assert.equal(view().input, "answer");
assert.deepEqual(labels(view().choices), ["державне", "приватне"]);
assert.deepEqual(view().choices[0].message, { type: "panel/next", note: "державне" });
nextAnswers = [step({ status: "done", elementId: null, action: "read", instruction: "Готово", outline: [] })];
await send(view().choices[0].message);
assert.equal(session().status, "done"); assert.equal(view().mood, "happy"); assert.deepEqual(labels(view().actions), ["Дякую!", "Ще не все"]);
assert.match(lastUser(), /need_info\/read: "Яке страхування\?" -> the person says it is done; they added: "державне"/);
const doneRequests = requests.length;
listeners.updated(7, { status: "complete" }, { url: page.url }); await tick();
assert.equal(requests.length, doneRequests);
ok("invalid id -> no target; question -> option buttons that answer it; done stays done on reload");

// 9. Target vanished before it could be shown
page.targetFound = false;
await send({ type: "panel/wrong", note: "" });
assert.equal(session().status, "waiting"); assert.match(session().message, /зник/); assert.equal(view().mood, "confused"); assert.match(view().text, /зник/);
page.targetFound = true;
ok("vanished element -> confused mascot says so");

// 10. Blocked pages: the mascot covers its eyes and nothing is sent to the API
for (const [url, pattern] of [["https://www.somebank.de/login", /банківських/], ["https://shop.blocked.example/x", /банківських/]]) {
    page.url = url; const n = requests.length; const snapshots = page.toTab.filter((m) => m.type === "content/snapshot").length;
    await send({ type: "panel/start", tabId: 7, goal: "g" });
    assert.equal(session().status, "blocked"); assert.equal(view().mood, "shy"); assert.equal(view().text, "Тут я не підглядаю."); assert.match(view().detail, pattern);
    assert.equal(requests.length, n); assert.equal(page.toTab.filter((m) => m.type === "content/snapshot").length, snapshots);
}
page.url = "https://shop.example/checkout"; page.payment = true; const n10 = requests.length;
await send({ type: "panel/start", tabId: 7, goal: "g" });
assert.equal(session().status, "blocked"); assert.equal(view().mood, "shy"); assert.match(view().detail, /картки/); assert.equal(requests.length, n10);
page.payment = false;
page.url = "chrome://extensions"; page.canInject = false;
await send({ type: "panel/start", tabId: 7, goal: "g" });
assert.equal(session().status, "blocked"); assert.match(session().message, /службова/);
page.canInject = true;
ok("bank host / custom blocklist / card fields / browser page -> blocked, page not read, no API call");

// 11. Leaving a blocked page resumes planning
page.url = "https://shop.example/";
listeners.updated(7, { status: "complete" }, { url: page.url }); await tick(); await tick();
assert.equal(session().status, "waiting");
ok("navigation away from a blocked page -> planning resumes");

// 12. Closing the bubble during a model call: the late answer must not bring the session back
let release; gate = new Promise((r) => (release = r));
const pending = send({ type: "panel/next", note: "" }); await tick();
assert.equal(session().status, "thinking");
await send({ type: "panel/stop" }, 7);
assert.equal(session(), null); assert.equal(page.toTab.at(-1).type, "content/clear");
release(); gate = null; await pending;
assert.equal(session(), null);
ok("stop mid-call -> stale answer dropped");

// 13. Tour: one line first, stops one at a time, goals at the end
nextAnswers = [{ summary: "Сайт клініки", stops: [{ elementId: 1, title: "Запис", text: "t1" }, { elementId: 50, title: "Привид", text: "x" }, { elementId: 2, title: "Рецепти", text: "t2" }], goals: ["записатися до лікаря"] }];
await send({ type: "panel/tour" }, 7);
assert.equal(session().status, "tour"); assert.equal(session().tour.stops.length, 2); assert.equal(session().tourIndex, -1);
assert.equal(view().mood, "hello"); assert.equal(view().text, "Сайт клініки"); assert.equal(view().targetId, null);
assert.deepEqual(labels(view().actions), ["Покажи"]); assert.deepEqual(labels(view().more), ["записатися до лікаря"]); assert.equal(view().choices.length, 0);
assert.equal(log().at(-1).status, "tour"); assert.match(requests.at(-1).system, /first-time visitor/);
await send(view().actions[0].message);
assert.equal(session().tourIndex, 0); assert.equal(view().title, "1 / 2 · Запис"); assert.equal(view().text, "t1"); assert.equal(view().targetId, 1);
assert.deepEqual(labels(view().actions), ["Назад", "Далі"]);
await send(view().actions[1].message);
assert.equal(session().tourIndex, 1); assert.equal(view().targetId, 2); assert.deepEqual(labels(view().actions), ["Назад"]);
assert.deepEqual(labels(view().choices), ["записатися до лікаря"]);
await send({ type: "panel/tourGo", index: 5 });
assert.equal(session().tourIndex, 1);
await send(view().choices[0].message, 7);
assert.equal(session().status, "waiting"); assert.equal(session().goal, "записатися до лікаря"); assert.equal(session().tour, null);
ok("tour -> summary, stops filtered and shown one by one, goal button starts guidance");

// 14. Summoning again shows the running session; a session started elsewhere moves the mascot
listeners.action({ id: 7, url: page.url }); await tick();
assert.equal(view().text, "Натисни Termin buchen");
const before14 = page.toTab.length;
await send({ type: "panel/start", goal: "інше" }, 8);
assert.ok(page.toTab.slice(before14).some((m) => m.type === "content/clear" && m.tabId === 7));
assert.equal(session().tabId, 8);
ok("icon click on a tab with a session -> current step again; new session elsewhere clears the old tab");

// 15. Tab closed ends the session; step cap
await listeners.removed(8); assert.equal(session(), null);
await send({ type: "panel/start", tabId: 7, goal: "g" });
store.session.session.stepCount = 40; const n15 = requests.length;
await send({ type: "panel/next", note: "" });
assert.equal(session().status, "error"); assert.match(session().message, /40 кроків/); assert.equal(requests.length, n15);
ok("tab closed -> session cleared; step cap enforced");

console.log(`\nall scenarios passed (${requests.length} model calls, ${log().length} log entries)`);
