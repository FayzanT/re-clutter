import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { fromBlocksDocument, toBlocksDocument, type BlockEdge, type BlockNode } from "../diagram/blocksDocument";
import { readShared, savedHash } from "./sharedDoc";
import { copyOf, docFrom, fixture, sync } from "./testHelpers";
import { applyChanges, LOCAL, writeWhole, type Diagram } from "./writeDoc";

type Canvas = { name: string; nodes: BlockNode[]; edges: BlockEdge[] };

// What a browser draws after joining: the room's diagram through
// fromBlocksDocument, as the editor does.
const drawn = (ydoc: Y.Doc): Canvas => {
  const { name, document } = readShared(ydoc);
  return { name, ...fromBlocksDocument(document) };
};
const form = (c: Canvas): Diagram => ({ name: c.name, document: toBlocksDocument(c.nodes, c.edges) });
const editNode = (c: Canvas, id: string, f: (n: BlockNode) => BlockNode): Canvas => ({ ...c, nodes: c.nodes.map((n) => (n.id === id ? f(n) : n)) });
const setField = (c: Canvas, id: string, k: string, v: unknown) => editNode(c, id, (n) => ({ ...n, data: { ...n.data, fields: { ...n.data.fields, [k]: v } } }));

// change applies one editor action and writes it, as the editor's mirror does.
function change(ydoc: Y.Doc, c: Canvas, f: (c: Canvas) => Canvas): Canvas {
  const next = f(c);
  applyChanges(ydoc, form(c), form(next), LOCAL);
  return next;
}

const fields = (ydoc: Y.Doc, id: string) => readShared(ydoc).document.nodes.find((n) => n.id === id)?.data.fields;

