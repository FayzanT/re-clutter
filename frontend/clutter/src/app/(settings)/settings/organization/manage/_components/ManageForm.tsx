"use client";

import React, { useEffect, useMemo, useState } from "react";

export interface ManageFormValues {
  orgName: string;
  orgId: string;
  description: string;
}

export interface ManageFormProps {
  initialValues: ManageFormValues;
  onSubmit: (values: ManageFormValues) => void | Promise<void>;
  onCancel?: () => void;
  onDelete?: () => void | Promise<void>;
  isSaving?: boolean;
  isDeleting?: boolean;
}

export default function ManageForm({ initialValues, onSubmit, onDelete, isSaving, isDeleting, }: ManageFormProps) {
  const [values, setValues] = useState<ManageFormValues>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const isDirty = useMemo(() => {
    const a = (initialValues.description ?? "").trim();
    const b = (values.description ?? "").trim();
    return a !== b;
  }, [initialValues.description, values.description]);

  const handleChange =
    (field: keyof ManageFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return; // extra safety
    await onSubmit(values);
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    await onDelete();
  };

  const saveDisabled = !!isSaving || !isDirty;

  return (
    <div>
      <form className="space-y-6" onSubmit={handleSubmit}>
        {/* Name + ID (read-only) */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Organization name
            </label>
            <input
              type="text"
              value={values.orgName}
              disabled
              className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">
              Organization name cannot be changed.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Organization ID
            </label>
            <input
              type="text"
              value={values.orgId}
              disabled
              className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">Used in APIs. This ID is fixed.</p>
          </div>
        </div>

        {/* Description (editable) */}
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Description
            </label>
            <textarea
              value={values.description}
              onChange={handleChange("description")}
              rows={4}
              className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
              placeholder="Describe this organization…"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Helps members understand what this workspace is for.
            </p>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saveDisabled}
            className="px-4 py-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60 transition"
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>

          {/* optional: tiny hint */}
          {!isDirty && (
            <span className="text-xs text-muted-foreground">No changes to save</span>
          )}
        </div>
      </form>

      {/* Danger zone */}
      <div className="mt-8 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">Danger zone</h3>
        <p className="text-xs text-muted-foreground mb-3 max-w-md">
          Deleting this organization will remove access to all projects,
          workspaces, and runs. This action cannot be undone.
        </p>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!!isDeleting}
          className="px-4 py-2 rounded-lg bg-red-600 text-sm font-medium text-foreground hover:bg-red-500/100 disabled:opacity-60 transition"
        >
          {isDeleting ? "Deleting…" : "Delete organization"}
        </button>
      </div>
    </div>
  );
}
