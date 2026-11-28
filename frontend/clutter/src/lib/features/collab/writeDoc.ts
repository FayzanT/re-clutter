// Writing the editor's changes into the shared document (sharedDoc.ts).
//
// The editor keeps its canvas in React state. After each change, it hands us
// the diagram before and after the change, both in B's saved format
// (toBlocksDocument), and we write only what differs between the two, in one
// transaction. Comparing before with after, never after with the shared
// document, matters: the shared document may already hold another person's
// newer edit that this browser has not drawn yet, and comparing with it would
// write the old value back over theirs.
//
// The one exception is a box with no size in the shared document. A's
// PUT /diagram drops a node's width and height, so a diagram loaded from the
// database has no box sizes, and fromBlocksDocument works them out again (and
// lays the box's VMs out in a column). The first change that touches such a
// box writes its size and its VMs' places too, so every browser keeps
// drawing the box the same way.

import * as Y from "yjs";
import { NETWORK_KIND, VM_KIND, type BlocksDocument, type BlocksDocumentNode } from "../diagram/blocksDocument";
import { EDGES, META, NODES, readShared, sizeOf, stableJson } from "./sharedDoc";

// The diagram as the editor shows it: its name and its saved form.
export type Diagram = { name: string; document: BlocksDocument };

// LOCAL is the transaction origin of this browser's own edits. The undo
// manager tracks only this origin, so Undo never reverses someone else's
// edit, and the editor's observer skips it, since the canvas already shows it.
export const LOCAL = { origin: "local edit" } as const;

const sameJson = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

// sharedSize is a shared node's box size, or null when it has none.
function sharedSize(node: unknown): { width: number; height: number } | null {
  if (!(node instanceof Y.Map)) return null;
  const raw = node.get("size") as { width?: unknown; height?: unknown } | undefined;
  return raw && typeof raw === "object" ? sizeOf(raw.width, raw.height) : null;
}

// newNode makes a shared node: kind, name, position, size (boxes only) and
// the fields as a nested map, set one key at a time.
function newNode(n: BlocksDocumentNode): Y.Map<unknown> {
  const node = new Y.Map<unknown>();
  node.set("kind", n.type);
  node.set("name", n.data.name);
  node.set("position", { x: n.position.x, y: n.position.y });
  const size = sizeOf(n.width, n.height);
  if (size) node.set("size", size);
  const fields = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(n.data.fields)) fields.set(k, v);
  node.set("fields", fields);
  return node;
}

// deleteNode removes a block and every shared edge that touches it,
// including edges another person drew that this browser has not drawn yet.
function deleteNode(ydoc: Y.Doc, id: string) {
  ydoc.getMap(NODES).delete(id);
  const edges = ydoc.getMap(EDGES);
  const gone: string[] = [];
  edges.forEach((e, eid) => {
    const r = e as { source?: unknown; target?: unknown } | null;
    if (r && (r.source === id || r.target === id)) gone.push(eid);
  });
  for (const eid of gone) edges.delete(eid);
}

// writeNode writes what changed in one block between before and after: its
// name, position and size whole, and its fields one key at a time.
function writeNode(nodes: Y.Map<unknown>, before: BlocksDocumentNode | undefined, after: BlocksDocumentNode) {
  const node = nodes.get(after.id);
  if (!before || !(node instanceof Y.Map) || node.get("kind") !== after.type) {
    // New, or removed by someone else meanwhile: write it whole.
    nodes.set(after.id, newNode(after));
    return;
  }
  if (before.data.name !== after.data.name) node.set("name", after.data.name);
  if (before.position.x !== after.position.x || before.position.y !== after.position.y) {
    node.set("position", { x: after.position.x, y: after.position.y });
  }
  const size = sizeOf(after.width, after.height);
  if (!sameJson(size, sizeOf(before.width, before.height))) {
    if (size) node.set("size", size);
    else node.delete("size");
  }

  let fields = node.get("fields");
  if (!(fields instanceof Y.Map)) {
    fields = new Y.Map<unknown>();
    node.set("fields", fields);
  }
  const f = fields as Y.Map<unknown>;
  for (const [k, v] of Object.entries(after.data.fields)) {
    if (!(k in before.data.fields) || !sameJson(before.data.fields[k], v)) f.set(k, v);
  }
  for (const k of Object.keys(before.data.fields)) {
    if (!(k in after.data.fields)) f.delete(k);
  }
}

