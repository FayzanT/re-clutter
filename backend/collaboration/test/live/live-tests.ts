// Live tests for the sync service, against the real app (npm run dev).
//
// The unit tests in test/ use a fake A and unsigned tokens. These use:
//   - A's real API and its real authorizer (http://localhost:8787),
//   - real users in the local Postgres, with tokens signed like the log-in Lambda,
//   - the same y-websocket client the frontend has installed.
//
// Run it through run-live-tests.sh, which loads the devserver's local secrets.
// It creates its own users and data and removes them at the end.
// It never prints a token, a cookie or diagram content to the service's log.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { WebSocket as WsSocket } from "ws";
import { canonical, savedHash, type BlocksDocument } from "../../src/blocks.ts";
import { API, ORIGIN, WS, api, inADay, must, requireDevSecret, sign, sql } from "./lib.ts";

// The frontend's own copies of the Yjs client libraries, so we test what the editor will run.
const front = createRequire(new URL("../../../../frontend/clutter/package.json", import.meta.url));
const Y = front("yjs");
const { WebsocketProvider } = front("y-websocket");

const RESULTS = process.env.LIVE_RESULTS ?? "";
const SERVER_TS = new URL("../../src/server.ts", import.meta.url).pathname;
const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/blocks-doc.json", import.meta.url), "utf8"));

requireDevSecret("live-tests");

// ---------- results ----------

interface Result {
  id: string;
  area: string;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  ms: number;
}
const results: Result[] = [];

async function test(id: string, area: string, name: string, expected: string, fn: () => Promise<string>): Promise<void> {
  const t0 = Date.now();
  let actual: string;
  let pass: boolean;
  try {
    actual = await fn();
    pass = true;
  } catch (err) {
    actual = err instanceof Error ? err.message : String(err);
    pass = false;
  }
  const r: Result = { id, area, name, expected, actual, pass, ms: Date.now() - t0 };
  results.push(r);
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}  (${r.ms} ms)\n      expected: ${expected}\n      actual:   ${actual}`);
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
    await sleep(10);
  }
}

// ---------- users, tokens and data ----------

interface User {
  id: string;
  email: string;
  name: string;
  token: string;
}

const sfx = randomUUID().slice(0, 8);

// Every user this script makes has an email like live-sync-a-<run>@clutter.localhost.
// Cleanup finds them by that pattern, so it works however far a run got.
// test-users.sh's users (live-sync-a@clutter.localhost) never match it.
const THIS_RUN = `^live-sync-[a-d]-${sfx}@clutter\\.localhost$`;
const ANY_RUN = "^live-sync-[a-d]-[0-9a-f]{8}@clutter\\.localhost$";

// Deletes the organizations these users made (their projects, diagrams and
// memberships go with them) and then the users. Returns how many users it removed.
// olderThanMinutes leaves recent users alone, so it never touches a run still going.
function removeTestUsers(pattern: string, olderThanMinutes = 0): number {
  const users = `SELECT id FROM users WHERE email ~ '${pattern}' AND created_at < now() - interval '${olderThanMinutes} minutes'`;
  const out = sql(`DELETE FROM organizations WHERE created_by IN (${users});\nDELETE FROM users WHERE id IN (${users});`);
  return Number(/DELETE (\d+)\s*$/.exec(out)?.[1] ?? 0);
}

let cleanedUp = false;
function cleanup(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const x of openClients) {
    try {
      x.provider.destroy();
    } catch {
      // already gone
    }
  }
  try {
    const n = removeTestUsers(THIS_RUN);
    console.log(`\ncleanup: removed this run's ${n} users and their organizations, projects and diagrams`);
  } catch (err) {
    console.error("cleanup failed:", err instanceof Error ? err.message : err);
  }
}

// Ctrl+C or a kill still cleans up.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

function makeUser(letter: string): User {
  const u = { id: randomUUID(), email: `live-sync-${letter}-${sfx}@clutter.localhost`, name: `Live Sync User ${letter.toUpperCase()}` };
  sql(`INSERT INTO users (id, email, full_name, picture_url) VALUES ('${u.id}', '${u.email}', '${u.name}', '');`);
  return { ...u, token: sign(u, inADay()) };
}


