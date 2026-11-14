import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrganizationAwsAccount } from "@/lib/features/organization/types";

interface AwsExistingAccountCardProps {
  account: OrganizationAwsAccount;
}

export default function AwsExistingAccountCard({ account }: AwsExistingAccountCardProps) {
  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">Linked AWS account</CardTitle>
        <CardDescription className="text-muted-foreground">
          This organization already has an AWS account link configured.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-foreground">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-muted-foreground">Account name</span>
          <span className="font-medium text-foreground">{account.account_name}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-muted-foreground">Status</span>
          <span className="font-medium text-foreground">{account.status}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-muted-foreground">Role ARN</span>
          <span className="max-w-[20rem] truncate font-mono text-foreground">{account.role_arn ?? "Not submitted yet"}</span>
        </div>
      </CardContent>
    </Card>
  );
}
