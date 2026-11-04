"use client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
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
      <div className="flex items-center justify-between gap-4 px-5 py-5">
        <div className="min-w-0">
          {!isEditing ? (
            <button
              type="button"
              disabled={!!nameDisabled}
              onClick={startEdit}
              className={[
                "h-10 max-w-[420px] truncate rounded-lg border border-slate-800 bg-slate-950/70 px-4",
                "text-sm font-semibold text-slate-100 shadow-lg backdrop-blur-sm",
                "transition-colors hover:bg-slate-900/70",
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
                "h-10 w-[min(420px,60vw)] rounded-lg border border-slate-800 bg-slate-950/70 px-4",
                "text-sm font-semibold text-slate-100 shadow-lg backdrop-blur-sm outline-none",
                "focus:border-slate-700",
              ].join(" ")}
              placeholder="Diagram name"
            />
          )}
        </div>

        <div className="flex items-center gap-4">
          <Button
            onClick={handleBackClick}
            className="h-10 rounded-lg border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-white/10"
          >
            ← Back
          </Button>

          <Button
            onClick={onSave}
            disabled={!canSave || isDeploying || isDestroying}
            title={saveDisabledReason ?? undefined}
            className={[
              "h-10 px-6 rounded-lg font-semibold shadow-lg text-white",
              canSave
                ? "bg-gradient-to-br from-teal-600 to-blue-600 hover:opacity-90"
                : "bg-white/10 text-white/60 cursor-not-allowed",
            ].join(" ")}
          >
            {isSaving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>

          {previewControl}

          <Button
            onClick={onDeploy}
            disabled={canSave || isDeploying || isDestroying}
            className={[
              "h-10 px-6 rounded-lg font-semibold shadow-lg text-white",
              isDeploying
                ? "bg-white/10 text-white/60 cursor-not-allowed"
                : "bg-gradient-to-br from-emerald-600 to-green-600 hover:opacity-90",
            ].join(" ")}
          >
            {isDeploying ? "Deploying…" : "Deploy"}
          </Button>

          <Button
            onClick={handleDestroyClick}
            disabled={canSave || isDeploying || isDestroying}
            className={[
              "h-10 px-6 rounded-lg font-semibold shadow-lg text-white",
              isDestroying
                ? "bg-white/10 text-white/60 cursor-not-allowed"
                : "bg-gradient-to-br from-red-600 to-rose-600 hover:opacity-90",
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
            className="mx-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-red-800/50 bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h3 className="mb-1 text-base font-semibold text-white">
                  Destroy deployment
                </h3>
                <p className="text-sm text-slate-400">
                  Are you sure you want to destroy{" "}
                  <span className="font-medium text-white">
                    &quot;{diagramName || "Untitled diagram"}&quot;
                  </span>
                  ? This will tear down all deployed infrastructure and cannot be undone.
                </p>
              </div>
              <button
                onClick={() => setShowDestroyConfirm(false)}
                className="ml-auto flex-shrink-0 text-slate-500 transition-colors hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDestroyConfirm(false)}
                className="h-9 rounded-lg border border-slate-700 bg-slate-800 px-4 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDestroy}
                className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-500"
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
            className="mx-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-amber-800/50 bg-amber-900/30">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h3 className="mb-1 text-base font-semibold text-white">
                  Leave without saving?
                </h3>
                <p className="text-sm text-slate-400">
                  You have unsaved changes in{" "}
                  <span className="font-medium text-white">
                    &quot;{diagramName || "Untitled diagram"}&quot;
                  </span>
                  . If you leave now, your changes will be lost.
                </p>
              </div>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="ml-auto flex-shrink-0 text-slate-500 transition-colors hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="h-9 rounded-lg border border-slate-700 bg-slate-800 px-4 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
              >
                Stay
              </button>
              <button
                onClick={handleConfirmLeave}
                className="h-9 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-500"
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
