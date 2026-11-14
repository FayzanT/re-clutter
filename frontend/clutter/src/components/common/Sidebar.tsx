"use client";
import Brand from "./Brand";
import { Button } from "@/components/ui/button";
import { useOrganizations } from "@/lib/features/organization/hooks";
import { useProjects } from "@/lib/features/projects/hooks";
import { useLogout, useMe } from "@/lib/features/user/hooks";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export default function DashboardSidebar({
  className,
}: {
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const user = useMe().data;
  const token = user?.token ?? null;
  const orgsQ = useOrganizations(token);
  const projectsQ = useProjects(token, orgsQ.data?.[0]?.id ?? null);
  const organization = orgsQ.data?.[0];
  const items = [
    { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
    { icon: FolderOpen, label: "Projects", href: "/projects" },
    {
      icon: Cloud,
      label: "Cloud accounts",
      href: "/settings/organization/aws-account",
    },
    {
      icon: Settings,
      label: "Team settings",
      href: "/settings/organization/manage",
    },
  ];
  return (
    <aside
      className={cn(
        "studio-sidebar flex h-full shrink-0 flex-col transition-[width] duration-200",
        collapsed ? "w-[76px]" : "w-[248px] max-md:w-[76px]",
        className,
      )}
    >
      <div className="flex h-[84px] items-center justify-between px-5">
        <span className={cn(!collapsed && "max-md:hidden")}>
          <Brand compact={collapsed} />
        </span>
        {!collapsed && (
          <span className="hidden max-md:block">
            <Brand compact />
          </span>
        )}
      </div>
      <div
        className={cn(
          "mx-4 mb-7 rounded-xl border border-border bg-muted p-3",
          collapsed ? "hidden" : "max-md:hidden",
        )}
      >
        <p className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">
          Workspace
        </p>
        <p className="mt-2 truncate text-sm">
          {organization?.name || "Your organization"}
        </p>
      </div>
      <nav aria-label="Main navigation" className="space-y-1 px-3">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href === "/projects" && pathname.startsWith("/projects/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "studio-navigation-link",
                collapsed && "justify-center !px-0",
              )}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && (
                <span className="max-md:hidden">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>
      {!collapsed && (
        <div className="mt-9 min-h-0 flex-1 overflow-y-auto px-5 max-md:hidden">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">
              Your projects
            </span>
            <Link
              href="/projects/new"
              aria-label="Create project"
              className="text-[var(--primary-text)]"
            >
              <Plus className="h-4 w-4" />
            </Link>
          </div>
          {projectsQ.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading projects…</p>
          ) : projectsQ.isError ? (
            <p className="text-xs text-red-700 dark:text-red-300">Could not load projects.</p>
          ) : projectsQ.data?.length ? (
            projectsQ.data.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}/diagrams`}
                className="flex items-center gap-2 rounded-lg py-2 text-xs text-muted-foreground hover:text-[var(--primary-text)]"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="truncate">{project.name}</span>
              </Link>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Create a project to get started.
            </p>
          )}
        </div>
      )}
      <div className="mt-auto p-4">
        {!collapsed && (
          <div className="mb-5 rounded-xl bg-primary/5 p-4 max-md:hidden">
            <p className="text-sm font-semibold text-[var(--primary-text)]">
              Ready for your next build?
            </p>
            <p className="mb-4 mt-2 text-xs leading-5 text-muted-foreground">
              From your first resource to your next deployment.
            </p>
            <Button asChild size="sm" className="w-full">
              <Link href="/projects/new">
                New project <ArrowUpRight />
              </Link>
            </Button>
          </div>
        )}
        <div className="flex items-center gap-3 border-t border-border pt-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs text-[var(--primary-text)]">
            {(user?.displayName || user?.email || "U")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1 max-md:hidden">
              <p className="truncate text-xs">
                {user?.displayName || "Your account"}
              </p>
              <button
                onClick={() => {
                  logout();
                  router.push("/login");
                  router.refresh();
                }}
                className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-[var(--primary-text)]"
              >
                <LogOut className="h-3 w-3" /> Sign out
              </button>
            </div>
          )}
          {
            <button
              aria-label="Sign out"
              onClick={() => {
                logout();
                router.push("/login");
                router.refresh();
              }}
              className={cn(
                "absolute bottom-20 text-muted-foreground",
                !collapsed && "md:hidden",
              )}
            >
              <LogOut className="h-4 w-4" />
            </button>
          }
        </div>
        <button
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="mt-5 hidden w-full items-center justify-center rounded-lg border border-border py-2 text-muted-foreground md:flex"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </div>
    </aside>
  );
}
