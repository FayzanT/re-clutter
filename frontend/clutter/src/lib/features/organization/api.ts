// lib/features/organization/api.ts
import type {
  ApiEnvelope,
  CloudFormationStackUrlResponse,
  CreateCloudFormationStackUrlInput,
  CreateOrganizationInput,
  OrganizationAwsAccount,
  OrganizationAwsAccountsResponse,
  Organization,
  UpdateOrganizationAwsAccountInput,
  UpdateOrganizationInput,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_ENDPOINT;

// The local dev gateway's own routes exist only here, never in a deployment.
export const isLocalDevApi = process.env.NODE_ENV === "development"
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

export const organizationApi = {
  // GET /organization
  // supports either {data: {...}} or {data: [{...}, ...]}
  list: async (token: string): Promise<Organization[]> => {
    const json = await apiFetch<ApiEnvelope<Organization | Organization[]>>("/organization", token, { method: "GET" });

    return Array.isArray(json.data) ? json.data : [json.data];
  },

  // POST /organization
  create: async (token: string, input: CreateOrganizationInput): Promise<Organization> => {
    const json = await apiFetch<ApiEnvelope<Organization>>("/organization", token, {
      method: "POST",
      body: JSON.stringify(input),
    });

    return json.data;
  },

  // PUT /organization/:organizationId
  update: async (token: string, organizationId: string, input: UpdateOrganizationInput): Promise<Organization> => {
    const json = await apiFetch<ApiEnvelope<Organization>>(`/organization/${organizationId}`, token, {
      method: "PUT",
      body: JSON.stringify(input),
    });

    return json.data;
  },

  // DELETE /organization/:organizationId
  delete: async (token: string, organizationId: string): Promise<void> => {
    await apiFetch<ApiEnvelope<unknown>>(`/organization/${organizationId}`, token, {
      method: "DELETE",
    });
  },

  // GET /cloudformation-stack-url/:organizationId?accountName=...&region=...
  createCloudFormationStackUrl: async (
    token: string,
    input: CreateCloudFormationStackUrlInput
  ): Promise<CloudFormationStackUrlResponse> => {
    const params = new URLSearchParams({
      accountName: input.accountName,
      region: input.region ?? "us-west-2",
    });

    const json = await apiFetch<ApiEnvelope<CloudFormationStackUrlResponse>>(
      `/cloudformation-stack-url/${input.organizationId}?${params.toString()}`,
      token,
      { method: "GET" }
    );

    return json.data;
  },

  // GET /organization/:organizationId/accounts
  listAccounts: async (token: string, organizationId: string): Promise<OrganizationAwsAccount[]> => {
    const json = await apiFetch<ApiEnvelope<OrganizationAwsAccountsResponse>>(
      `/organization/${organizationId}/accounts`,
      token,
      { method: "GET" }
    );

    return [...(json.data?.complete ?? []), ...(json.data?.incomplete ?? [])].filter(
      (account): account is OrganizationAwsAccount => !!account && typeof account === "object"
    );
  },

  // POST /dev/link-fake-account (local dev gateway only)
  linkFakeAccount: async (token: string, organizationId: string): Promise<void> => {
    await apiFetch<{ message: string }>("/dev/link-fake-account", token, {
      method: "POST",
      body: JSON.stringify({ organizationId }),
    });
  },

  // DELETE /organization/:organizationId/accounts/:accountId
  deleteAccount: async (token: string, organizationId: string, accountId: string): Promise<void> => {
    await apiFetch<ApiEnvelope<unknown>>(`/organization/${organizationId}/accounts/${accountId}`, token, {
      method: "DELETE",
    });
  },

  // POST /organization/:organizationId/accounts/:accountId
  updateAccount: async (
    token: string,
    organizationId: string,
    accountId: string,
    input: UpdateOrganizationAwsAccountInput
  ): Promise<void> => {
    await apiFetch<ApiEnvelope<unknown>>(`/organization/${organizationId}/accounts/${accountId}`, token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
