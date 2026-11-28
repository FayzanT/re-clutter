import { describe, expect, it } from "vitest";
import { fromBlocksDocument, toBlocksDocument, type BlockNode } from "../diagram/blocksDocument";
import { closeAction, collabUrl } from "./connection";
import { mergeEdges, mergeName, mergeNodes } from "./mirror";
import { readShared } from "./sharedDoc";
import { copyOf, docFrom, fixture, sync } from "./testHelpers";
import { applyChanges } from "./writeDoc";
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

describe("a redraw between a local edit and its write", () => {
  // Found in the browser test: three people adding a block at once kept only
  // one, because a redraw landed before the other two adds were written.
  it("keeps a block added here, and still writes it, when someone else's add arrives first", () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    const read = (d: typeof a) => {
      const { name, document } = readShared(d);
      return { name, ...fromBlocksDocument(document) };
    };
    // B's canvas, in step with the room.
    let bCanvas = read(b);
    let bBase = { name: bCanvas.name, document: toBlocksDocument(bCanvas.nodes, bCanvas.edges) };
    // B adds a block; React has drawn it but the write has not run yet.
    const mine: BlockNode = { id: "b-new", type: "block", position: { x: 0, y: 0 }, data: { kind: "volume", name: "b", fields: {} } };
    bCanvas = { ...bCanvas, nodes: [...bCanvas.nodes, mine] };
    // A adds a block, and it reaches B.
    const before = read(a);
    const aNode: BlockNode = { id: "a-new", type: "block", position: { x: 5, y: 5 }, data: { kind: "vm", name: "a", fields: {} } };
    applyChanges(a, { name: before.name, document: toBlocksDocument(before.nodes, before.edges) }, { name: before.name, document: toBlocksDocument([...before.nodes, aNode], before.edges) });
    sync(a, b);
    // B redraws from the room, then writes what is still its own.
    const room = read(b);
    const merged = { name: mergeName(bCanvas.name, room.name, bBase.name), nodes: mergeNodes(bCanvas.nodes, room.nodes, bBase.document), edges: mergeEdges(bCanvas.edges, room.edges, bBase.document) };
    bBase = { name: room.name, document: toBlocksDocument(room.nodes, room.edges) };
    applyChanges(b, bBase, { name: merged.name, document: toBlocksDocument(merged.nodes, merged.edges) });
    sync(a, b);
    for (const d of [a, b]) expect(Object.keys(d.getMap("nodes").toJSON()).sort()).toEqual(["a-new", "b-new", "node-net", "node-vm", "node-vol"]);
  });

  const node = (id: string, name = id): BlockNode => ({ id, type: "block", position: { x: 0, y: 0 }, data: { kind: "volume", name, fields: {} } });
  const prev = toBlocksDocument([node("a"), node("b"), node("c")], [{ id: "e1", source: "a", target: "b" }]);

  it("keeps blocks changed or removed here, and takes the room's other changes", () => {
    const local = [node("a", "renamed-here"), node("b")]; // c removed here
    const room = [node("a"), node("b", "renamed-there"), node("c"), node("d")];
    const merged = mergeNodes(local, room, prev);
    expect(merged.map((n) => [n.id, n.data.name])).toEqual([
      ["a", "renamed-here"],
      ["b", "renamed-there"],
      ["d", "d"],
    ]);
  });

  it("keeps the room's edit to one field and this browser's edit to another field of the same block", () => {
    const withFields = (name: string, fields: Record<string, unknown>): BlockNode => ({ ...node("a", name), data: { kind: "volume", name, fields } });
    const was = toBlocksDocument([withFields("a", { x: "old", y: "old" })], []);
    const local = [withFields("a", { x: "old", y: "mine" })];
    const room = [withFields("a-renamed", { x: "theirs", y: "old" })];
    const merged = mergeNodes(local, room, was);
    expect(merged[0]!.data).toEqual({ kind: "volume", name: "a-renamed", fields: { x: "theirs", y: "mine" } });
  });

  it("drops a block the room removed that was not changed here", () => {
    expect(mergeNodes([node("a"), node("b"), node("c")], [node("a"), node("c")], prev).map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("keeps lines drawn or removed here", () => {
    const merged = mergeEdges([{ id: "e2", source: "b", target: "c" }], [{ id: "e1", source: "a", target: "b" }, { id: "e3", source: "c", target: "a" }], prev);
    expect(merged.map((e) => e.id)).toEqual(["e3", "e2"]);
  });

  it("keeps a name typed here", () => {
    expect(mergeName("typed", "room", "old")).toBe("typed");
    expect(mergeName("old", "room", "old")).toBe("room");
    expect(mergeName("x", "room", null)).toBe("room");
  });
});
