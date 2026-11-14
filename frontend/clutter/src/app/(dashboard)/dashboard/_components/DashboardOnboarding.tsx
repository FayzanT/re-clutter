"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export default function DashboardOnboarding() {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-20rem)] px-6">
      <Card className="max-w-2xl w-full bg-card backdrop-blur-xl border-border">
        <CardHeader>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-primary/10 rounded-lg">
              <AlertCircle className="w-8 h-8 text-[var(--primary-text)]" />
            </div>
            <div>
              <CardTitle className="text-2xl text-foreground">Welcome to Re-Clutter!</CardTitle>
              <CardDescription className="text-muted-foreground">Let&apos;s set up your organization</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert className="bg-card border-border">
            <AlertCircle className="h-4 w-4 text-[var(--primary-text)]" />
            <AlertTitle className="text-foreground">No Organization Found</AlertTitle>
            <AlertDescription className="text-muted-foreground">You need to create or join an organization before you can start creating projects.</AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="p-4 bg-card rounded-lg border border-border">
              <h3 className="text-foreground font-semibold mb-2">Create a New Organization</h3>
              <p className="text-sm text-muted-foreground mb-4">Start fresh with your own organization. You will be the owner and can invite team members later.</p>
              <Button onClick={() => router.push("/onboarding/create-tenant")} className="w-full bg-primary hover:bg-primary">
                Create Organization
              </Button>
            </div>

            <div className="p-4 bg-card rounded-lg border border-border">
              <h3 className="text-foreground font-semibold mb-2">Join an Existing Organization</h3>
              <p className="text-sm text-muted-foreground mb-4">Have an invitation code? Join your team&apos;s organization here.</p>
              <Button onClick={() => router.push("/onboarding/join-tenant")} variant="secondary" className="w-full bg-muted hover:bg-muted   text-foreground transition-colors">
                Join Organization
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
