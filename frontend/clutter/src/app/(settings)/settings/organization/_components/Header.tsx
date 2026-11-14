

export default function HeaderSettings() {
  return (
    <header className="px-6 py-10">
        <p className="text-xs uppercase tracking-wide text-[var(--primary-text)] mb-1">
          Settings
        </p>
        <h1 className="text-3xl font-semibold mb-1">
          Organization settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization details, workspaces, and access.
        </p>
    </header>
  );
}
