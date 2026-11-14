"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  useCreateCloudFormationStackUrl,
  useDeleteOrganizationAccount,
  useOrganizationAccounts,
  useOrganizations,
  useUpdateOrganizationAccount,
} from "@/lib/features/organization/hooks";
import type { CloudFormationStackUrlResponse } from "@/lib/features/organization/types";
import { useMe } from "@/lib/features/user/hooks";
import AwsAccountDangerZone from "./AwsAccountDangerZone";
import AwsDeleteConfirmModal from "./AwsDeleteConfirmModal";
import AwsAccountHeader from "./AwsAccountHeader";
import AwsConnectionPreview from "./AwsConnectionPreview";
import AwsExistingAccountCard from "./AwsExistingAccountCard";
import AwsRoleSetupCard from "./AwsRoleSetupCard";
import AwsRoleVerificationForm from "./AwsRoleVerificationForm";

export type LinkStatus = "idle" | "creating-template-link" | "awaiting-role-arn" | "verifying" | "verified" | "saving" | "submitted" | "error";

type DeleteTarget = {
  accountId: string;
  accountName: string;
};

const roleArnPattern = /^arn:aws:iam::\d{12}:role\/[\w+=,.@\-_/]+$/;
export default function ArnPage() {
  const meQ = useMe();
  const token = meQ.data?.token ?? null;
  const orgQ = useOrganizations(token);
  const organizationId = orgQ.data?.[0]?.id ?? "";
  const createStackUrl = useCreateCloudFormationStackUrl(token);
  const accountsQ = useOrganizationAccounts(token, organizationId);
  const deleteAccount = useDeleteOrganizationAccount(token);
  const updateAccount = useUpdateOrganizationAccount(token);

  const [accountName, setAccountName] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [defaultRegion, setDefaultRegion] = useState("us-west-2");
  const [status, setStatus] = useState<LinkStatus>("idle");
  const [error, setError] = useState("");
  const [stackData, setStackData] = useState<CloudFormationStackUrlResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const completeAccount = accountsQ.data?.find((account) => account.status === "complete") ?? null;
  const pendingAccount = accountsQ.data?.find((account) => account.status === "incomplete") ?? null;
  const activePendingAccountId = stackData?.account_id ?? pendingAccount?.id ?? null;
  const effectiveAccountName = accountName.trim() || pendingAccount?.account_name || "";
  const effectiveRoleArn = roleArn.trim() || pendingAccount?.role_arn || "";

  const handleGenerateStackUrl = async () => {
    if (!token) {
      setStatus("error");
      setError("You must be signed in before generating the AWS setup link.");
      return;
    }

    if (!organizationId) {
      setStatus("error");
      setError("Organization context is still loading. Try again once settings finish loading.");
      return;
    }

    if (!accountName.trim()) {
      setStatus("error");
      setError("Enter the AWS account name before generating the setup link.");
      return;
    }

    setError("");
    setStatus("creating-template-link");
    const popup = typeof window !== "undefined" ? window.open("", "_blank") : null;

    try {
      const response = await createStackUrl.mutateAsync({
        organizationId,
        accountName: accountName.trim(),
        region: defaultRegion,
      });

      setStackData(response);
      setStatus("awaiting-role-arn");

      if (popup) {
        popup.location.href = response.url;
        popup.focus();
      }
    } catch (err) {
      popup?.close();
      setStatus("error");
      setStackData(null);
      setError(err instanceof Error ? err.message : "Failed to generate CloudFormation launch URL.");
    }
  };

  const handleVerify = async () => {
    if (!effectiveAccountName) {
      setStatus("error");
      setError("Enter an account name before verifying the role.");
      return;
    }

    if (!activePendingAccountId) {
      setStatus("error");
      setError("Generate the CloudFormation setup link before submitting the ARN.");
      return;
    }

    if (!roleArnPattern.test(effectiveRoleArn)) {
      setStatus("error");
      setError("Enter a valid IAM Role ARN in the format arn:aws:iam::<account-id>:role/<role-name>.");
      return;
    }

    setError("");
    setStatus("verifying");

    window.setTimeout(() => {
      setStatus("verified");
    }, 900);
  };

  const handleSave = async () => {
    if (!organizationId || !activePendingAccountId) {
      setStatus("error");
      setError("The pending account record is missing. Generate the setup link again.");
      return;
    }

    if (!roleArnPattern.test(effectiveRoleArn)) {
      setStatus("error");
      setError("Enter a valid IAM Role ARN before saving.");
      return;
    }

    setError("");
    setStatus("saving");

    try {
      await updateAccount.mutateAsync({
        organizationId,
        accountId: activePendingAccountId,
        data: {
          role_arn: effectiveRoleArn,
        },
      });

      setStatus("submitted");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to save the AWS account role ARN.");
    }
  };

  const resetCreationFlow = () => {
    setAccountName("");
    setRoleArn("");
    setDefaultRegion("us-west-2");
    setStatus("idle");
    setError("");
    setStackData(null);
  };

  const handleDeleteAccount = async () => {
    if (!organizationId || !deleteTarget) return;

    try {
      await deleteAccount.mutateAsync({
        organizationId,
        accountId: deleteTarget.accountId,
      });

      setDeleteTarget(null);
      resetCreationFlow();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to delete the AWS account link.");
    }
  };

  const currentAccountName = effectiveAccountName;
  const currentRoleArn = effectiveRoleArn;
  const hasPendingFlow = !!pendingAccount || !!stackData;

  const currentStatus: LinkStatus =
    status === "idle" && pendingAccount ? "awaiting-role-arn" : status;

  return (
    <main className="space-y-6">
      {!completeAccount && <AwsAccountHeader />}

      {status === "error" && error && (
        <Alert className="border-red-500/30 bg-red-500/100/10 text-red-100">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Verification blocked</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {status === "verified" && (
        <Alert className="border-primary/30 bg-primary/10 text-[var(--primary-text)]">
          <CheckCircle2 className="h-4 w-4 text-[var(--primary-text)]" />
          <AlertTitle>ARN format validated</AlertTitle>
          <AlertDescription>The ARN format looks valid locally. You can submit it when ready.</AlertDescription>
        </Alert>
      )}

      {status === "submitted" && (
        <Alert className="border-primary/30 bg-primary/10 text-[var(--primary-text)]">
          <CheckCircle2 className="h-4 w-4 text-[var(--primary-text)]" />
          <AlertTitle>Role ARN submitted</AlertTitle>
          <AlertDescription>The ARN was sent to the backend for this organization account link.</AlertDescription>
        </Alert>
      )}

      {completeAccount ? (
        <div className="space-y-6">
          <AwsExistingAccountCard account={completeAccount} />
          <AwsAccountDangerZone
            accountName={completeAccount.account_name}
            isDeleting={deleteAccount.isPending}
            onRequestDelete={() =>
              setDeleteTarget({
                accountId: completeAccount.id,
                accountName: completeAccount.account_name,
              })
            }
          />
        </div>
      ) : (
        <Card className="rounded-2xl border border-border bg-card shadow-xl">
          <CardContent className="grid gap-6 px-6 py-6 lg:grid-cols-2">
            <div className="h-full">
              <AwsRoleSetupCard
                accountName={currentAccountName}
                defaultRegion={defaultRegion}
                isGenerating={createStackUrl.isPending}
                launchUrl={stackData?.url ?? null}
                linkedAccountId={activePendingAccountId}
                onAccountNameChange={setAccountName}
                onDefaultRegionChange={setDefaultRegion}
                onGenerateStackUrl={handleGenerateStackUrl}
              />
            </div>

            <div className="h-full">
              <AwsRoleVerificationForm
                accountName={currentAccountName}
                defaultRegion={defaultRegion}
                isReadyForArn={hasPendingFlow}
                roleArn={currentRoleArn}
                status={currentStatus}
                onDefaultRegionChange={setDefaultRegion}
                onRoleArnChange={setRoleArn}
                onSave={handleSave}
                onVerify={handleVerify}
              />
            </div>

            <div className="lg:col-span-2">
              <AwsConnectionPreview
                accountName={currentAccountName}
                defaultRegion={defaultRegion}
                launchUrl={stackData?.url ?? null}
                linkedAccountId={activePendingAccountId}
                status={currentStatus}
              />
            </div>

            {pendingAccount && (
              <div className="lg:col-span-2">
                <AwsAccountDangerZone
                  accountName={pendingAccount.account_name}
                  isDeleting={deleteAccount.isPending}
                  onRequestDelete={() =>
                    setDeleteTarget({
                      accountId: pendingAccount.id,
                      accountName: pendingAccount.account_name,
                    })
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {deleteTarget && (
        <AwsDeleteConfirmModal
          accountName={deleteTarget.accountName}
          isDeleting={deleteAccount.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteAccount}
        />
      )}
    </main>
  );
}
