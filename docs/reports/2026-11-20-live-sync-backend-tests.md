# Live sync backend: test log

Date: 2026-11-20. Tester: Moiz. Feature: live collaboration on building-block diagrams (the sync service in `backend/collaboration`, built by Rohil).

## Summary

The sync service passed every check. The editor is not connected yet, so the browser checks wait for the frontend.

| Check | Result |
| --- | --- |
| Type-check (`npm run typecheck`) | pass |
| Unit tests (`npm test`) | 5 files, 105 of 105 pass on Node 26 and on Node 22 |
| App start (`npm run dev`) | start message shows `Live sync: ws://localhost:8791` |
| Health check (`GET /healthz`) | `{"status":"ok"}`; any other path gives 404 |
| Smoke test with the service running | A: 32 of 32 routes, 39 calls: 31 pass, 3 need AWS, 5 expected failures, 0 fail. B: 32 of 32 pass |
| Live tests against the real app (new, below) | 45 of 45 pass: twice on Node 26, once on Node 22 |
| Smoke test with the service on Node 22 | same counts, 0 fail |
| Smoke test with the service stopped | same counts, 0 fail; the website still answers 200 |
| Dev script tests (`backend/devserver/test-scripts.sh`) | 45 of 45 pass |
| Test users and data for the browser tests (new, below) | made, checked through the API, the sync service and a real browser |

