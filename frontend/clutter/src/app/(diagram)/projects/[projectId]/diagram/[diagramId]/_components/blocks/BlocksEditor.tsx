"use client";

import IsoStack from "@/components/brand/IsoStack";
import FirstDeployChecklist from "@/components/common/FirstDeployChecklist";
import { SelectionBox } from "@/components/common/CanvasMotif";
import { useTheme } from "@/components/common/ThemeProvider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { adapterErrorMessage } from "@/lib/adapterApi";
import { cloudLookFor, kindIconClass } from "@/lib/features/catalog/display";
import { openAdminPorts, openToEveryoneWarning } from "@/lib/features/catalog/fieldRules";
import { blockFields, blockTitle as titleOf, blockValuesErrors, defaultValues, paletteBlocks } from "@/lib/features/catalog/forms";
import { useCatalog } from "@/lib/features/catalog/hooks";
import { allLinkCards, linkCard, linkCheck, manifestsInPlay } from "@/lib/features/catalog/links";
import LivePresence from "@/lib/features/collab/LivePresence";
import { useLiveDiagram } from "@/lib/features/collab/useLiveDiagram";
import { useConnections } from "@/lib/features/connections/hooks";
import { blockIssues, problemsByBlock, type BlockRef } from "@/lib/features/deployments/compatibility";
import { useCompatibility, useDiagramDeployments, useInvalidateDeploymentChecks, useRunLogs } from "@/lib/features/deployments/hooks";
import { servesWeb } from "@/lib/features/deployments/results";
import { BLOCKS_VIEW, nodeLook, resolveView, viewClouds, viewSummary } from "@/lib/features/deployments/views";
import {
  BOX,
  boxAt,
  defaultBlockName,
  detachFrom,
  fitBoxToChildren,
  freeSpot,
  fromBlocksDocument,
  NETWORK_KIND,
  NETWORK_NODE_TYPE,
  networksWithVM,
  newBlockId,
  nodeTypeFor,
  parentsFirst,
  placeIn,
  toBlocksDocument,
  VM_KIND,
  type BlockEdge,
  type BlockNode as BlockNodeType,
  type BlocksDocument,
} from "@/lib/features/diagram/blocksDocument";
import { diagramNameError } from "@/lib/features/diagram/diagramName";
import { historyShortcut, NO_HISTORY, record, redo, removalLabel, typingIn, undo, undoTo, type CanvasState } from "@/lib/features/diagram/history";
import { liveMarkers } from "@/lib/features/diagram/live";
import { useSaveBlocksDiagram } from "@/lib/features/diagram/hooks";
import { saveStatus } from "@/lib/features/diagram/saveStatus";
import { diagramSummary } from "@/lib/features/diagram/summary";
import type { Diagram } from "@/lib/features/diagram/types";
import { useOrganizations } from "@/lib/features/organization/hooks";
import { effectiveExperience, INSPECTOR_WIDTH, inspectorWidthFrom, usePreferencesStore } from "@/lib/features/preferences/uiStore";
import { useProject, useProjectOrganization } from "@/lib/features/projects/hooks";
import { useMe } from "@/lib/features/user/hooks";
import { ApiError, apiErrorMessage } from "@/lib/features/user/session";
import { cn } from "@/lib/utils";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useConnection,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeDimensionChange,
  type OnBeforeDelete,
  type OnConnectEnd,
  type XYPosition,
} from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import BlockForm, { blockNameProblem } from "./BlockForm";
import BlockPalette, { BLOCK_DND_MIME } from "./BlockPalette";
import { CanvasContext, type Canvas, type EdgeCard } from "./canvasContext";
import { canvasStyle, defaultEdgeOptions, edgeTypes, nodeTypes } from "./canvasSetup";
import CodePanel from "./CodePanel";
import DeployPanel from "./DeployPanel";
import EditorTopBar from "./EditorTopBar";
import KindIcon from "./KindIcon";
import ReadOnlyView from "./ReadOnlyView";
import SummaryPill from "./SummaryPill";
import { useLeaveGuard } from "./useLeaveGuard";
import ViewSwitch from "./ViewSwitch";

// How long a refused line's reason stays on screen.
const REFUSAL_MS = 3500;

// The editor needs a wide screen; below 1024px it shows a read-only view.
const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );

type Snapshot = { name: string; doc: BlocksDocument };
const same = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);

// A's diagram API answers an error with a JSON body holding a reason. A call
// that never reached it (status 0) carries apiFetch's own sentence.
const saveErrorMessage = (err: unknown) =>
  apiErrorMessage(err) ?? (err instanceof ApiError && err.status === 0 ? err.message : "The save failed.");

// Cmd (Mac) or Ctrl click adds a block to the selection, and so does Shift
// click; Shift drag on the canvas still draws a selection box.
const MULTI_SELECT_KEYS = ["Meta", "Control", "Shift"];

// A box's own resize, as React Flow reports it while the handle is dragged
// (resizing true) and when it is let go (false).
const isResize = (c: NodeChange<BlockNodeType>): c is NodeDimensionChange => c.type === "dimensions" && c.resizing !== undefined;

