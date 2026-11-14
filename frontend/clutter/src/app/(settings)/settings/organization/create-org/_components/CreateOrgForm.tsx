// src/app/(settings)/settings/organization/create-org/_components/CreateOrgForm.tsx
"use client";

import { useState } from "react";

export interface CreateOrgFormValues {
  orgName: string;
  slug: string;
  region: string;
  timeZone: string;
  description: string;
  visibility: "private" | "team";
}

export interface CreateOrgFormProps {
  initialValues: CreateOrgFormValues;
  onSubmit: (values: CreateOrgFormValues) => void | Promise<void>;
  onCancel?: () => void;
  isCreating?: boolean;
}

export default function CreateOrgForm({ initialValues, onSubmit, onCancel, isCreating, }: CreateOrgFormProps) {
    const [values, setValues] = useState<CreateOrgFormValues>(initialValues);

    const handleChange =(field: keyof CreateOrgFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setValues((prev) => ({ ...prev, [field]: e.target.value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSubmit(values);
    };

    return (
        <section className="bg-card border border-border rounded-2xl shadow-xl">
        <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Create a new organization</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Use organizations to separate environments (demo, client projects,
            internal tools) and manage access independently.
            </p>
        </div>

        <form className="px-6 py-6 space-y-6" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                Organization name
                </label>
                <input
                type="text"
                required
                placeholder="e.g. Demo Organization"
                value={values.orgName}
                onChange={handleChange("orgName")}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
                />
                <p className="text-xs text-muted-foreground">
                    This cannot be changed after creation.
                </p>
            </div>

            <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                Slug / ID
                </label>
                <input
                type="text"
                required
                placeholder="e.g. demo-org"
                value={values.slug}
                onChange={handleChange("slug")}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
                />
                <p className="text-xs text-muted-foreground">
                Lowercase, no spaces. Used in URLs and APIs.
                </p>
            </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-foreground">
                    Time zone
                    </label>
                    <select
                    value={values.timeZone}
                    onChange={handleChange("timeZone")}
                    className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
                    >
                    <option value="America/Edmonton">(UTC-07:00) Edmonton</option>
                    <option value="America/Denver">(UTC-07:00) Denver</option>
                    <option value="America/New_York">(UTC-05:00) New York</option>
                    <option value="UTC">(UTC) Coordinated Universal Time</option>
                    </select>
                </div>
                <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                    Initial visibility
                </label>
                <select
                    value={values.visibility}
                    onChange={handleChange("visibility")}
                    className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
                >
                    <option value="private">Private (invite only)</option>
                    <option value="team">
                    Visible to team, restricted project access
                    </option>
                </select>
                <p className="text-xs text-muted-foreground">
                    You can customize member roles after creation.
                </p>
            </div>
            </div>

            
            

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-card transition"
            >
                Cancel
            </button>
            <button
                type="submit"
                disabled={isCreating}
                className="px-4 py-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60 transition shadow-md shadow-green-500/20"
            >
                {isCreating ? "Creating…" : "Create organization"}
            </button>
            </div>
        </form>
        </section>
    );
}
