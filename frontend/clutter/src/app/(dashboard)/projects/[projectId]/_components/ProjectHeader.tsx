"use client";

import { Button } from "@/components/ui/button";
import { useCreateDiagram } from "@/lib/features/diagram/hooks";
import { Layers, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProjectContext } from "../_contexts/ProjectContext";

export function ProjectHeader() {
  const router = useRouter();
  const { project, projectLoading, projectId, token } = useProjectContext();

  // Create diagram mutation
  const createDiagramM = useCreateDiagram(token);
  const [createError, setCreateError] = useState<string | null>(null);

  /**
   * Generate a unique diagram name based on existing diagrams
   * Pattern: "New Diagram", "New Diagram 1", "New Diagram 2", etc.
   */
  const generateDiagramName = (): string => {
    const diagrams = project?.diagrams ?? [];
    
    if (diagrams.length === 0) {
      return "New Diagram";
    }

    // Find all existing "New Diagram" names
    const newDiagramNames = diagrams
      .map(d => d.name)
      .filter(name => name.match(/^New Diagram( \d+)?$/));

    if (newDiagramNames.length === 0) {
      return "New Diagram";
    }

    // Extract numbers from existing names
    const numbers = newDiagramNames
      .map(name => {
        const match = name.match(/^New Diagram(?: (\d+))?$/);
        if (!match) return 0;
        return match[1] ? parseInt(match[1], 10) : 0;
      })
      .filter(n => !isNaN(n));

    // Find the highest number
    const maxNumber = Math.max(0, ...numbers);
    
    // Return next number
    if (maxNumber === 0) {
      // We have "New Diagram" but no numbered ones yet
      return "New Diagram 1";
    }
    
    return `New Diagram ${maxNumber + 1}`;
  };

  const handleCreateDiagram = async () => {
    if (!token || !projectId || !project) return;

    setCreateError(null);

    try {
      const diagramName = generateDiagramName();
      
      const created = await createDiagramM.mutateAsync({
        organizationId: project.organizationId,
        projectId,
        name: diagramName,
      });

      // Navigate to the newly created diagram
      router.push(`/projects/${projectId}/diagram/${created.id}`);
    } catch (e) {
      setCreateError(String(e));
      console.error("Failed to create diagram:", e);
    }
  };

  const projectName = project?.name || (projectLoading ? "Loading..." : "Project not found");
  const isCreating = createDiagramM.isPending;

  return (
    <>
      <header className="border-b border-border px-12 py-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-primary p-[2px]">
            <div className="w-full h-full flex items-center justify-center rounded-2xl bg-card">
              {projectLoading ? (
                <Loader2 className="w-6 h-6 text-[var(--primary-text)] animate-spin" />
              ) : (
                <Layers className="w-6 h-6 text-[var(--primary-text)]" />
              )}
            </div>
          </div>
          <h1 className="text-2xl font-semibold">{projectName}</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleCreateDiagram}
            disabled={projectLoading || !project || isCreating}
            className="bg-primary hover:opacity-90 text-primary-foreground px-4 disabled:opacity-50"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Create New Diagram
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Error banner */}
      {createError && (
        <div className="px-12 py-3 bg-red-500/10 border-b border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to create diagram: {createError}</p>
        </div>
      )}
    </>
  );
}