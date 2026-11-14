import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AwsRoleSetupCardProps {
  accountName: string;
  defaultRegion: string;
  isGenerating: boolean;
  launchUrl: string | null;
  linkedAccountId: string | null;
  onAccountNameChange: (value: string) => void;
  onDefaultRegionChange: (value: string) => void;
  onGenerateStackUrl: () => Promise<void>;
}

export default function AwsRoleSetupCard({ accountName, defaultRegion, isGenerating, launchUrl, linkedAccountId, onAccountNameChange, onDefaultRegionChange, onGenerateStackUrl }: AwsRoleSetupCardProps) {
  return (
    <Card className="h-full border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">1. Open AWS setup</CardTitle>
        <CardDescription className="text-muted-foreground">Enter the account name first. Re-Clutter will generate the CloudFormation launch URL and open AWS for you.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-5">
        <div className="grid gap-4 rounded-2xl border border-border bg-card p-4">
          <div className="space-y-2">
            <Label className="text-foreground">AWS account name</Label>
            <Input value={accountName} onChange={(event) => onAccountNameChange(event.target.value)} placeholder="e.g. DemoAccount" className="border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring" />
            <p className="text-xs text-muted-foreground">This becomes the `accountName` query parameter for the setup-link endpoint.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Deployment region</Label>
            <Select value={defaultRegion} onValueChange={onDefaultRegionChange}>
              <SelectTrigger className="w-full border-border bg-card text-foreground">
                <SelectValue placeholder="Select a region" />
              </SelectTrigger>
              <SelectContent className="border-border bg-card text-foreground">
                <SelectItem value="us-west-2">us-west-2</SelectItem>
                <SelectItem value="us-east-1">us-east-1</SelectItem>
                <SelectItem value="ca-central-1">ca-central-1</SelectItem>
                <SelectItem value="eu-west-1">eu-west-1</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">If omitted, the API defaults to `us-west-2`. Keeping it explicit is clearer for the user.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" className="bg-primary font-semibold text-primary-foreground hover:bg-primary" onClick={() => void onGenerateStackUrl()} disabled={isGenerating}>
              {isGenerating ? "Opening AWS setup..." : "Open AWS setup in CloudFormation"}
            </Button>
          </div>

          {linkedAccountId && (
            <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-[var(--primary-text)]">
              Pending account link created with ID <span className="font-mono">{linkedAccountId}</span>.
            </div>
          )}

          {launchUrl && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>AWS setup is ready. If the tab did not open, use the fallback action.</span>
              <Button type="button" variant="ghost" size="sm" className="text-foreground hover:bg-card hover:text-foreground" onClick={() => window.open(launchUrl, "_blank", "noopener,noreferrer")}>
                Open again
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
