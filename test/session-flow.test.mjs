// Drives the built service worker through whole sessions with in-memory fakes.
import assert from "node:assert/strict";

const store = { local: {}, session: {} };
const area = (name) => ({
  get: async (key) => (key in store[name] ? { [key]: structuredClone(store[name][key]) } : {}),
  set: async (obj) => { Object.assign(store[name], structuredClone(obj)); },
  remove: async (key) => { delete store[name][key]; },
});
const listeners = {};
const ev = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
const page = { url: "https://praxis.example/", payment: false, toTab: [], injected: 0, highlightFound: true };
const SNAPSHOT = { url: "https://praxis.example/", title: "Praxis", lang: "de", headings: [], text: "", iframes: [], truncated: false,
  elements: [
    { id: 1, role: "link", name: "Termin buchen", states: [], inViewport: true, context: "nav", href: "/termin", options: [] },
    { id: 2, role: "link", name: "Rezept", states: [], inViewport: true, context: "nav", href: "partner.example.org/rezept", options: [] },
  ] };
globalThis.chrome = {
  storage: { local: area("local"), session: area("session") },
  sidePanel: { setPanelBehavior: async () => {} },
  runtime: { onMessage: ev("message") },
  scripting: { executeScript: async () => { page.injected++; } },
  tabs: {
    onUpdated: ev("updated"), onRemoved: ev("removed"),
    get: async (id) => { if (id !== 7) throw new Error("No tab"); return { id, url: page.url }; },
    sendMessage: async (id, req) => {
      page.toTab.push(req);
      if (req.type === "content/snapshot") return page.payment ? { ok: false, reason: "payment-fields" } : { ok: true, snapshot: SNAPSHOT };
      if (req.type === "content/highlight") return { found: page.highlightFound };
      return null;
    },
  },
};

const requests = [];
let nextAnswers = [];
let gate = null; // when set, fetch waits on it
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(init.body));
  if (gate) await gate;
  const answer = nextAnswers.shift() ?? { status: "step", elementId: 1, action: "click", instruction: "Натисни Termin buchen", why: "", outline: ["далі"] };
  return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 900, output_tokens: 60 } }), { status: 200, headers: { "content-type": "application/json" } });
};

await import("../dist/background.js");
const send = (msg, tabId) => new Promise((res) => listeners.message(msg, tabId ? { tab: { id: tabId } } : {}, res));
const session = () => store.session.session ?? null;
const log = () => store.local.log ?? [];
const tick = () => new Promise((r) => setTimeout(r, 20));
const lastUser = () => requests.at(-1).messages[0].content;
const ok = (name) => console.log("ok  ", name);

// 1. No API key
await send({ type: "panel/start", tabId: 7, goal: "записатися" });
assert.equal(session().status, "error"); assert.match(session().message, /API-ключ/); assert.equal(requests.length, 0);
ok("no key -> error, no API call");

// 2. First step
store.local.settings = { apiKey: "k", model: "claude-opus-5-5", language: "українська", blocklist: ["blocked.example"] };
await send({ type: "panel/start", tabId: 7, goal: "записатися" });
assert.equal(session().status, "waiting"); assert.equal(session().step.elementId, 1); assert.equal(session().stepCount, 1);
assert.equal(session().targetName, "Termin buchen"); assert.equal(session().targetHost, "");
assert.deepEqual(page.toTab.at(-1), { type: "content/highlight", id: 1, action: "click", instruction: "Натисни Termin buchen", why: "", destination: "" });
assert.equal(log().length, 1); assert.equal(log()[0].verdict, null); assert.equal(log()[0].inputTokens, 900);
ok("start -> step shown, highlighted, logged");

// 3. Acted from another tab is ignored; from the session tab it is recorded
await send({ type: "content/acted" }, 99);
assert.equal(session().status, "waiting");
await send({ type: "content/acted" }, 7);
assert.equal(session().status, "settling"); assert.equal(session().step, null);
assert.equal(session().history[0].outcome, "acted"); assert.equal(log()[0].verdict, "ok");
const before = requests.length;
await send({ type: "content/settled" }, 7);
assert.equal(requests.length, before + 1); assert.equal(session().status, "waiting"); assert.equal(session().stepCount, 2);
assert.match(lastUser(), /1\. \[\/\] step\/click on "Termin buchen": "Натисни Termin buchen" -> the person did it/);
ok("acted -> settling -> settled -> next step with history");

// 4. Wrong with a note; external link shows its host
nextAnswers = [{ status: "step", elementId: 2, action: "click", instruction: "Rezept", why: "w", outline: [] }];
await send({ type: "panel/wrong", note: " не та кнопка " });
assert.equal(session().history[1].outcome, "wrong"); assert.equal(session().history[1].note, "не та кнопка");
assert.equal(log()[1].verdict, "wrong"); assert.match(lastUser(), /says this step was wrong; they added: "не та кнопка"/);
assert.equal(session().targetHost, "partner.example.org"); assert.equal(page.toTab.at(-1).destination, "partner.example.org");
ok("wrong -> recorded with note, verdict wrong, external host shown");

