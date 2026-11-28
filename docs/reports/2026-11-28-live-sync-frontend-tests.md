# Live sync frontend: test log

Dates: 2026-11-27 (automated) and 2026-11-28 (by hand). Tester: Moiz. Feature: live collaboration on building-block diagrams, now connected to the blocks editor. The sync service it uses is tested in [the backend test log](2026-11-20-live-sync-backend-tests.md).

## Summary

Three signed-in users can edit one building-block diagram together, live. Every check passed. One bug was found by the browser test and fixed before the change was committed.

| Check | Result |
| --- | --- |
| By hand, three users in three Chrome profiles, plus an outsider | 10 of 10 pass |
| Browser scenarios, automated in Chrome | 23 of 23 pass, two runs in a row |
| Frontend unit tests (Vitest) | 55 files, 436 of 436 pass (51 of them new, for live sync) |
| Type-check and lint | no errors (lint has 3 older warnings, none in the new code) |
| Production build | passes |
| B's own workflow test, in Chrome, with live sync on | pass |
| B's own workflow test, in Chrome, with live sync off | pass |
| Smoke test (`npm run smoke`) | 0 fail; B checks 37 of 37 |
| The sync service's live tests | 45 of 45 pass |

## What was built

- The blocks editor joins a live room for the diagram it opens, when the sync service is running. With the service off, refused or unreachable, it works alone, exactly as before.
- Each change a person makes is sent to everyone else in the room, block by block and field by field, so two people editing different things never overwrite each other.
- The top right of the canvas shows who else is here and the state of the connection: connecting, live, reconnecting, or editing alone with the reason.
- "Saved" and "Unsaved changes" are the same for everyone: they compare the shared diagram with its last save, whoever saved it.
- Undo reverses only your own changes while live, never someone else's.
- The canvas is read-only for the moment it takes to connect, so nothing is drawn over.
- The saved format, Save itself, A's old AWS editor and the sync service are unchanged.

## Setup

| Item | Value |
| --- | --- |
| Branch | `feat/live-sync-frontend`, made from `live-diagram-sync` after Rohil merged `main` into it |
| Machine | macOS (Darwin 25.5.0), Apple Silicon |
| Node | 22.23.5 (the version CI uses) |
| Browser | Google Chrome, three or four profiles by hand; headless Chrome for the automated runs |
| App | `npm run dev`, which also starts the sync service (`Live sync: ws://localhost:8791`) |
| Test data | `backend/collaboration/test/live/test-users.sh --reset` before each run |

## By hand (2026-11-28)

Three Chrome profiles were signed in as Test Users A, B and C, and a fourth as D, who is in another organization. All used `http://localhost:3000` and the team's "Shared diagram".

| # | What was done | Expected | Result |
| --- | --- | --- | --- |
| 1 | A, B and C each add a different block at about the same time | Every window shows all three new blocks | pass |
| 2 | A drags a block while B renames it | Both the new place and the new name are kept | pass |
| 3 | A types a startup script and B an SSH key in the same VM at the same time | Both values are kept in every window | pass |
| 4 | A and B each rename a block, then A presses Cmd+Z | Only A's rename is undone | pass |
| 5 | B goes offline; A and C keep editing | B shows "Reconnecting", then catches up when back | pass |
| 6 | B edits while offline | A and C get B's edit when B is back | pass |
| 7 | A presses Save, then someone edits | All three show "Saved", then all three show "Unsaved changes" | pass |
| 8 | C opens a second diagram while A edits the shared one | C is alone there and none of A's edits appear | pass |
| 9 | D opens the team's diagram | It does not open for D | pass |
| 10 | The team's old AWS diagram is opened | A's old AWS editor opens, with no live editing | pass |

Going offline: the app and the sync service run on the same Mac, so turning off Wi-Fi does not take a browser offline. Use Chrome's developer tools instead: Network tab, then "Offline". The editor shows "Reconnecting" after 30 to 40 seconds, when it stops hearing from the service.

## Automated browser scenarios (2026-11-27)

A script drove Test Users A to D in headless Chrome. A separate Yjs client joined the same room and read what the shared diagram really held, so the checks do not rely only on what each screen shows.

| Check | What it shows | Result |
| --- | --- | --- |
| Join | A, B and C are live; A sees "3 people here" with B's and C's initials | pass |
| Identity | The user id the editor shares is the login's own id, so the service accepts it | pass |
| Three adds at once | Four rounds of three people adding a block at the same moment: every block arrives, every canvas matches | pass |
| Move and rename | Both kept | pass |
| Two fields of one block | Both kept | pass |
| Undo | Reverses A's own edit only | pass |
| Offline and back | B's edits made offline arrive; B catches up with A's | pass |
| Delete while connecting | A removes a block while B draws a line to it: no line to a missing block | pass |
| Save | All three show "Saved"; the saved diagram has no line to a missing block; an edit afterwards shows "Unsaved changes" for all three | pass |
| Two diagrams | Edits and presence stay in their own diagram | pass |
| Outsider | D cannot open the team's diagram; D is live alone on their own | pass |
| Service unreachable | "Live editing did not connect. Reload the page to try again."; editing alone works | pass |
| Old AWS diagram | Opens A's editor, with no live editing | pass |
| Two tabs | One person with two tabs is listed once | pass |
| Console | No unexpected browser errors | pass |

## The bug the browser test found

The first browser run showed that edits made at the same moment could be lost. When three people added a block at once, only one or two arrived. When two people changed different fields of the same block at once, one change was lost.

Two causes, both about timing inside the browser:

- When another person's change arrived just after a local edit but before it was sent, the redraw replaced the canvas with the shared copy, which did not have the local edit yet.
- React runs its effects a moment after it draws. If a change arrived in that moment, the editor compared an older canvas with a newer shared copy, and wrote the older values back.

The fix keeps any local change that has not been sent yet when a redraw comes, part by part inside a block (name, place, size, each field). It also sends changes in the same step as the screen updates, and applies redraws at once, so the two can no longer fall out of step. New unit tests reproduce the race; the main one was checked to fail with the fix switched off. After the fix, the same browser checks passed twice in a row, and by hand.

## Known limits

- If the service drops a user after they joined (for example their login ends mid-session), the editor carries on alone. Until the next save it can show "Unsaved changes" when nothing has changed, because of how network boxes are laid out on load.
- A's diagram save does not keep a network box's size, so a saved diagram has none and the editor works sizes out again on load. In a live session the size is shared from the first change that touches the box. Keeping sizes in A's save is a small change to A, outside this work.
- Live editing works on one machine only, at `http://localhost:3000`, because the service listens only on this machine and allows only that address.
- Only Chrome was tested. Firefox and Safari were not.
- If everyone leaves a diagram for 30 seconds without saving, the unsaved changes are lost. That is by design.

## For review

- The change to the blocks editor itself is small (about 50 lines); everything else is new code in the frontend's live sync feature folder. The B team owns the editor, so they should review that part.
- With live sync off, the editor behaves as before. B's own workflow test passes with live sync on and off.
- No packages were added, and Yjs stays on the version the service uses.
