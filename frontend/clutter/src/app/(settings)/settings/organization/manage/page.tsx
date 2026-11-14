"use client";

import {
  useAddMember,
  useAvailableUsers,
  useMembers,
} from "@/lib/features/members/hooks";
import {
  useDeleteOrganization,
  useOrganizations,
  useUpdateOrganization,
} from "@/lib/features/organization/hooks";
import { useLogout, useMe } from "@/lib/features/user/hooks";
import { AlertTriangle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import AddUsersDropdown, {
  type MemberOption,
} from "./_components/AddUsersDropdown";
import ManageForm, { type ManageFormValues } from "./_components/ManageForm";
import Members from "./_components/Members";

export default function OrganizationManagePage() {
  const router = useRouter();
  const logout = useLogout();

  const meQ = useMe();
  const token = meQ.data?.token ?? null;

  const orgQ = useOrganizations(token);

  const membersQ = useMembers();
  const usersQ = useAvailableUsers();

  const updateOrg = useUpdateOrganization(token);
  const deleteOrg = useDeleteOrganization(token);
  const addMember = useAddMember();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const organizations = orgQ.data ?? [];
  const organization = organizations[0] ?? null;

  const members = membersQ.data ?? [];
  const availableUsers = usersQ.data ?? [];

  const isLoading =
    meQ.isLoading || orgQ.isLoading || membersQ.isLoading || usersQ.isLoading;

  const isSaving =
    updateOrg.isPending || deleteOrg.isPending || addMember.isPending;

  const userOptions: MemberOption[] = useMemo(
    () =>
      availableUsers.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      })),
    [availableUsers],
  );

  if (!isLoading && !token) {
    return (
      <main className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">
          Please sign in to manage your organization.
        </div>
      </main>
    );
  }

  if (isLoading && !organization) {
    return (
      <main className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading organization settings...</div>
      </main>
    );
  }

  return (
    <>
      <main>
        <section className="rounded-2xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Workspace settings</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Update the core details for this organization. Changes may take a
              few seconds to propagate.
            </p>
          </div>

          <div className="px-6 py-6">
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <ManageForm
                initialValues={{
                  orgName: organization?.name ?? "",
                  orgId: organization?.id ?? "",
                  description: organization?.description ?? "",
                }}
                onSubmit={async (values: ManageFormValues) => {
                  if (!token || !organization?.id) return;

                  await updateOrg.mutateAsync({
                    organizationId: organization.id,
                    data: { description: values.description },
                  });
                }}
                onDelete={async () => {
                  if (!token || !organization?.id) return;
                  setShowDeleteConfirm(true);
                }}
                isSaving={isSaving}
                isDeleting={deleteOrg.isPending}
              />

              <div className="border-border lg:border-l lg:pl-6 border-t lg:border-t-0">
                <AddUsersDropdown
                  options={userOptions}
                  onPick={async (member) => {
                    await addMember.mutateAsync({
                      userId: member.id,
                      role: "Member",
                    });
                  }}
                  placeholder="Add users..."
                  disabled={isSaving}
                />
                <Members members={members} />
              </div>
            </div>
          </div>
        </section>
      </main>

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => {
            if (!deleteOrg.isPending) setShowDeleteConfirm(false);
          }}
        >
          <div
            className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-red-800/50 bg-red-500/10">
                <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-300" />
              </div>

              <div>
                <h3 className="mb-1 text-base font-semibold text-foreground">
                  Delete organization
                </h3>
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to delete{" "}
                  <span className="font-medium text-foreground">
                    &quot;{organization?.name || "this organization"}&quot;
                  </span>
                  ? This action cannot be undone.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteOrg.isPending}
                className="ml-auto flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteOrg.isPending}
                className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={deleteOrg.isPending}
                onClick={async () => {
                  if (!token || !organization?.id) return;

                  await deleteOrg.mutateAsync(organization.id);
                  setShowDeleteConfirm(false);

                  logout();
                  router.replace("/");
                  router.refresh();
                }}
                className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-foreground transition-colors hover:bg-red-500/100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteOrg.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}