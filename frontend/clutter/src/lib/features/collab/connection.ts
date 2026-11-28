// How the editor reads the live sync service's answers. The service always
// opens the socket, then closes it with a code (backend/collaboration/README.md
// § Close codes). The y-websocket client retries after every close, whatever
// the code, so the editor must stop it on a refusal.

// The connection as the editor shows it.
//   off:          live sync is not set up here (no NEXT_PUBLIC_COLLAB_URL).
//   connecting:   waiting for the first sync; the canvas is read-only.
//   live:         in the room.
//   reconnecting: was live, the socket dropped; edits wait and are sent on reconnect.
//   alone:        editing alone for the rest of this page visit (refused, or
//                 the first sync never came). Never joins later: reload to.
export type LiveState =
  | { kind: "off" }
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "reconnecting"; reason: string | null }
  | { kind: "alone"; reason: string };

// How long to wait for the first sync before editing alone.
export const FIRST_SYNC_MS = 5000;

// Codes after which the editor must stop retrying and edit alone.
const REFUSALS: Record<number, string> = {
  4400: "Live editing is not available for this diagram.",
  4401: "Sign in again to keep editing live.",
  4403: "Live editing only works at http://localhost:3000.",
  4404: "Live editing is not available for this diagram.",
};

// Codes after which the client keeps retrying, with a message to show.
const BUSY: Record<number, string> = {
  4429: "Too many people, try again shortly.",
  4500: "Live editing cannot reach Clutter right now.",
};

// closeAction says what to do after the service closes the socket: stop and
// edit alone, or keep retrying (with the message to show, if any).
export function closeAction(code: number | undefined): { stop: true; reason: string } | { stop: false; reason: string | null } {
  if (code !== undefined && code in REFUSALS) return { stop: true, reason: REFUSALS[code]! };
  return { stop: false, reason: code !== undefined && code in BUSY ? BUSY[code]! : null };
}

// The message shown when the first sync does not come in time.
export const NO_FIRST_SYNC = "Live editing did not connect. Reload the page to try again.";

// collabUrl is the sync service's address, or null when live sync is off.
export function collabUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}
