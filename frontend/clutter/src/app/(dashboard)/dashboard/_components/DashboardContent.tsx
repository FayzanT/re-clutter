import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useProjectRecentActivity } from "@/lib/features/logs/hooks";
import { Organization } from "@/lib/features/organization/types";
import { useProjects } from "@/lib/features/projects/hooks";
import { useMe } from "@/lib/features/user/hooks";
import type { UserData } from "@/lib/features/user/types";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, Cloud, FolderOpen } from "lucide-react";
import ActivitySection from "./ActivitySection";
import DashboardHeader from "./DashboardHeader";
import ProjectsSection from "./ProjectSection";
import StatsCards from "./StatsCards";

interface DashboardContentProps {
  userData: UserData | null;
  organization: Organization | null;
  error: string | null;
}

export default function DashboardContent({
  userData,
  organization,
  error,
}: DashboardContentProps) {
  const meQ = useMe();

  const token = meQ.data?.token ?? null;

  const projectsQ = useProjects(token, organization?.id);
  const projects = projectsQ.data ?? [];

  const { data: recentActivity = [], isLoading } = useProjectRecentActivity(
    token,
    organization?.id,
    projects,
  );

  return (
    <div className="p-5 md:p-10">
      <DashboardHeader userName={userData?.displayName} />

      {error && (
        <Alert className="mb-6 bg-red-500/10 border-red-800">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <StatsCards
        projectCount={projectsQ.data?.length ?? 0}
        diagramCount={organization?.total_diagrams ?? 0}
        // need to firgue out the team memebr situation dont quite know how to handle that yet
        memberCount={organization?.total_members ?? 0}
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <Link href="/projects" className="workspace-shortcut">
          <span className="shortcut-icon">
            <FolderOpen className="h-5 w-5" />
          </span>
          <span>
            <strong>Explore your projects</strong>
            <small>Pick up where you left off</small>
          </span>
          <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" />
        </Link>
        <Link
          href="/settings/organization/aws-account"
          className="workspace-shortcut"
        >
          <span className="shortcut-icon shortcut-icon-secondary">
            <Cloud className="h-5 w-5" />
          </span>
          <span>
            <strong>Connect your cloud</strong>
            <small>Manage your AWS accounts</small>
          </span>
          <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
      <div className="dashboard-columns">
        <section className="min-w-0">
          {projectsQ.isLoading ? (
            <p role="status" className="text-muted-foreground">
              Loading your projects…
            </p>
          ) : projectsQ.isError ? (
            <p role="alert" className="text-destructive">
              Could not load projects. Refresh to try again.
            </p>
          ) : (
            <ProjectsSection projects={projects} />
          )}
        </section>
        <aside className="min-w-0">
          <ActivitySection activity={recentActivity} isLoading={isLoading} />
        </aside>
      </div>
    </div>
  );
}
