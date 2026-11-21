# collaboration

The live sync service. It lets several signed-in users edit the same building-block diagram at once. It is a Node service that uses Yjs over WebSockets, with one room per diagram.

`npm run dev` starts it with the rest of Clutter. The website does not connect to it yet.

## How it works

- The browser connects to `ws://localhost:8791/<diagramId>?projectId=<projectId>` and sends the `clutter_token` cookie.
- The service calls A's `GET /diagram` with that token. A decides if the user may open the diagram.
- The first user in a room gets the saved diagram. After that, every change is sent to everyone in the room.
- The service has no JWT secret and no database access. It never saves. The editor's Save button does that.
- A room is dropped 30 seconds after the last user leaves. Changes that were not saved are lost.
- Only building-block diagrams work. Old AWS diagrams are refused.

## Run it

Use Node 22 (`nvm use` at the repo root). There is no build step.

`npm run dev` starts the service and `npm run stop` stops it. The start message has a `Live sync:` line with the address, or the reason it is off. Clutter still runs when it is off.

To run it by hand:

```bash
cd backend/collaboration
npm ci
npm start
```

It needs A's API running (`npm run dev:backend`).

```bash
curl http://127.0.0.1:8791/healthz     # {"status":"ok"}
```

## Test it

Run these in `backend/collaboration`. They need no database and no running app.

```bash
npm run typecheck     # no errors
npm test              # 5 files, 105 tests pass
```

### Against the real app

These need the app running (`npm run dev`). Run them from the repo root. The scripts are in `tests/scripts`.

```bash
backend/collaboration/tests/scripts/run-live-tests.sh   # 45 tests pass
backend/collaboration/tests/scripts/test-users.sh       # test users for the browser
```

- `run-live-tests.sh` tests the service with A's real API, real local users and the frontend's own `y-websocket` client. It makes its own users and data and removes them at the end.
- `test-users.sh` makes four users that stay: A, B and C in the organization "Live Sync Team", and D in "Live Sync Outsider". It also makes a project with a shared building-block diagram (the sample in `test/fixtures`), a second one and an old AWS diagram, plus a diagram for D. Running it again keeps what exists and signs fresh logins, which last 24 hours. `--reset` puts the team's diagrams back to how they started, and `--remove` deletes it all.
- To sign a browser profile in as one of the users, open `http://localhost:3000`, open the console, and paste that user's `*-signin.js` file. The script prints where the files are, in `backend/devserver/.state/live-sync-users`. The same folder has Playwright storage files for automated browser tests. The files hold login tokens, so never share or commit them. Git ignores `.state`.

## Settings

All are optional environment variables. A bad value stops the service at start.

| Variable | Default | Meaning |
| --- | --- | --- |
| `COLLAB_HOST` | `127.0.0.1` | Address to listen on. Must be this machine. |
| `COLLAB_PORT` | `8791` | Port to listen on. |
| `COLLAB_API_URL` | `http://localhost:8787` | A's API. |
| `COLLAB_ALLOWED_ORIGINS` | `http://localhost:3000` | Websites that may connect, separated by commas. |
| `COLLAB_ACCESS_TIMEOUT_MS` | `5000` | How long to wait for A's API. |
| `COLLAB_MAX_MESSAGE_BYTES` | `1048576` | Largest message a client may send. |
| `COLLAB_MAX_CLIENTS_PER_ROOM` | `20` | Most connections in one room. |
| `COLLAB_MAX_ROOMS` | `100` | Most rooms at one time. |
| `COLLAB_ROOM_IDLE_MS` | `30000` | How long an empty room is kept. |
| `COLLAB_PING_MS` | `30000` | How often each client is pinged. |
| `COLLAB_REFUSE_DELAY_MS` | `1000` | How long a refused socket is held before it is closed. |

## Close codes

A browser cannot read the HTTP status of a failed WebSocket. So the service opens the socket and then closes it with one of these codes.

| Code | Meaning |
| --- | --- |
| 4400 | `projectId` is missing, the diagram is not a building-block diagram, or a message could not be read |
| 4401 | Not signed in, or the login ended |
| 4403 | The website's address is not allowed |
| 4404 | The diagram does not exist, or the user has no access |
| 4429 | The room or the service is full |
| 4500 | A's API could not be reached |

The `y-websocket` client reconnects after every close. The editor must stop it on 4400, 4401, 4403 and 4404.

## The shared document

The saved format is B's (`blocksDocument.ts` in the frontend). The shared Yjs document holds the same data in three maps:

```text
nodes : node id -> { kind, name, position: {x, y}, fields: one entry per field }
edges : edge id -> { source, target }
meta  : { name, saved: { hash, by, at } }
```

- `meta.saved.hash` is the hash of the last saved diagram. The editor shows "Saved" when the current hash matches it.
- `test/fixtures` has a sample diagram in both formats, with its hash. The frontend's conversion must give the same results.

## Presence

Each client can share who it is: `{ user: { id, name, color } }`. The service ignores presence where `user.id` is not the signed-in user. One user cannot change another user's presence.

## Notes

- Never log a token, a cookie or diagram content.
- Keep Yjs on version 13, the same as the frontend.
- `vitest` is pinned to 4.0.8, the same as the frontend. Version 4.1.12 does not install with npm 10.9.9.
- The service listens on this machine only and has no TLS.
- A user who loses access to a diagram stays in the room until they disconnect or their login ends.
