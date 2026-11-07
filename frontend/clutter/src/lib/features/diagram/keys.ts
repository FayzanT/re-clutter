// lib/features/diagram/keys.ts

export const diagramKeys = {
  base: ["diagram"] as const,

  list: (projectId: string) => [...diagramKeys.base, "list", projectId] as const,
  detail: (projectId: string, diagramId: string) => [...diagramKeys.base, "detail", projectId, diagramId] as const,
  terraformFiles: (projectId: string, diagramId: string) => [...diagramKeys.base, "terraform-files", projectId, diagramId] as const,
};