Nothing failed. Section [Things the frontend must handle](#things-the-frontend-must-handle) lists what the tests showed that the editor work needs to know.

## Setup

| Item | Value |
| --- | --- |
| Branch | `test/live-sync-backend`, made from `origin/live-diagram-sync` at `99999f0` |
| Machine | macOS (Darwin 25.5.0), Apple Silicon |
| Node and npm | Node 26.10.0 with npm 11.19.1 (first runs); Node 22.23.5 with npm 10.9.9 (Node 22 runs) |
| Docker | 28.0.1 |
| App | started with `npm run dev` after `npm run setup` |

Notes on the setup:

- CI runs the service on Node 22. The first runs used Node 26, which the service allows (it needs 22.18 or newer). Everything was then run again on Node 22.23.5, the version CI uses: the type-check, the unit tests, the backend started with `npm run dev:backend` (the sync service itself running on Node 22), the live tests and the smoke test. Results matched.
- Node 22 came from Homebrew (`node@22`, not linked, so `node` stays 26). Installing it updated a library Homebrew's Node 26 shares (`simdjson`), which stopped Node 26 from starting until `brew upgrade node` (26.10.0 to 26.13.1). Anyone installing `node@22` the same way should expect the same.
- The local database was made by an older clone with a different password, so `npm run dev` stopped at first. It was wiped (`npm run stop -- --wipe`) and rebuilt. Only local test data was lost.

## How the live tests work

The unit tests use a fake A and unsigned tokens. The live tests add what they cannot show:

- **A's real API and authorizer.** The service asks A's `GET /diagram` whether each user may join, so tenancy is A's real check.
- **Real users.** Four users are added to the local database, with tokens signed the same way as the log-in Lambda: A, B and C in one organization, and D in another. There is no invite route, so B and C are added to A's organization in SQL.
- **The frontend's own client.** The tests use the `y-websocket` 3.0.0 and `yjs` 13.6.27 copies installed in `frontend/clutter`, which the editor will use.

The data is made through A's API as the users: two projects in the shared organization, a building-block diagram holding the shared sample (`test/fixtures/blocks-doc.json`), a second building-block diagram, an old AWS diagram, and D's own project and diagram. Everything is removed at the end.

Files:

- `backend/collaboration/tests/scripts/run-live-tests.sh` loads the local secrets the same way `smoke.sh` does, checks that A and the service are up, and runs the tests.
- `backend/collaboration/tests/scripts/live-tests.ts` holds the tests.
- `backend/collaboration/tests/scripts/lib.ts` holds the helpers this script and `test-users.sh` share: local logins, SQL and calls to A's API.

Run them again with the app running:

```bash
npm run dev            # or npm run dev:backend
backend/collaboration/tests/scripts/run-live-tests.sh
```

## Live test results

Run 1 at about 21:45 and run 2 at about 21:50 (Central time) on Node 26, and run 3 on Node 22. All three gave the same results. Times are from run 1.

### Setup check

| ID | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| SET-01 | A, B, C and D read the shared diagram through A's API | 200, 200, 200, 404 | 200, 200, 200, 404 | pass |

### Refusals and tenancy

Every refused socket is opened, held for about 1 second, then closed with a code, as the README says.

| ID | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| REF-01 | No login cookie | 4401 | 4401 after 1011 ms | pass |
| REF-02 | A cookie that is not a token | 4401 | 4401 | pass |
| REF-03 | A token signed with another secret | 4401 | 4401 | pass |
| REF-04 | An expired token | 4401 | 4401 | pass |
| REF-05 | Page address `http://evil.example` | 4403 | 4403 | pass |
| REF-06 | No `Origin` header | 4403 | 4403 | pass |
| REF-07 | Page address `http://127.0.0.1:3000` | 4403 (only `localhost:3000` is allowed) | 4403 | pass |
| REF-08 | No `projectId` | 4400 | 4400 | pass |
| REF-09 | An old AWS diagram | 4400 | 4400 | pass |
| REF-10 | A diagram id that does not exist | 4404 | 4404 | pass |
| REF-11 | A diagram id that is not a UUID | 4404 | 4404 | pass |
| REF-12 | D (another organization) joins the shared diagram | 4404 | 4404 | pass |
| REF-13 | D names their own project with the shared diagram's id | 4404 | 4404 | pass |
| REF-14 | A names their second project with a diagram from the first | 4404 | 4404 | pass |
| REF-15 | A joins D's diagram | 4404 | 4404 | pass |
| REF-16 | A refused socket is held before it closes | 800 to 2000 ms | 1004 ms | pass |
| REF-17 | A refused `y-websocket` client keeps retrying | at most 6 tries in 5 s | 4 tries in 5 s, all 4404 | pass |

REF-12 to REF-15 are task 4 of the plan: "another organization is refused" is now shown with real users and A's real check, not only a fake API. REF-13 and REF-14 also show that A checks the diagram belongs to the project and the project to the organization, not only membership.

### Sync and the section 8 cases

| ID | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| SYN-01 | First user in the room gets the saved diagram | same as the sample | 3 nodes, 2 edges, name "Demo diagram" | pass |
| SYN-02 | The room's saved hash | the sample's hash `b7b72b6b...` | the same hash; `by` and `at` empty | pass |
| SYN-03 | B and C join | three equal documents | equal | pass |
| SYN-04 | A adds a VM, B a network, C a volume, at once | all see all three | all have 6 nodes, equal | pass |
| SYN-05 | A moves a VM while B renames it | both kept | position (999, 111) and the new name | pass |
| SYN-06 | A and B edit different fields of one block | both kept | flavor `m1.large` and ports `[22]` | pass |
| SYN-07 | A and B set the same field at once | everyone ends with one value | all settled on `10.1.0.0/24` | pass |
| SYN-08 | A deletes a VM while B connects an edge to it | the saved form has no edge to a missing block | the shared document keeps the edge, and the saved form drops it | pass, see below |
| SYN-09 | B drops off, A and C edit, B comes back | B catches up | B had both edits after reconnecting | pass |
| SYN-10 | B edits while offline, then reconnects (roadmap 16.4) | B's edits reach the others | B's offline block reached A and C, and A's edit reached B | pass |
| SYN-11 | A user joins late | gets the live state, not the saved copy | saw every live edit | pass |
| SYN-12 | Two diagrams open at once | no edits cross | each room held only its own edit | pass |

### Presence

| ID | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| PRE-01 | Each user's presence reaches the others | A sees B and C by user id | A sees A, B and C | pass |
| PRE-02 | Presence between diagrams | a user in the second diagram sees nobody from the first | nobody | pass |
| PRE-03 | C claims to be A | ignored | A never saw it | pass |
| PRE-04 | B leaves | B's presence goes away | gone within 5 s | pass |

### Bad messages, limits and sessions

| ID | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| LIM-01 | A message over 1 MiB | closed with 1009 | 1009; the others stay connected | pass |
| LIM-02 | A text message | 4400 | 4400 | pass |
| LIM-03 | A binary message that is not a Yjs message | 4400; the room still works | 4400; A, B and C still sync | pass |
| LIM-04 | The login ends during the session | 4401 at the end time | synced, then 4401 | pass |
| LIM-05 | B is removed from the organization while connected | B stays until they reconnect, then 4404 (README, Notes) | B still received edits; a new connection got 4404 | pass, see below |
| CAP-01 | A third user in a room limited to 2; a second room when the limit is 1 | 4429 | 4429 and 4429 | pass |
| UP-01 | A's API cannot be reached | 4500 | 4500 | pass |
| CFG-01 | Listening on `0.0.0.0` | refuses to start | exits: "COLLAB_HOST must be 127.0.0.1, ::1 or localhost" | pass |

CAP-01 and UP-01 start a second copy of the service on ports 8792 and 8793 with their own settings, so the running app is not changed.

### Rooms

| ID | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| ROOM-01 | Everyone leaves and comes back within 30 s | unsaved edits still there | still there after 3 s | pass |
| ROOM-02 | Everyone leaves for more than 30 s | room dropped; the next user gets the saved copy | after 32 s, the saved copy | pass, see below |

### Security

| ID | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| LOG-01 | The service's log | no token, cookie or diagram content | 3 lines, none of them | pass |

## Test users and data for the browser tests (tasks 1 and 2)

Before this, the local sign-in had one user. `test-users.sh` now makes the people and data the three-user browser tests need, and keeps them until they are removed. It does not change any of the B team's files. Like the smoke test, it adds users in SQL and signs their logins with the devserver's local secret.

| What | Made |
| --- | --- |
| Users | Test User A, B and C, and Test User D (outsider), with emails `live-sync-a@clutter.localhost` to `live-sync-d@clutter.localhost` |
| Organizations | "Live Sync Team" with A, B and C (B and C join in SQL, because there is no invite route), and "Live Sync Outsider" with D |
| Project and diagrams | "Live Sync" in the team, with "Shared diagram" (building blocks, the shared sample), "Second diagram" (building blocks, empty) and "Old AWS diagram" (A's format). "Outsider Project" with "Outsider diagram" for D |
| Sign-in | per user, a snippet to paste in a browser profile's console on `http://localhost:3000`, and a Playwright storage file, in `backend/devserver/.state/live-sync-users` (readable only by the owner; git ignores `.state`) |

The snippet sets what a real sign-in leaves in the browser: the `clutter_token` cookie, the `google_data` entry and the chosen organization. Logins last 24 hours, like a real one. Running the script again signs new ones.

How it was checked (2026-11-20, Node 26.13.1):

| ID | Check | Result |
| --- | --- | --- |
| USR-01 | First run makes everything, then checks it: A, B and C see the team and D does not; A, B and C read the shared diagram (200) and D gets 404; A, B and C join it live and D gets 4404; the old AWS diagram is refused live (4400) | 13 of 13 checks ok |
| USR-02 | Second run reuses what exists | same ids; still 4 users, the team has 3 members, 4 diagrams |
| USR-03 | `--reset` | the three team diagrams go back to how they started |
| USR-04 | `--remove`, then a new run | 0 users and 0 organizations left, sign-in files deleted; the new run passes 13 of 13 checks |
| USR-05 | B signs in with the console snippet in a fresh Chrome profile | lands on the dashboard in "Live Sync Team": 1 project, 3 diagrams, 3 members |
| USR-06 | A, C and D sign in with the storage files | A and C see "Live Sync Team"; D sees only "Live Sync Outsider" |
| USR-07 | A opens the shared diagram | B's building-block editor shows the sample's three blocks (web, main, data) and "Saved" |
| USR-08 | The live tests still pass after the scripts' shared helpers moved to `tests/scripts/lib.ts` | 45 of 45 pass |

USR-05 to USR-07 used Playwright with the Google Chrome installed on the machine, because Playwright's own Chromium download did not finish here. Each check used a new, empty browser profile.

## Things the frontend must handle

These all pass, and the service behaves as its README says. The editor has to deal with them.

1. **Save from the saved form, not the raw shared document** (SYN-08). The shared document can hold an edge to a deleted block for a moment. The service's `canonical` step drops it. The frontend's copy of the conversion must do the same before `PUT /diagram`.
2. **Stop the client on 4400, 4401, 4403 and 4404** (REF-17). `y-websocket` keeps retrying a refused connection, about once a second because of the server's 1 second hold. Without a stop it never ends.
3. **Unsaved edits are lost 30 s after the last person leaves** (ROOM-02). The editor should save, or warn, before the last person leaves.
4. **Same field, same moment: one value wins without a message** (SYN-07). This is normal for Yjs. It may be worth showing in the demo so nobody files it as a bug.
5. **Only `http://localhost:3000` may connect** (REF-07). A person who opens `http://127.0.0.1:3000` gets 4403 and no live sync, although the rest of the app works there. Either the editor shows why, or `dev.sh` also allows `http://127.0.0.1:3000`.

## Points for the decision record

- **A removed member keeps live access until they disconnect** (LIM-05). B was removed from the organization while connected and kept receiving every edit. A new connection was refused. The README states this. A local login lasts 24 hours, so this could last that long. The repo's first rule is tenant isolation, so the ADR for this feature should say whether this is accepted, or whether the service checks access again from time to time.

## Not tested yet (waits for the frontend)

From section 8 of the plan:

- A presses Save, and B and C show "Saved". The service carries the saved hash in `meta.saved`. The editor writes it and shows the label.
- A user from another organization is refused, **and their editor works alone**. The refusal passes (REF-12). The "works alone" half is the editor's.
- The sync service is stopped, **and the editor still works alone**. The app and the smoke test still pass without it. The editor half waits.
- An old AWS diagram opens in A's editor, unchanged. The service refuses it (REF-09). Which editor opens it is the frontend's choice.
- Three users in three browser profiles at once (task 3 and the demo run-through). The users, data and sign-in files for it are ready (above).

## Notes on the test run

- The live tests print a "Yjs was already imported" warning. It comes from the test itself, which loads the frontend's copy of Yjs for the client and the service's copy to compute the saved hash. The two are never mixed, and the service itself loads Yjs once.
- Node prints an "ExperimentalWarning: localStorage" line on Node 26. It does not affect the results.
