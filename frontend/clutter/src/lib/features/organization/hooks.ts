// lib/features/organization/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { organizationApi } from "./api";
import { orgKeys } from "./keys";
import type {
  CreateCloudFormationStackUrlInput,
  CreateOrganizationInput,
  OrganizationAwsAccount,
  Organization,
  UpdateOrganizationAwsAccountInput,
  UpdateOrganizationInput,
} from "./types";

export const useOrganizations = (token?: string | null) => {
  return useQuery({
    queryKey: orgKeys.list(),
    queryFn: () => organizationApi.list(token as string),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
};

export const useCreateOrganization = (token?: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => organizationApi.create(token as string, input),
    onSuccess: (created) => {
      qc.setQueryData<Organization[]>(orgKeys.list(), (prev) => [created, ...(prev ?? [])]);
    },
  });
};

export const useUpdateOrganization = (token?: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { organizationId: string; data: UpdateOrganizationInput }) =>
      organizationApi.update(token as string, input.organizationId, input.data),
    onSuccess: (updated) => {
      qc.setQueryData<Organization[]>(orgKeys.list(), (prev) =>
        (prev ?? []).map((o) => (o.id === updated.id ? updated : o))
      );
    },
  });
};

export const useDeleteOrganization = (token?: string | null) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) => organizationApi.delete(token as string, organizationId),
    onSuccess: (_void, organizationId) => {
      qc.setQueryData<Organization[]>(orgKeys.list(), (prev) => (prev ?? []).filter((o) => o.id !== organizationId));
      qc.removeQueries({ queryKey: ["members"] });
    },
  });
};

export const useCreateCloudFormationStackUrl = (token?: string | null) => {
  return useMutation({
    mutationKey: orgKeys.cloudFormationStackUrl(),
    mutationFn: (input: CreateCloudFormationStackUrlInput) =>
      organizationApi.createCloudFormationStackUrl(token as string, input),
  });
};

export const useOrganizationAccounts = (token?: string | null, organizationId?: string | null) => {
  return useQuery({
    queryKey: orgKeys.accounts(organizationId ?? ""),
    queryFn: () => organizationApi.listAccounts(token as string, organizationId as string),
    enabled: !!token && !!organizationId,
    staleTime: 60 * 1000,
  });
};

export const useLinkFakeAccount = (token?: string | null) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (organizationId: string) => organizationApi.linkFakeAccount(token as string, organizationId),
    onSuccess: (_void, organizationId) => qc.invalidateQueries({ queryKey: orgKeys.accounts(organizationId) }),
  });
};

export const useDeleteOrganizationAccount = (token?: string | null) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { organizationId: string; accountId: string }) =>
      organizationApi.deleteAccount(token as string, input.organizationId, input.accountId),
    onSuccess: (_void, input) => {
      qc.setQueryData<OrganizationAwsAccount[]>(
        orgKeys.accounts(input.organizationId),
        (prev) => (prev ?? []).filter((account) => account.id !== input.accountId)
      );
    },
  });
};

export const useUpdateOrganizationAccount = (token?: string | null) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      organizationId: string;
      accountId: string;
      data: UpdateOrganizationAwsAccountInput;
    }) => organizationApi.updateAccount(token as string, input.organizationId, input.accountId, input.data),
    onSuccess: (_void, input) => {
      qc.invalidateQueries({ queryKey: orgKeys.accounts(input.organizationId) });
    },
  });
};