describe("applyChanges", () => {
  it("writes nothing when nothing changed, even though the drawing differs from the room", () => {
    const ydoc = docFrom(fixture.shared);
    const c = drawn(ydoc);
    // On load the editor lays the box out: its saved form differs from the room's.
    expect(form(c).document).not.toEqual(readShared(ydoc).document);
    let updates = 0;
    ydoc.on("update", () => updates++);
    applyChanges(ydoc, form(c), form(c));
    expect(updates).toBe(0);
  });

  it("adds a block with its fields as a nested map, in one transaction", () => {
    const ydoc = docFrom(fixture.shared);
    let tx = 0;
    ydoc.on("afterTransaction", () => tx++);
    change(ydoc, drawn(ydoc), (c) => ({
      ...c,
      nodes: [...c.nodes, { id: "new-1", type: "block", position: { x: 10, y: 20 }, data: { kind: "volume", name: "logs", fields: { size: 20 } } }],
    }));
    expect(tx).toBe(1);
    const node = ydoc.getMap("nodes").get("new-1") as Y.Map<unknown>;
    expect(node.get("fields")).toBeInstanceOf(Y.Map);
    expect(readShared(ydoc).document.nodes.find((n) => n.id === "new-1")).toEqual({
      id: "new-1",
      type: "volume",
      position: { x: 10, y: 20 },
      data: { name: "logs", fields: { size: 20 } },
    });
  });

  it("keeps both edits when two people change different fields of one block", () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    change(a, drawn(a), (c) => setField(c, "node-vm", "flavor", "m1.large"));
    change(b, drawn(b), (c) => setField(c, "node-vm", "image", "ubuntu"));
    sync(a, b);
    for (const d of [a, b]) expect(fields(d, "node-vm")).toMatchObject({ flavor: "m1.large", image: "ubuntu", ports: [80, 443] });
  });

  it("never writes back an old value over a newer edit this browser has not drawn yet", () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    const bCanvas = drawn(b);
    change(a, drawn(a), (c) => setField(c, "node-vm", "flavor", "m1.large"));
    sync(a, b);
    // B has the update but has not redrawn; it renames the block.
    change(b, bCanvas, (c) => editNode(c, "node-vm", (n) => ({ ...n, data: { ...n.data, name: "api" } })));
    sync(a, b);
    for (const d of [a, b]) {
      const vm = readShared(d).document.nodes.find((n) => n.id === "node-vm")!;
      expect(vm.data.name).toBe("api");
      expect(vm.data.fields.flavor).toBe("m1.large");
    }
  });

  it("keeps a move and a rename of one block made at the same time", () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    change(a, drawn(a), (c) => editNode(c, "node-vol", (n) => ({ ...n, position: { x: 900, y: 50 } })));
    change(b, drawn(b), (c) => editNode(c, "node-vol", (n) => ({ ...n, data: { ...n.data, name: "archive" } })));
    sync(a, b);
    for (const d of [a, b]) {
      expect(readShared(d).document.nodes.find((n) => n.id === "node-vol")).toMatchObject({ position: { x: 900, y: 50 }, data: { name: "archive" } });
    }
  });

  it("removes a field only when this browser removed it", () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    const bCanvas = drawn(b);
    change(a, drawn(a), (c) => setField(c, "node-vm", "image", "ubuntu"));
    sync(a, b);
    change(b, bCanvas, (c) =>
      editNode(c, "node-vm", (n) => {
        const rest = { ...n.data.fields };
        delete rest.tags;
        return { ...n, data: { ...n.data, fields: rest } };
      }),
    );
    sync(a, b);
    expect(fields(a, "node-vm")).toEqual({ flavor: "m1.small", ports: [80, 443], image: "ubuntu" });
  });

  it("removes a block and every line to it in one transaction, even a line drawn elsewhere", () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    // B draws a new line to the volume; A removes the volume without seeing it.
    change(b, drawn(b), (c) => ({ ...c, edges: [...c.edges, { id: "edge-new", source: "node-net", target: "node-vol" }] }));
    sync(a, b);
    const aCanvas = { ...drawn(a), edges: drawn(a).edges.filter((e) => e.id !== "edge-new") };
    let tx = 0;
    a.on("afterTransaction", () => tx++);
    change(a, aCanvas, (c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== "node-vol"), edges: c.edges.filter((e) => e.source !== "node-vol" && e.target !== "node-vol") }));
    expect(tx).toBe(1);
    expect([...a.getMap("edges").keys()]).toEqual(["edge-vm-net"]);
  });

  it("does not draw a line to a block someone else removed meanwhile", async () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    const bCanvas = drawn(b);
    change(a, drawn(a), (c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== "node-vol"), edges: c.edges.filter((e) => e.source !== "node-vol") }));
    sync(a, b);
    change(b, bCanvas, (c) => ({ ...c, edges: [...c.edges, { id: "edge-late", source: "node-net", target: "node-vol" }] }));
    sync(a, b);
    expect(b.getMap("edges").has("edge-late")).toBe(false);
    const { name, document } = readShared(a);
    expect(document.edges.every((e) => document.nodes.some((n) => n.id === e.target))).toBe(true);
    expect(await savedHash(name, document)).toBe(await savedHash(name, readShared(b).document));
  });

  it("writes a box's size and its VMs' places the first time a change touches it", () => {
    const a = docFrom(fixture.shared);
    // The sample's network has no size (A drops it), so the editor lays it out.
    expect((a.getMap("nodes").get("node-net") as Y.Map<unknown>).has("size")).toBe(false);
    const c = change(a, drawn(a), (cur) => editNode(cur, "node-vm", (n) => ({ ...n, position: { x: 60, y: 60 } })));
    const net = readShared(a).document.nodes.find((n) => n.id === "node-net")!;
    expect(net).toMatchObject({ width: 260, height: 170 });
    // Another browser draws the VM where it was put, not back in a column.
    const b = copyOf(a);
    const vmThere = drawn(b).nodes.find((n) => n.id === "node-vm")!;
    expect(vmThere.parentId).toBe("node-net");
    expect(vmThere.position).toEqual({ x: 60, y: 60 });
    expect(form(drawn(b)).document).toEqual(form(c).document);
  });

  it("writes a box's new size whole", () => {
    const a = docFrom(fixture.shared);
    change(a, drawn(a), (c) => editNode(c, "node-net", (n) => ({ ...n, width: 400, height: 300 })));
    expect((a.getMap("nodes").get("node-net") as Y.Map<unknown>).get("size")).toEqual({ width: 400, height: 300 });
  });

  it("writes the diagram's name", () => {
    const a = docFrom(fixture.shared);
    change(a, drawn(a), (c) => ({ ...c, name: "Renamed" }));
    expect(a.getMap("meta").get("name")).toBe("Renamed");
  });

  it("lets Undo reverse only this browser's own edits", () => {
    const a = docFrom(fixture.shared);
    const b = copyOf(a);
    const undo = new Y.UndoManager([a.getMap("nodes"), a.getMap("edges"), a.getMap("meta")], { trackedOrigins: new Set([LOCAL]) });
    change(a, drawn(a), (c) => setField(c, "node-vm", "flavor", "m1.large"));
    change(b, drawn(b), (c) => editNode(c, "node-vm", (n) => ({ ...n, data: { ...n.data, name: "api" } })));
    sync(a, b);
    undo.undo();
    sync(a, b);
    for (const d of [a, b]) {
      const vm = readShared(d).document.nodes.find((n) => n.id === "node-vm")!;
      expect(vm.data.fields.flavor).toBe("m1.small");
      expect(vm.data.name).toBe("api");
    }
  });
});

describe("writeWhole", () => {
  it("makes the room hold the drawn diagram, so its hash is the saved hash", async () => {
    const a = docFrom(fixture.shared);
    const target = form(drawn(a));
    writeWhole(a, target);
    const { name, document } = readShared(a);
    expect(await savedHash(name, document)).toBe(await savedHash(target.name, target.document));
    expect(document.nodes.find((n) => n.id === "node-net")).toMatchObject({ width: 260, height: 170 });
  });

  it("writes nothing when the room already holds the diagram", () => {
    const a = docFrom(fixture.shared);
    writeWhole(a, form(drawn(a)));
    let updates = 0;
    a.on("update", () => updates++);
    writeWhole(a, form(drawn(a)));
    expect(updates).toBe(0);
  });
});
