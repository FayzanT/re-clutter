"use client";

// Who else has the diagram open, and the state of live editing, for the top
// right of the canvas. Shows nothing when live sync is off.

import { cn } from "../../utils";
import type { Tint } from "../../tint";
import type { LiveState } from "./connection";
import { initials, type Peer } from "./presence";

// Written out whole so Tailwind sees every class.
const RING: Record<Tint, string> = {
  blue: "border-tint-blue-edge",
  violet: "border-tint-violet-edge",
  amber: "border-tint-amber-edge",
  grass: "border-tint-grass-edge",
  orange: "border-tint-orange-edge",
  yellow: "border-tint-yellow-edge",
  cyan: "border-tint-cyan-edge",
  pink: "border-tint-pink-edge",
};

const SHOWN = 4;

function statusText(state: LiveState, others: number): string | null {
  switch (state.kind) {
    case "off":
      return null;
    case "connecting":
      return "Connecting to live editing";
    case "live":
      return others === 0 ? "Live: only you here" : `Live: ${others + 1} people here`;
    case "reconnecting":
      return state.reason ?? "Reconnecting. Your edits are kept and sent when it is back.";
    case "alone":
      return state.reason;
  }
}

export default function LivePresence({ state, peers }: { state: LiveState; peers: Peer[] }) {
  const text = statusText(state, peers.length);
  if (!text) return null;
  const warn = state.kind === "reconnecting" || state.kind === "alone";
  return (
    <div data-testid="live-presence" className="surface-raised flex items-center gap-2 rounded-full border px-2.5 py-1">
      {peers.length > 0 && (
        <ul aria-label="People editing" className="flex -space-x-1.5">
          {peers.slice(0, SHOWN).map((p) => (
            <li
              key={p.id}
              title={p.tabs > 1 ? `${p.name} (${p.tabs} tabs)` : p.name}
              className={cn("bg-background text-foreground flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold", RING[p.color])}>
              <span aria-hidden>{initials(p.name)}</span>
              <span className="sr-only">{p.name}</span>
            </li>
          ))}
          {peers.length > SHOWN && (
            <li className="bg-background text-muted-foreground flex size-6 items-center justify-center rounded-full border text-[10px]">+{peers.length - SHOWN}</li>
          )}
        </ul>
      )}
      <span
        role="status"
        data-live-state={state.kind}
        className={cn("flex items-center gap-1.5 text-xs", warn ? "text-warning" : "text-muted-foreground")}>
        <span aria-hidden className={cn("size-1.5 rounded-full", state.kind === "live" ? "bg-success" : warn ? "bg-warning" : "bg-muted-foreground")} />
        {text}
      </span>
    </div>
  );
}
