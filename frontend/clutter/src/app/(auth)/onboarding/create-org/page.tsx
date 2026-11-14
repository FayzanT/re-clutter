"use client";

import { AlertCircle, ArrowRight, Building2, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useCreateOrganization, useOrganizations } from "@/lib/features/organization/hooks";
import { useMe } from "@/lib/features/user/hooks";

export default function CreateOrgPage() {
  const router = useRouter();

  const meQ = useMe();
  const token = meQ.data?.token ?? null;

  const orgsQ = useOrganizations(token);
  const createOrg = useCreateOrganization(token);

  const [organizationName, setOrganizationName] = useState("");
  const [description, setDescription] = useState("");

  const hasOrg = useMemo(() => (orgsQ.data ?? []).length > 0, [orgsQ.data]);
  const trimmedOrganizationName = organizationName.trim();
  const trimmedDescription = description.trim();
  const isDescriptionValid =
    trimmedDescription.length === 0 ||
    (trimmedDescription.length <= 300 && !description.startsWith(" ") && !description.endsWith(" ") && !description.includes("  "));

  useEffect(() => {
    if (meQ.isLoading) return;

    // not signed in → login
    if (!token) {
      router.replace("/login");
      return;
    }

    // signed in AND already has org → dashboard
    if (!orgsQ.isLoading && !orgsQ.isError && hasOrg) {
      router.replace("/dashboard");
    }
  }, [meQ.isLoading, token, hasOrg, orgsQ.isLoading, orgsQ.isError, router]);
  
  const canSubmit = trimmedOrganizationName.length >= 4 && isDescriptionValid && !!token && !createOrg.isPending;

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;

    const payload = {
      organizationName: trimmedOrganizationName,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
    };

    await createOrg.mutateAsync(payload);

    router.replace("/dashboard");
  };

  // Auth not ready / not signed in
  if (!meQ.isLoading && !token) {
    router.replace("/login");
    return null;
  }

  return (
    <div className="min-h-screen px-6 py-12 flex items-center justify-center bg-background">
      <Card className="max-w-4xl w-full bg-card backdrop-blur-xl border border-border shadow-2xl">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                <Building2 className="w-7 h-7 text-[var(--primary-text)]" />
              </div>

              <div>
                <CardTitle className="text-2xl text-foreground flex items-center gap-2">
                  Let’s start by creating your organization <Sparkles className="w-5 h-5 text-[var(--primary-text)]" />
                </CardTitle>
                <CardDescription className="text-muted-foreground mt-1">
                  This is where you’ll create projects, diagrams, workspaces, and runs. You can invite teammates later.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-2 items-start">
          {/* LEFT: Form */}
          <div className="space-y-6 pb-8 lg:pb-0 relative z-10">
            {(createOrg.isError || meQ.isError || orgsQ.isError) && (
              <Alert className="bg-red-500/100/10 border-red-500/30">
                <AlertCircle className="h-4 w-4 text-red-700 dark:text-red-300" />
                <AlertTitle className="text-foreground">Could not create organization</AlertTitle>
                <AlertDescription className="text-red-700 dark:text-red-300/80">
                  {createOrg.isError && String(createOrg.error)}
                  {meQ.isError && `Auth error: ${String(meQ.error)}`}
                  {orgsQ.isError && `Org lookup error: ${String(orgsQ.error)}`}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-foreground">Organization name</Label>
                <Input
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="e.g., Re-Clutter Labs"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Must be 4-32 characters to match the backend validation.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-foreground">Description (optional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Infrastructure diagrams for my team"
                  className="bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">Optional. Up to 300 characters. Cannot start/end with spaces or contain double spaces.</p>
                {!!description && !isDescriptionValid && (
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Description cannot start or end with spaces, contain double spaces, or exceed 300 characters.
                  </p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary text-primary-foreground font-semibold"
                  disabled={!canSubmit}
                >
                  {createOrg.isPending ? "Creating..." : "Create organization"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                By creating an org, you will be set as the <span className="text-foreground">Owner</span>. You can manage roles in{" "}
                <span className="text-foreground">Settings</span>.
              </div>
            </form>
          </div>

          {/* RIGHT: Details */}
          <div className="space-y-4 lg:sticky lg:top-6">
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="flex items-center gap-3 mb-2">
                <Users className="w-5 h-5 text-[var(--primary-text)]" />
                <h3 className="text-foreground font-semibold">Collaboration-ready</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Invite members, assign roles (owner/editor/viewer), and collaborate on diagrams with presence + locks.
              </p>
            </div>

            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="flex items-center gap-3 mb-2">
                <ShieldCheck className="w-5 h-5 text-[var(--primary-text)]" />
                <h3 className="text-foreground font-semibold">Project isolation</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Your org is the security boundary. Projects, canvases, nodes, and runs stay scoped to your org.
              </p>
            </div>

            <div className="p-4 bg-card rounded-lg border border-border">
              <h3 className="text-foreground font-semibold mb-2">What happens next?</h3>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Create your first project</li>
                <li>Build a diagram (Lambda / EC2 / DynamoDB / API GW)</li>
                <li>Export Terraform or run Plan/Apply</li>
              </ol>
            </div>

            <div className="p-4 bg-card rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Tip: If you’re joining a team, you might already have an invite.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
