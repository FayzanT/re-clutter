import { describe, expect, it } from "vitest";
import type { BlockNode } from "../diagram/blocksDocument";
import { closeAction, collabUrl } from "./connection";
import { mergeEdges, mergeNodes } from "./mirror";
import { initials, localPresence, peersFrom, presenceTint } from "./presence";

describe("closeAction", () => {
  it.each([4400, 4401, 4403, 4404])("stops retrying on %i", (code) => {
    expect(closeAction(code).stop).toBe(true);
  });

  it("asks to sign in again on 4401", () => {
    expect(closeAction(4401).reason).toBe("Sign in again to keep editing live.");
  });

  it.each([
    [4429, "Too many people, try again shortly."],
    [4500, "Live editing cannot reach Clutter right now."],
  ])("keeps retrying on %i, with a message", (code, reason) => {
    expect(closeAction(code)).toEqual({ stop: false, reason });
  });

  it.each([1000, 1001, 1006, undefined])("keeps retrying quietly on %s", (code) => {
    expect(closeAction(code)).toEqual({ stop: false, reason: null });
  });
});

describe("collabUrl", () => {
  it("is off when the address is unset or empty", () => {
    expect(collabUrl(undefined)).toBeNull();
    expect(collabUrl("")).toBeNull();
    expect(collabUrl("  ")).toBeNull();
    expect(collabUrl("ws://localhost:8791")).toBe("ws://localhost:8791");
  });
});

describe("presence", () => {
  it("shares only the id, name and colour", () => {
    const p = localPresence({ userId: "u-1", displayName: "Test User A" });
    expect(p).toEqual({ user: { id: "u-1", name: "Test User A", color: presenceTint("u-1") } });
  });

  it("gives one person the same colour every time", () => {
    expect(presenceTint("some-user-id")).toBe(presenceTint("some-user-id"));
  });

  it("lists each other person once, skips this tab and unreadable states", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: "me", name: "Me" } }],
      [2, { user: { id: "b", name: "Bea" } }],
      [3, { user: { id: "b", name: "Bea" } }],
      [4, { user: { id: "a", name: "  Al  " } }],
      [5, {}],
      [6, { user: { id: 7, name: "Bad" } }],
      [7, { user: { id: "me", name: "Me" } }],
    ]);
    const peers = peersFrom(states, 1);
    expect(peers.map((p) => [p.id, p.name, p.tabs])).toEqual([
      ["a", "Al", 1],
      ["b", "Bea", 2],
      ["me", "Me", 1],
    ]);
    // The colour comes from the id, never from what a client sent.
    const sent = new Map<number, Record<string, unknown>>([[2, { user: { id: "b", name: "Bea", color: "url(evil)" } }]]);
    expect(peersFrom(sent, 1)[0]!.color).toBe(presenceTint("b"));
  });

  it("makes initials", () => {
    expect(initials("Test User A")).toBe("TA");
    expect(initials("moiz")).toBe("MO");
    expect(initials(" ")).toBe("?");
  });
});

describe("mergeNodes", () => {
  const node = (id: string, x: number, extra: Partial<BlockNode> = {}): BlockNode => ({
    id,
    type: "block",
    position: { x, y: 0 },
    data: { kind: "vm", name: id, fields: {} },
    ...extra,
  });

  it("takes the room's blocks but keeps this browser's selection and measured size", () => {
    const local = [node("a", 0, { selected: true, measured: { width: 180, height: 84 } }), node("b", 0)];
    const merged = mergeNodes(local, [node("a", 50), node("c", 9)]);
    expect(merged.map((n) => n.id)).toEqual(["a", "c"]);
    expect(merged[0]).toMatchObject({ position: { x: 50 }, selected: true, measured: { width: 180, height: 84 } });
  });

  it("leaves a block being dragged or resized here where the pointer has it", () => {
    const local = [node("a", 10, { dragging: true }), node("box", 0, { resizing: true, width: 400 })];
    const merged = mergeNodes(local, [node("a", 99, { data: { kind: "vm", name: "renamed", fields: {} } }), node("box", 0, { width: 260 })]);
    expect(merged[0]).toMatchObject({ position: { x: 10 }, dragging: true, data: { name: "renamed" } });
    expect(merged[1]!.width).toBe(400);
  });

  it("keeps selected lines selected", () => {
    const merged = mergeEdges([{ id: "e1", source: "a", target: "b", selected: true }], [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "a" }]);
    expect(merged.map((e) => !!e.selected)).toEqual([true, false]);
  });
});