// 5. Navigation while waiting
page.url = "https://praxis.example/termin";
listeners.updated(7, { status: "loading" }, { url: page.url }); await tick();
assert.equal(session().history.length, 2);
listeners.updated(7, { status: "complete" }, { url: page.url }); await tick(); await tick();
assert.equal(session().history[2].outcome, "navigated"); assert.equal(log()[2].verdict, null);
assert.equal(session().status, "waiting"); assert.equal(session().runUrl, page.url);
listeners.updated(99, { status: "complete" }, { url: "https://other.example/" }); await tick();
assert.equal(session().history.length, 3);
ok("navigation -> step closed as navigated, re-planned; other tabs ignored");

// 6. Unknown element id, need_info, done
nextAnswers = [{ status: "step", elementId: 77, action: "click", instruction: "x", why: "", outline: [] }];
const sentBefore = page.toTab.filter((r) => r.type === "content/highlight").length;
await send({ type: "panel/next", note: "" });
assert.equal(session().step.elementId, null);
assert.equal(page.toTab.filter((r) => r.type === "content/highlight").length, sentBefore);
nextAnswers = [{ status: "need_info", elementId: null, action: "read", instruction: "Яке страхування?", why: "", outline: [] }];
await send({ type: "panel/next", note: "" });
assert.equal(session().status, "need_info");
nextAnswers = [{ status: "done", elementId: null, action: "read", instruction: "Готово", why: "", outline: [] }];
await send({ type: "panel/next", note: "державне" });
assert.equal(session().status, "done"); assert.match(lastUser(), /need_info\/read: "Яке страхування\?" -> the person says it is done; they added: "державне"/);
const doneReq = requests.length;
listeners.updated(7, { status: "complete" }, { url: page.url }); await tick();
assert.equal(requests.length, doneReq);
ok("invalid id -> no highlight; need_info answer reaches the model; done stays done on reload");

// 7. Highlight target vanished
page.highlightFound = false;
await send({ type: "panel/wrong", note: "" });
assert.equal(session().status, "waiting"); assert.match(session().message, /зник/);
page.highlightFound = true;
ok("vanished element -> note in session");

// 8. Blocked: bank host, custom blocklist, payment fields, browser page
for (const [url, pattern] of [["https://www.somebank.de/login", /банківських/], ["https://shop.blocked.example/x", /банківських/], ["chrome://extensions", /службова/]]) {
  page.url = url; const n = requests.length;
  await send({ type: "panel/start", tabId: 7, goal: "g" });
  assert.equal(session().status, "blocked"); assert.match(session().message, pattern); assert.equal(requests.length, n);
}
page.url = "https://shop.example/checkout"; page.payment = true; const n8 = requests.length;
await send({ type: "panel/start", tabId: 7, goal: "g" });
assert.equal(session().status, "blocked"); assert.match(session().message, /картки/); assert.equal(requests.length, n8);
page.payment = false;
ok("bank host / custom blocklist / browser page / card fields -> blocked, no API call");

// 9. Leaving a blocked page re-plans automatically
page.url = "https://shop.example/"; 
listeners.updated(7, { status: "complete" }, { url: page.url }); await tick(); await tick();
assert.equal(session().status, "waiting");
ok("navigation away from a blocked page -> planning resumes");

// 10. Stop during a model call: the late answer must not resurrect the session
let release; gate = new Promise((r) => (release = r));
const pending = send({ type: "panel/next", note: "" }); await tick();
assert.equal(session().status, "thinking");
await send({ type: "panel/stop" });
assert.equal(session(), null); assert.equal(page.toTab.at(-1).type, "content/clear");
release(); gate = null; await pending;
assert.equal(session(), null);
ok("stop mid-call -> stale answer dropped");

// 11. Tour: stops with unknown ids are dropped, navigation, goal chip
nextAnswers = [{ summary: "Сайт клініки", stops: [{ elementId: 1, title: "Запис", text: "t1" }, { elementId: 50, title: "Привид", text: "x" }, { elementId: 2, title: "Рецепти", text: "t2" }], goals: ["записатися до лікаря"] }];
await send({ type: "panel/tour", tabId: 7 });
assert.equal(session().status, "tour"); assert.equal(session().tour.stops.length, 2); assert.equal(session().tourIndex, 0);
assert.equal(page.toTab.at(-1).instruction, "Запис"); assert.equal(page.toTab.at(-1).action, "read"); assert.equal(log().at(-1).status, "tour");
assert.match(requests.at(-1).system, /first-time visitor/);
await send({ type: "panel/tourGo", index: 1 });
assert.equal(session().tourIndex, 1); assert.equal(page.toTab.at(-1).instruction, "Рецепти");
await send({ type: "panel/tourGo", index: 5 });
assert.equal(session().tourIndex, 1);
await send({ type: "panel/start", tabId: 7, goal: "записатися до лікаря" });
assert.equal(session().status, "waiting"); assert.equal(session().goal, "записатися до лікаря"); assert.equal(session().tour, null);
ok("tour -> stops filtered, back/next, goal chip starts guidance");

// 12. Tab closed ends the session; step cap
await listeners.removed(7); assert.equal(session(), null);
await send({ type: "panel/start", tabId: 7, goal: "g" });
store.session.session.stepCount = 40; const n12 = requests.length;
await send({ type: "panel/next", note: "" });
assert.equal(session().status, "error"); assert.match(session().message, /40 кроків/); assert.equal(requests.length, n12);
ok("tab closed -> session cleared; step cap enforced");

console.log(`\nall scenarios passed (${requests.length} model calls, ${log().length} log entries)`);