// applyChanges writes the difference between before and after into the
// shared document, in one transaction with the given origin.
export function applyChanges(ydoc: Y.Doc, before: Diagram, after: Diagram, origin: unknown = LOCAL): void {
  const was = new Map(before.document.nodes.map((n) => [n.id, n]));
  const now = new Map(after.document.nodes.map((n) => [n.id, n]));
  const touched = [...new Set([...was.keys(), ...now.keys()])].filter((id) => !sameJson(was.get(id), now.get(id)));
  const wasEdges = new Map(before.document.edges.map((e) => [e.id, e]));
  const nowEdges = new Map(after.document.edges.map((e) => [e.id, e]));
  const changedEdges = [...new Set([...wasEdges.keys(), ...nowEdges.keys()])].filter((id) => !sameJson(wasEdges.get(id), nowEdges.get(id)));
  if (touched.length === 0 && changedEdges.length === 0 && before.name === after.name) return;

  // Each box's VMs after the change, and the boxes the change touches,
  // directly or through one of their VMs.
  const vmsIn = new Map<string, string[]>();
  for (const e of after.document.edges) {
    if (now.get(e.source)?.type === VM_KIND && now.get(e.target)?.type === NETWORK_KIND) {
      vmsIn.set(e.target, [...(vmsIn.get(e.target) ?? []), e.source]);
    }
  }
  const touchedSet = new Set(touched);
  const boxes = [...now.values()].filter(
    (n) => n.type === NETWORK_KIND && (touchedSet.has(n.id) || (vmsIn.get(n.id) ?? []).some((v) => touchedSet.has(v))),
  );

  const nodes = ydoc.getMap(NODES);
  const edges = ydoc.getMap(EDGES);
  ydoc.transact(() => {
    for (const id of touched) {
      const n = now.get(id);
      if (n) writeNode(nodes, was.get(id), n);
      else deleteNode(ydoc, id);
    }

    // A box still without a size takes the one this browser drew, and its
    // VMs the places drawn in it.
    for (const box of boxes) {
      const shared = nodes.get(box.id);
      const size = sizeOf(box.width, box.height);
      if (!(shared instanceof Y.Map) || !size || sharedSize(shared)) continue;
      shared.set("size", size);
      for (const vm of vmsIn.get(box.id) ?? []) {
        const v = now.get(vm);
        const sv = nodes.get(vm);
        if (v && sv instanceof Y.Map && !sameJson(sv.get("position"), v.position)) sv.set("position", { x: v.position.x, y: v.position.y });
      }
    }

    for (const id of changedEdges) {
      const a = nowEdges.get(id);
      if (!a) {
        edges.delete(id);
        continue;
      }
      // Never draw a line to a block someone else has just removed.
      if (!(nodes.get(a.source) instanceof Y.Map) || !(nodes.get(a.target) instanceof Y.Map)) continue;
      edges.set(id, { source: a.source, target: a.target });
    }

    if (before.name !== after.name) ydoc.getMap(META).set("name", after.name);
  }, origin);
}

// writeWhole makes the shared document hold exactly the given diagram, as a
// save does before it hashes. Unlike a normal change it compares with the
// shared document itself, so it also writes what the editor worked out on
// load (box sizes, VMs' places in a box). Use it only for a save.
export function writeWhole(ydoc: Y.Doc, target: Diagram, origin: unknown = LOCAL): void {
  applyChanges(ydoc, readShared(ydoc), target, origin);
}
