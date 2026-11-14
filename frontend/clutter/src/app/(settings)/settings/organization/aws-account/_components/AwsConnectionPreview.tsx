import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LinkStatus } from "./arn_page";

interface AwsConnectionPreviewProps {
  accountName: string;
  defaultRegion: string;
  launchUrl: string | null;
  linkedAccountId: string | null;
  status: LinkStatus;
}

export default function AwsConnectionPreview({ accountName, defaultRegion, launchUrl, linkedAccountId, status }: AwsConnectionPreviewProps) {
  const statusLabel =
    {
      idle: "Waiting for input",
      "creating-template-link": "Creating setup link",
      "awaiting-role-arn": "Awaiting role ARN",
      verifying: "Validating ARN",
      verified: "ARN validated",
      saving: "Submitting ARN",
      submitted: "ARN submitted",
      error: "Needs attention",
    }[status] ?? status;

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">Connection preview</CardTitle>
        <CardDescription className="text-muted-foreground">This reflects the current setup state for this account connection.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm text-foreground md:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">Status</span>
          <span className="font-medium text-foreground">{statusLabel}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">AWS account name</span>
          <span className="font-medium text-foreground">{accountName.trim() || "Not set"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">Region</span>
          <span className="font-medium text-foreground">{defaultRegion}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">Pending link ID</span>
          <span className="break-all font-medium text-foreground">{linkedAccountId ?? "Not created yet"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 md:col-span-2 xl:col-span-2">
          <span className="text-muted-foreground">Launch URL</span>
          <span className="break-all font-medium text-foreground">{launchUrl ?? "Not generated yet"}</span>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-card p-4 text-muted-foreground md:col-span-2 xl:col-span-3">
          Generate the setup link in AWS first, then paste the Role ARN here to complete the connection.
        </div>
      </CardContent>
    </Card>
  );
}
