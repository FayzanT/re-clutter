"use client";

import type { Connection, EdgeChange, IsValidConnection, NodeChange, NodeProps, NodeTypes } from "@xyflow/react";
import { addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, Controls, Panel, ReactFlow, useReactFlow } from "@xyflow/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import Palette from "./Palette";
import TopNav from "./TopNav";
import TerraformPreview from "./TerraformPreview";
import { supportsLocalTerraformPreview } from "@/lib/features/diagram/api";
import AwsServiceNode from "./nodes/AwsServiceNode";
import ConfigPanel from "./nodes/ConfigPanel";

import { useDiagram, useRunTerraform, useUpdateDiagramData } from "@/lib/features/diagram/hooks";
import type { DiagramEdge, DiagramNode } from "@/lib/features/diagram/types";
import { useDiagramEditor, useDiagramEditorActions } from "@/lib/features/diagram/uiStore";
import { useLiveLogsAccumulated } from "@/lib/features/logs/hooks";
import { useOrganizationAccounts, useOrganizations } from "@/lib/features/organization/hooks";
import { useSupportedResources } from "@/lib/features/resources/hooks";
import { useMe } from "@/lib/features/user/hooks";
import { useRouter } from "next/navigation";
import AwsAccountRequiredModal from "./AwsAccountRequiredModal";
import LogsPanel from "./logs/LogsPanel";

export type PaletteItem = {
  label: string;
  img: string;
};

const DND_MIME = "application/x-palette-item";
const RESOURCE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HIDDEN_VARIABLE_NAMES = new Set([
  "label",
  "position",
  "x",
  "y",
  "position_x",
  "position_y",
  "x_position",
  "y_position",
  "pos_x",
  "pos_y",
]);
const formatVariableLabel = (name: string) =>
  name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getVariableError = (name: string, value: unknown, required: boolean) => {
  const stringValue = typeof value === "string" ? value.trim() : "";

  if (required) {
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && stringValue === "");

    if (isMissing) {
      return "This field is required.";
    }
  }

  if (name === "resource_name" && stringValue && !RESOURCE_NAME_PATTERN.test(stringValue)) {
    return "Use lowercase letters, numbers, and hyphens only, for example test-lambda.";
  }

  return null;
};

