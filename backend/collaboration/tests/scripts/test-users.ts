// Test users and data for the live sync browser tests (plan section 5, tasks 1 and 2).
//
// Makes four local users that stay until removed:
//   A, B and C in one organization ("Live Sync Team"), D in another ("Live Sync Outsider").
// And the data they test with:
//   - project "Live Sync" in the team organization, with three diagrams:
//     "Shared diagram" (building blocks, the shared sample), "Second diagram"
//     (building blocks, empty) and "Old AWS diagram" (A's format);
//   - project "Outsider Project" in D's organization, with "Outsider diagram".
//
// Every run signs fresh logins (24 hours, like a real sign-in) and writes, for
// each user, a sign-in snippet to paste in a browser profile's console and a
// Playwright storage file, into the devserver's .state folder (git ignores it).
// Tokens are never printed.
//
// Modes: (none) make what is missing and keep diagrams as they are;
//        --reset  also put the three team diagrams back to their starting contents;
//        --remove delete both organizations (with their projects and diagrams) and the four users.
// Run it through test-users.sh.

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { API, ORIGIN, WS, api, inADay, must, requireDevSecret, sign, sql } from "./lib.ts";

requireDevSecret("test-users");

const OUT = process.env.LIVE_USERS_DIR ?? "";
const MODE = process.argv[2] ?? "";
if (!OUT) {
  console.error("test-users: LIVE_USERS_DIR is not set (run me through test-users.sh)");
  process.exit(2);
}
if (!["", "--reset", "--remove"].includes(MODE)) {
  console.error("usage: test-users.sh [--reset | --remove]");
  process.exit(2);
}

const FIXTURE = JSON.parse(readFileSync(new URL("../../test/fixtures/blocks-doc.json", import.meta.url), "utf8"));

const PEOPLE = [
  { key: "a", name: "Test User A" },
  { key: "b", name: "Test User B" },
  { key: "c", name: "Test User C" },
  { key: "d", name: "Test User D (outsider)" },
] as const;

const TEAM_ORG = "Live Sync Team";
const OUTSIDER_ORG = "Live Sync Outsider";
const TEAM_PROJECT = "Live Sync";
const OUTSIDER_PROJECT = "Outsider Project";

const emptyBlocks = () => ({ engine: "blocks", nodes: [], edges: [] });
const oldAws = () => ({
  nodes: [
    {
      id: "old-aws-s3",
      type: "awsService",
      position: { x: 300, y: 200 },
      data: { label: "S3", img: "/aws/s3.png", variables: { resource_name: "old-bucket" } },
    },
  ],
  edges: [],
});
const TEAM_DIAGRAMS: { name: string; start: () => unknown }[] = [
  { name: "Shared diagram", start: () => FIXTURE.saved },
  { name: "Second diagram", start: emptyBlocks },
  { name: "Old AWS diagram", start: oldAws },
];

interface User {
  key: string;
  id: string;
  email: string;
  name: string;
  createdAt: string;
  token: string;
  exp: number;
}

// The answers from A list their rows under "data"; one row may come back alone.
const rows = (json: any): any[] => (Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []);
const emailOf = (key: string) => `live-sync-${key}@clutter.localhost`;

// Find a user by email, or add them. Returns the row as A stores it.
function findOrAddUser(key: string, name: string): User {
  const email = emailOf(key);
  let row = sql(`SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM users WHERE email = '${email}';`);
  if (!row) {
    const id = randomUUID();
    sql(`INSERT INTO users (id, email, full_name, picture_url) VALUES ('${id}', '${email}', '${name}', '');`);
    row = sql(`SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM users WHERE email = '${email}';`);
  }
  const [id, createdAt] = row.split("|") as [string, string];
  const exp = inADay();
  return { key, id, email, name, createdAt, exp, token: sign({ id, email, name }, exp, undefined, createdAt) };
}

async function findOrMakeOrg(owner: User, name: string): Promise<string> {
  const found = rows((await api("GET", "/organization", owner.token)).json).find((o) => o.name === name);
  if (found) return found.id;
  return (await must("POST", "/organization", owner.token, { organizationName: name, description: "Live sync browser tests" })).data.id;
}

async function findOrMakeProject(owner: User, orgId: string, name: string): Promise<string> {
  const found = rows((await api("GET", `/project?organizationId=${orgId}`, owner.token)).json).find((p) => p.name === name);
  if (found) return found.id;
  return (await must("POST", "/project", owner.token, { organizationId: orgId, name, description: "Live sync browser tests" })).data.id;
}

