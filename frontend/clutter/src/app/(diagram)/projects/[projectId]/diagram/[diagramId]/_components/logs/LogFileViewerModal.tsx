"use client";
import { LogFileViewerModalProps } from "./types";

export default function LogFileViewerModal({
  open,
  title,
  content,
  loading,
  error,
  onClose,
}: LogFileViewerModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">Log file preview</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-card p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              <span className="h-3 w-3 rounded-full border border-border border-t-transparent animate-spin" />
              Loading log file…
            </div>
          ) : error ? (
            <p className="text-xs font-mono text-red-700 dark:text-red-300">{error}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
              {content || "Empty log file."}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}