export default function DiagramEditor({ projectId, diagramId, }: { projectId: string; diagramId: string; }) {
  const router = useRouter();

  const meQ = useMe();
  const token = meQ.data?.token ?? null;
  const orgsQ = useOrganizations(token);

  const orgId = orgsQ.data?.[0]?.id ?? null;

  const { screenToFlowPosition } = useReactFlow();

  const orgAWS = useOrganizationAccounts(token, orgId);
  const connectedAwsAccount = orgAWS.data?.find((account) => account.status === "complete" && !!account.role_arn, ) ?? null;
  const awsId = connectedAwsAccount?.id ?? null;
  const isAwsBlocked = !orgAWS.isLoading && !!orgId && !awsId;

  const { data: supportedResources } = useSupportedResources();
  const diagramQ = useDiagram(token, projectId, diagramId);

  const saveM = useUpdateDiagramData(token);
  const terraformM = useRunTerraform(token);

  const editor = useDiagramEditor(diagramId);
  const {
    ensure,
    reset,
    hydrateFromServer,
    setNodes,
    setEdges,
    setNodesWithoutDirty,
    setEdgesWithoutDirty,
    setName,
    markClean,
  } = useDiagramEditorActions();

  const [taskArn, setTaskArn] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(`taskArn:${diagramId}`);
  });

  const [currentAction, setCurrentAction] = useState<"deploy" | "destroy" | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(`currentAction:${diagramId}`) as "deploy" | "destroy" | null;
  });

  const [showSaved, setShowSaved] = useState(false);

  const liveLogs = useLiveLogsAccumulated({
    token,
    orgId,
    projId: projectId,
    diagramId,
    taskArn,
    pollIntervalMs: 2000,
  });

  const { isComplete } = liveLogs;

  useEffect(() => {
    ensure(diagramId);
  }, [diagramId, ensure]);

  useEffect(() => {
    if (!diagramQ.data) return;
    hydrateFromServer(
      diagramId,
      diagramQ.data.name ?? "",
      diagramQ.data.data?.nodes ?? [],
      diagramQ.data.data?.edges ?? [],
    );
  }, [diagramId, diagramQ.data, hydrateFromServer]);

  useEffect(() => {
    if (taskArn) sessionStorage.setItem(`taskArn:${diagramId}`, taskArn);
    else sessionStorage.removeItem(`taskArn:${diagramId}`);
  }, [taskArn, diagramId]);

  useEffect(() => {
    if (currentAction) sessionStorage.setItem(`currentAction:${diagramId}`, currentAction);
    else sessionStorage.removeItem(`currentAction:${diagramId}`);
  }, [currentAction, diagramId]);

  useEffect(() => {
    if (isComplete) {
      sessionStorage.removeItem(`taskArn:${diagramId}`);
      sessionStorage.removeItem(`currentAction:${diagramId}`);
    }
  }, [isComplete, diagramId]);

  const nodes = useMemo(() => editor?.nodes ?? [], [editor?.nodes]);
  const edges = useMemo(() => editor?.edges ?? [], [editor?.edges]);
  const name = editor?.name ?? "";
  const dirty = !!editor?.dirty;

  const saveDisabledReason = useMemo(() => {
    if (!supportedResources) return null;

    for (const node of nodes) {
      const resource = supportedResources.find(
        (item) => item.label === node.data.label,
      );
      if (!resource) continue;

      for (const variable of resource.variables) {
        if (HIDDEN_VARIABLE_NAMES.has(variable.name.toLowerCase())) continue;

        const value = node.data.variables?.[variable.name];
        const error = getVariableError(variable.name, value, variable.required);
        if (error) {
          return `${resource.displayName} · ${formatVariableLabel(
            variable.name,
          )}: ${error}`;
        }
      }
    }

    return null;
  }, [nodes, supportedResources]);

  const isLoading = diagramQ.isLoading;
  const isSaving = saveM.isPending;

  const isValidConnection: IsValidConnection<DiagramEdge> = useCallback(
    (connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);

      if (!source || !target) return false;

      const sourceLabel = source.data.label.toLowerCase();
      const targetLabel = target.data.label.toLowerCase();

      if (targetLabel.includes("api gateway")) return false;
      if (sourceLabel.includes("dynamodb")) return false;
      if (sourceLabel.includes("s3")) return false;
      if (
        sourceLabel.includes("lambda") &&
        targetLabel.includes("api gateway")
      )
        return false;
      if (sourceLabel.includes("ec2") && targetLabel.includes("api gateway"))
        return false;
      if (connection.source === connection.target) return false;

      return true;
    },
    [nodes],
  );

  const onBack = React.useCallback(() => {
    reset(diagramId);
    router.back();
  }, [reset, diagramId, router]);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      awsService: AwsServiceNode as React.ComponentType<NodeProps>,
    }),
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<DiagramNode>[]) => {
      const requiresSave = changes.some(
        (change) =>
          change.type === "position" ||
          change.type === "dimensions" ||
          change.type === "add" ||
          change.type === "remove" ||
          change.type === "replace",
      );

      const next = applyNodeChanges(changes, nodes);
      if (requiresSave) {
        setNodes(diagramId, next);
      } else {
        setNodesWithoutDirty(diagramId, next);
      }
    },
    [diagramId, nodes, setNodes, setNodesWithoutDirty],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<DiagramEdge>[]) => {
      const requiresSave = changes.some((change) => change.type !== "select");
      const next = applyEdgeChanges(changes, edges);
      if (requiresSave) {
        setEdges(diagramId, next);
      } else {
        setEdgesWithoutDirty(diagramId, next);
      }
    },
    [diagramId, edges, setEdges, setEdgesWithoutDirty],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const next = addEdge({ ...params }, edges);
      setEdges(diagramId, next);
    },
    [diagramId, edges, setEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DND_MIME);
      if (!raw) return;

      const item: PaletteItem = JSON.parse(raw);
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      const resourceDef = supportedResources?.find(
        (r) => r.label === item.label,
      );
      const defaultVariables: Record<string, unknown> = {};

      if (resourceDef) {
        for (const v of resourceDef.variables) {
          if (v.default !== null) {
            defaultVariables[v.name] = v.default;
          }
        }
      }

      const newNode: DiagramNode = {
        id: crypto.randomUUID(),
        type: "awsService",
        position,
        data: {
          label: item.label,
          img: item.img,
          ...(Object.keys(defaultVariables).length > 0 && {
            variables: defaultVariables,
          }),
        },
      };

      setNodes(diagramId, [...nodes, newNode]);
    },
    [diagramId, nodes, screenToFlowPosition, setNodes, supportedResources],
  );

  const onSave = useCallback(async () => {
    if (!token) return;

    await saveM.mutateAsync({
      projectId,
      diagramId,
      name: editor?.name?.trim() || "Untitled diagram",
      nodes,
      edges,
    });

    markClean(diagramId);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }, [token, saveM, projectId, diagramId, editor?.name, nodes, edges, markClean]);

  const onDeploy = useCallback(async () => {
    if (!orgId || !awsId) return;

    setCurrentAction("deploy");
    const result = await terraformM.mutateAsync({
      organizationId: orgId,
      projectId,
      diagramId,
      accountAccessRoleId: awsId,
      command: "apply",
    });
    setTaskArn(result.taskArn);
  }, [orgId, projectId, diagramId, terraformM, awsId]);

  const onDestroy = useCallback(async () => {
    if (!orgId || !awsId) return;

    setCurrentAction("destroy");
    const result = await terraformM.mutateAsync({
      organizationId: orgId,
      projectId,
      diagramId,
      accountAccessRoleId: awsId,
      command: "destroy",
    });
    setTaskArn(result.taskArn);
  }, [orgId, awsId, terraformM, projectId, diagramId]);

  const isDeploying =
    (terraformM.isPending && currentAction === "deploy") ||
    (!!taskArn && currentAction === "deploy" && !isComplete);

  const isDestroying =
    (terraformM.isPending && currentAction === "destroy") ||
    (!!taskArn && currentAction === "destroy" && !isComplete);

  const isReadOnly = isDeploying || isDestroying || isAwsBlocked;

  return (
    <div className="h-screen w-screen overflow-hidden">
      <div className="flex h-full w-full">
        <Palette isReadOnly={isReadOnly} />

        <div className="relative flex-1">
          <ReactFlow
            colorMode="dark"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            snapToGrid
            snapGrid={[20, 20]}
            isValidConnection={isValidConnection}
            nodesDraggable={!isReadOnly}
            nodesConnectable={!isReadOnly}
            elementsSelectable={!isReadOnly}
          >
            <Panel position="top-left" className="w-full pr-5">
              <TopNav
                diagramName={name}
                onNameChange={(n) => setName(diagramId, n)}
                onSave={onSave}
                onDeploy={onDeploy}
                onDestroy={onDestroy}
                isDeploying={isDeploying}
                isDestroying={isDestroying}
                onBack={onBack}
                dirty={dirty}
                isSaving={isSaving}
                saveDisabledReason={saveDisabledReason}
                previewControl={supportsLocalTerraformPreview ? <TerraformPreview
                  key={diagramId}
                  token={token}
                  projectId={projectId}
                  diagramId={diagramId}
                  disabled={dirty || isSaving || isLoading || isDeploying || isDestroying}
                /> : undefined}
              />
            </Panel>

            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.5}
            />

            <Controls
              orientation="horizontal"
              className="[&_button]:!w-10 [&_button]:!h-10 [&_button]:!min-w-10 [&_button]:!min-h-10"
              showInteractive={false}
            />
          </ReactFlow>

          {isLoading && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <div className="rounded-lg bg-neutral-900 px-4 py-2 text-sm">
                Loading diagram…
              </div>
            </div>
          )}

          {isSaving && (
            <div className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Saving…
            </div>
          )}

          {showSaved && !isSaving && (
            <div className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-900/80 px-4 py-2 text-sm text-emerald-100 shadow-lg">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Saved
            </div>
          )}

          <LogsPanel
            key={taskArn ?? "no-task"}
            token={token}
            orgId={orgId}
            projectId={projectId}
            diagramId={diagramId}
            taskArn={taskArn}
            liveLogs={liveLogs}
          />

          <AwsAccountRequiredModal
            open={isAwsBlocked}
            onBack={onBack}
            onGoToSettings={() =>
              router.push("/settings/organization/aws-account")
            }
          />
        </div>

        <ConfigPanel
          diagramId={diagramId}
          projectId={projectId}
          orgId={orgId}
          accountAccessRoleId={awsId}
        />
      </div>
    </div>
  );
}
