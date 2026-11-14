"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { useOrganizations } from "@/lib/features/organization/hooks";
import { useCreateProject } from "@/lib/features/projects/hooks";
import { useMe } from "@/lib/features/user/hooks";

export default function NewProjectPage() {
  const router = useRouter();
  const meQ = useMe();
  const user = meQ.data ?? null;
  const token = user?.token ?? null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!name && user?.displayName) {
      setName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.displayName]);

  const orgsQ = useOrganizations(token);
  const organizationId = useMemo(() => orgsQ.data?.[0]?.id ?? null, [orgsQ.data]);

  const createProjectM = useCreateProject(token);
  const submitting = createProjectM.isPending;
  const canSubmit = !!name.trim() && !!token && !!organizationId && !submitting;

  const onCreate = async () => {
    setErrorText(null);

    const trimmedName = name.trim();
    if (!trimmedName) return setErrorText("Project name is required.");
    if (!token) return setErrorText("Missing auth token. Please log in again.");
    if (!organizationId) return setErrorText("Missing organizationId. Please select an organization first.");

    const desc = description.trim();
    const payload = {
      organizationId,
      name: trimmedName,
      ...(desc ? { description: desc } : {}), // omit when empty (backend rejects "")
    };

    try {
      const created = await createProjectM.mutateAsync(payload);
      router.replace(`/projects/${created.id}/diagrams`);
    } catch (e) {
      setErrorText(String(e));
    }
  };

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Create New Project</h1>
        <p className="text-muted-foreground mt-2">
          Create a project to start building diagrams, variables, and workspaces.
        </p>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm text-foreground">Project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Web App Infrastructure"
              className="w-full rounded-lg bg-card border border-border px-3 py-2 text-foreground outline-none focus:border-primary/60"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-foreground">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project for?"
              rows={4}
              className="w-full rounded-lg bg-card border border-border px-3 py-2 text-foreground outline-none focus:border-primary/60"
            />
          </div>

          {(errorText || createProjectM.isError) && (
            <pre className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-300 bg-red-500/100/10 border border-red-500/20 rounded-lg p-3">
              {errorText ?? String(createProjectM.error?.message ?? createProjectM.error)}
            </pre>
          )}

          <Button onClick={onCreate} disabled={!canSubmit} className="w-full bg-primary hover:bg-primary text-primary-foreground">
            {submitting ? "Creating..." : "Create Project"}
          </Button>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            Back to Dashboard
          </button>
        </CardContent>
      </Card>
    </div>
  );
}