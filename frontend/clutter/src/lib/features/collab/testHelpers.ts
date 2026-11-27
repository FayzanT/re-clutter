// Test helpers for the collab tests. Not used by the app.

import { readFileSync } from "node:fs";
import * as Y from "yjs";
import type { BlocksDocument } from "../diagram/blocksDocument";

export type SharedJson = { nodes: Record<string, Record<string, unknown>>; edges: Record<string, unknown>; meta: Record<string, unknown> };

// The sync service's sample diagram, in both formats, with its hash. The
// service tests its own copy against the same file.
export const fixture = JSON.parse(
  readFileSync(new URL("../../../../../../backend/collaboration/test/fixtures/blocks-doc.json", import.meta.url), "utf8"),
) as { name: string; saved: BlocksDocument; shared: SharedJson; hash: string };

// docFrom builds a Y.Doc from the toJSON() form of the three maps, the way
// the service fills a room. Only tests do this; the browser never fills a room.
export function docFrom(shared: SharedJson): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    for (const [id, n] of Object.entries(shared.nodes)) {
      const node = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(n)) {
        if (k !== "fields") node.set(k, v);
      }
      const fields = new Y.Map<unknown>();
      for (const [k, v] of Object.entries((n.fields ?? {}) as Record<string, unknown>)) fields.set(k, v);
      node.set("fields", fields);
      ydoc.getMap("nodes").set(id, node);
    }
    for (const [id, e] of Object.entries(shared.edges)) ydoc.getMap("edges").set(id, e);
    for (const [k, v] of Object.entries(shared.meta)) ydoc.getMap("meta").set(k, v);
  });
  return ydoc;
}

// sync exchanges every update between two documents, as the service would.
export function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

// copyOf is a second browser that has caught up with a.
export function copyOf(a: Y.Doc): Y.Doc {
  const b = new Y.Doc();
  sync(a, b);
  return b;
}
