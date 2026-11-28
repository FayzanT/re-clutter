import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { BlocksDocument } from "../diagram/blocksDocument";
import { canonical, readSavedMark, readShared, savedHash, sizeOf, stableJson } from "./sharedDoc";
import { docFrom, fixture } from "./testHelpers";

// A diagram with a box size, a name outside ASCII, a self edge and a repeated
// pair. REF_HASH was computed by the service's savedHash (2026-11-26), so it
// proves the two copies agree on sizes and edge cleaning, not only on the sample.
const sized: BlocksDocument = {
  engine: "blocks",
  nodes: [
    { id: "net-1", type: "network", position: { x: 40, y: 60 }, width: 300, height: 220, data: { name: "lan", fields: { cidr: "10.0.0.0/24" } } },
    { id: "vm-1", type: "vm", position: { x: 80, y: 110.5 }, data: { name: "web", fields: { flavor: "m1.small", ports: [80], public: true, note: null } } },
    { id: "vol-1", type: "volume", position: { x: -20, y: 400 }, data: { name: "data", fields: {} } },
  ],
  edges: [
    { id: "vm-1-in-net-1", source: "vm-1", target: "net-1" },
    { id: "e2", source: "vol-1", target: "vm-1" },
    { id: "e1", source: "vol-1", target: "vm-1" },
    { id: "e0", source: "vm-1", target: "vm-1" },
  ],
};
const SIZED_NAME = "Sized diagram ✓";
const REF_HASH = "abe192304c2a7649c1f4c6db764340ffab3e99abc51f404a0dc56bb99d46a4df";

describe("savedHash", () => {
  it("gives the sample's hash for the saved diagram", async () => {
    expect(await savedHash(fixture.name, fixture.saved)).toBe(fixture.hash);
  });

  it("gives the service's hash for a diagram with a box size and bad edges", async () => {
    expect(await savedHash(SIZED_NAME, sized)).toBe(REF_HASH);
  });

  it("does not depend on the order of nodes, edges or keys", async () => {
    const shuffled: BlocksDocument = {
      engine: "blocks",
      edges: [...fixture.saved.edges].reverse(),
      nodes: [...fixture.saved.nodes].reverse().map((n) => ({ data: { fields: n.data.fields, name: n.data.name }, position: n.position, type: n.type, id: n.id })),
    };
    expect(await savedHash(fixture.name, shuffled)).toBe(fixture.hash);
  });

  it("changes when the name, a position, a field or a box size changes", async () => {
    const moved = structuredClone(fixture.saved);
    moved.nodes[0]!.position.x += 1;
    const edited = structuredClone(fixture.saved);
    edited.nodes[0]!.data.fields.flavor = "m1.large";
    const resized = structuredClone(sized);
    resized.nodes[0]!.width = 301;
    const hashes = await Promise.all([
      savedHash(fixture.name, fixture.saved),
      savedHash("Other", fixture.saved),
      savedHash(fixture.name, moved),
      savedHash(fixture.name, edited),
      savedHash(SIZED_NAME, resized),
      savedHash(SIZED_NAME, sized),
    ]);
    expect(new Set(hashes).size).toBe(6);
  });
});

describe("readShared", () => {
  it("reads the sample's shared maps as its saved diagram", async () => {
    const { name, document } = readShared(docFrom(fixture.shared));
    expect(name).toBe(fixture.name);
    expect(document).toEqual(canonical(fixture.saved));
    expect(await savedHash(name, document)).toBe(fixture.hash);
  });

  it("matches the hash the service wrote in meta.saved", async () => {
    const ydoc = docFrom(fixture.shared);
    const { name, document } = readShared(ydoc);
    expect(readSavedMark(ydoc)).toEqual({ hash: fixture.hash, by: null, at: null });
    expect(await savedHash(name, document)).toBe(readSavedMark(ydoc)!.hash);
  });

  it("reads a box size and gives the service's hash", async () => {
    const shared = {
      nodes: Object.fromEntries(
        sized.nodes.map((n) => [
          n.id,
          { kind: n.type, name: n.data.name, position: n.position, ...(n.width ? { size: { width: n.width, height: n.height } } : {}), fields: n.data.fields },
        ]),
      ),
      edges: Object.fromEntries(sized.edges.map((e) => [e.id, { source: e.source, target: e.target }])),
      meta: { name: SIZED_NAME },
    };
    const { name, document } = readShared(docFrom(shared));
    expect(document.nodes.find((n) => n.id === "net-1")).toMatchObject({ width: 300, height: 220 });
    expect(await savedHash(name, document)).toBe(REF_HASH);
  });

  it("skips what another client wrote wrong", () => {
    const ydoc = docFrom(fixture.shared);
    ydoc.transact(() => {
      const bad = new Y.Map<unknown>();
      bad.set("kind", 7);
      ydoc.getMap("nodes").set("bad-kind", bad);
      ydoc.getMap("nodes").set("not-a-map", { kind: "vm" });
      ydoc.getMap("edges").set("bad-edge", { source: "node-vm" });
      const net = ydoc.getMap("nodes").get("node-net") as Y.Map<unknown>;
      net.set("size", { width: "wide", height: 160 });
      net.set("position", "here");
    });
    const { document } = readShared(ydoc);
    expect(document.nodes.map((n) => n.id)).toEqual(["node-net", "node-vm", "node-vol"]);
    expect(document.edges.map((e) => e.id)).toEqual(["edge-vm-net", "edge-vol-vm"]);
    const net = document.nodes.find((n) => n.id === "node-net")!;
    expect(net.position).toEqual({ x: 0, y: 0 });
    expect("width" in net || "height" in net).toBe(false);
  });

  it("drops edges whose block is gone, after a delete", () => {
    const ydoc = docFrom(fixture.shared);
    ydoc.getMap("nodes").delete("node-vol");
    expect(readShared(ydoc).document.edges.map((e) => e.id)).toEqual(["edge-vm-net"]);
  });
});

describe("helpers", () => {
  it("sizeOf keeps a size only when both numbers are positive", () => {
    expect(sizeOf(260, 160)).toEqual({ width: 260, height: 160 });
    for (const [w, h] of [[260, undefined], [0, 160], [-5, 160], ["260", 160], [Number.NaN, 160], [Number.POSITIVE_INFINITY, 160]]) {
      expect(sizeOf(w, h)).toBeNull();
    }
  });

  it("stableJson sorts keys and has no spaces", () => {
    expect(stableJson({ b: [1, { d: null, c: "x" }], a: true })).toBe('{"a":true,"b":[1,{"c":"x","d":null}]}');
  });

  it("readSavedMark is null when meta.saved is missing or wrong", () => {
    const ydoc = new Y.Doc();
    expect(readSavedMark(ydoc)).toBeNull();
    ydoc.getMap("meta").set("saved", { hash: 5 });
    expect(readSavedMark(ydoc)).toBeNull();
  });
});
