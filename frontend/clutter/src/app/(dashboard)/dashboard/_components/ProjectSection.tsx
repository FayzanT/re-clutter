"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Project } from "@/lib/features/projects/types";
import { ArrowUpRight, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
interface ProjectsSectionProps {
  projects: Project[];
}

export default function ProjectsSection({ projects }: ProjectsSectionProps) {
  const router = useRouter();

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <FolderOpen className="w-6 h-6 text-[var(--primary-text)]" />
        Your projects
      </h2>

      {projects.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderOpen className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold text-foreground mb-2">
              No projects yet
            </h3>
            <p className="text-muted-foreground text-center mb-6">
              Create your first project to start building infrastructure
            </p>
            <Button
              onClick={() => router.push("/projects/new")}
              className="bg-primary text-primary-foreground hover:bg-primary"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}/diagrams`}>
              <Card className="h-full bg-card border-border hover:border-primary/50 hover:-translate-y-0.5 transition-all cursor-pointer group">
                <CardHeader>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-[var(--primary-text)]">
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-foreground group-hover:text-[var(--primary-text)] transition-colors">
                    {project.name}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground line-clamp-2">
                    {project.description || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-xs text-muted-foreground">
                    {project.diagrams?.length ?? 0} architectures
                  </p>
                  <div className="flex items-center justify-between border-t border-border pt-3 text-sm text-[var(--primary-text)]">
                    Open project <ArrowUpRight className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
