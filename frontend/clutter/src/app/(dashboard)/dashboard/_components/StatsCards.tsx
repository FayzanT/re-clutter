import { Activity, FolderOpen, Users } from "lucide-react";
export default function StatsCards({
  projectCount,
  diagramCount,
  memberCount,
}: {
  projectCount: number;
  diagramCount: number;
  memberCount: number;
}) {
  return (
    <div className="dashboard-stats">
      {[
        { label: "Projects", value: projectCount, icon: FolderOpen },
        { label: "Architectures", value: diagramCount, icon: Activity },
        { label: "Team members", value: memberCount, icon: Users },
      ].map((stat) => (
        <div key={stat.label} className="dashboard-stat">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <stat.icon className="h-3.5 w-3.5 text-[var(--primary-text)]" />
            {stat.label}
          </div>
          <p className="dashboard-stat-value">
            {String(stat.value).padStart(2, "0")}
          </p>
        </div>
      ))}
    </div>
  );
}
