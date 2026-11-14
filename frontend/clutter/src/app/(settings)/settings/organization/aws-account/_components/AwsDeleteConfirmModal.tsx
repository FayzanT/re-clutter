"use client";

import { AlertTriangle, X } from "lucide-react";

interface AwsDeleteConfirmModalProps {
  accountName: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export default function AwsDeleteConfirmModal({
  accountName,
  isDeleting,
  onCancel,
  onConfirm,
}: AwsDeleteConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={isDeleting ? undefined : onCancel}
    >
      <div
        className="mx-4 w-full max-w-2xl rounded-[28px] border border-border bg-card p-8 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-8 flex items-start gap-5">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-amber-800/60 bg-amber-500/10">
            <AlertTriangle className="h-7 w-7 text-amber-700 dark:text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">
              Delete AWS account link?
            </h3>
            <p className="text-xl leading-relaxed text-muted-foreground">
              You are about to remove{" "}
              <span className="font-semibold text-foreground">
                &quot;{accountName}&quot;
              </span>
              . If you continue, this AWS account connection will be deleted and you will need to set it up again.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="h-14 rounded-2xl border border-border bg-card px-8 text-2xl font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            className="h-14 rounded-2xl bg-amber-600 px-8 text-2xl font-semibold text-foreground transition-colors hover:bg-amber-500/100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
