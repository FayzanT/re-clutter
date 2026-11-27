// The shared Yjs document that the live sync service (backend/collaboration)
// keeps for each building-block diagram, and its hash. It holds the same facts
// as B's saved format (diagram/blocksDocument.ts), split so that two people
// editing different things never overwrite each other:
//
//   nodes : node id -> Y.Map { kind, name, position: {x, y}, size: {width, height} (boxes only), fields: Y.Map }
//   edges : edge id -> { source, target }
//   meta  : { name, saved: { hash, by, at } }
//
// The service has its own copy of this reading and of the hash
// (backend/collaboration/src/blocks.ts). The two must give the same results,
// or "Saved" never shows; both are tested against
// backend/collaboration/test/fixtures/blocks-doc.json. Never import the
// service's code here: a second copy of yjs in the page breaks sync silently.
//
// The browser never fills the document. The service fills a new room from the
// saved diagram.

import * as Y from "yjs";
import { BLOCKS_ENGINE, type BlocksDocument, type BlocksDocumentEdge, type BlocksDocumentNode } from "../diagram/blocksDocument";

export const NODES = "nodes";
export const EDGES = "edges";
export const META = "meta";

// What meta.saved holds: the hash of the last saved diagram, who saved it and
// when. The service writes by and at as null when it fills a room.
export type SavedMark = { hash: string; by: string | null; at: string | null };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

// sizeOf is a box size, kept only when width and height are both positive
// numbers, as the service reads it.
export function sizeOf(width: unknown, height: unknown): { width: number; height: number } | null {
  return positive(width) && positive(height) ? { width, height } : null;
}

// Compare ids with < and >, never localeCompare, which can order differently
// on another machine and so give another hash.
const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// canonical puts a document in a fixed order: nodes and edges sorted by id,
// then edges to a missing node, from a node to itself, or repeating an earlier
// source and target pair removed.
export function canonical(doc: BlocksDocument): BlocksDocument {
  const nodes = [...doc.nodes].sort(byId);
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: BlocksDocumentEdge[] = [];
  for (const e of [...doc.edges].sort(byId)) {
    const key = `${e.source}\u0000${e.target}`;
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target || seen.has(key)) continue;
    seen.add(key);
    edges.push(e);
  }
  return { engine: BLOCKS_ENGINE, nodes, edges };
}

// stableJson is JSON text with every object's keys in sorted order and no spaces.
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// savedHash is the SHA-256, as lowercase hex, of a diagram's name and content.
// The editor shows "Saved" when the shared document's hash equals meta.saved.hash.
export async function savedHash(name: string, doc: BlocksDocument): Promise<string> {
  const { nodes, edges } = canonical(doc);
  const bytes = new TextEncoder().encode(stableJson({ name, nodes, edges }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// readShared reads the shared document back into the saved format, in
// canonical order. Any client can write anything, so every value is checked:
// a node that is not a map or whose kind is not a string is skipped, a bad
// position reads as 0, a bad size is dropped, and a bad edge is skipped.
export function readShared(ydoc: Y.Doc): { name: string; document: BlocksDocument } {
  const nodes: BlocksDocumentNode[] = [];
  ydoc.getMap(NODES).forEach((node, id) => {
    if (!(node instanceof Y.Map)) return;
    const kind = node.get("kind");
    if (typeof kind !== "string") return;
    const name = node.get("name");
    const pos = node.get("position");
    const raw = node.get("size");
    const size = isRecord(raw) ? sizeOf(raw.width, raw.height) : null;
    const fields = node.get("fields");
    const out: BlocksDocumentNode = {
      id,
      type: kind,
      position: {
        x: isRecord(pos) && typeof pos.x === "number" ? pos.x : 0,
        y: isRecord(pos) && typeof pos.y === "number" ? pos.y : 0,
      },
      data: {
        name: typeof name === "string" ? name : "",
        fields: fields instanceof Y.Map ? (fields.toJSON() as Record<string, unknown>) : {},
      },
    };
    if (size) {
      out.width = size.width;
      out.height = size.height;
    }
    nodes.push(out);
  });

  const edges: BlocksDocumentEdge[] = [];
  ydoc.getMap(EDGES).forEach((edge, id) => {
    if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") return;
    edges.push({ id, source: edge.source, target: edge.target });
  });

  const name = ydoc.getMap(META).get("name");
  return { name: typeof name === "string" ? name : "", document: canonical({ engine: BLOCKS_ENGINE, nodes, edges }) };
}

// readSavedMark reads meta.saved, or null when it is missing or not readable.
export function readSavedMark(ydoc: Y.Doc): SavedMark | null {
  const saved = ydoc.getMap(META).get("saved");
  if (!isRecord(saved) || typeof saved.hash !== "string") return null;
  return {
    hash: saved.hash,
    by: typeof saved.by === "string" ? saved.by : null,
    at: typeof saved.at === "string" ? saved.at : null,
  };
}
