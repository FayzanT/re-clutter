"use client";
import ThemeToggle from "@/components/common/ThemeToggle";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft, Rocket, Save, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type TopNavProps = {
  diagramName: string;
  onNameChange: (nextName: string) => void;
  onSave: () => void;
  onBack?: () => void;
  onDeploy?: () => void;
  onDestroy?: () => void;
  isDeploying?: boolean;
  isDestroying?: boolean;
  dirty: boolean;
  isSaving?: boolean;
  nameDisabled?: boolean;
  saveDisabledReason?: string | null;
  previewControl?: ReactNode;
};

export default function TopNav({
  diagramName,
  onNameChange,
  onSave,
  onBack,
  onDeploy,
  onDestroy,
  isDeploying,
  isDestroying,
  dirty,
  isSaving,
  nameDisabled,
  saveDisabledReason,
  previewControl,
}: TopNavProps) {
  const canSave = dirty && !isSaving && !saveDisabledReason;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [showDestroyConfirm, setShowDestroyConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isEditing]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || isDeploying || isDestroying) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, isDeploying, isDestroying]);

  const startEdit = useCallback(() => {
    if (nameDisabled) return;
    setDraft(diagramName);
    setIsEditing(true);
  }, [diagramName, nameDisabled]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (!next) {
      setIsEditing(false);
      return;
    }
    if (next !== diagramName) onNameChange(next);
    setIsEditing(false);
  }, [draft, diagramName, onNameChange]);

  const cancel = useCallback(() => setIsEditing(false), []);

  const handleBackClick = useCallback(() => {
    if (dirty) {
      setShowLeaveConfirm(true);
      return;
    }
    onBack?.();
  }, [dirty, onBack]);

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false);
    onBack?.();
  }, [onBack]);

  const handleDestroyClick = useCallback(() => {
    if (isDeploying || isDestroying || canSave) return;
    setShowDestroyConfirm(true);
  }, [isDeploying, isDestroying, canSave]);

  const handleConfirmDestroy = useCallback(() => {
    setShowDestroyConfirm(false);
    onDestroy?.();
  }, [onDestroy]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            onClick={handleBackClick}
            className="h-9 border border-border bg-card text-foreground hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--primary-text)]">
              Architecture editor
            </p>
            {!isEditing ? (
              <button
                type="button"
                disabled={!!nameDisabled}
                onClick={startEdit}
                className={[
                  "h-10 max-w-[min(280px,45vw)] truncate rounded-full border border-border bg-background px-4",
                  "font-sans text-xl text-foreground",
                  "transition-colors hover:bg-secondary",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                ].join(" ")}
                title="Click to rename"
              >
                {diagramName || "Untitled diagram"}
              </button>
            ) : (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") cancel();
                }}
                className={[
                  "h-10 w-[min(420px,60vw)] rounded-full border border-border bg-background px-4",
                  "font-sans text-xl text-foreground outline-none",
                  "focus:border-border",
                ].join(" ")}
                placeholder="Diagram name"
              />
            )}
          </div>
        </div>

        <div
          role="group"
          aria-label="Diagram actions"
          className="flex flex-wrap items-center gap-2"
        >
          <Button
            onClick={onSave}
            disabled={!canSave || isDeploying || isDestroying}
            title={saveDisabledReason ?? undefined}
            className={[
              "h-10 px-6 rounded-full font-medium text-foreground",
              canSave
                ? "border border-primary/40 bg-primary/10 text-[var(--primary-text)] hover:bg-primary/20"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            ].join(" ")}
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>

          {previewControl}
          <ThemeToggle />

          <Button
            onClick={onDeploy}
            disabled={canSave || isDeploying || isDestroying}
            className={[
              "h-10 px-6 rounded-full font-medium text-foreground",
              isDeploying
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary !text-primary-foreground hover:bg-primary",
            ].join(" ")}
          >
            <Rocket className="h-4 w-4" />
            {isDeploying ? "Deploying…" : "Deploy"}
          </Button>

          <Button
            onClick={handleDestroyClick}
            disabled={canSave || isDeploying || isDestroying}
            className={[
              "h-10 px-6 rounded-full font-medium text-foreground",
              isDestroying
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "ml-2 border border-red-400/30 bg-transparent !text-red-700 dark:text-red-300 hover:bg-red-500/100/10",
            ].join(" ")}
          >
            {isDestroying ? "Destroying…" : "Destroy"}
          </Button>
        </div>
      </div>

      {showDestroyConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowDestroyConfirm(false)}
        >
          <div
            className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-red-800/50 bg-red-500/10">
                <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-300" />
              </div>
              <div>
                <h3 className="mb-1 text-base font-semibold text-foreground">
                  Destroy deployment
                </h3>
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to destroy{" "}
                  <span className="font-medium text-foreground">
                    &quot;{diagramName || "Untitled diagram"}&quot;
                  </span>
                  ? This will tear down all deployed infrastructure and cannot
                  be undone.
                </p>
              </div>
              <button
                onClick={() => setShowDestroyConfirm(false)}
                className="ml-auto flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDestroyConfirm(false)}
                className="h-9 rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDestroy}
                className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-foreground transition-colors hover:bg-red-500/100"
              >
                Destroy
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowLeaveConfirm(false)}
        >
          <div
            className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-amber-800/50 bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300" />
              </div>
              <div>
                <h3 className="mb-1 text-base font-semibold text-foreground">
                  Leave without saving?
                </h3>
                <p className="text-sm text-muted-foreground">
                  You have unsaved changes in{" "}
                  <span className="font-medium text-foreground">
                    &quot;{diagramName || "Untitled diagram"}&quot;
                  </span>
                  . If you leave now, your changes will be lost.
                </p>
              </div>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="ml-auto flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="h-9 rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Stay
              </button>
              <button
                onClick={handleConfirmLeave}
                className="h-9 rounded-lg bg-amber-600 px-4 text-sm font-medium text-foreground transition-colors hover:bg-amber-500/100"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
