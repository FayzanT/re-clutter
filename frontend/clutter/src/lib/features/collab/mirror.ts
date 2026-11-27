// Drawing other people's edits on this browser's canvas. When the shared
// document changes from elsewhere, the editor rebuilds its nodes and edges
// from it (fromBlocksDocument(readShared(...))), then keeps what is this
// browser's own: what is selected, the sizes React Flow measured, and the
// whole of any block being dragged or box being resized here, so a remote
// edit never yanks it from under the pointer. Nothing of this is shared.
//
// A redraw can also land between a local edit and its write: React applies
// the editor's update and the redraw in one render, before the write runs.
// So the merge is three-way. `prev` is the diagram the canvas last held in
// step with the room (in saved form). A block or line this browser added or
// removed since prev is kept that way; in a block this browser changed, the
// parts it changed (name, place, size, each field) are kept over the room's.
// The next write sends them; everything else comes from the room.

import { parentsFirst, toBlocksDocument, type BlockEdge, type BlockNode, type BlocksDocument, type BlocksDocumentNode } from "../diagram/blocksDocument";
import { stableJson } from "./sharedDoc";

export function mergeNodes(local: BlockNode[], rebuilt: BlockNode[], prev: BlocksDocument | null = null): BlockNode[] {
  const mine = new Map(local.map((n) => [n.id, n]));
  const was = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
  const now = new Map(toBlocksDocument(local, []).nodes.map((n) => [n.id, n]));

  const out: BlockNode[] = [];
  for (const n of rebuilt) {
    const l = mine.get(n.id);
    if (!l) {
      // Removed here but not yet written: keep it removed.
      if (prev && was.has(n.id)) continue;
      out.push(n);
      continue;
    }
    if (l.dragging || l.resizing) {
      out.push({ ...l, data: n.data });
      continue;
    }
    const base: BlockNode = l.measured ? { ...n, selected: l.selected, measured: l.measured } : { ...n, selected: l.selected };
    const w = was.get(n.id);
    const c = now.get(n.id);
    out.push(prev && w && c ? keepLocal(base, l, w, c) : base);
  }
  // Added here but not yet written.
  const inRoom = new Set(rebuilt.map((n) => n.id));
  if (prev) for (const l of local) if (!inRoom.has(l.id) && !was.has(l.id)) out.push(l);
  return parentsFirst(out);
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

// keepLocal lays this browser's unwritten changes to one block (local, whose
// saved form is now, against was) over the room's version (room): its name,
// its place (and box), its size, and each field it changed. The rest is the
// room's, so another person's edit to another part of the block is kept.
function keepLocal(room: BlockNode, local: BlockNode, was: BlocksDocumentNode, now: BlocksDocumentNode): BlockNode {
  if (same(was, now)) return room;
  const out: BlockNode = { ...room, data: { ...room.data, fields: { ...room.data.fields } } };
  if (was.data.name !== now.data.name) out.data.name = local.data.name;
  if (!same(was.position, now.position) || room.parentId !== local.parentId) {
    out.position = local.position;
    out.data.networkEdgeId = local.data.networkEdgeId;
    if (local.parentId) out.parentId = local.parentId;
    else delete out.parentId;
  }
  if (was.width !== now.width || was.height !== now.height) {
    out.width = local.width;
    out.height = local.height;
  }
  for (const k of new Set([...Object.keys(was.data.fields), ...Object.keys(now.data.fields)])) {
    if (same(was.data.fields[k], now.data.fields[k])) continue;
    if (k in local.data.fields) out.data.fields[k] = local.data.fields[k];
    else delete out.data.fields[k];
  }
  return out;
}

export function mergeEdges(local: BlockEdge[], rebuilt: BlockEdge[], prev: BlocksDocument | null = null): BlockEdge[] {
  const mine = new Map(local.map((e) => [e.id, e]));
  const was = new Set((prev?.edges ?? []).map((e) => e.id));
  const out: BlockEdge[] = [];
  for (const e of rebuilt) {
    const l = mine.get(e.id);
    // Removed here but not yet written: keep it removed.
    if (!l && prev && was.has(e.id)) continue;
    out.push(l?.selected ? { ...e, selected: true } : e);
  }
  // Drawn here but not yet written.
  const inRoom = new Set(rebuilt.map((e) => e.id));
  if (prev) for (const l of local) if (!inRoom.has(l.id) && !was.has(l.id)) out.push(l);
  return out;
}

// mergeName keeps a name typed here but not yet written.
export function mergeName(local: string, room: string, prev: string | null): string {
  return prev !== null && local !== prev ? local : room;
}
