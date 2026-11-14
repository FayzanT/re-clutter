"use client";

import { useLogFiles, useRecentActivity } from "@/lib/features/logs/hooks";
import { useMemo, useState } from "react";
import FileRow from "./FileRow";
import LogFileViewerModal from "./LogFileViewerModal";
import { FilesTabProps } from "./types";

type ActivityEntry = {
  diagram_name: string;
  command_id: string;
  command: string;
  status: string;
  created_at: string;
  duration_seconds: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${dateStr} · ${timeStr}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const STATUS_CONFIG: Record<string, { dot: string; badge: string; label: string }> = {
  SUCCESS: {
    dot: "bg-green-400",
    badge: "bg-green-500/100/10 text-green-700 dark:text-green-300",
    label: "success",
  },
  FAILED: {
    dot: "bg-red-400",
    badge: "bg-red-500/100/10 text-red-700 dark:text-red-300",
    label: "failed",
  },
  RUNNING: {
    dot: "bg-primary animate-pulse",
    badge: "bg-primary/10 text-[var(--primary-text)]",
    label: "running",
  },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? {
    dot: "bg-slate-500",
    badge: "bg-muted/50 text-muted-foreground",
    label: status.toLowerCase(),
  };
}

const COMMAND_ICONS: Record<string, string> = {
  destroy: "✕",
  deploy: "↑",
  apply: "✓",
  plan: "⋯",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function FilesTab({
  token,
  orgId,
  projectId,
  diagramId,
}: FilesTabProps) {
  const { data: files, isLoading, isError } = useLogFiles(token, orgId, projectId, diagramId);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerContent, setViewerContent] = useState("");
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [loadingFileKey, setLoadingFileKey] = useState<string | null>(null);

  const { data: rawActivity = [] } = useRecentActivity(token, orgId, diagramId);
  const activity = rawActivity as ActivityEntry[];

  const activityByDeployment = useMemo(() => {
    const map = new Map<string, ActivityEntry>();
    const sorted = [...activity].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    for (const entry of sorted) {
      map.set(entry.command_id, entry);
    }
    return map;
  }, [activity]);

  const grouped = useMemo(() =>
    files?.reduce<Record<string, typeof files>>((acc, f) => {
      if (!acc[f.deploymentId]) acc[f.deploymentId] = [];
      acc[f.deploymentId].push(f);
      return acc;
    }, {}) ?? {}
  , [files]);

  const sortedGroupEntries = useMemo(() => {
    return Object.entries(grouped).sort(([aId], [bId]) => {
      const aTime = activityByDeployment.get(aId)?.created_at ?? "";
      const bTime = activityByDeployment.get(bId)?.created_at ?? "";
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [grouped, activityByDeployment]);

  if (isLoading) {
    return <p className="text-muted-foreground text-xs font-mono p-4">Loading log files…</p>;
  }
  if (isError) {
    return <p className="text-red-700 dark:text-red-300 text-xs font-mono p-4">Failed to load log files.</p>;
  }
  if (!files?.length) {
    return <p className="text-muted-foreground text-xs font-mono p-4">No log files found.</p>;
  }

  const handleOpenViewer = async (args: {
    key: string;
    deploymentId: string;
    file: string;
    refetchUrl: () => Promise<{ data?: string }>;
  }) => {
    const { key, deploymentId, file, refetchUrl } = args;
    setViewerOpen(true);
    setViewerTitle(`${file} — ${deploymentId}`);
    setViewerContent("");
    setViewerError(null);
    setLoadingFileKey(key);
    try {
      const { data: url } = await refetchUrl();
      if (!url) throw new Error("Could not get file URL.");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch log file: ${res.status}`);
      setViewerContent(await res.text());
    } catch (err) {
      setViewerError(err instanceof Error ? err.message : "Failed to load log file.");
    } finally {
      setLoadingFileKey(null);
    }
  };

  return (
    <>
      <div className="h-full overflow-y-auto p-4 space-y-4">
        {sortedGroupEntries.map(([deploymentId, groupFiles]) => {
          const act = activityByDeployment.get(deploymentId);
          const cfg = act ? getStatusConfig(act.status) : null;
          const icon = act ? (COMMAND_ICONS[act.command] ?? "·") : null;

          return (
            <div key={deploymentId}>
              {/* Deployment header */}
              <div className="flex items-center gap-2 mb-2">
                {/* Status dot */}
                {cfg && (
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                )}

                {/* command_id (deploymentId) */}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {deploymentId}
                </span>

                {/* Command + status badge */}
                {act && cfg && (
                  <span
                    className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide ${cfg.badge}`}
                  >
                    <span>{icon}</span>
                    <span>{act.command}</span>
                    <span className="opacity-50">·</span>
                    <span>{cfg.label}</span>
                  </span>
                )}

                {/* Duration */}
                {act && (
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                    {formatDuration(act.duration_seconds)}
                  </span>
                )}

                <div className="h-px flex-1 bg-muted" />

                {/* Date + relative time */}
                {act && (
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                    {formatDateTime(act.created_at)}
                    <span className="mx-1 opacity-40">·</span>
                    {relativeTime(act.created_at)}
                  </span>
                )}
              </div>

              {/* Files */}
              <div className="space-y-1.5">
                {groupFiles.map((f) => (
                  <FileRow
                    key={`${f.deploymentId}-${f.file}`}
                    token={token}
                    orgId={orgId}
                    projectId={projectId}
                    diagramId={diagramId}
                    deploymentId={f.deploymentId}
                    file={f.file}
                    loadingFileKey={loadingFileKey}
                    onOpenViewer={handleOpenViewer}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <LogFileViewerModal
        open={viewerOpen}
        title={viewerTitle}
        content={viewerContent}
        loading={!!loadingFileKey}
        error={viewerError}
        onClose={() => {
          setViewerOpen(false);
          setViewerTitle("");
          setViewerContent("");
          setViewerError(null);
          setLoadingFileKey(null);
        }}
      />
    </>
  );
}