// The middle of a block card whose top left corner is at p.
const cardCenter = (p: XYPosition, n?: BlockNodeType): XYPosition => ({
  x: p.x + (n?.measured?.width ?? BOX.blockW) / 2,
  y: p.y + (n?.measured?.height ?? BOX.blockH) / 2,
});

// The room a new block needs: a card grows with its hint and markers, so it
// asks for more than its starting size.
const sizeOf = (kind: string) => (kind === NETWORK_KIND ? { w: BOX.width, h: BOX.height } : { w: 220, h: 130 });

// B's editor: building blocks from the manifests, saved through A's diagram
// API as a building-block document, deployed through B per linked cloud.
// Networks are boxes and a VM inside one runs in it (ADR-025); every other
// link is a line, and while one is drawn only the blocks it may reach get a ring.
export default function BlocksEditor({ projectId, diagram }: { projectId: string; diagram: Diagram }) {
  const meQ = useMe();
  const token = meQ.data?.token ?? null;
  const orgsQ = useOrganizations(token);
  const orgIds = useMemo(() => orgsQ.data?.map((o) => o.id) ?? null, [orgsQ.data]);
  // Every B call is checked against the project's own organization.
  const orgQ = useProjectOrganization(token, projectId, orgIds);
  const orgId = orgQ.data ?? null;
  const organizationName = orgsQ.data?.find((o) => o.id === orgId)?.name ?? null;
  const projectQ = useProject(token, orgId, projectId);
  // The organization cannot be found: the lookup failed or found none, or the
  // organizations it searches could not be read or are none. B's panels say
  // so instead of waiting for it.
  const orgError =
    !orgId && (orgsQ.isError || (orgsQ.isSuccess && orgsQ.data.length === 0) || orgQ.isError || orgQ.isSuccess)
      ? "Clutter could not find this diagram's team. Reload the page."
      : null;

  const experience = effectiveExperience(usePreferencesStore((s) => s.experience));
  const firstCloud = usePreferencesStore((s) => s.firstCloud);
  const { resolvedTheme } = useTheme();
  const wide = useWide();

  const catalogQ = useCatalog(token);
  const catalog = useMemo(() => catalogQ.data ?? [], [catalogQ.data]);
  const palette = useMemo(() => paletteBlocks(catalog), [catalog]);
  const blockTitle = useCallback((kind: string) => titleOf(catalog, kind), [catalog]);

  // The clouds "View as" offers: those this diagram deploys to or the
  // organization connects to. The deploy panel reads the same two queries.
  const deploymentsQ = useDiagramDeployments(token, orgId, diagram.id);
  const connectionsQ = useConnections(token, orgId);
  const views = useMemo(
    () => viewClouds(catalog, deploymentsQ.data ?? [], connectionsQ.data ?? []),
    [catalog, deploymentsQ.data, connectionsQ.data],
  );
  // The "View as" choice is kept per viewer and diagram in the preferences
  // store (this browser only). With no choice kept, the cloud chosen at
  // onboarding is the default view.
  const keptView = usePreferencesStore((s) => s.blocksView[diagram.id]);
  const setBlocksView = usePreferencesStore((s) => s.setBlocksView);
  const view = resolveView(keptView ?? firstCloud ?? BLOCKS_VIEW, views);
  const currentView = views.find((v) => v.connector === view) ?? null;
  const chooseView = (v: string) => setBlocksView(diagram.id, v);
  // The clouds in play decide which lines may be drawn and what they mean.
  const manifests = useMemo(
    () => manifestsInPlay(catalog, currentView ? [currentView.connector] : views.map((v) => v.connector)),
    [catalog, currentView, views],
  );

  // The deployment the canvas shows: live markers, the code panel and the
  // problem badges follow it. It defaults to the first on the viewed cloud.
  const deployments = useMemo(() => deploymentsQ.data ?? [], [deploymentsQ.data]);
  const [chosenDeployment, setChosenDeployment] = useState<string | null>(null);
  const selectedDeployment =
    deployments.find((d) => d.id === chosenDeployment) ??
    (currentView && deployments.find((d) => d.connector === currentView.connector)) ??
    deployments[0] ??
    null;
  const compatQ = useCompatibility(token, orgId, selectedDeployment?.id ?? null);
  const problems = useMemo(() => problemsByBlock(compatQ.data), [compatQ.data]);
  // The clouds the organization connects to: the palette and the Block panel
  // name only these.
  const connected = useMemo(() => new Set((connectionsQ.data ?? []).map((c) => c.connector)), [connectionsQ.data]);
  const linkedClouds = useMemo(() => [...connected].map((c) => cloudLookFor(catalog, c)), [connected, catalog]);

  const saveM = useSaveBlocksDiagram(token);
  const invalidateChecks = useInvalidateDeploymentChecks();
  const { screenToFlowPosition, setCenter } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [initial] = useState(() => fromBlocksDocument(diagram.data));
  const [nodes, setNodes] = useState<BlockNodeType[]>(initial.nodes);
  const [edges, setEdges] = useState<BlockEdge[]>(initial.edges);
  const [name, setName] = useState(diagram.name ?? "");
  const [saved, setSaved] = useState<Snapshot>(() => ({ name: diagram.name ?? "", doc: toBlocksDocument(initial.nodes, initial.edges) }));

  // Live editing (lib/features/collab): with the sync service running, the
  // diagram's room holds the diagram and this canvas mirrors it. With it off
  // or refused, nothing changes here.
  const live = useLiveDiagram({
    diagramId: diagram.id,
    projectId,
    me: meQ.isPending ? undefined : meQ.data ? { userId: meQ.data.userId, displayName: meQ.data.displayName } : null,
    enabled: true,
    canvas: { nodes, edges, name, setNodes, setEdges, setName },
  });
  // Live, "saved" is the room's last save, whoever made it.
  const [seenSaved, setSeenSaved] = useState(live.savedDiagram);
  if (live.savedDiagram !== seenSaved) {
    setSeenSaved(live.savedDiagram);
    if (live.savedDiagram) setSaved({ name: live.savedDiagram.name, doc: live.savedDiagram.document });
  }
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  // A diagram with no blocks yet opens on the Block tab: there is nothing to
  // deploy until something is drawn.
  const [tab, setTab] = useState<"block" | "deploy">(() => (initial.nodes.length > 0 ? "deploy" : "block"));
  // Terraform users see the code from the start.
  const [codeOpen, setCodeOpen] = useState(() => experience === "terraform");

  // ?panel=deploy opens the Deploy view and ?panel=code the code panel, from
  // a link (the project's Deployments tab) or the checklist.
  const panel = useSearchParams().get("panel");
  const [seenPanel, setSeenPanel] = useState<string | null>(null);
  if (panel !== seenPanel) {
    setSeenPanel(panel);
    if (panel === "deploy") setTab("deploy");
    if (panel === "code") setCodeOpen(true);
  }

  // The inspector's width, kept per viewer in the preferences store.
  const inspectorWidth = inspectorWidthFrom(usePreferencesStore((s) => s.inspectorWidth)) ?? INSPECTOR_WIDTH.start;
  const resize = usePreferencesStore((s) => s.setInspectorWidth);

  const doc = toBlocksDocument(nodes, edges);
  // Live, the room's hash against its last save's; alone, the canvas against
  // the last save here.
  const dirty = live.live ? live.dirty === true : !same({ name, doc }, saved);
  const status = saveStatus({ dirty, saving: saveM.isPending });
  const guard = useLeaveGuard(dirty);
  const selectedNodes = nodes.filter((n) => n.selected);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null;
  // A block selected any way (a click, Enter or Space on a focused block, a
  // selection box) opens the Block tab.
  const selectionKey = selectedNodes.map((n) => n.id).join(",");
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  if (selectionKey !== seenSelection) {
    setSeenSelection(selectionKey);
    if (selectionKey) setTab("block");
  }
  // The networks a VM runs in now: only they show the switch for internet
  // access for private servers.
  const vmNets = networksWithVM(doc);
  const savedSelected = selected ? (saved.doc.nodes.find((n) => n.id === selected.id) ?? null) : null;

  // The box a VM being dragged would drop into, and the kind a palette drag holds.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragKind = useRef<string | null>(null);
  // Why the last line was refused, shown for a moment.
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!refusal) return;
    const t = window.setTimeout(() => setRefusal(null), REFUSAL_MS);
    return () => window.clearTimeout(t);
  }, [refusal]);

  const savedBlocks: BlockRef[] = useMemo(() => saved.doc.nodes.map((n) => ({ id: n.id, kind: n.type, name: n.data.name })), [saved]);
  const currentBlocks: BlockRef[] = useMemo(() => nodes.map((n) => ({ id: n.id, kind: n.data.kind, name: n.data.name })), [nodes]);
  // The saved servers that are a website, for "What was built".
  const webServers = useMemo(
    () => servesWeb(saved.doc.nodes.map((n) => ({ id: n.id, kind: n.type, fields: n.data.fields })), saved.doc.edges),
    [saved],
  );

  // What holds Save back: the diagram's name, then each block's own problem.
  const nameProblem = diagramNameError(name);
  const blockProblems = nodes.flatMap((n) => {
    const label = n.data.name || blockTitle(n.data.kind);
    const msg = blockNameProblem(n.data.kind, n.data.name) ?? blockValuesErrors(n.data.kind, blockFields(catalog, n.data.kind), n.data.fields)[0]?.message;
    return msg ? [{ id: n.id, text: `${label}: ${msg}` }] : [];
  });
  const saveProblem = nameProblem ?? blockProblems[0]?.text ?? null;

  const selectBlock = (id: string) => {
    setNodes((cur) => cur.map((n) => ({ ...n, selected: n.id === id })));
    setTab("block");
    const n = nodes.find((x) => x.id === id);
    if (n) {
      const byId = new Map(nodes.map((x) => [x.id, x]));
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      const abs = parent ? { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y } : n.position;
      void setCenter(abs.x + BOX.blockW / 2, abs.y + BOX.blockH / 2, { zoom: 1, duration: 250 });
    }
  };

  // The canvas as it is now, for the history and an Undo pressed after later edits.
  const canvasNow = useRef<CanvasState>({ nodes, edges });
  useEffect(() => {
    canvasNow.current = { nodes, edges };
  });

  // The undo history of this session (diagram/history.ts).
  const history = useRef(NO_HISTORY);
  // The block whose form is being edited: its edits until the field loses
  // focus are one change.
  const editing = useRef<string | null>(null);

  // commit records the canvas as it is before a change, and returns it.
  const commit = useCallback(() => {
    const before = canvasNow.current;
    history.current = record(history.current, before);
    editing.current = null;
    liveRef.current.stopCapturing();
    return before;
  }, []);

  const restore = (step: ReturnType<typeof undo>) => {
    if (!step) return;
    history.current = step.history;
    editing.current = null;
    setNodes(step.canvas.nodes);
    setEdges(step.canvas.edges);
  };
  // Live, Undo reverses only this person's own edits; the snapshot history
  // would also wipe out everyone else's.
  const undoLast = () => (live.live ? live.undo() : restore(undo(history.current, canvasNow.current)));
  const redoNext = () => (live.live ? live.redo() : restore(redo(history.current, canvasNow.current)));

  // Every removal can be undone from its toast for a few seconds: Undo takes
  // the canvas back to before it, and the keys redo what came after.
  const offerUndo = (before: CanvasState, gone: BlockNodeType[], lines: number) => {
    const what = removalLabel(gone, lines, blockTitle);
    if (!what) return;
    toast(`Removed ${what}`, {
      action: { label: "Undo", onClick: () => (liveRef.current.live ? liveRef.current.undo() : restore(undoTo(history.current, canvasNow.current, before))) },
    });
  };

  // addBlock adds a block with its top left corner at position on the canvas;
  // a VM dropped on a box goes into it.
  const addBlock = useCallback(
    (kind: string, position: XYPosition, box: string | null = null) => {
      // Until the room's diagram arrives, an added block would be drawn over.
      if (liveRef.current.waiting) return;
      const id = newBlockId();
      commit();
      setNodes((cur) => {
        const node: BlockNodeType = {
          id,
          type: nodeTypeFor(kind),
          position,
          selected: true,
          data: {
            kind,
            name: defaultBlockName(kind, cur.map((n) => n.data.name)),
            fields: defaultValues(blockFields(catalog, kind)),
          },
          ...(kind === NETWORK_KIND ? { width: BOX.width, height: BOX.height } : {}),
        };
        const next = parentsFirst([...cur.map((n) => ({ ...n, selected: false })), node]);
        return kind === VM_KIND && box ? placeIn(next, id, box, position) : next;
      });
      setTab("block");
    },
    [catalog, commit],
  );

  // A click or Enter in the palette adds the block at a free spot near the
  // middle of what the canvas shows, so blocks never stack.
  const addAtCenter = (kind: string) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = screenToFlowPosition(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 400, y: 300 });
    addBlock(kind, freeSpot(nodes, center, sizeOf(kind)));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const box = dragKind.current === VM_KIND ? boxAt(nodes, screenToFlowPosition({ x: e.clientX, y: e.clientY })) : null;
    if (box !== dropTarget) setDropTarget(box);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    dragKind.current = null;
    const kind = e.dataTransfer.getData(BLOCK_DND_MIME);
    if (!kind || !palette.some((b) => b.kind === kind)) return;
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const size = sizeOf(kind);
    // The card lands centred under the pointer; a VM over a box goes into it.
    const topLeft = { x: at.x - size.w / 2, y: at.y - size.h / 2 };
    addBlock(kind, topLeft, kind === VM_KIND ? boxAt(nodes, at) : null);
  };

  // While a VM is dragged on the canvas, the box under its middle lights up,
  // unless it is the box the VM is already in. Dropped, the VM moves into
  // that box, or out of its box onto the canvas.
  const boxUnder = useCallback((n: BlockNodeType, all: BlockNodeType[]) => {
    const byId = new Map(all.map((x) => [x.id, x]));
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const abs = parent ? { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y } : n.position;
    return { abs, box: boxAt(all, cardCenter(abs, n)) };
  }, []);

  const onNodeDrag = (_e: React.MouseEvent, n: BlockNodeType) => {
    if (n.data.kind !== VM_KIND) return;
    const { box } = boxUnder(n, nodes);
    const next = box && box !== n.parentId ? box : null;
    if (next !== dropTarget) setDropTarget(next);
  };

  // A drag is one change, recorded when it ends and only when something moved.
  // Dropped, a VM in a box moves off any block it covers there.
  const dragBefore = useRef<CanvasState | null>(null);
  const onDragStart = () => {
    dragBefore.current = canvasNow.current;
    live.stopCapturing();
  };
  const endDrag = (dragged: BlockNodeType[]) => {
    setDropTarget(null);
    const before = dragBefore.current;
    dragBefore.current = null;
    if (before) {
      const was = new Map(before.nodes.map((n) => [n.id, n.position]));
      const moved = dragged.some((d) => {
        const p = was.get(d.id);
        return !p || p.x !== d.position.x || p.y !== d.position.y;
      });
      if (moved) {
        history.current = record(history.current, before);
        editing.current = null;
      }
    }
    setNodes((cur) => {
      let next = cur;
      for (const d of dragged) {
        if (d.data.kind !== VM_KIND) continue;
        const { abs, box } = boxUnder(d, next);
        if (box || d.parentId) next = placeIn(next, d.id, box, abs);
      }
      return next;
    });
  };

  // A box's resize is one change. A box never ends smaller than its VMs.
  const resizing = useRef(false);
  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNodeType>[]) => {
      const resized = changes.filter(isResize);
      if (resized.some((c) => c.resizing) && !resizing.current) {
        commit();
        resizing.current = true;
      }
      if (resized.some((c) => c.resizing === false)) resizing.current = false;
      setNodes((cur) => resized.reduce((next, c) => fitBoxToChildren(next, c.id), applyNodeChanges(changes, cur)));
    },
    [commit],
  );
  const onEdgesChange = useCallback((changes: EdgeChange<BlockEdge>[]) => setEdges((cur) => applyEdgeChanges(changes, cur)), []);
  const onConnect = useCallback(
    (c: Connection) => {
      commit();
      setEdges((cur) => addEdge({ ...c, id: newBlockId() }, cur));
    },
    [commit],
  );

  // Delete and Backspace remove the selection. Removing a box keeps the VMs
  // in it, on the canvas where they were; React Flow would remove them with it.
  const onBeforeDelete: OnBeforeDelete<BlockNodeType, BlockEdge> = async ({ nodes: gone, edges: goneEdges }) => {
    const boxes = new Set(gone.filter((n) => n.type === NETWORK_NODE_TYPE).map((n) => n.id));
    const kept = new Set(gone.filter((n) => n.parentId && boxes.has(n.parentId) && !n.selected).map((n) => n.id));
    const removed = gone.filter((n) => !kept.has(n.id));
    const removedIds = new Set(removed.map((n) => n.id));
    const removedEdges = kept.size === 0 ? goneEdges : goneEdges.filter((e) => e.selected || removedIds.has(e.source) || removedIds.has(e.target));
    offerUndo(commit(), removed, removedEdges.length);
    if (kept.size === 0) return true;
    setNodes((cur) => detachFrom(cur, boxes));
    return { nodes: removed, edges: removedEdges };
  };

  // Which lines may be drawn: the manifests of the clouds in play decide.
  const kindById = useMemo(() => new Map(nodes.map((n) => [n.id, n.data.kind])), [nodes]);
  const check = useCallback(
    (from: string, to: string) => {
      const fk = kindById.get(from);
      const tk = kindById.get(to);
      if (!fk || !tk) return { ok: false as const, reason: "" };
      return linkCheck(manifests, { id: from, kind: fk }, { id: to, kind: tk }, edges, (id) => kindById.get(id), blockTitle);
    },
    [manifests, kindById, edges, blockTitle],
  );
  const connectingFrom = useConnection((c) => (c.inProgress ? c.fromNode.id : null));

  const isValidConnection: IsValidConnection<BlockEdge> = (c) => !!c.source && !!c.target && check(c.source, c.target).ok;

  const onConnectEnd: OnConnectEnd = (_e, state) => {
    if (!state.fromNode || !state.toNode || state.isValid !== false || state.toNode.id === state.fromNode.id) return;
    const r = check(state.fromNode.id, state.toNode.id);
    if (!r.ok && r.reason) setRefusal(r.reason);
  };

  const patchNode = (id: string, patch: { name?: string; fields?: Record<string, unknown> }) => {
    if (editing.current !== id) {
      commit();
      editing.current = id;
    }
    setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  // removeBlocks removes blocks and their lines. A removed box's VMs that
  // are not removed stay on the canvas, out of the box.
  const removeBlocks = (ids: string[]) => {
    const gone = new Set(ids);
    offerUndo(
      commit(),
      nodes.filter((n) => gone.has(n.id)),
      0,
    );
    setNodes((cur) => detachFrom(cur, gone).filter((x) => !gone.has(x.id)));
    setEdges((cur) => cur.filter((e) => !gone.has(e.source) && !gone.has(e.target)));
  };

  // save stores the canvas; it answers false when it could not (the top bar
  // says why: the problem to fix or the failed save).
  const save = async (): Promise<boolean> => {
    if (saveProblem || !token) return false;
    const trimmed = name.trim();
    const document = toBlocksDocument(nodes, edges);
    // Live, the room first holds exactly what is saved, so its hash is the save's.
    const hash = live.live ? await live.beforeSave({ name: trimmed, document }) : null;
    try {
      await saveM.mutateAsync({ projectId, diagramId: diagram.id, name: trimmed, document });
    } catch {
      return false;
    }
    setName(trimmed);
    setSaved({ name: trimmed, doc: document });
    if (hash) live.afterSave(hash);
    invalidateChecks();
    return true;
  };
  const onSave = () => void save();

  // Ctrl or Cmd + S saves, as in any editor. Ctrl or Cmd + Z undoes the last
  // change to the canvas, and Shift + Ctrl or Cmd + Z or Ctrl + Y redoes it,
  // except in a text field, which keeps its own undo.
  const keysRef = useRef({ save: onSave, undo: undoLast, redo: redoNext });
  useEffect(() => {
    keysRef.current = { save: onSave, undo: undoLast, redo: redoNext };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        keysRef.current.save();
        return;
      }
      const step = historyShortcut(e);
      if (step && liveRef.current.waiting) return;
      if (!step || e.defaultPrevented || typingIn(e.target as HTMLElement | null)) return;
      e.preventDefault();
      keysRef.current[step]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openDeploy = () => {
    setTab("deploy");
    // The selected deployment's one next action takes the focus.
    window.requestAnimationFrame(() => {
      const target = selectedDeployment
        ? document.querySelector<HTMLElement>(`[data-deployment-primary="${selectedDeployment.id}"]`)
        : document.querySelector<HTMLElement>("#side-tab-panel button");
      target?.focus();
    });
  };

  const nameOf = useCallback((id: string) => nodes.find((n) => n.id === id)?.data.name || "(no name)", [nodes]);

  // The blocks the selected deployment's last apply built, from that apply's
  // log, and the connection each one runs on; a block drawn since is not
  // deployed yet (diagram/live.ts).
  const lastApplyLogQ = useRunLogs(token, orgId, selectedDeployment?.last_apply ?? null);
  const markers = useMemo(
    () =>
      liveMarkers(
        selectedDeployment,
        lastApplyLogQ.data ?? null,
        saved.doc.nodes.map((n) => n.id),
        nodes.map((n) => n.id),
      ),
    [selectedDeployment, lastApplyLogQ.data, saved, nodes],
  );
  // Each line is read out by its blocks' names ("Link from web to db").
  const labelledEdges = useMemo(() => {
    const label = new Map(nodes.map((n) => [n.id, n.data.name || blockTitle(n.data.kind)]));
    return edges.map((e) => ({ ...e, ariaLabel: `Link from ${label.get(e.source) ?? "a block"} to ${label.get(e.target) ?? "a block"}` }));
  }, [nodes, edges, blockTitle]);
  const summaries = useMemo(() => new Map(palette.map((b) => [b.kind, b.summary])), [palette]);

  const canvas: Canvas = {
    look: (block) => nodeLook(view, views, block, blockTitle(block.kind)),
    dropTarget,
    linkState: (id) => {
      if (!connectingFrom || id === connectingFrom) return null;
      return check(connectingFrom, id).ok ? "valid" : "invalid";
    },
    problems: (id) => problems.get(id) ?? [],
    warning: (id) => {
      const n = nodes.find((x) => x.id === id);
      if (!n || n.data.kind !== "firewall") return null;
      return openToEveryoneWarning(openAdminPorts(n.data.fields, defaultValues(blockFields(catalog, "firewall"))));
    },
    live: (id) => markers.live.get(id) ?? null,
    notBuilt: (id) => markers.notBuilt.has(id),
    // One-line hints on blocks only for people new to this; others get the calm canvas.
    hint: (kind) => (experience === "new" ? summaries.get(kind) || null : null),
    fieldsOf: (kind) => blockFields(catalog, kind),
    hasVM: (id) => vmNets.has(id),
    setField: (id, field, value) => {
      commit();
      setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, fields: { ...n.data.fields, [field]: value } } } : n)));
    },
    edgeCard: (source, target) => {
      const sk = kindById.get(source);
      const tk = kindById.get(target);
      const c = sk && tk ? linkCard(manifests, catalog, sk, tk) : null;
      return c ? { ...c, sourceName: nameOf(source), targetName: nameOf(target) } : null;
    },
    editable: wide && !live.waiting,
  };

  const links: EdgeCard[] = useMemo(
    () => allLinkCards(manifests).map((c) => ({ ...c, sourceName: titleOf(catalog, c.source), targetName: titleOf(catalog, c.target) })),
    [manifests, catalog],
  );
  // What the selected deployment builds, less the blocks it leaves out; with
  // no deployment, only what the diagram has.
  const summary = diagramSummary(
    nodes.map((n) => ({ id: n.id, kind: n.data.kind, name: n.data.name })),
    blockTitle,
    selectedDeployment ? { excluded: selectedDeployment.exclusions ?? [] } : null,
  );
  const projectHref = `/projects/${projectId}/diagrams`;

  const leaveDialog = (
    <AlertDialog open={!!guard.pending} onOpenChange={(o) => !o && guard.stay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>Your changes to {name.trim() || "this diagram"} are not saved. If you leave now, they are lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction onClick={guard.confirm}>Leave without saving</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (!wide) {
    return (
      <CanvasContext.Provider value={canvas}>
        <ReadOnlyView
          name={name}
          projectName={projectQ.data?.name ?? null}
          projectHref={projectHref}
          nodes={nodes}
          edges={labelledEdges}
          colorMode={resolvedTheme}
          deployments={deployments}
          deploymentsLoading={deploymentsQ.isLoading}
          deploymentsError={deploymentsQ.isError && !deploymentsQ.data}
          onRetryDeployments={() => void deploymentsQ.refetch()}
          catalog={catalog}
          blockTitle={blockTitle}
        />
        {leaveDialog}
      </CanvasContext.Provider>
    );
  }

  return (
    <div className="bg-background text-foreground flex h-dvh w-screen flex-col overflow-hidden">
      <EditorTopBar
        organizationId={orgId}
        organizationName={organizationName}
        projectId={projectId}
        projectName={projectQ.data?.name ?? null}
        name={name}
        onNameChange={setName}
        status={status}
        dirty={dirty}
        saving={saveM.isPending}
        saveBlocked={saveProblem ?? (!token ? "Sign in again to save." : null)}
        problemCount={(nameProblem ? 1 : 0) + blockProblems.length}
        onShowProblem={() => {
          if (blockProblems[0]) selectBlock(blockProblems[0].id);
          else document.querySelector<HTMLInputElement>('input[aria-label="Diagram name"]')?.focus();
        }}
        saveError={saveM.isError && !saveM.isPending ? saveErrorMessage(saveM.error) : null}
        onSave={onSave}
        onBack={() => guard.leave(projectHref)}
        codeOpen={codeOpen}
        onToggleCode={() => setCodeOpen((o) => !o)}
        onDeploy={openDeploy}
      />
      {dirty && nameProblem && (
        <p role="alert" className="border-warning/30 bg-warning/10 text-warning border-b px-4 py-1.5 text-xs">
          {nameProblem}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <BlockPalette
          blocks={palette}
          loading={catalogQ.isLoading}
          error={catalogQ.isError && !catalogQ.data ? adapterErrorMessage(catalogQ.error) : null}
          onRetry={() => void catalogQ.refetch()}
          linked={linkedClouds}
          onAdd={addAtCenter}
          onDragKind={(k) => {
            dragKind.current = k;
            if (!k) setDropTarget(null);
          }}
          links={links}
        />

        <div ref={canvasRef} className="relative min-w-0 flex-1" data-testid="blocks-canvas">
          <CanvasContext.Provider value={canvas}>
            <ReactFlow<BlockNodeType, BlockEdge>
              colorMode={resolvedTheme}
              style={canvasStyle}
              nodes={nodes}
              edges={labelledEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onBeforeDelete={onBeforeDelete}
              deleteKeyCode={["Delete", "Backspace"]}
              multiSelectionKeyCode={MULTI_SELECT_KEYS}
              onNodeClick={() => setTab("block")}
              onNodeDragStart={onDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={(_e, _n, dragged) => endDrag(dragged)}
              onSelectionDragStart={onDragStart}
              onSelectionDragStop={(_e, dragged) => endDrag(dragged)}
              onDragOver={onDragOver}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={onDrop}
              elevateNodesOnSelect={false}
              snapToGrid
              snapGrid={[20, 20]}
              fitView={nodes.length > 0}
              fitViewOptions={{ maxZoom: 1, padding: 0.25 }}>
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} color="var(--dot-grid)" />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>

            <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-24rem)] flex-col items-start gap-2">
              <div className="pointer-events-auto">
                <ViewSwitch views={views} value={view} onChange={chooseView} />
              </div>
              {currentView && (
                <p data-testid="view-summary" className="surface-raised text-muted-foreground max-w-md rounded-md border px-3 py-1.5 text-xs text-pretty">
                  {viewSummary(
                    currentView,
                    nodes.map((n) => ({ id: n.id, kind: n.data.kind })),
                    blockTitle,
                  )}
                </p>
              )}
            </div>
            {/* Bottom-left, right of the zoom controls: the checklist (a card
                that folds to a pill) and the summary pill. Top-left holds the
                view switch; the card's own height cap keeps it below. */}
            <div className="pointer-events-none absolute bottom-3 left-16 z-20 flex max-w-[calc(100%-5rem)] items-end gap-2">
              {orgId && (
                <div className="pointer-events-auto shrink-0">
                  <FirstDeployChecklist
                    organizationId={orgId}
                    variant="editor"
                    blockCount={nodes.length}
                    onOpenPanel={(p) => (p === "code" ? setCodeOpen(true) : openDeploy())}
                  />
                </div>
              )}
              {nodes.length > 0 && <SummaryPill summary={summary} />}
            </div>
            <div className="pointer-events-none absolute top-3 right-3 z-10">
              <LivePresence state={live.state} peers={live.peers} />
            </div>
            {live.waiting && (
              <div data-testid="live-waiting" className="bg-background/40 absolute inset-0 z-30 cursor-wait" aria-hidden />
            )}
            {refusal && (
              <p
                role="status"
                data-testid="link-refused"
                className="surface-raised border-warning/40 text-warning pointer-events-none absolute top-14 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3.5 py-1.5 text-xs animate-fade-up">
                {refusal}
              </p>
            )}
            {nodes.length === 0 && (
              <div data-testid="canvas-hint" className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="flex flex-col items-center gap-5 text-center animate-fade-in">
                  <IsoStack preset="cluster" accent="vm" size={22} />
                  {/* mb-7: room for the "you" cursor below the box, clear of the hint. */}
                  <SelectionBox cursorLabel="you" className="mb-7">
                    <span className="surface-raised flex items-center gap-2 rounded-lg border px-4 py-3">
                      <KindIcon kind="vm" className={cn(kindIconClass("vm"), "size-4")} />
                      <span className="text-sm font-semibold">Your first block</span>
                    </span>
                  </SelectionBox>
                  <p className="text-muted-foreground max-w-xs text-sm">Click a block on the left, or drag it here. Drop VMs into a network box.</p>
                </div>
              </div>
            )}
            {codeOpen && (
              <CodePanel
                token={token}
                organizationId={orgId}
                deployment={selectedDeployment ? { id: selectedDeployment.id, title: selectedDeployment.connection_name } : null}
                unsaved={dirty}
                onClose={() => setCodeOpen(false)}
                onAddDeployment={() => {
                  setCodeOpen(false);
                  setTab("deploy");
                }}
              />
            )}
          </CanvasContext.Provider>
        </div>

        <InspectorHandle width={inspectorWidth} onResize={resize} />
        <aside aria-label="Block and deployments" style={{ width: inspectorWidth }} className="bg-background flex shrink-0 flex-col">
          <div role="tablist" aria-label="Block and deployments" className="flex h-11 shrink-0 gap-1 border-b px-3">
            {(["block", "deploy"] as const).map((t) => (
              <button
                key={t}
                id={`side-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls="side-tab-panel"
                onClick={() => setTab(t)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    const next = t === "block" ? "deploy" : "block";
                    setTab(next);
                    document.getElementById(`side-tab-${next}`)?.focus();
                  }
                }}
                tabIndex={tab === t ? 0 : -1}
                className={cn(
                  "focus-visible:ring-ring/50 relative px-3 text-sm outline-none transition-colors focus-visible:ring-[3px]",
                  tab === t ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}>
                {t === "block" ? "Block" : "Deploy"}
                {tab === t && <span aria-hidden className="bg-primary absolute inset-x-2 -bottom-px h-0.5 rounded-full" />}
              </button>
            ))}
          </div>
          <div
            id="side-tab-panel"
            role="tabpanel"
            aria-labelledby={`side-tab-${tab}`}
            className="min-h-0 flex-1 overflow-y-auto p-4"
            onBlur={() => {
              editing.current = null;
            }}>
            <div key={tab} className="animate-fade-in">
              {tab === "block" ? (
                selected ? (
                  <BlockForm
                    key={selected.id}
                    node={selected}
                    catalog={catalog}
                    title={blockTitle(selected.data.kind)}
                    token={token}
                    organizationId={orgId}
                    organizationError={orgError}
                    diagramId={diagram.id}
                    connected={connected}
                    issues={blockIssues(compatQ.data, selected.id, new Set(["name", ...blockFields(catalog, selected.data.kind).map((f) => f.name)]))}
                    saved={savedSelected ? { name: savedSelected.data.name, fields: savedSelected.data.fields } : null}
                    hasVM={vmNets.has(selected.id)}
                    onChange={(patch) => patchNode(selected.id, patch)}
                    onRemove={() => removeBlocks([selected.id])}
                  />
                ) : selectedNodes.length > 1 ? (
                  <div data-testid="multi-selection" className="space-y-3">
                    <p className="text-sm font-semibold">{selectedNodes.length} blocks selected</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeBlocks(selectedNodes.map((n) => n.id))}
                      className="text-danger hover:text-danger">
                      <Trash2 aria-hidden />
                      Remove blocks
                    </Button>
                    <p className="text-muted-foreground text-xs">Or press Delete. You can undo it. Select one block to name it and set its fields.</p>
                  </div>
                ) : (
                  <div className="text-muted-foreground space-y-2 text-sm">
                    <p>{nodes.length === 0 ? "Add a building block from the left to start." : "Select a block to name it and set its fields."}</p>
                    <p className="text-xs">
                      Tip: Shift or Cmd click selects more than one block. Delete removes the selection, Ctrl or Cmd + Z undoes your last change, and Ctrl or Cmd + S
                      saves.
                    </p>
                  </div>
                )
              ) : (
                <DeployPanel
                  token={token}
                  organizationId={orgId}
                  organizationError={orgError}
                  diagramId={diagram.id}
                  catalog={catalog}
                  savedBlocks={savedBlocks}
                  currentBlocks={currentBlocks}
                  webServers={webServers}
                  blockTitle={blockTitle}
                  dirty={dirty}
                  save={save}
                  selectedId={selectedDeployment?.id ?? null}
                  onSelect={setChosenDeployment}
                  onPreview={(id) => {
                    setChosenDeployment(id);
                    setCodeOpen(true);
                  }}
                />
              )}
            </div>
          </div>
        </aside>
      </div>
      {leaveDialog}
    </div>
  );
}

// The inspector's left edge: drag it, or focus it and press the arrow keys,
// to make the inspector wider or narrower.
function InspectorHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side panel"
      aria-valuenow={width}
      aria-valuemin={INSPECTOR_WIDTH.min}
      aria-valuemax={INSPECTOR_WIDTH.max}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + (start.current.x - e.clientX));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + INSPECTOR_WIDTH.step);
        else if (e.key === "ArrowRight") onResize(width - INSPECTOR_WIDTH.step);
        else if (e.key === "Home") onResize(INSPECTOR_WIDTH.min);
        else if (e.key === "End") onResize(INSPECTOR_WIDTH.max);
        else return;
        e.preventDefault();
      }}
      className="group focus-visible:bg-primary/40 hover:bg-primary/30 bg-border relative z-10 w-px shrink-0 cursor-col-resize outline-none transition-colors">
      {/* The 1 px line's target is 25 px wide (WCAG 2.5.8). */}
      <span aria-hidden className="absolute inset-y-0 -right-3 -left-3" />
    </div>
  );
}
