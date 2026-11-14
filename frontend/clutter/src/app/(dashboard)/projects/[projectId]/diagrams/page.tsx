"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCreateDiagram, useDeleteDiagram } from "@/lib/features/diagram/hooks";
import { AlertTriangle, FileText, LayoutTemplate, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProjectContext } from "../_contexts/ProjectContext";

type DeleteTarget = { id: string; name: string } | null;

export default function ProjectDiagramsPage() {
  const router = useRouter();
  const { projectId, token, user, project } = useProjectContext();

  const createDiagramM = useCreateDiagram(token);
  const [createError, setCreateError] = useState<string | null>(null);

  const deleteDiagramM = useDeleteDiagram(token);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const handleCreateFromScratch = async () => {
    if (!token || !projectId || !project) return;
    setCreateError(null);
    try {
      const created = await createDiagramM.mutateAsync({
        organizationId: project.organizationId,
        projectId,
        name: "New Diagram",
      });
      router.push(`/projects/${projectId}/diagram/${created.id}`);
    } catch (e) {
      setCreateError(String(e));
    }
  };

  const handleOpenDiagram = (diagramId: string) => {
    router.push(`/projects/${projectId}/diagram/${diagramId}`);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setDeleteTarget({ id, name });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !project) return;
    setDeleteError(null);
    const { id, name } = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteDiagramM.mutateAsync({
        organizationId: project.organizationId,
        projectId,
        diagramId: id,
      });
      setShowDeleted(true);
      setTimeout(() => setShowDeleted(false), 2000);
    } catch (e) {
      setDeleteError(`Failed to delete ${name}: ${String(e)}`);
    }
  };

  const firstName = user?.displayName?.split(" ")[0] || "there";
  const diagrams = project?.diagrams ?? [];
  const hasDiagrams = diagrams.length > 0;

  if (!project) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-2xl bg-primary">
            <span className="text-3xl">👋</span>
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Welcome {firstName}!</h2>
          <p className="text-muted-foreground text-lg">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* ── Custom delete confirmation modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-xl bg-card border border-border shadow-2xl p-6">
            <div className="flex items-start gap-4 mb-6">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-500/10 border border-red-800/50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-300" />
              </div>
              <div>
                <h3 className="text-foreground font-semibold text-base mb-1">Delete diagram</h3>
                <p className="text-muted-foreground text-sm">
                  Are you sure you want to delete{" "}
                  <span className="text-foreground font-medium">&quot;{deleteTarget.name}&quot;</span>?
                  This action cannot be undone.
                </p>
              </div>
              <button
                onClick={() => setDeleteTarget(null)}
                className="ml-auto flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setDeleteTarget(null)}
                className="h-9 px-4 rounded-lg bg-card hover:bg-muted text-foreground text-sm font-medium border border-border">
                Cancel
              </Button>
              <Button
                onClick={handleDeleteConfirm}
                className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-500/100 text-foreground text-sm font-medium">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete toast ── */}
      {showDeleted && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-card border border-border px-4 py-2 text-sm text-foreground shadow-lg flex items-center gap-2">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          Diagram deleted
        </div>
      )}

      {/* ── Deleting in-progress toast ── */}
      {deleteDiagramM.isPending && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-card border border-border px-4 py-2 text-sm text-foreground shadow-lg flex items-center gap-2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          Deleting…
        </div>
      )}

      {/* ── Error banners ── */}
      {createError && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">{createError}</p>
        </div>
      )}
      {deleteError && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">{deleteError}</p>
        </div>
      )}

      {/* ── Empty state ── */}
      {!hasDiagrams && (
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-2xl bg-primary">
            <span className="text-3xl">👋</span>
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Welcome {firstName}!</h2>
          <p className="text-muted-foreground text-lg">Create your first diagram to get started</p>
          {createError && (
            <p className="mt-4 text-sm text-red-700 dark:text-red-300">Failed to create diagram: {createError}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
            <Card
              onClick={createDiagramM.isPending ? undefined : handleCreateFromScratch}
              className={`bg-card border-border hover:border-primary/50 transition-all ${createDiagramM.isPending ? "cursor-not-allowed opacity-60" : "cursor-pointer"} group`}>
              <CardContent className="p-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-xl bg-muted group-hover:bg-primary/20 transition-colors">
                  <FileText className="w-8 h-8 text-muted-foreground group-hover:text-[var(--primary-text)] transition-colors" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {createDiagramM.isPending ? "Creating..." : "Start from scratch"}
                </h3>
                <p className="text-sm text-muted-foreground">Create a new workflow diagram</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border hover:border-primary/50 transition-all cursor-not-allowed group opacity-60">
              <CardContent className="p-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-xl bg-muted group-hover:bg-primary/20 transition-colors">
                  <LayoutTemplate className="w-8 h-8 text-muted-foreground group-hover:text-[var(--primary-text)] transition-colors" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Start with a template</h3>
                <p className="text-sm text-muted-foreground">Coming soon</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Diagrams grid ── */}
      {hasDiagrams && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {diagrams.map((diagram) => {
            const isDeleting =
              deleteDiagramM.isPending && deleteDiagramM.variables?.diagramId === diagram.id;

            return (
              <Card
                key={diagram.id}
                onClick={() => handleOpenDiagram(diagram.id)}
                className={`bg-card border-border hover:border-primary/40 transition ${isDeleting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} group relative`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-card group-hover:bg-primary/20 transition-colors">
                      <FileText className="w-6 h-6 text-muted-foreground group-hover:text-[var(--primary-text)] transition-colors" />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleDeleteClick(e, diagram.id, diagram.name)}
                      disabled={isDeleting}
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 text-muted-foreground"
                      title="Delete diagram">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-foreground font-semibold mb-1">{diagram.name}</div>
                  </div>
                  {isDeleting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-card rounded-lg">
                      <p className="text-sm text-foreground">Deleting...</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}