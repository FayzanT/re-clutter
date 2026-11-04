import type {
  ApiEnvelope,
  CreateDiagramInput,
  Diagram,
  DiagramApiItem,
  RunTerraformResponseEnvelope,
  RunTerraformResult,
  UpdateDiagramInput,
  TerraformPreview,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_ENDPOINT;

// The preview endpoint belongs to the local dev gateway and is never deployed.
export const supportsLocalTerraformPreview = process.env.NODE_ENV === "development"
  && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(API_BASE ?? "");

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new Error("API_ENDPOINT is not set");

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

// No more uiLayout renaming — just ensure data has a safe fallback
function normalizeDiagram(item: DiagramApiItem): Diagram {
  return {
    ...item,
    data: {
      nodes: item.data?.nodes ?? [],
      edges: item.data?.edges ?? [],
    },
  };
}

function normalizeMany(payload: DiagramApiItem | DiagramApiItem[]): Diagram[] {
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr.map(normalizeDiagram);
}

export const diagramApi = {
  previewTerraform: async (token: string, projectId: string, diagramId: string): Promise<TerraformPreview> => {
    const qs = new URLSearchParams({ projectId, diagramId });
    const json = await apiFetch<ApiEnvelope<TerraformPreview>>(`/dev/terraform-preview?${qs}`, token);
    return json.data;
  },
  list: async (token: string, projectId: string): Promise<Diagram[]> => {
    const qs = new URLSearchParams({ projectId });
    const json = await apiFetch<ApiEnvelope<DiagramApiItem[] | DiagramApiItem>>(`/diagram?${qs.toString()}`, token, {
      method: "GET",
    });
    return normalizeMany(json.data);
  },

  create: async (token: string, input: CreateDiagramInput): Promise<Diagram> => {
    const json = await apiFetch<ApiEnvelope<DiagramApiItem[] | DiagramApiItem>>("/diagram", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const first = Array.isArray(json.data) ? json.data[0] : json.data;
    if (!first) throw new Error("Create returned no diagram");
    return normalizeDiagram(first);
  },

  get: async (token: string, projectId: string, diagramId: string): Promise<Diagram> => {
    const qs = new URLSearchParams({ projectId, diagramId });
    const json = await apiFetch<ApiEnvelope<DiagramApiItem[] | DiagramApiItem>>(`/diagram?${qs.toString()}`, token, {
      method: "GET",
    });
    const first = Array.isArray(json.data) ? json.data[0] : json.data;
    if (!first) throw new Error("Diagram not found");
    return normalizeDiagram(first);
  },

  update: async (token: string, input: UpdateDiagramInput): Promise<Diagram> => {
    // input.data is sent as-is — matches what the backend expects
    const json = await apiFetch<ApiEnvelope<DiagramApiItem[] | DiagramApiItem | null | undefined>>(`/diagram`, token, {
      method: "PUT",
      body: JSON.stringify(input),
    });

    const returned = json?.data;
    const item = Array.isArray(returned) ? returned[0] : returned;

    if (item && typeof item === "object" && "id" in item) {
      return normalizeDiagram(item as DiagramApiItem);
    }

    return await diagramApi.get(token, input.projectId, input.diagramId);
  },

  delete: async (token: string, projectId: string, diagramId: string): Promise<void> => {
    const qs = new URLSearchParams({ projectId, diagramId });
    await apiFetch<ApiEnvelope<unknown>>(`/diagram?${qs.toString()}`, token, { method: "DELETE" });
  },

  // POST /terraform-command-runner
  runTerraform: async (
    token: string,
    input: {
      organizationId: string;
      projectId: string;
      diagramId: string;
      accountAccessRoleId: string;
      command: "apply" | "destroy" | "plan";
    }
  ): Promise<RunTerraformResult> => {
    const json = await apiFetch<RunTerraformResponseEnvelope>("/terraform-command-runner", token, {
      method: "POST",
      body: JSON.stringify(input),
    });

    const commandId = json?.data?.commandId;
    const taskArn = json?.data?.taskArn;

    if (!taskArn) {
      throw new Error("runTerraform: response did not include a taskArn");
    }

    if (!commandId) {
      throw new Error("runTerraform: response did not include a commandId");
    }

    return {
      commandId,
      taskArn,
    };
  },
};
