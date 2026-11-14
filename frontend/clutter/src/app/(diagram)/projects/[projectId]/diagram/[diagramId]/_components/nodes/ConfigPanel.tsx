"use client";

import { Play, Settings, Trash2, Upload, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateLambdaCodeUploadUrl,
  useUploadLambdaCodeToS3,
} from "@/lib/features/codeUpload/hooks";
import { useUpdateDiagramData } from "@/lib/features/diagram/hooks";
import type { DiagramNode } from "@/lib/features/diagram/types";
import {
  useDiagramEditor,
  useDiagramEditorActions,
} from "@/lib/features/diagram/uiStore";
import { useSupportedResources } from "@/lib/features/resources/hooks";
import {
  useAnsibleJob,
  useCreatePlaybookUploadUrl,
  useSubmitAnsibleJob,
  useUploadPlaybookFileToS3,
} from "@/lib/features/runs/hooks";
import { useMe } from "@/lib/features/user/hooks";

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

const getVariableSelectOptions = (
  resourceLabel: string | undefined,
  variableName: string
) => {
  if (resourceLabel === "DynamoDB") {
    if (variableName === "billing_mode")
      return ["PAY_PER_REQUEST", "PROVISIONED"];
    if (variableName === "hash_key_type") return ["S", "N", "B"];
  }
  if (resourceLabel === "Lambda" && variableName === "architecture")
    return ["arm64", "x86_64"];
  if (resourceLabel === "Lambda" && variableName === "memory_size")
    return ["128", "256", "512", "1024", "1769"];
  if (resourceLabel === "Lambda" && variableName === "runtime") {
    return [
      "nodejs24.x",
      "nodejs22.x",
      "python3.14",
      "python3.13",
      "python3.12",
      "provided.al2023",
    ];
  }
  return null;
};

const getVariableChecklistOptions = (
  resourceLabel: string | undefined,
  variableName: string
) => {
  if (resourceLabel === "API Gateway" && variableName === "http_methods") {
    return [
      { label: "GET", value: "GET" },
      { label: "POST", value: "POST" },
      { label: "PUT", value: "PUT" },
      { label: "PATCH", value: "PATCH" },
      { label: "DELETE", value: "DELETE" },
    ];
  }
  return null;
};

const getVariablePlaceholder = (
  resourceLabel: string | undefined,
  variableName: string,
  fallback: string
) => {
  if (resourceLabel === "S3" && variableName === "resource_name")
    return "e.g. test-bucket";
  return fallback;
};

const getVariableError = (name: string, value: unknown, required: boolean) => {
  const stringValue = typeof value === "string" ? value.trim() : "";
  if (required) {
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && stringValue === "");
    if (isMissing) return "This field is required.";
  }
  if (
    name === "resource_name" &&
    stringValue &&
    !RESOURCE_NAME_PATTERN.test(stringValue)
  ) {
    return "Use lowercase letters, numbers, and hyphens only, for example test-lambda.";
  }
  return null;
};

const JOB_CARD_STYLES: Record<string, string> = {
  QUEUED: "border-border bg-card",
  RUNNING: "border-amber-500/20 bg-amber-500/100/10",
  SUCCESS: "border-green-500/20 bg-green-500/100/10",
  FAILED: "border-red-500/20 bg-red-500/100/10",
  CANCELLED: "border-border bg-card",
};

const JOB_DOT_STYLES: Record<string, string> = {
  QUEUED: "bg-slate-400 animate-pulse",
  RUNNING: "bg-amber-400 animate-pulse",
  SUCCESS: "bg-green-400",
  FAILED: "bg-red-400",
  CANCELLED: "bg-slate-500",
};

const JOB_TEXT_STYLES: Record<string, string> = {
  QUEUED: "text-foreground",
  RUNNING: "text-amber-700 dark:text-amber-300",
  SUCCESS: "text-green-700 dark:text-green-300",
  FAILED: "text-red-700 dark:text-red-300",
  CANCELLED: "text-muted-foreground",
};

