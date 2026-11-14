"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import FilesTab from "./FilesTab";
import LiveLogsTab from "./LiveLogsTab";
import { LogsPanelProps, LogsTab } from "./types";

const MIN_HEIGHT = 220;
const MAX_HEIGHT = 700;
const DEFAULT_HEIGHT = 280;

export default function LogsPanel({
  token,
  orgId,
  projectId,
  diagramId,
  taskArn,
  liveLogs,
}: LogsPanelProps) {
  const [open, setOpen] = useState(() => !!taskArn);
  const [tab, setTab] = useState<LogsTab>("live");
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);

  const [isResizing, setIsResizing] = useState(false);

  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(DEFAULT_HEIGHT);
  const panelRef = useRef<HTMLDivElement>(null);

  const { lines, isComplete, taskStatus, isLoading } = liveLogs;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current || !panelRef.current) return;

      const deltaY = startYRef.current - e.clientY;
      const nextHeight = Math.max(
        MIN_HEIGHT,
        Math.min(MAX_HEIGHT, startHeightRef.current + deltaY)
      );

      // Write directly to the DOM — no React re-render
      panelRef.current.style.height = `${nextHeight}px`;
    };

    const handleMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      // Sync React state once, only on release
      if (panelRef.current) {
        setPanelHeight(parseInt(panelRef.current.style.height, 10));
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!open) return;

    resizingRef.current = true;
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-40">
      <div className="flex justify-end pr-6">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2.5 rounded-t-lg border border-b-0 border-border bg-card px-5 py-2.5 text-sm text-muted-foreground select-none transition-colors hover:text-foreground cursor-pointer"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path
              d="M2 8L6 4L10 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Deploy Logs
          {taskArn &&
          (isComplete ? (
            <span className="flex items-center gap-1 text-green-700 dark:text-green-300 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              {taskStatus || "Complete"}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              {taskStatus || "Live"}
            </span>
          ))}
        </button>
      </div>

      <div
        ref={panelRef}
        className={`overflow-hidden border-t border-border bg-card ${
          !isResizing ? "transition-all duration-300" : ""
        }`}
        style={{ height: open ? panelHeight : 0 }}
      >
        <div
          onMouseDown={startResize}
          className="flex h-2 cursor-ns-resize items-center justify-center bg-transparent hover:bg-muted/50"
          title="Drag to resize"
        >
          <div className="h-1 w-12 rounded-full bg-muted" />
        </div>

        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-4">
          {(["live", "files"] as LogsTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
                tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "live" ? "Live" : "Log Files"}
            </button>
          ))}
        </div>

        <div className="h-[calc(100%-44px)]">
          {tab === "live" ? (
            <LiveLogsTab
              taskArn={taskArn}
              lines={lines}
              isComplete={isComplete}
              taskStatus={taskStatus}
              isLoading={isLoading}
            />
          ) : (
            <FilesTab
              token={token}
              orgId={orgId}
              projectId={projectId}
              diagramId={diagramId}
            />
          )}
        </div>
      </div>
    </div>
  );
}