// ---------- clients ----------

function socketClass(headers: Record<string, string>) {
  return class extends WsSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols ?? [], { headers });
    }
  };
}

function headersFor(token: string | null, origin: string | null = ORIGIN): Record<string, string> {
  const h: Record<string, string> = {};
  if (origin !== null) h.Origin = origin;
  if (token !== null) h.Cookie = `clutter_token=${encodeURIComponent(token)}`;
  return h;
}

interface Client {
  doc: any;
  provider: any;
  closes: number[];
  user: User;
}

const openClients: Client[] = [];

// A y-websocket client, as the editor will make one.
function join(user: User, diagramId: string, projectId: string, opts: { token?: string; url?: string } = {}): Client {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(opts.url ?? WS, diagramId, doc, {
    params: { projectId },
    WebSocketPolyfill: socketClass(headersFor(opts.token ?? user.token)),
    disableBc: true,
    maxBackoffTime: 2500,
  });
  const c: Client = { doc, provider, closes: [], user };
  provider.on("connection-close", (ev: { code: number } | null) => {
    if (ev) c.closes.push(ev.code);
  });
  openClients.push(c);
  return c;
}

async function joinSynced(user: User, diagramId: string, projectId: string): Promise<Client> {
  const c = join(user, diagramId, projectId);
  await until(() => c.provider.synced, `${user.name} synced`);
  return c;
}

function leave(c: Client): void {
  c.provider.destroy();
  c.doc.destroy();
}

// The shared document as the saved format, sorted, so we can compare clients.
function asSaved(doc: any): BlocksDocument {
  const nodes = Object.entries(doc.getMap("nodes").toJSON() as Record<string, any>).map(([id, n]) => ({
    id,
    type: n.kind,
    position: n.position,
    data: { name: n.name, fields: n.fields ?? {} },
  }));
  const edges = Object.entries(doc.getMap("edges").toJSON() as Record<string, any>).map(([id, e]) => ({ id, source: e.source, target: e.target }));
  return canonical({ engine: "blocks", nodes, edges });
}

const view = (doc: any) => JSON.stringify(asSaved(doc));

async function converged(clients: Client[], what: string): Promise<string> {
  await until(() => clients.every((c) => view(c.doc) === view(clients[0]!.doc)), what);
  return view(clients[0]!.doc);
}

function newNode(doc: any, id: string, kind: string, name: string, fields: Record<string, unknown> = {}): void {
  doc.transact(() => {
    const n = new Y.Map();
    n.set("kind", kind);
    n.set("name", name);
    n.set("position", { x: 100, y: 100 });
    const f = new Y.Map();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    n.set("fields", f);
    doc.getMap("nodes").set(id, n);
  });
}

// A raw socket, for refusals: returns the close code and how long it took.
function rawConnect(path: string, headers: Record<string, string>, url = WS): Promise<{ code: number; ms: number; opened: boolean }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let opened = false;
    const ws = new WsSocket(url + path, { headers });
    ws.on("open", () => (opened = true));
    ws.on("error", () => {});
    ws.on("close", (code) => resolve({ code, ms: Date.now() - t0, opened }));
  });
}

// A second copy of the service with its own settings, on another port.
async function startSide(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVER_TS], {
    env: { PATH: process.env.PATH ?? "", COLLAB_PORT: String(port), COLLAB_API_URL: API, ...env },
    stdio: "ignore",
  });
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) return child;
    } catch {
      // not up yet
    }
    if (Date.now() - start > 10_000) throw new Error(`side service on ${port} did not start`);
    await sleep(100);
  }
}

// ---------- the run ----------

const fixtureSaved = FIXTURE.saved as BlocksDocument;
const fixtureName = FIXTURE.name as string;