// Returns the diagram's id and whether this run filled it.
async function findOrMakeDiagram(owner: User, projectId: string, name: string, start: () => unknown, reset: boolean): Promise<{ id: string; filled: boolean }> {
  const found = rows((await api("GET", `/diagram?projectId=${projectId}`, owner.token)).json).find((d) => d.name === name);
  const id: string = found ? found.id : (await must("POST", "/diagram", owner.token, { projectId, name })).data.id;
  if (!found || reset) {
    await must("PUT", "/diagram", owner.token, { projectId, diagramId: id, name, data: start() });
    return { id, filled: true };
  }
  return { id, filled: false };
}

// What a real sign-in leaves in the browser (frontend lib/features/user/api.ts,
// and the devserver's /dev/login): the clutter_token cookie and google_data.
function signInFiles(u: User, orgId: string): void {
  const login = {
    message: "existing user retrieved",
    token: u.token,
    exp: u.exp,
    user_data: { uuid: u.id, email: u.email, full_name: u.name, picture_url: "", created_at: u.createdAt },
  };
  const current = { state: { organizationId: orgId }, version: 0 };
  const maxAge = u.exp - Math.floor(Date.now() / 1000);

  const snippet = `// Signs this browser profile in as ${u.name} on the local Clutter. Paste in the console on ${ORIGIN}.
(() => {
  if (location.origin !== ${JSON.stringify(ORIGIN)}) { alert("Open ${ORIGIN} first, then paste this again."); return; }
  document.cookie = "clutter_token=" + encodeURIComponent(${JSON.stringify(u.token)}) + "; Path=/; SameSite=Lax; Max-Age=${maxAge}";
  localStorage.setItem("google_data", ${JSON.stringify(JSON.stringify(login))});
  localStorage.setItem("clutter-current-organization", ${JSON.stringify(JSON.stringify(current))});
  location.href = "/dashboard";
})();
`;
  const storage = {
    cookies: [{ name: "clutter_token", value: u.token, domain: "localhost", path: "/", expires: u.exp, httpOnly: false, secure: false, sameSite: "Lax" }],
    origins: [
      {
        origin: ORIGIN,
        localStorage: [
          { name: "google_data", value: JSON.stringify(login) },
          { name: "clutter-current-organization", value: JSON.stringify(current) },
        ],
      },
    ],
  };
  writeFileSync(join(OUT, `${u.key}-signin.js`), snippet, { mode: 0o600 });
  writeFileSync(join(OUT, `${u.key}-storage.json`), JSON.stringify(storage, null, 2), { mode: 0o600 });
}

