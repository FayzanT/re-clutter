// Presence: who else has this diagram open. It uses the provider's awareness,
// is live only and is never saved. Everyone in the room receives it, so it
// holds no token, no email and nothing secret: only the user's id (which the
// service checks against the login token's sub), name and colour.

import type { Tint } from "../../tint";

export type PresenceUser = { id: string; name: string; color: Tint };
export type Peer = PresenceUser & { tabs: number };

const TINTS: Tint[] = ["blue", "violet", "amber", "grass", "orange", "yellow", "cyan", "pink"];

// presenceTint picks a stable colour from a user id, so a person keeps one
// colour on every screen. Other browsers work it out from the id the same
// way, rather than trusting the colour a client sent.
export function presenceTint(id: string): Tint {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

// localPresence is what this browser shares about its user.
export function localPresence(me: { userId: string; displayName: string }): { user: PresenceUser } {
  return { user: { id: me.userId, name: me.displayName, color: presenceTint(me.userId) } };
}

const NAME_MAX = 64;

// peersFrom lists the other people in the room from the awareness states,
// once each however many tabs they have open, skipping this tab and any
// state without a readable user. This browser's own user in another tab is
// listed too, so a second tab shows. Names are cut to NAME_MAX characters.
export function peersFrom(states: Map<number, Record<string, unknown>>, ownClientId: number): Peer[] {
  const byUser = new Map<string, Peer>();
  for (const [clientId, state] of states) {
    if (clientId === ownClientId) continue;
    const u = state?.user as { id?: unknown; name?: unknown } | undefined;
    if (!u || typeof u.id !== "string" || !u.id) continue;
    const name = typeof u.name === "string" && u.name.trim() ? u.name.trim().slice(0, NAME_MAX) : "Someone";
    const seen = byUser.get(u.id);
    if (seen) seen.tabs += 1;
    else byUser.set(u.id, { id: u.id, name, color: presenceTint(u.id), tabs: 1 });
  }
  return [...byUser.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
}

// initials is one or two letters for a person's badge.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
