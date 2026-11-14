import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LinkStatus } from "./arn_page";

interface AwsRoleVerificationFormProps {
  accountName: string;
  defaultRegion: string;
  isReadyForArn: boolean;
  roleArn: string;
  status: LinkStatus;
  onDefaultRegionChange: (value: string) => void;
  onRoleArnChange: (value: string) => void;
  onSave: () => Promise<void>;
  onVerify: () => Promise<void>;
}

export default function AwsRoleVerificationForm({ accountName, defaultRegion, isReadyForArn, roleArn, status, onDefaultRegionChange, onRoleArnChange, onSave, onVerify }: AwsRoleVerificationFormProps) {
  return (
    <Card className="h-full border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">2. Paste role details and submit</CardTitle>
        <CardDescription className="text-muted-foreground">After you finish in AWS, paste the Role ARN here and submit it. Format validation is optional.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave();
          }}
        >
          <div className="space-y-2">
            <Label className="text-foreground">AWS account name</Label>
            <Input value={accountName} readOnly className="border-border bg-card text-foreground" />
            <p className="text-xs text-muted-foreground">This comes from the setup-link step and is sent to the backend before the ARN step is unlocked.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Role ARN</Label>
            <Input
              value={roleArn}
              onChange={(event) => onRoleArnChange(event.target.value)}
              placeholder="arn:aws:iam::123456789012:role/ClutterDeployRole"
              className="border-border bg-card font-mono text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
              disabled={!isReadyForArn}
            />
            <p className="text-xs text-muted-foreground">Submitting this sends `role_arn` to the backend account endpoint.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Default region</Label>
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
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <Button type="submit" className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary" disabled={!isReadyForArn || status === "verifying" || status === "saving"}>
              {status === "saving" ? "Submitting ARN..." : "Submit ARN"}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" className="w-full border-border bg-card text-foreground hover:bg-card" onClick={() => void onVerify()} disabled={!isReadyForArn || status === "verifying" || status === "saving"}>
              {status === "verifying" ? "Validating ARN..." : "Optional: Validate ARN format"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
