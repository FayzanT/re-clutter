import type { Edge, Node } from "@xyflow/react";

export type NodeData = {
  label: string;
  img: string;
  ansiblePlaybookName?: string;
  ansiblePlaybookKey?: string;
  ansiblePlaybookId?: string;
  ansibleTargetInstanceId?: string;
  lastAnsibleJobId?: string;
  lastAnsibleJobStatus?: string;
  lambdaCodeZipName?: string;
  lambdaCodeS3Key?: string;
  lambdaCodeS3Bucket?: string;
  variables?: Record<string, unknown>;
};
export type DiagramNode = Node<NodeData>;
export type DiagramEdge = Edge;

export type DiagramUiLayout = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

export type DiagramApiItem = {
  id: string;
  name: string;
  projectId: string;
  data: DiagramUiLayout;
  createdBy?: string;
  createdAt?: string;
  latestUpdateBy?: string;
  latestUpdateAt?: string;
};

// Diagram and DiagramApiItem now share the same shape
export type Diagram = DiagramApiItem;

export type TerraformPreview = {
  files: { "main.tf": string; "outputs.tf": string };
};

export type CreateDiagramInput = {
  projectId: string;
  name: string;
  data?: DiagramUiLayout;
};

export type UpdateDiagramInput = {
  projectId: string;
  diagramId: string;
  name: string;
  data: DiagramUiLayout; // was uiLayout — now consistently "data"
};

export type TerraformCommandInput = {
  organizationId: string;
  projectId: string;
  diagramId: string;
  accountAccessRoleId: string;
  command: "apply" | "destroy" | "plan";
};

// ─── RunTerraform response ────────────────────────────────────────────────────
// Only the fields we actually use; the full shape is much larger.
export type EcsFargateTask = {
  TaskArn: string;
  LastStatus: string;
  DesiredStatus: string;
  CreatedAt: string | null;
};

export type RunTerraformResponseEnvelope = {
  data: {
    commandId: string;
    taskArn: string;
  };
  message?: string;
};

// Convenient, flattened result we expose to callers
export type RunTerraformResult = {
  commandId: string;
  taskArn: string;
};

export type ApiEnvelope<T> = { data: T; message?: string };