type FinishedJobSnapshot = {
  id: string;
  status: string;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ConfigPanelProps = {
  diagramId: string;
  projectId: string;
  orgId: string | null;
  accountAccessRoleId: string | null;
};

export default function ConfigPanel({
  diagramId,
  projectId,
  orgId,
  accountAccessRoleId,
}: ConfigPanelProps) {
  const editor = useDiagramEditor(diagramId);
  const { markClean, setNodes, setEdges } = useDiagramEditorActions();
  const meQ = useMe();
  const token = meQ.data?.token ?? null;
  const saveDiagram = useUpdateDiagramData(token);
  const createPlaybookUploadUrl = useCreatePlaybookUploadUrl(token);
  const uploadPlaybookFileToS3 = useUploadPlaybookFileToS3();
  const submitAnsibleJob = useSubmitAnsibleJob(token);
  const createLambdaCodeUploadUrl = useCreateLambdaCodeUploadUrl(token);
  const uploadLambdaCodeToS3 = useUploadLambdaCodeToS3();
  const { data: supportedResources } = useSupportedResources();

  const nodes = useMemo(() => editor?.nodes ?? [], [editor?.nodes]);
  const edges = useMemo(() => editor?.edges ?? [], [editor?.edges]);

  const selectedNode = useMemo(() => nodes.find((n) => n.selected), [nodes]);
  const showContent = !!selectedNode;
  const isEc2Node = selectedNode?.data.img?.includes("ec2") ?? false;
  const isLambdaNode = selectedNode?.data.img?.includes("lambda") ?? false;

  const ansibleUploadInputId = selectedNode
    ? `ansible-playbook-upload-${selectedNode.id}`
    : "ansible-playbook-upload";

  const lambdaUploadInputId = selectedNode
    ? `lambda-code-upload-${selectedNode.id}`
    : "lambda-code-upload";

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lambdaUploadError, setLambdaUploadError] = useState<string | null>(
    null
  );
  const [lambdaUploadMessage, setLambdaUploadMessage] = useState<string | null>(
    null
  );
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [latestFinishedJob, setLatestFinishedJob] =
    useState<FinishedJobSnapshot | null>(null);

  const jobStatusQuery = useAnsibleJob(token, activeJobId);
  const [lastSyncedJobStatus, setLastSyncedJobStatus] = useState<string | null>(
    null
  );
  const polledStatus = jobStatusQuery.data?.status ?? null;

  const resourceDef = useMemo(
    () => supportedResources?.find((r) => r.label === selectedNode?.data.label),
    [supportedResources, selectedNode?.data.label]
  );

  const visibleVariables = useMemo(
    () =>
      resourceDef?.variables.filter(
        (v) => !HIDDEN_VARIABLE_NAMES.has(v.name.toLowerCase())
      ) ?? [],
    [resourceDef?.variables]
  );

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return "—";
    return new Date(value).toLocaleString();
  }, []);

  const patchSelectedNode = useCallback(
    (patch: (node: DiagramNode) => DiagramNode) => {
      if (!selectedNode) return;
      const next = nodes.map((n) => (n.id === selectedNode.id ? patch(n) : n));
      setNodes(diagramId, next);
    },
    [diagramId, nodes, selectedNode, setNodes]
  );

  useEffect(() => {
    if (!polledStatus || polledStatus === lastSyncedJobStatus || !activeJobId)
      return;
    if (!selectedNode || selectedNode.data.lastAnsibleJobId !== activeJobId)
      return;

    setLastSyncedJobStatus(polledStatus);

    patchSelectedNode((n) => ({
      ...n,
      data: {
        ...n.data,
        lastAnsibleJobStatus: polledStatus,
      },
    }));

    if (jobStatusQuery.isDone && jobStatusQuery.data) {
      setLatestFinishedJob({
        id: jobStatusQuery.data.id,
        status: jobStatusQuery.data.status,
        error_message: jobStatusQuery.data.error_message ?? null,
        created_at: jobStatusQuery.data.created_at ?? null,
        updated_at: jobStatusQuery.data.updated_at ?? null,
      });

      setActiveJobId(null);
    }
  }, [
    activeJobId,
    jobStatusQuery.data,
    jobStatusQuery.isDone,
    lastSyncedJobStatus,
    patchSelectedNode,
    polledStatus,
    selectedNode,
  ]);

  const handleClose = () =>
    patchSelectedNode((n) => ({ ...n, selected: false }));

  const handleVariableChange = (varName: string, value: unknown) => {
    patchSelectedNode((n) => ({
      ...n,
      data: {
        ...n.data,
        variables: { ...(n.data.variables ?? {}), [varName]: value },
      },
    }));
  };

  const persistDiagram = useCallback(
    async (nextNodes: DiagramNode[]) => {
      if (!token) return;
      await saveDiagram.mutateAsync({
        projectId,
        diagramId,
        name: editor?.name?.trim() || "Untitled diagram",
        nodes: nextNodes,
        edges,
      });
      markClean(diagramId);
    },
    [diagramId, editor?.name, edges, markClean, projectId, saveDiagram, token]
  );

  const handleAnsiblePlaybookUpload = useCallback(
    async (file: File | null) => {
      if (!file || !selectedNode) return;
      if (!token) {
        setUploadError("You must be signed in before uploading a playbook.");
        return;
      }

      setUploadError(null);
      setUploadMessage(null);
      setRunError(null);

      try {
        const uploadTarget = await createPlaybookUploadUrl.mutateAsync({
          file_name: file.name,
          project_id: projectId,
          diagram_id: diagramId,
        });

        const targetUrl =
          (typeof uploadTarget.upload_url === "string" &&
            uploadTarget.upload_url) ||
          (typeof uploadTarget.url === "string" && uploadTarget.url) ||
          "";

        if (!targetUrl) {
          throw new Error(
            "Upload URL response did not include a usable target URL."
          );
        }

        await uploadPlaybookFileToS3.mutateAsync({
          upload_url: targetUrl,
          file,
        });

        const nextNodes = nodes.map((node) =>
          node.id !== selectedNode.id
            ? node
            : {
                ...node,
                data: {
                  ...node.data,
                  ansiblePlaybookName: file.name,
                  ansiblePlaybookKey:
                    (typeof uploadTarget.playbook_s3_key === "string" &&
                      uploadTarget.playbook_s3_key) ||
                    (typeof uploadTarget.key === "string" && uploadTarget.key) ||
                    node.data.ansiblePlaybookKey,
                  ansiblePlaybookId:
                    (typeof uploadTarget.playbook_id === "string" &&
                      uploadTarget.playbook_id) ||
                    node.data.ansiblePlaybookId,
                },
              }
        );

        setNodes(diagramId, nextNodes);
        await persistDiagram(nextNodes);
        setUploadMessage(`Uploaded "${file.name}" for this EC2 container.`);
      } catch (err) {
        setUploadError(
          err instanceof Error
            ? err.message
            : "Failed to upload Ansible playbook."
        );
      }
    },
    [
      createPlaybookUploadUrl,
      diagramId,
      nodes,
      persistDiagram,
      projectId,
      selectedNode,
      setNodes,
      token,
      uploadPlaybookFileToS3,
    ]
  );

  const handleLambdaCodeUpload = useCallback(
    async (file: File | null) => {
      if (!file || !selectedNode) return;
      if (!token) {
        setLambdaUploadError("You must be signed in before uploading code.");
        return;
      }

      setLambdaUploadError(null);
      setLambdaUploadMessage(null);

      const resourceName = String(
        selectedNode.data.variables?.resource_name ?? ""
      );
      const runtime = String(selectedNode.data.variables?.runtime ?? "");

      if (!resourceName) {
        setLambdaUploadError(
          "Set a resource_name on this Lambda node before uploading code."
        );
        return;
      }

      try {
        const result = await createLambdaCodeUploadUrl.mutateAsync({
          org_id: orgId ?? "",
          project_id: projectId,
          diagram_id: diagramId,
          lambda_resource_name: resourceName,
          runtime,
        });

        await uploadLambdaCodeToS3.mutateAsync({
          upload_url: result.upload_url,
          file,
        });

        patchSelectedNode((n) => ({
          ...n,
          data: {
            ...n.data,
            lambdaCodeZipName: file.name,
            lambdaCodeS3Key: result.s3_key,
            lambdaCodeS3Bucket: result.s3_bucket,
            variables: {
              ...(n.data.variables ?? {}),
              s3_key: result.s3_key,
              s3_bucket: result.s3_bucket,
            },
          },
        }));

        setLambdaUploadMessage(
          `Uploaded "${file.name}" for this Lambda function.`
        );
      } catch (err) {
        setLambdaUploadError(
          err instanceof Error ? err.message : "Failed to upload Lambda code."
        );
      }
    },
    [
      createLambdaCodeUploadUrl,
      diagramId,
      orgId,
      patchSelectedNode,
      projectId,
      selectedNode,
      token,
      uploadLambdaCodeToS3,
    ]
  );

  const handleTargetInstanceIdChange = useCallback(
    (targetInstanceId: string) => {
      patchSelectedNode((n) => ({
        ...n,
        data: { ...n.data, ansibleTargetInstanceId: targetInstanceId },
      }));
    },
    [patchSelectedNode]
  );

  const handleRunPlaybook = useCallback(async () => {
    if (!selectedNode) return;
    if (!token) {
      setRunError("You must be signed in before submitting an Ansible job.");
      return;
    }

    const playbookId = selectedNode.data.ansiblePlaybookId?.trim();
    const targetInstanceId = selectedNode.data.ansibleTargetInstanceId?.trim();

    if (!playbookId) {
      setRunError(
        "Upload a playbook first so this EC2 container has a playbook ID."
      );
      return;
    }
    if (!targetInstanceId) {
      setRunError(
        "Enter the target EC2 instance ID before running the playbook."
      );
      return;
    }
    if (!accountAccessRoleId) {
      setRunError(
        "Connect an AWS account role before submitting an Ansible job."
      );
      return;
    }

    setRunError(null);
    setLatestFinishedJob(null);

    try {
      const response = await submitAnsibleJob.mutateAsync({
        account_access_role_id: accountAccessRoleId,
        playbook_id: playbookId,
        target_instance_ids: [targetInstanceId],
      });

      patchSelectedNode((n) => ({
        ...n,
        data: {
          ...n.data,
          lastAnsibleJobId: response.job_id,
          lastAnsibleJobStatus: response.status,
        },
      }));

      setLastSyncedJobStatus(response.status);
      setActiveJobId(response.job_id);
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : "Failed to submit the Ansible job."
      );
    }
  }, [
    accountAccessRoleId,
    patchSelectedNode,
    selectedNode,
    submitAnsibleJob,
    token,
  ]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    setNodes(
      diagramId,
      nodes.filter((n) => n.id !== nodeId)
    );
    setEdges(
      diagramId,
      edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
    );
  }, [diagramId, edges, nodes, selectedNode, setEdges, setNodes]);

  const jobData = jobStatusQuery.data;
  const jobStatus = jobData?.status ?? "";
  const jobCardStyle = JOB_CARD_STYLES[jobStatus] ?? JOB_CARD_STYLES.QUEUED;
  const jobDotStyle = JOB_DOT_STYLES[jobStatus] ?? JOB_DOT_STYLES.QUEUED;
  const jobTextStyle = JOB_TEXT_STYLES[jobStatus] ?? JOB_TEXT_STYLES.QUEUED;

  return (
    <aside
      className={[
        "relative h-full shrink-0 border-l border-border bg-card backdrop-blur",
        "transition-[width] duration-200",
        showContent ? "w-[380px]" : "w-[5px]",
      ].join(" ")}
    >
      {!showContent ? null : (
        <>
          <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card">
                <Settings className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {resourceDef?.displayName ?? selectedNode!.data.label}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  Configuration
                </div>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card transition hover:bg-card"
              title="Deselect node"
              type="button"
            >
              <X className="h-4 w-4 text-foreground" />
            </button>
          </div>

          <div className="flex h-[calc(100%-3.5rem)] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-card">
                  <Image
                    src={selectedNode!.data.img as string}
                    alt=""
                    width={24}
                    height={24}
                    unoptimized
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Resource</div>
                  <div className="truncate text-sm font-medium text-foreground">
                    {resourceDef?.displayName ?? selectedNode!.data.label}
                  </div>
                </div>
              </div>

              {resourceDef && visibleVariables.length > 0 && (
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Configuration
                  </label>
                  <div className="space-y-3">
                    {visibleVariables.map((v) => {
                      const val = selectedNode!.data.variables?.[v.name];
                      const placeholder = getVariablePlaceholder(
                        resourceDef?.label,
                        v.name,
                        v.default != null ? String(v.default) : ""
                      );
                      const fieldError = getVariableError(
                        v.name,
                        val,
                        v.required
                      );
                      const labelText = formatVariableLabel(v.name);
                      const selectOptions = getVariableSelectOptions(
                        resourceDef?.label,
                        v.name
                      );
                      const checklistOptions = getVariableChecklistOptions(
                        resourceDef?.label,
                        v.name
                      );
                      const selectedChecklistValues = new Set(
                        String(
                          val ??
                            (typeof v.default === "string" ? v.default : "")
                        )
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                      );

                      return (
                        <div
                          key={v.name}
                          className="rounded-xl border border-border bg-card p-3"
                        >
                          <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-foreground">
                            <Label>{labelText}</Label>
                            {v.required ? (
                              <span className="text-red-700 dark:text-red-300">*</span>
                            ) : null}
                          </div>

                          {checklistOptions ? (
                            <div className="grid grid-cols-2 gap-2">
                              {checklistOptions.map((option) => {
                                const checked = selectedChecklistValues.has(
                                  option.value
                                );
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                      const nextValues = new Set(
                                        selectedChecklistValues
                                      );
                                      if (checked) nextValues.delete(option.value);
                                      else nextValues.add(option.value);
                                      handleVariableChange(
                                        v.name,
                                        Array.from(nextValues).join(",")
                                      );
                                    }}
                                    className={[
                                      "flex h-10 items-center gap-2 rounded-lg border px-3 text-sm transition",
                                      checked
                                        ? "border-primary/50 bg-primary/10 text-[var(--primary-text)]"
                                        : "border-border bg-card text-foreground hover:bg-card",
                                    ].join(" ")}
                                  >
                                    <span
                                      className={[
                                        "grid h-4 w-4 place-items-center rounded border text-[10px] font-bold",
                                        checked
                                          ? "border-primary bg-primary text-primary-foreground"
                                          : "border-border bg-card text-transparent",
                                      ].join(" ")}
                                    >
                                      ✓
                                    </span>
                                    <span className="font-medium">
                                      {option.label}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : v.type === "boolean" ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={Boolean(val)}
                              onClick={() =>
                                handleVariableChange(v.name, !Boolean(val))
                              }
                              className={[
                                ((
                                  resourceDef?.label === "API Gateway" &&
                                  v.name === "enable_cors"
                                ) ||
                                (resourceDef?.label === "S3" &&
                                  (v.name === "enable_versioning" ||
                                    v.name === "block_public_access")) ||
                                (resourceDef?.label === "DynamoDB" &&
                                  v.name === "enable_ttl"))
                                  ? "flex h-10 w-full items-center justify-between rounded-lg border px-3 text-sm transition"
                                  : "inline-flex h-10 min-w-[148px] items-center justify-between rounded-lg border px-3 text-sm transition",
                                fieldError
                                  ? "border-red-500/50 bg-card text-red-100"
                                  : "border-border bg-card text-foreground",
                              ].join(" ")}
                            >
                              <span className="font-medium">
                                {Boolean(val) ? "True" : "False"}
                              </span>
                              <span
                                className={[
                                  "relative h-5 w-10 rounded-full transition-colors",
                                  Boolean(val)
                                    ? "bg-primary/80"
                                    : "bg-muted",
                                ].join(" ")}
                              >
                                <span
                                  className={[
                                    "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                                    Boolean(val)
                                      ? "translate-x-[20px]"
                                      : "translate-x-0",
                                  ].join(" ")}
                                />
                              </span>
                            </button>
                          ) : selectOptions ? (
                            <Select
                              value={val === undefined ? "" : String(val)}
                              onValueChange={(nextValue) =>
                                handleVariableChange(v.name, nextValue)
                              }
                            >
                              <SelectTrigger
                                className={[
                                  "h-10 w-full rounded-lg bg-card text-sm text-foreground",
                                  fieldError
                                    ? "border-red-500/50 focus:ring-red-500/40"
                                    : "border-border focus:ring-ring/40",
                                ].join(" ")}
                              >
                                <SelectValue
                                  placeholder={placeholder || "Select an option"}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {selectOptions.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type={v.type === "number" ? "number" : "text"}
                              maxLength={
                                v.name === "resource_name" ? 32 : undefined
                              }
                              className={[
                                "h-10 rounded-lg bg-card text-sm text-foreground placeholder:text-muted-foreground",
                                fieldError
                                  ? "border-red-500/50 focus-visible:ring-red-500/40"
                                  : "border-border focus-visible:ring-ring/40",
                              ].join(" ")}
                              placeholder={placeholder || v.description}
                              value={val === undefined ? "" : String(val)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                handleVariableChange(
                                  v.name,
                                  raw === ""
                                    ? undefined
                                    : v.type === "number"
                                    ? Number(raw)
                                    : raw
                                );
                              }}
                            />
                          )}

                          {v.description &&
                            !(
                              (resourceDef?.label === "DynamoDB" &&
                                (v.name === "billing_mode" ||
                                  v.name === "hash_key_type" ||
                                  v.name === "enable_ttl")) ||
                              (resourceDef?.label === "API Gateway" &&
                                v.name === "http_methods")
                            ) && (
                              <p className="mt-2 text-[11px] text-muted-foreground">
                                {v.description}
                              </p>
                            )}

                          {fieldError && (
                            <p className="mt-2 text-[11px] text-red-700 dark:text-red-300">
                              {fieldError}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isEc2Node && (
                <div>
                  <div className="mb-4 border-t border-border" />
                  <div className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Ansible Playbook
                  </div>
                  <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/20 p-3">
                    <div className="rounded-lg border border-primary/40 bg-card px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Bound EC2 container
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {selectedNode!.data.label}
                      </div>
                    </div>

                    <label
                      htmlFor={ansibleUploadInputId}
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-primary/60 bg-card px-3 py-3 text-sm font-medium text-[var(--primary-text)] transition hover:border-primary/60 hover:bg-primary/30"
                    >
                      <Upload className="h-4 w-4" />
                      {selectedNode!.data.ansiblePlaybookName
                        ? "Replace playbook for this EC2 container"
                        : "Upload playbook for this EC2 container"}
                    </label>
                    <input
                      id={ansibleUploadInputId}
                      type="file"
                      accept=".yml,.yaml"
                      className="hidden"
                      onChange={async (e) => {
                        const input = e.currentTarget;
                        await handleAnsiblePlaybookUpload(
                          input.files?.[0] ?? null
                        );
                        input.value = "";
                      }}
                    />

                    <div className="rounded-lg border border-primary/40 bg-card px-3 py-2">
                      <div className="text-xs text-muted-foreground">Uploaded file</div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {selectedNode!.data.ansiblePlaybookName ??
                          "No playbook uploaded yet"}
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Target EC2 instance ID
                      </label>
                      <input
                        type="text"
                        value={selectedNode!.data.ansibleTargetInstanceId ?? ""}
                        onChange={(e) =>
                          handleTargetInstanceIdChange(e.target.value)
                        }
                        placeholder="i-0a05920cb52c4555d"
                        className="w-full rounded-lg border border-primary/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="mt-1 text-xs text-muted-foreground">
                        This instance ID is stored on this EC2 container node and
                        used as the Ansible target.
                      </div>
                    </div>

                    <div className="rounded-lg border border-primary/40 bg-card px-3 py-2">
                      <div className="text-xs text-muted-foreground">Playbook ID</div>
                      <div className="mt-1 break-all text-sm font-medium text-foreground">
                        {selectedNode!.data.ansiblePlaybookId ??
                          "Not available until upload succeeds"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRunPlaybook}
                      disabled={
                        !accountAccessRoleId ||
                        !selectedNode!.data.ansiblePlaybookId ||
                        !selectedNode!.data.ansibleTargetInstanceId?.trim() ||
                        createPlaybookUploadUrl.isPending ||
                        uploadPlaybookFileToS3.isPending ||
                        submitAnsibleJob.isPending
                      }
                      className={[
                        "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
                        selectedNode!.data.ansiblePlaybookId &&
                        selectedNode!.data.ansibleTargetInstanceId?.trim()
                          ? "border-primary/40 bg-primary/10 text-[var(--primary-text)] hover:bg-primary/20"
                          : "border-border bg-card text-muted-foreground",
                      ].join(" ")}
                    >
                      <Play className="h-4 w-4" />
                      {submitAnsibleJob.isPending
                        ? "Submitting Ansible job..."
                        : !accountAccessRoleId
                        ? "Connect AWS account to run"
                        : selectedNode!.data.ansiblePlaybookId
                        ? "Run playbook on this EC2 container"
                        : "Upload a playbook to run"}
                    </button>

                    {(createPlaybookUploadUrl.isPending ||
                      uploadPlaybookFileToS3.isPending) && (
                      <div className="text-xs text-muted-foreground">
                        Uploading playbook…
                      </div>
                    )}

                    {submitAnsibleJob.isPending && (
                      <div className="text-xs text-muted-foreground">
                        Submitting Ansible job…
                      </div>
                    )}

                    {uploadMessage && (
                      <div className="rounded-lg border border-green-500/20 bg-green-500/100/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                        {uploadMessage}
                      </div>
                    )}

                    {uploadError && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/100/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        {uploadError}
                      </div>
                    )}

                    {jobData && (
                      <div
                        className={`rounded-lg border px-3 py-2 text-xs space-y-1.5 ${jobCardStyle}`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${jobDotStyle}`}
                          />
                          <span className={`font-semibold ${jobTextStyle}`}>
                            {jobData.status}
                          </span>
                          <span className="text-muted-foreground font-mono ml-auto">
                            {jobData.id.slice(0, 8)}
                          </span>
                        </div>

                        {jobData.error_message && (
                          <p className="text-red-700 dark:text-red-300 pl-4 leading-snug">
                            {jobData.error_message}
                          </p>
                        )}

                        {jobStatusQuery.isDone && jobData.updated_at && (
                          <p className="text-muted-foreground pl-4">
                            Completed{" "}
                            {new Date(jobData.updated_at).toLocaleTimeString()}
                          </p>
                        )}
                      </div>
                    )}

                    {latestFinishedJob && !activeJobId && (
                      <details className="rounded-lg border border-border bg-card">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-foreground">
                          <span>Latest Ansible result</span>
                          <span
                            className={[
                              "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              latestFinishedJob.status === "SUCCESS"
                                ? "border-green-500/30 bg-green-500/100/10 text-green-700 dark:text-green-300"
                                : latestFinishedJob.status === "FAILED"
                                ? "border-red-500/30 bg-red-500/100/10 text-red-700 dark:text-red-300"
                                : latestFinishedJob.status === "RUNNING"
                                ? "border-amber-500/30 bg-amber-500/100/10 text-amber-700 dark:text-amber-300"
                                : "border-border bg-card text-foreground",
                            ].join(" ")}
                          >
                            {latestFinishedJob.status}
                          </span>
                        </summary>

                        <div className="space-y-2 border-t border-border px-3 py-3 text-xs text-foreground">
                          <div className="grid grid-cols-[90px_1fr] gap-2">
                            <span className="text-muted-foreground">Status</span>
                            <span>{latestFinishedJob.status}</span>
                          </div>

                          <div className="grid grid-cols-[90px_1fr] gap-2">
                            <span className="text-muted-foreground">Message</span>
                            <span>
                              {latestFinishedJob.error_message || "No message"}
                            </span>
                          </div>

                          <div className="grid grid-cols-[90px_1fr] gap-2">
                            <span className="text-muted-foreground">Created</span>
                            <span>
                              {formatDateTime(latestFinishedJob.created_at)}
                            </span>
                          </div>

                          <div className="grid grid-cols-[90px_1fr] gap-2">
                            <span className="text-muted-foreground">Updated</span>
                            <span>
                              {formatDateTime(latestFinishedJob.updated_at)}
                            </span>
                          </div>

                          <div className="grid grid-cols-[90px_1fr] gap-2">
                            <span className="text-muted-foreground">Job ID</span>
                            <span className="break-all font-mono text-[11px]">
                              {latestFinishedJob.id}
                            </span>
                          </div>
                        </div>
                      </details>
                    )}

                    {runError && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/100/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        {runError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isLambdaNode && (
                <div>
                  <div className="mb-4 border-t border-border" />
                  <div className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Function Code
                  </div>
                  <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/20 p-3">
                    <label
                      htmlFor={lambdaUploadInputId}
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-primary/60 bg-card px-3 py-3 text-sm font-medium text-[var(--primary-text)] transition hover:border-primary/60 hover:bg-primary/30"
                    >
                      <Upload className="h-4 w-4" />
                      {selectedNode!.data.lambdaCodeZipName
                        ? "Replace function code (.zip)"
                        : "Upload function code (.zip)"}
                    </label>
                    <input
                      id={lambdaUploadInputId}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={async (e) => {
                        const input = e.currentTarget;
                        await handleLambdaCodeUpload(
                          e.target.files?.[0] ?? null
                        );
                        input.value = "";
                      }}
                    />

                    <div className="rounded-lg border border-primary/40 bg-card px-3 py-2">
                      <div className="text-xs text-muted-foreground">Uploaded file</div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {selectedNode!.data.lambdaCodeZipName ??
                          "No file uploaded yet"}
                      </div>
                    </div>

                    {(createLambdaCodeUploadUrl.isPending ||
                      uploadLambdaCodeToS3.isPending) && (
                      <div className="text-xs text-muted-foreground">
                        Uploading function code…
                      </div>
                    )}

                    {lambdaUploadMessage && (
                      <div className="rounded-lg border border-green-500/20 bg-green-500/100/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                        {lambdaUploadMessage}
                      </div>
                    )}

                    {lambdaUploadError && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/100/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        {lambdaUploadError}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Danger zone
              </div>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className={[
                  "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
                  "border-red-900/40 bg-red-500/10 text-red-700 dark:text-red-300",
                  "hover:bg-red-500/10 hover:border-red-800/60",
                  "focus:outline-none focus:ring-1 focus:ring-red-500/60",
                ].join(" ")}
                title="Delete selected node"
              >
                <Trash2 className="h-4 w-4" />
                Delete node
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                This will also remove any connections to this node.
              </p>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}