// Opens a socket to the sync service as a user and returns its close code,
// or "joined" when the service let them in and sent the document.
function tryJoin(u: User, diagramId: string, projectId: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/${diagramId}?projectId=${projectId}`, {
      headers: { Origin: ORIGIN, Cookie: `clutter_token=${encodeURIComponent(u.token)}` },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve("no answer");
    }, 5000);
    ws.on("error", () => {});
    ws.once("message", () => {
      clearTimeout(timer);
      ws.close();
      resolve("joined");
    });
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve(String(code));
    });
  });
}

async function remove(): Promise<void> {
  const users = PEOPLE.map((p) => ({ p, row: sql(`SELECT id FROM users WHERE email = '${emailOf(p.key)}';`) }));
  for (const { p, row } of users) {
    if (!row) continue;
    const u = findOrAddUser(p.key, p.name);
    for (const o of rows((await api("GET", "/organization", u.token)).json)) {
      if (o.name === TEAM_ORG || o.name === OUTSIDER_ORG) {
        const r = await api("DELETE", `/organization/${o.id}`, u.token);
        console.log(`removed organization "${o.name}": ${r.status}`);
      }
    }
  }
  const ids = users.filter((x) => x.row).map((x) => `'${x.row}'`);
  if (ids.length) sql(`DELETE FROM users WHERE id IN (${ids.join(",")});`);
  rmSync(OUT, { recursive: true, force: true });
  console.log(`removed ${ids.length} test users and their sign-in files`);
}

async function main(): Promise<void> {
  if (MODE === "--remove") return remove();

  const [A, B, C, D] = PEOPLE.map((p) => findOrAddUser(p.key, p.name)) as [User, User, User, User];

  const team = await findOrMakeOrg(A, TEAM_ORG);
  const outsider = await findOrMakeOrg(D, OUTSIDER_ORG);
  // There is no invite route, so B and C join the team in SQL.
  sql(`INSERT INTO organization_members (organization_id, member_id) VALUES ('${team}', '${B.id}'), ('${team}', '${C.id}') ON CONFLICT DO NOTHING;`);

  const project = await findOrMakeProject(A, team, TEAM_PROJECT);
  const outsiderProject = await findOrMakeProject(D, outsider, OUTSIDER_PROJECT);
  const diagrams: Record<string, { id: string; filled: boolean }> = {};
  for (const d of TEAM_DIAGRAMS) diagrams[d.name] = await findOrMakeDiagram(A, project, d.name, d.start, MODE === "--reset");
  const outsiderDiagram = await findOrMakeDiagram(D, outsiderProject, "Outsider diagram", emptyBlocks, false);

  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  chmodSync(OUT, 0o700);
  for (const u of [A, B, C]) signInFiles(u, team);
  signInFiles(D, outsider);

  const url = (p: string, d: string) => `${ORIGIN}/projects/${p}/diagram/${d}`;
  const shared = diagrams["Shared diagram"]!.id;
  const summary = {
    note: "No tokens here. Sign-in files are beside this one.",
    users: [A, B, C, D].map((u) => ({ key: u.key.toUpperCase(), name: u.name, email: u.email, id: u.id })),
    team: { organization: team, project, diagrams: Object.fromEntries(Object.entries(diagrams).map(([n, d]) => [n, { id: d.id, url: url(project, d.id) }])) },
    outsider: { organization: outsider, project: outsiderProject, diagram: { id: outsiderDiagram.id, url: url(outsiderProject, outsiderDiagram.id) } },
    loginsEndAt: new Date(A.exp * 1000).toISOString(),
  };
  writeFileSync(join(OUT, "users.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });

  // Check that what we made works the way the tests need it to.
  const problems: string[] = [];
  const checks: string[] = [];
  const expect = (what: string, got: string, want: string) => {
    checks.push(`${got === want ? "ok  " : "BAD "} ${what}: ${got}`);
    if (got !== want) problems.push(`${what}: got ${got}, want ${want}`);
  };
  for (const u of [A, B, C, D]) {
    const names = rows((await api("GET", "/organization", u.token)).json).map((o) => o.name);
    expect(`${u.name} sees the team organization`, String(names.includes(TEAM_ORG)), String(u !== D));
  }
  for (const u of [A, B, C, D]) {
    expect(`${u.name} reads the shared diagram`, String((await api("GET", `/diagram?projectId=${project}&diagramId=${shared}`, u.token)).status), u === D ? "404" : "200");
  }
  const live = await fetch(WS.replace(/^ws/, "http") + "/healthz").then(
    (r) => r.ok,
    () => false,
  );
  if (live) {
    for (const u of [A, B, C, D]) expect(`${u.name} joins the shared diagram live`, await tryJoin(u, shared, project), u === D ? "4404" : "joined");
    expect("the old AWS diagram is refused live", await tryJoin(A, diagrams["Old AWS diagram"]!.id, project), "4400");
  } else {
    checks.push("--   the live sync service is not running, so live joins were not checked");
  }

  console.log(`Test users are ready (API ${API}).\n`);
  for (const u of [A, B, C, D]) console.log(`  ${u.key.toUpperCase()}  ${u.name.padEnd(24)} ${u.email}`);
  console.log(`\nTeam organization "${TEAM_ORG}" (A, B, C), project "${TEAM_PROJECT}":`);
  for (const [n, d] of Object.entries(diagrams)) console.log(`  ${n.padEnd(16)} ${url(project, d.id)}${d.filled ? (MODE === "--reset" ? "  (reset)" : "  (new)") : ""}`);
  console.log(`Outsider organization "${OUTSIDER_ORG}" (D): ${url(outsiderProject, outsiderDiagram.id)}`);
  console.log(`\nChecks:\n  ${checks.join("\n  ")}`);
  console.log(`\nSign in a browser profile as a user: open ${ORIGIN}, open the console, and paste the`);
  console.log(`contents of one of these files. Logins end at ${summary.loginsEndAt}; run this again for new ones.`);
  for (const u of [A, B, C, D]) console.log(`  ${u.key.toUpperCase()}: ${join(OUT, `${u.key}-signin.js`)}`);
  console.log(`Playwright storage files (for automated browser tests): ${join(OUT, "<a|b|c|d>-storage.json")}`);
  if (problems.length) {
    console.error(`\n${problems.length} check(s) failed:\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("test-users: failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
