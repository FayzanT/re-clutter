// lib/features/diagram/hooks.ts

import { projectKeys } from "@/lib/features/projects/keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VALID_LOADERS } from "next/dist/shared/lib/image-config";
import { DiagramSummary, Project } from "../projects/types";
import { diagramApi } from "./api";
import { diagramKeys } from "./keys";
import { filesPredateStatus } from "./types";
import type {
  CreateDiagramInput,
  Diagram,
  DiagramEdge,
  DiagramNode,
  RunTerraformResult,
  TerraformCommandInput,
} from "./types";

export const useDiagrams = (token?: string | null, projectId?: string | null) => {
  return useQuery({
    queryKey: projectId ? diagramKeys.list(projectId) : ["diagram", "list", "no-project"],
    queryFn: () => diagramApi.list(token as string, projectId as string),
    enabled: !!token && !!projectId,
    staleTime: 5 * 60 * 1000,
  });
};

export const useDiagram = (token?: string | null, projectId?: string | null, diagramId?: string | null) => {
  return useQuery({
    queryKey: projectId && diagramId ? diagramKeys.detail(projectId, diagramId) : ["diagram", "detail", "missing"],
    queryFn: () => diagramApi.get(token as string, projectId as string, diagramId as string),
    enabled: !!token && !!projectId && !!diagramId,
    staleTime: 5 * 60 * 1000,
  });
};

// Generation runs just after a save returns, so the first answer can be behind
// the save. pollWhileBehind keeps asking until the answer covers the latest save.
// Nothing is cached: an old answer must never stand in for a new save.
export const useTerraformFiles = (token: string | null, projectId: string, diagramId: string, pollWhileBehind: boolean) => {
  return useQuery({
    queryKey: diagramKeys.terraformFiles(projectId, diagramId),
    queryFn: () => diagramApi.terraformFiles(token as string, projectId, diagramId),
    enabled: !!token,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: (query) =>
      pollWhileBehind && query.state.status !== "error" && !query.state.data?.current && !filesPredateStatus(query.state.data)
        ? 1000
        : false,
  });
};

export const useCreateDiagram = (token?: string | null) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateDiagramInput & { organizationId: string }) => {
      const { organizationId: _orgId, ...payload } = input;
      return diagramApi.create(token as string, payload);
    },
    onSuccess: (created, vars) => {
      qc.setQueryData<Diagram[]>(diagramKeys.list(created.projectId), (prev) => [created, ...(prev ?? [])]);
      qc.setQueryData<Project>(projectKeys.detail(vars.organizationId, created.projectId), (prev) => {
        if (!prev) return prev;
        const nextSummary: DiagramSummary = { id: created.id, name: created.name };
        const filtered = (prev.diagrams ?? []).filter((d) => d.id !== created.id);
        return {
          ...prev,
          diagrams: [nextSummary, ...filtered],
        };
      });
    },
  });
};

export const useUpdateDiagramData = (token?: string | null) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      projectId: string;
      diagramId: string;
      name: string;
      nodes: DiagramNode[];
      edges: DiagramEdge[];
    }) =>
      diagramApi.update(token as string, {
        projectId: input.projectId,
        diagramId: input.diagramId,
        name: input.name,
        data: { nodes: input.nodes, edges: input.edges },
      }),

    onSuccess: (updated, vars) => {
      // update detail cache
      qc.setQueryData<Diagram>(diagramKeys.detail(vars.projectId, vars.diagramId), updated);

      // update list cache for that project
      qc.setQueryData<Diagram[]>(diagramKeys.list(vars.projectId), (prev) => {
        if (!prev) return prev;
        return prev.map((d) => (d.id === updated.id ? updated : d));
      });
    },
  });
};

export const useDeleteDiagram = (token?: string | null) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { organizationId: string; projectId: string; diagramId: string }) =>
      diagramApi.delete(token as string, input.projectId, input.diagramId),
    onSuccess: (_void, vars) => {
      qc.removeQueries({ queryKey: diagramKeys.detail(vars.projectId, vars.diagramId) });
      qc.setQueryData<Diagram[]>(diagramKeys.list(vars.projectId), (prev) => {
        if (!prev) return prev;
        return prev.filter((d) => d.id !== vars.diagramId);
      });
      qc.setQueryData<Project>(projectKeys.detail(vars.organizationId, vars.projectId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          diagrams: (prev.diagrams ?? []).filter((d) => d.id !== vars.diagramId),
        };
      });
    },
  });
};

export const useRunTerraform = (token?: string | null) => {
  return useMutation<RunTerraformResult, Error, TerraformCommandInput>({
    mutationFn: (input: TerraformCommandInput) => diagramApi.runTerraform(token as string, input),
  });
};
