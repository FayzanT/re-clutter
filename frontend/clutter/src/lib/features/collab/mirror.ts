// Drawing other people's edits on this browser's canvas. When the shared
// document changes from elsewhere, the editor rebuilds its nodes and edges
// from it (fromBlocksDocument(readShared(...))), then keeps what is this
// browser's own: what is selected, the sizes React Flow measured, and the
// whole of any block being dragged or box being resized here, so a remote
// edit never yanks it from under the pointer. Nothing of this is shared.

import type { BlockEdge, BlockNode } from "../diagram/blocksDocument";

export function mergeNodes(local: BlockNode[], rebuilt: BlockNode[]): BlockNode[] {
  const mine = new Map(local.map((n) => [n.id, n]));
  return rebuilt.map((n) => {
    const l = mine.get(n.id);
    if (!l) return n;
    if (l.dragging || l.resizing) return { ...l, data: n.data };
    const out: BlockNode = { ...n, selected: l.selected };
    if (l.measured) out.measured = l.measured;
    return out;
  });
}

export function mergeEdges(local: BlockEdge[], rebuilt: BlockEdge[]): BlockEdge[] {
  const selected = new Set(local.filter((e) => e.selected).map((e) => e.id));
  return rebuilt.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
}
