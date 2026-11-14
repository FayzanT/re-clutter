"use client";
import { useState } from "react";
import { useOrganizations } from "@/lib/features/organization/hooks";
import { useProjects } from "@/lib/features/projects/hooks";
import { useMe } from "@/lib/features/user/hooks";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import ProjectsSection from "../dashboard/_components/ProjectSection";
export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const meQ = useMe();
  const token = meQ.data?.token ?? null;
  const orgsQ = useOrganizations(token);
  const projectsQ = useProjects(token, orgsQ.data?.[0]?.id ?? null);
  const isLoading = meQ.isLoading || orgsQ.isLoading || projectsQ.isLoading;
  const hasError = meQ.isError || orgsQ.isError || projectsQ.isError;
  const projects = (projectsQ.data ?? []).filter((project) =>
    `${project.name} ${project.description ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="p-5 md:p-10">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="section-label">YOUR PROJECTS</p>
          <h1 className="section-heading">
            Great builds start <em>here.</em>
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Every great architecture starts with a project.
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            New project <ArrowUpRight />
          </Link>
        </Button>
      </div>
      <label className="mb-8 flex max-w-md items-center gap-3 rounded-full border border-border bg-card px-5 py-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          aria-label="Search projects"
          placeholder="Find your next build…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {isLoading ? (
        <p role="status" className="text-muted-foreground">
          Loading your projects…
        </p>
      ) : hasError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 p-6"
        >
          <p>Could not load your projects.</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              void meQ.refetch();
              void orgsQ.refetch();
              void projectsQ.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : search && projects.length === 0 ? (
        <p className="rounded-xl border border-border p-8 text-muted-foreground">
          No projects match “{search}”. Try a different name.
        </p>
      ) : (
        <ProjectsSection projects={projects} />
      )}
    </div>
  );
}
