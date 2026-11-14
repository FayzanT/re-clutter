import { ExternalLink, KeyRound, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const AWS_SETUP_GUIDE_URL =
  "/guide/AWS_Account_Link_Steps.pdf";

export default function AwsAccountHeader() {
  return (
    <Card className="border-border bg-card shadow-2xl backdrop-blur-xl">
      <CardHeader className="gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
              <KeyRound className="h-7 w-7 text-[var(--primary-text)]" />
            </div>

            <div className="space-y-2">
              <CardTitle className="flex items-center gap-2 text-3xl text-foreground">
                Connect an AWS Account
                <Sparkles className="h-5 w-5 text-[var(--primary-text)]" />
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Re-Clutter deploys infrastructure into your AWS account by assuming a secure IAM role. Create the role in AWS, paste the Role ARN here, then verify and save the connection.
              </CardDescription>
            </div>
          </div>

          <div className="grid min-w-[220px] gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <ShieldCheck className="h-4 w-4 text-[var(--primary-text)]" />
              No long-lived AWS keys
            </div>
            <div className="text-muted-foreground">Frontend only stores metadata like alias, role ARN, and region.</div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="max-w-3xl text-lg leading-8 text-foreground">
            Need a walkthrough? Open the step-by-step AWS account linking guide.
          </span>
          <Button variant="ghost" size="sm" asChild className="shrink-0 text-base text-foreground hover:bg-card hover:text-foreground">
            <a href={AWS_SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
              View setup guide
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}
