"use client";
import ThemeToggle from "./ThemeToggle";
import DashboardSidebar from "./Sidebar";
import { ArrowUpRight, Cloud } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
export default function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  const section = path.startsWith("/settings")
    ? "Settings"
    : path.startsWith("/projects")
      ? "Projects"
      : "Overview";
  return (
    <div className="cloud-shell flex h-dvh overflow-hidden">
      <DashboardSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="workspace-topbar">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Re-Clutter studio</span>
            <span className="text-border">/</span>
            <span>{section}</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/settings/organization/aws-account"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Cloud className="h-4 w-4" />
              <span className="hidden sm:inline">Manage cloud connections</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="workspace-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
