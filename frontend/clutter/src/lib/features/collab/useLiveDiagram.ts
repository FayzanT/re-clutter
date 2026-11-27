"use client";

// useLiveDiagram joins a building-block diagram's live room and mirrors the
// editor's canvas to it (COLLAB_FRONTEND_GUIDE rules, backend/collaboration/README.md).
//
// The editor keeps its canvas in its own React state, as it always has. This
// hook:
//   - waits for the first sync, never fills the room itself, then draws the
//     room's diagram on the canvas;
//   - after each local change, writes only what changed (writeDoc.ts), at most
//     every DRAG_MS while a block is dragged, and always the final position;
//   - draws other people's changes, keeping this browser's selection and any
//     block it is dragging (mirror.ts);
//   - shares who is here, and lists the others (presence.ts);
//   - knows whether the room matches the last save (meta.saved.hash), and keeps
//     the diagram as it was at that moment for the deploy panel;
//   - undoes only this browser's own edits.
// With live sync off, refused or never connected, it does nothing and the
// editor works alone, exactly as before, for the rest of the page visit.

import { useCallback, useEffect, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { fromBlocksDocument, toBlocksDocument, type BlockEdge, type BlockNode } from "../diagram/blocksDocument";
import { closeAction, collabUrl, FIRST_SYNC_MS, NO_FIRST_SYNC, type LiveState } from "./connection";
import { mergeEdges, mergeNodes } from "./mirror";
import { localPresence, peersFrom, type Peer } from "./presence";
import { EDGES, META, NODES, readSavedMark, readShared, savedHash, type SavedMark } from "./sharedDoc";
import { applyChanges, LOCAL, writeWhole, type Diagram } from "./writeDoc";

// At most one position write per DRAG_MS while a block is dragged.
const DRAG_MS = 50;

// SAVING is the origin of what a save writes: the diagram it saves and
// meta.saved. Undo does not track it, so Undo never "unsaves".
const SAVING = { origin: "save" } as const;

export type LiveCanvas = {
  nodes: BlockNode[];
  edges: BlockEdge[];
  name: string;
  setNodes: (f: (cur: BlockNode[]) => BlockNode[]) => void;
  setEdges: (f: (cur: BlockEdge[]) => BlockEdge[]) => void;
  setName: (name: string) => void;
};

export type LiveDiagram = {
  state: LiveState;
  // True while the room is in use: the shared document is the source of truth.
  live: boolean;
  // True while waiting for the first sync: the canvas must not be edited yet.
  waiting: boolean;
  peers: Peer[];
  // Whether the room matches the last save; null when not live or not known yet.
  dirty: boolean | null;
  // The diagram as it was when it last matched the last save, for the deploy panel.
  savedDiagram: Diagram | null;
  saved: SavedMark | null;
  undo: () => void;
  redo: () => void;
  // Ends the current undo step, so the next edit is a step of its own.
  stopCapturing: () => void;
  // A save: beforeSave writes the diagram into the room and returns its
  // hash; afterSave marks the room saved with that hash.
  beforeSave: (target: Diagram) => Promise<string | null>;
  afterSave: (hash: string) => void;
};

// The signed-in user: undefined while still loading, null when signed out.
type Me = { userId: string; displayName: string } | null | undefined;

export function useLiveDiagram(opts: { diagramId: string; projectId: string; me: Me; enabled: boolean; canvas: LiveCanvas }): LiveDiagram {
  const { diagramId, projectId, me, enabled, canvas } = opts;
  const url = enabled ? collabUrl(process.env.NEXT_PUBLIC_COLLAB_URL) : null;

  const [state, setState] = useState<LiveState>(() => (url ? { kind: "connecting" } : { kind: "off" }));
  const [peers, setPeers] = useState<Peer[]>([]);
  const [hashes, setHashes] = useState<{ current: string | null; saved: SavedMark | null }>({ current: null, saved: null });
  const [savedDiagram, setSavedDiagram] = useState<Diagram | null>(null);

  // The latest canvas, read by the listeners below.
  const latest = useRef(canvas);
  useEffect(() => {
    latest.current = canvas;
  });

  const room = useRef<{ ydoc: Y.Doc; undo: Y.UndoManager } | null>(null);
  // What this browser last read from or wrote to the room, in saved form:
  // the "before" of the next local change.
  const base = useRef<Diagram | null>(null);
  const lastWrite = useRef(0);
  const dragTimer = useRef<number | null>(null);

  const formOf = (c: LiveCanvas): Diagram => ({ name: c.name, document: toBlocksDocument(c.nodes, c.edges) });

  // flush writes the canvas's changes since base into the room.
  const flush = useCallback(() => {
    if (dragTimer.current !== null) {
      window.clearTimeout(dragTimer.current);
      dragTimer.current = null;
    }
    const r = room.current;
    const before = base.current;
    if (!r || !before) return;
    const after = formOf(latest.current);
    applyChanges(r.ydoc, before, after, LOCAL);
    base.current = after;
    lastWrite.current = Date.now();
  }, []);

  // Join the room. One provider and one document per diagram and user; both
  // are destroyed on unmount (React runs this twice in development).
  const userId = me?.userId ?? null;
  const displayName = me?.displayName ?? "";
  const signedOut = me === null;
  useEffect(() => {
    if (!url || signedOut) return;
    if (!userId) return;
    const ydoc = new Y.Doc();
    const undo = new Y.UndoManager([ydoc.getMap(NODES), ydoc.getMap(EDGES), ydoc.getMap(META)], { trackedOrigins: new Set([LOCAL]) });
    // The cookie carries the login; the token never goes in the URL.
    const provider = new WebsocketProvider(url, diagramId, ydoc, { params: { projectId }, disableBc: true });
    let synced = false;
    let stopped = false;
    let pending = false;
    // Hashes are worked out asynchronously; only the newest one counts.
    let seq = 0;
    setState({ kind: "connecting" });

    const stop = (reason: string) => {
      stopped = true;
      provider.disconnect();
      room.current = null;
      base.current = null;
      setPeers([]);
      setState({ kind: "alone", reason });
    };

    // Draw the room on the canvas, and work out whether it is saved.
    const draw = () => {
      pending = false;
      if (stopped) return;
      // Send any local edit not yet written, so the redraw does not drop it.
      if (base.current) flush();
      const shared = readShared(ydoc);
      const rebuilt = fromBlocksDocument(shared.document);
      const c = latest.current;
      c.setNodes((cur) => mergeNodes(cur, rebuilt.nodes));
      c.setEdges((cur) => mergeEdges(cur, rebuilt.edges));
      if (c.name !== shared.name) c.setName(shared.name);
      base.current = { name: shared.name, document: toBlocksDocument(rebuilt.nodes, rebuilt.edges) };
      void track(shared);
    };
    const track = async (shared: Diagram) => {
      const mine = ++seq;
      const mark = readSavedMark(ydoc);
      const current = await savedHash(shared.name, shared.document);
      if (stopped || mine !== seq) return;
      setHashes({ current, saved: mark });
      if (mark && mark.hash === current) setSavedDiagram(shared);
    };

    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (!synced || stopped) return;
      if (origin === LOCAL || origin === SAVING) {
        // The canvas already shows it; only the saved state can change.
        void track(readShared(ydoc));
        return;
      }
      // Batch a burst of remote updates into one redraw.
      if (!pending) {
        pending = true;
        queueMicrotask(draw);
      }
    };
    ydoc.on("update", onUpdate);

    const firstSync = window.setTimeout(() => {
      if (!synced && !stopped) stop(NO_FIRST_SYNC);
    }, FIRST_SYNC_MS);

    provider.on("sync", (isSynced: boolean) => {
      if (stopped || !isSynced) return;
      if (!synced) {
        synced = true;
        window.clearTimeout(firstSync);
        room.current = { ydoc, undo };
        draw();
      }
      setState({ kind: "live" });
    });
    provider.on("status", ({ status }) => {
      if (stopped || !synced) return;
      if (status === "disconnected") setState((s) => (s.kind === "reconnecting" ? s : { kind: "reconnecting", reason: null }));
    });
    provider.on("connection-close", (event) => {
      if (stopped) return;
      const action = closeAction(event?.code);
      if (action.stop) stop(action.reason);
      else if (synced) setState({ kind: "reconnecting", reason: action.reason });
    });

    provider.awareness.setLocalState(localPresence({ userId, displayName }));
    const onAwareness = () => {
      if (!stopped) setPeers(peersFrom(provider.awareness.getStates() as Map<number, Record<string, unknown>>, ydoc.clientID));
    };
    provider.awareness.on("change", onAwareness);

    return () => {
      stopped = true;
      window.clearTimeout(firstSync);
      if (dragTimer.current !== null) window.clearTimeout(dragTimer.current);
      dragTimer.current = null;
      provider.awareness.off("change", onAwareness);
      ydoc.off("update", onUpdate);
      room.current = null;
      base.current = null;
      undo.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [url, signedOut, userId, displayName, diagramId, projectId, flush]);

  // After each local change, write it: at once, or at most every DRAG_MS
  // while a block is dragged. The drag's end always writes, since the
  // dragged block's position then differs from what was last written, or the
  // timer below catches it.
  useEffect(() => {
    if (!room.current || !base.current) return;
    const dragging = canvas.nodes.some((n) => n.dragging);
    const wait = DRAG_MS - (Date.now() - lastWrite.current);
    if (!dragging || wait <= 0) {
      flush();
      return;
    }
    if (dragTimer.current === null) {
      dragTimer.current = window.setTimeout(() => {
        dragTimer.current = null;
        flush();
      }, wait);
    }
  }, [canvas.nodes, canvas.edges, canvas.name, flush]);

  const undo = useCallback(() => {
    flush();
    room.current?.undo.undo();
  }, [flush]);
  const redo = useCallback(() => {
    flush();
    room.current?.undo.redo();
  }, [flush]);
  const stopCapturing = useCallback(() => room.current?.undo.stopCapturing(), []);

  const beforeSave = useCallback(
    async (target: Diagram) => {
      const r = room.current;
      if (!r) return null;
      flush();
      writeWhole(r.ydoc, target, SAVING);
      base.current = target;
      return savedHash(target.name, target.document);
    },
    [flush],
  );
  const afterSave = useCallback(
    (hash: string) => {
      const r = room.current;
      if (!r || !userId) return;
      r.ydoc.transact(() => r.ydoc.getMap(META).set("saved", { hash, by: userId, at: new Date().toISOString() }), SAVING);
    },
    [userId],
  );

  const live = state.kind === "live" || state.kind === "reconnecting";
  // Signed out: the service would refuse with 4401, so do not ask it.
  const shown: LiveState = url && signedOut ? { kind: "alone", reason: "Sign in again to keep editing live." } : state;
  return {
    state: shown,
    live,
    waiting: shown.kind === "connecting",
    peers: live ? peers : [],
    dirty: live && hashes.current ? hashes.current !== hashes.saved?.hash : null,
    savedDiagram: live ? savedDiagram : null,
    saved: live ? hashes.saved : null,
    undo,
    redo,
    stopCapturing,
    beforeSave,
    afterSave,
  };
}
