"use client";

import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

export type MemberOption = {
  id: string;
  name: string;
  email: string;
};

export default function AddUsersDropdown({ options, onPick, disabled, placeholder = "Add users...", }: {
  options: MemberOption[];
  onPick: (member: MemberOption) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(
      (m) => m.name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s)
    );
  }, [options, q]);

  const pick = async (m: MemberOption) => {
    await onPick(m);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <div>
        <h2 className="text-sm font-medium text-foreground">Organization Members</h2>
      </div>
      <div className="relative">
        <Search
          className="absolute  left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          size={16}
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full rounded-lg bg-card border border-border px-3 py-2 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary disabled:opacity-60 transition"
        />
        <ChevronDown
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          size={16}
        />

        {open && (
          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl backdrop-blur">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No users found
              </div>
            ) : (
              <ul className="max-h-64 overflow-auto py-1">
                {filtered.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()} // keep focus/blur from closing early
                      onClick={() => pick(m)}
                      className="w-full px-3 py-2 text-left hover:bg-card transition"
                    >
                      <div className="text-sm text-foreground">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}