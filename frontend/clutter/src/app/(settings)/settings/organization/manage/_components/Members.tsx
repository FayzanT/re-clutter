"use client";

export type OrgMember = {
  id: string;
  name: string;
  email: string;
  role: string; // e.g. "Project Admin", "Member"
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

export default function Members({ members }: { members: OrgMember[]; }) {
  return (
    <section className="space-y-2 py-2">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Header (stays visible) */}
        <div className="grid grid-cols-12 px-4 py-3 text-xs text-muted-foreground border-b border-border">
          <div className="col-span-8">User</div>
          <div className="col-span-4">Role</div>
        </div>

        {/* Scroll area depends on window */}
        <div className={`max-h-[40vh] overflow-y-auto`}>
          <ul className="divide-y divide-slate-800">
            {members.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-8 flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-card border border-border flex items-center justify-center text-xs font-semibold text-foreground shrink-0">
                      {initials(m.name)}
                    </div>

                    <div className="min-w-0">
                      <div className="text-sm text-foreground truncate">
                        {m.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.email}
                      </div>
                    </div>
                  </div>

                  <div className="col-span-4 text-sm text-foreground">
                    {m.role}
                  </div>
                </div>
              </li>
            ))}

            {members.length === 0 && (
              <li className="px-4 py-6 text-sm text-muted-foreground">No members yet.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}