async function main(): Promise<void> {
  console.log(`live-tests: API ${API}, service ${WS}, run ${sfx}\n`);

  // Runs that crashed before this cleanup existed, or were killed hard, left users behind.
  const leftovers = removeTestUsers(ANY_RUN, 10);
  if (leftovers) console.log(`setup: removed ${leftovers} users left by earlier runs, with their data\n`);

  // Setup: four users. A, B and C share an organization; D has their own.
  const A = makeUser("a");
  const B = makeUser("b");
  const C = makeUser("c");
  const D = makeUser("d");

  const org = (await must("POST", "/organization", A.token, { organizationName: `Live Sync ${sfx}`, description: "live sync tests" })).data.id as string;
  const orgD = (await must("POST", "/organization", D.token, { organizationName: `Live Sync D ${sfx}`, description: "live sync tests" })).data.id as string;
  // There is no invite route, so B and C join A's organization in SQL.
  sql(`INSERT INTO organization_members (organization_id, member_id) VALUES ('${org}', '${B.id}'), ('${org}', '${C.id}');`);

  const proj = (await must("POST", "/project", A.token, { organizationId: org, name: "Shared", description: "live sync tests" })).data.id as string;
  const proj2 = (await must("POST", "/project", A.token, { organizationId: org, name: "Second", description: "live sync tests" })).data.id as string;
  const projD = (await must("POST", "/project", D.token, { organizationId: orgD, name: "D's own", description: "live sync tests" })).data.id as string;

  async function diagram(projectId: string, token: string, name: string, data: unknown): Promise<string> {
    const id = (await must("POST", "/diagram", token, { projectId, name })).data.id as string;
    await must("PUT", "/diagram", token, { projectId, diagramId: id, name, data });
    return id;
  }
  const d1 = await diagram(proj, A.token, fixtureName, fixtureSaved);
  const d2 = await diagram(proj, A.token, "Second diagram", { engine: "blocks", nodes: [], edges: [] });
  const dAws = await diagram(proj, A.token, "Old AWS diagram", { nodes: [{ id: "s3-1", type: "s3", position: { x: 0, y: 0 }, data: {} }], edges: [] });
  const dD = await diagram(projD, D.token, "D's diagram", { engine: "blocks", nodes: [], edges: [] });

  console.log(`setup: users A B C (one organization) and D (another); diagrams d1 (fixture), d2, an AWS diagram, and D's own\n`);

  const path = (diagramId: string, projectId: string | null) => `/${diagramId}${projectId ? `?projectId=${projectId}` : ""}`;

  // ---- Setup checks ----
  await test("SET-01", "Setup", "Users B and C can read the shared diagram through A's API", "200 for A, B and C; 404 for D", async () => {
    const codes = [];
    for (const u of [A, B, C, D]) codes.push((await api("GET", `/diagram?projectId=${proj}&diagramId=${d1}`, u.token)).status);
    check(codes.join() === "200,200,200,404", `got ${codes.join(", ")} for A, B, C, D`);
    return `A ${codes[0]}, B ${codes[1]}, C ${codes[2]}, D ${codes[3]}`;
  });

  // ---- Refusals ----
  const refusal = async (headers: Record<string, string>, p: string, want: number): Promise<string> => {
    const r = await rawConnect(p, headers);
    check(r.code === want, `closed with ${r.code}, want ${want}`);
    return `closed with ${r.code} after ${r.ms} ms`;
  };
  await test("REF-01", "Refusals", "No login cookie", "4401", () => refusal(headersFor(null), path(d1, proj), 4401));
  await test("REF-02", "Refusals", "A cookie that is not a token", "4401", () => refusal(headersFor("not-a-token"), path(d1, proj), 4401));
  await test("REF-03", "Refusals", "A token signed with another secret", "4401", () =>
    refusal(headersFor(sign(A, inADay(), "devserver-local-not-the-real-secret-0123456789")), path(d1, proj), 4401),
  );
  await test("REF-04", "Refusals", "An expired token", "4401", () => refusal(headersFor(sign(A, Math.floor(Date.now() / 1000) - 60)), path(d1, proj), 4401));
  await test("REF-05", "Refusals", "A page address that is not the website (http://evil.example)", "4403", () =>
    refusal(headersFor(A.token, "http://evil.example"), path(d1, proj), 4403),
  );
  await test("REF-06", "Refusals", "No Origin header at all", "4403", () => refusal(headersFor(A.token, null), path(d1, proj), 4403));
  await test("REF-07", "Refusals", "127.0.0.1:3000 as the page address (only localhost:3000 is allowed)", "4403", () =>
    refusal(headersFor(A.token, "http://127.0.0.1:3000"), path(d1, proj), 4403),
  );
  await test("REF-08", "Refusals", "No projectId", "4400", () => refusal(headersFor(A.token), path(d1, null), 4400));
  await test("REF-09", "Refusals", "An old AWS diagram", "4400", () => refusal(headersFor(A.token), path(dAws, proj), 4400));
  await test("REF-10", "Refusals", "A diagram id that does not exist", "4404", () => refusal(headersFor(A.token), path(randomUUID(), proj), 4404));
  await test("REF-11", "Refusals", "A diagram id that is not a UUID", "4404", () => refusal(headersFor(A.token), path("not-a-uuid", proj), 4404));
  await test("REF-12", "Tenancy", "User D (another organization) joins the shared diagram", "4404", () => refusal(headersFor(D.token), path(d1, proj), 4404));
  await test("REF-13", "Tenancy", "User D names their own project with the shared diagram's id", "4404", () =>
    refusal(headersFor(D.token), path(d1, projD), 4404),
  );
  await test("REF-14", "Tenancy", "User A names their own second project with d1's id (diagram is not in that project)", "4404", () =>
    refusal(headersFor(A.token), path(d1, proj2), 4404),
  );
  await test("REF-15", "Tenancy", "User A joins D's diagram", "4404", () => refusal(headersFor(A.token), path(dD, projD), 4404));
  await test("REF-16", "Refusals", "A refused socket is held about 1 s before it closes (slows retries)", "800 to 2000 ms", async () => {
    const r = await rawConnect(path(d1, proj), headersFor(null));
    check(r.opened, "socket never opened");
    check(r.ms >= 800 && r.ms <= 2000, `closed after ${r.ms} ms`);
    return `opened, then closed with ${r.code} after ${r.ms} ms`;
  });
  await test("REF-17", "Refusals", "A refused y-websocket client retries about once a second, not ten times", "at most 6 attempts in 5 s", async () => {
    const c = join(D, d1, proj);
    await sleep(5000);
    const n = c.closes.length;
    leave(c);
    check(n >= 1 && n <= 6, `${n} closes in 5 s (codes ${c.closes.join(",")})`);
    return `${n} closes in 5 s, all ${[...new Set(c.closes)].join(",")}`;
  });

  // ---- Sync ----
  let a: Client, b: Client, c: Client;
  await test("SYN-01", "Sync", "The first user gets the saved diagram", "same nodes, edges and name as the fixture", async () => {
    a = await joinSynced(A, d1, proj);
    const got = asSaved(a.doc);
    check(JSON.stringify(got) === JSON.stringify(canonical(fixtureSaved)), "document differs from the fixture");
    check(a.doc.getMap("meta").get("name") === fixtureName, "name differs");
    return `${got.nodes.length} nodes, ${got.edges.length} edges, name "${fixtureName}"`;
  });
  await test("SYN-02", "Sync", "The room's saved hash matches the fixture's hash", FIXTURE.hash.slice(0, 16) + "...", async () => {
    const h = a.doc.getMap("meta").get("saved")?.hash;
    check(h === FIXTURE.hash, `hash ${h}`);
    check(savedHash(fixtureName, asSaved(a.doc)) === FIXTURE.hash, "recomputed hash differs");
    return `hash ${String(h).slice(0, 16)}..., by null, at null`;
  });
  await test("SYN-03", "Sync", "B and C join and get the same document", "three identical documents", async () => {
    b = await joinSynced(B, d1, proj);
    c = await joinSynced(C, d1, proj);
    await converged([a, b, c], "A, B, C equal");
    return "A, B and C hold the same 3 nodes and 2 edges";
  });
  await test("SYN-04", "Section 8", "A adds a VM, B a network, C a volume, at the same moment", "all three see all three new blocks", async () => {
    newNode(a.doc, "live-vm", "vm", "a-vm");
    newNode(b.doc, "live-net", "network", "b-net");
    newNode(c.doc, "live-vol", "volume", "c-vol");
    const v = await converged([a, b, c], "three adds");
    const ids = asSaved(a.doc).nodes.map((n) => n.id);
    check(["live-vm", "live-net", "live-vol"].every((id) => ids.includes(id)), `nodes ${ids.join(",")}`);
    return `each client has 6 nodes (${v.length} bytes, identical)`;
  });
  await test("SYN-05", "Section 8", "A moves the VM while B renames it", "both the new position and the new name are kept", async () => {
    a.doc.getMap("nodes").get("node-vm").set("position", { x: 999, y: 111 });
    b.doc.getMap("nodes").get("node-vm").set("name", "renamed-by-b");
    await converged([a, b, c], "move + rename");
    const n = asSaved(c.doc).nodes.find((x) => x.id === "node-vm")!;
    check(n.position.x === 999 && n.position.y === 111 && n.data.name === "renamed-by-b", JSON.stringify(n));
    return `C sees position (999, 111) and name "renamed-by-b"`;
  });
  await test("SYN-06", "Section 8", "A and B edit different fields of one block", "both field edits are kept", async () => {
    a.doc.getMap("nodes").get("node-vm").get("fields").set("flavor", "m1.large");
    b.doc.getMap("nodes").get("node-vm").get("fields").set("ports", [22]);
    await converged([a, b, c], "two fields");
    const f = asSaved(c.doc).nodes.find((x) => x.id === "node-vm")!.data.fields;
    check(f.flavor === "m1.large" && JSON.stringify(f.ports) === "[22]", JSON.stringify(f));
    return `C sees flavor m1.large and ports [22]`;
  });
  await test("SYN-07", "Conflicts", "A and B set the same field at the same moment", "everyone ends with the same one value", async () => {
    a.doc.getMap("nodes").get("node-net").get("fields").set("cidr", "10.1.0.0/24");
    b.doc.getMap("nodes").get("node-net").get("fields").set("cidr", "10.2.0.0/24");
    await converged([a, b, c], "same field");
    const v = asSaved(a.doc).nodes.find((x) => x.id === "node-net")!.data.fields.cidr;
    check(v === "10.1.0.0/24" || v === "10.2.0.0/24", String(v));
    return `all three settled on ${v} (Yjs picks one write; the other is overwritten, as expected for one field)`;
  });
  await test("SYN-08", "Section 8 (partial)", "A deletes a VM while B connects an edge to it", "documents agree; the saved form has no edge to a missing block", async () => {
    a.doc.getMap("nodes").delete("live-vm");
    b.doc.getMap("edges").set("edge-b-to-deleted", { source: "live-net", target: "live-vm" });
    await until(() => [a, b, c].every((x) => x.doc.getMap("edges").has("edge-b-to-deleted") && !x.doc.getMap("nodes").has("live-vm")), "delete + connect");
    const saved = asSaved(c.doc);
    check(!saved.edges.some((e) => e.target === "live-vm"), "saved form kept the dangling edge");
    return "the raw shared document keeps B's edge, and the saved form (canonical) drops it; the editor must save through that path";
  });
  await test("SYN-09", "Section 8", "B drops off, A and C edit, B comes back", "B catches up", async () => {
    b.provider.disconnect();
    await until(() => !b.provider.wsconnected, "B disconnected");
    newNode(a.doc, "while-b-away-a", "vm", "added-by-a");
    c.doc.getMap("nodes").get("node-vol").set("name", "renamed-by-c");
    await converged([a, c], "A and C");
    check(!b.doc.getMap("nodes").has("while-b-away-a"), "B got the edit while offline");
    b.provider.connect();
    await converged([a, b, c], "B caught up");
    return "B was missing both edits while away, and had both after reconnecting";
  });
  await test("SYN-10", "Roadmap 16.4", "Edits B makes while offline survive the reconnect", "A and C get B's offline edit", async () => {
    b.provider.disconnect();
    await until(() => !b.provider.wsconnected, "B disconnected");
    newNode(b.doc, "made-offline-by-b", "volume", "offline-vol");
    a.doc.getMap("nodes").get("node-vm").set("name", "a-while-b-offline");
    await sleep(300);
    b.provider.connect();
    await converged([a, b, c], "offline merge");
    check(a.doc.getMap("nodes").has("made-offline-by-b"), "B's offline node missing for A");
    check(asSaved(b.doc).nodes.find((n) => n.id === "node-vm")!.data.name === "a-while-b-offline", "A's edit missing for B");
    return "B's offline volume reached A and C; A's edit reached B";
  });
  await test("SYN-11", "Sync", "A user who joins late gets the live state, not the saved copy", "the late joiner sees every edit so far", async () => {
    const late = await joinSynced(C, d1, proj);
    await converged([a, late], "late joiner");
    check(late.doc.getMap("nodes").has("made-offline-by-b"), "late joiner has the saved copy");
    leave(late);
    return "a second tab for C saw all live edits";
  });
  await test("SYN-12", "Isolation", "Two diagrams open at once: no edits leak between them", "d2 stays empty while d1 changes", async () => {
    const a2 = await joinSynced(A, d2, proj);
    const b2 = await joinSynced(B, d2, proj);
    newNode(a.doc, "only-in-d1", "vm", "d1-only");
    newNode(a2.doc, "only-in-d2", "vm", "d2-only");
    await converged([a, b, c], "d1");
    await converged([a2, b2], "d2");
    check(!b2.doc.getMap("nodes").has("only-in-d1") && !b.doc.getMap("nodes").has("only-in-d2"), "an edit crossed rooms");
    leave(a2);
    leave(b2);
    return "each room holds only its own edit";
  });

  // ---- Presence ----
  await test("PRE-01", "Presence", "Each user's presence reaches the others", "A sees B and C by user id", async () => {
    a.provider.awareness.setLocalStateField("user", { id: A.id, name: A.name, color: "#e11d48" });
    b.provider.awareness.setLocalStateField("user", { id: B.id, name: B.name, color: "#2563eb" });
    c.provider.awareness.setLocalStateField("user", { id: C.id, name: C.name, color: "#16a34a" });
    const ids = () => [...a.provider.awareness.getStates().values()].map((s: any) => s?.user?.id);
    await until(() => [B.id, C.id].every((id) => ids().includes(id)), "A sees B and C");
    return `A sees ${new Set(ids()).size} users: A, B, C`;
  });
  await test("PRE-02", "Presence", "Presence is not shared between diagrams", "a d2 user sees nobody from d1", async () => {
    const a2 = await joinSynced(A, d2, proj);
    await sleep(300);
    const others = [...a2.provider.awareness.getStates().entries()].filter(([id]) => id !== a2.doc.clientID);
    leave(a2);
    check(others.length === 0, `${others.length} others visible`);
    return "no one else visible in d2";
  });
  await test("PRE-03", "Presence", "C claims to be A in presence", "the others ignore it", async () => {
    c.provider.awareness.setLocalStateField("user", { id: A.id, name: "fake A", color: "#000000" });
    await sleep(500);
    const fake = [...a.provider.awareness.getStates().values()].filter((s: any) => s?.user?.name === "fake A");
    check(fake.length === 0, "fake presence reached A");
    c.provider.awareness.setLocalStateField("user", { id: C.id, name: C.name, color: "#16a34a" });
    return "A never saw the fake entry";
  });
  await test("PRE-04", "Presence", "When B leaves, the others stop seeing B", "B's presence is removed", async () => {
    const bt = join(B, d1, proj);
    await until(() => bt.provider.synced, "B's second tab synced");
    bt.provider.awareness.setLocalStateField("user", { id: B.id, name: "B second tab", color: "#2563eb" });
    const seen = () => [...a.provider.awareness.getStates().values()].some((s: any) => s?.user?.name === "B second tab");
    await until(seen, "A sees B's second tab");
    leave(bt);
    await until(() => !seen(), "B's second tab removed", 5000);
    return "B's second tab appeared, then disappeared within 5 s of leaving";
  });

  // ---- Bad messages and limits ----
  const joinedRaw = (headers: Record<string, string>, p: string): Promise<WsSocket> =>
    new Promise((resolve, reject) => {
      const ws = new WsSocket(WS + p, { headers });
      ws.on("error", reject);
      ws.once("message", () => resolve(ws));
    });
  const closeOf = (ws: WsSocket): Promise<number> => new Promise((r) => ws.on("close", (code) => r(code)));

  await test("LIM-01", "Limits", "A message over 1 MiB", "closed with 1009", async () => {
    const ws = await joinedRaw(headersFor(A.token), path(d1, proj));
    const closed = closeOf(ws);
    ws.send(Buffer.alloc(1024 * 1024 + 10, 0));
    const code = await closed;
    check(code === 1009, `closed with ${code}`);
    return `closed with ${code}; the others stay connected: ${a.provider.wsconnected && b.provider.wsconnected}`;
  });
  await test("LIM-02", "Limits", "A text (non-binary) message", "closed with 4400", async () => {
    const ws = await joinedRaw(headersFor(A.token), path(d1, proj));
    const closed = closeOf(ws);
    ws.send("hello");
    const code = await closed;
    check(code === 4400, `closed with ${code}`);
    return `closed with ${code}`;
  });
  await test("LIM-03", "Limits", "A binary message that is not a Yjs message", "closed with 4400, room unharmed", async () => {
    const ws = await joinedRaw(headersFor(A.token), path(d1, proj));
    const closed = closeOf(ws);
    ws.send(Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1]));
    const code = await closed;
    check(code === 4400, `closed with ${code}`);
    newNode(a.doc, "after-garbage", "vm", "still-works");
    await converged([a, b, c], "room still works");
    return `closed with ${code}; A, B and C still sync`;
  });
  await test("LIM-04", "Sessions", "The login ends during the session", "closed with 4401 when the token expires", async () => {
    const short = sign(C, Math.floor(Date.now() / 1000) + 3);
    const t = join(C, d1, proj, { token: short });
    await until(() => t.provider.synced, "short-token client synced");
    await until(() => t.closes.includes(4401), "closed with 4401", 8000);
    leave(t);
    return `synced, then closed with 4401 after the token's end time`;
  });
  await test("LIM-05", "Sessions (known limit)", "B is removed from the organization while connected", "B stays in the room until they reconnect (README Notes), then gets 4404", async () => {
    sql(`DELETE FROM organization_members WHERE organization_id='${org}' AND member_id='${B.id}';`);
    newNode(a.doc, "after-b-removed", "vm", "b-should-not-see");
    await sleep(500);
    const stillGets = b.doc.getMap("nodes").has("after-b-removed");
    const again = await rawConnect(path(d1, proj), headersFor(B.token));
    sql(`INSERT INTO organization_members (organization_id, member_id) VALUES ('${org}', '${B.id}');`);
    check(again.code === 4404, `rejoin closed with ${again.code}`);
    return `while connected B ${stillGets ? "still received" : "did not receive"} edits (as the README says); a new connection got ${again.code}`;
  });

  // Close the shared clients before the room tests.
  for (const x of [a!, b!, c!]) leave(x);

  await test("ROOM-01", "Rooms", "Everyone leaves and comes back within 30 s", "unsaved edits are still there", async () => {
    await sleep(3000);
    const back = await joinSynced(A, d1, proj);
    const kept = back.doc.getMap("nodes").has("made-offline-by-b");
    leave(back);
    check(kept, "edits were lost after 3 s");
    return "after 3 s empty, the room still had the live edits";
  });
  await test("ROOM-02", "Rooms (as designed)", "Everyone leaves for more than 30 s", "the room is dropped: the next user gets the saved copy, unsaved edits are gone", async () => {
    await sleep(32_000);
    const back = await joinSynced(A, d1, proj);
    const got = asSaved(back.doc);
    leave(back);
    check(JSON.stringify(got) === JSON.stringify(canonical(fixtureSaved)), "room was not dropped");
    return "after 32 s empty, the next user got the saved copy (the editor must warn that unsaved changes are lost)";
  });

  // ---- Side services with other settings ----
  const side1 = await startSide(8792, { COLLAB_MAX_CLIENTS_PER_ROOM: "2", COLLAB_MAX_ROOMS: "1" });
  try {
    await test("CAP-01", "Limits", "A third client in a room limited to 2", "closed with 4429", async () => {
      const x = join(A, d1, proj, { url: "ws://127.0.0.1:8792" });
      const y = join(B, d1, proj, { url: "ws://127.0.0.1:8792" });
      await until(() => x.provider.synced && y.provider.synced, "two synced");
      const r = await rawConnect(path(d1, proj), headersFor(C.token), "ws://127.0.0.1:8792");
      const d = await rawConnect(path(d2, proj), headersFor(C.token), "ws://127.0.0.1:8792");
      leave(x);
      leave(y);
      check(r.code === 4429, `third client closed with ${r.code}`);
      check(d.code === 4429, `second room closed with ${d.code}`);
      return `third client: ${r.code}; a second room when the limit is 1: ${d.code}`;
    });
  } finally {
    side1.kill();
  }
  const side2 = await startSide(8793, { COLLAB_API_URL: "http://127.0.0.1:9", COLLAB_ACCESS_TIMEOUT_MS: "1000" });
  try {
    await test("UP-01", "Failures", "A's API cannot be reached", "closed with 4500", async () => {
      const r = await rawConnect(path(d1, proj), headersFor(A.token), "ws://127.0.0.1:8793");
      check(r.code === 4500, `closed with ${r.code}`);
      return `closed with ${r.code}`;
    });
  } finally {
    side2.kill();
  }
  await test("CFG-01", "Settings", "The service refuses to listen on a non-local address", "it exits at start", async () => {
    const out = (() => {
      try {
        execFileSync(process.execPath, [SERVER_TS], { env: { PATH: process.env.PATH ?? "", COLLAB_HOST: "0.0.0.0", COLLAB_PORT: "8794" }, stdio: "pipe", timeout: 5000 });
        return "started";
      } catch (err: any) {
        return String(err.stderr ?? err.message);
      }
    })();
    check(out.includes("COLLAB_HOST must be"), out.slice(0, 200));
    return "exited with: COLLAB_HOST must be 127.0.0.1, ::1 or localhost";
  });

  // ---- The service's log ----
  await test("LOG-01", "Security", "The service's log holds no token, cookie or diagram content", "none of the four tokens, no clutter_token, no node names", async () => {
    const file = process.env.LIVE_COLLAB_LOG ?? "";
    check(file !== "", "LIVE_COLLAB_LOG is not set");
    const text = readFileSync(file, "utf8");
    const leaks = [A, B, C, D].filter((u) => text.includes(u.token.split(".")[2]!)).length;
    check(leaks === 0, `${leaks} token signatures in the log`);
    check(!text.includes("clutter_token") && !text.includes("eyJ"), "a cookie or token appears in the log");
    check(!text.includes("renamed-by-b") && !text.includes("m1.large"), "diagram content appears in the log");
    return `${text.split("\n").filter(Boolean).length} log lines, none with a token, cookie or diagram content`;
  });

  if (RESULTS) writeFileSync(RESULTS, JSON.stringify({ run: sfx, at: new Date().toISOString(), node: process.version, results }, null, 2));
}

main()
  .catch((err) => {
    console.error("live-tests: setup failed:", err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => {
    // Runs whether the tests finished, failed or setup stopped partway.
    cleanup();
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length} tests, ${results.length - failed} pass, ${failed} fail`);
    if (failed && !process.exitCode) process.exitCode = 1;
    setTimeout(() => process.exit(), 200);
  });
