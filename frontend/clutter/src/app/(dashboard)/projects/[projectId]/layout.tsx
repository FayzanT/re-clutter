"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOrganizations } from "@/lib/features/organization/hooks";
import { useMe } from "@/lib/features/user/hooks";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "./_components/ProjectHeader";
import { ProjectNav } from "./_components/ProjectNav";
import { ProjectProvider, useProjectContext } from "./_contexts/ProjectContext";

interface ProjectLayoutProps {
  children: React.ReactNode;
}

/**
 * Inner layout component that uses the project context
 */
function ProjectLayoutContent({ children }: ProjectLayoutProps) {
  const { isLoading, hasError, error, project } = useProjectContext();
  
  return (
    <div className="flex flex-col flex-1">
      <ProjectHeader />
      <ProjectNav />
      
      <main className="flex-1 px-12 py-8">
        {/* Loading state */}
        {isLoading && !project && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--primary-text)]" />
          </div>
        )}
        
        {/* Error state */}
        {hasError && !project && (
          <Alert className="bg-red-500/10 border-red-800">
            <AlertDescription>
              Failed to load project: {String(error)}
            </AlertDescription>
          </Alert>
        )}
        
        {/* Content */}
        {!isLoading && project && children}
        
        {/* Not found state */}
        {!isLoading && !project && !hasError && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Project not found
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Main layout component that provides the project context
 */
export default function ProjectLayout({ children }: ProjectLayoutProps) {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const meQ = useMe();
  const token = meQ.data?.token ?? null;

  const orgQ = useOrganizations(token);
  const organizationId = orgQ.data?.[0].id ?? null;
  
  if (!organizationId || !projectId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">No project ID provided</p>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <ProjectProvider organizationId={organizationId} projectId={projectId}>
        <ProjectLayoutContent>{children}</ProjectLayoutContent>
      </ProjectProvider>
    </div>
  );
}