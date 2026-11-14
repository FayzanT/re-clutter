"use client";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
export default function DashboardHeader({ userName }: { userName?: string }) {
  return (
    <section className="dashboard-welcome">
      <div>
        <p className="section-label">WORKSPACE OVERVIEW</p>
        <h1>
          Your cloud, <span>in focus.</span>
        </h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
          {userName ? `Welcome back, ${userName.split(" ")[0]}. ` : ""}Pick up a
          project, shape an architecture, or start with a clean canvas.
        </p>
      </div>
      <div className="shrink-0">
        <Button asChild size="lg">
          <Link href="/projects/new">
            Create a project <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}
