"use client";

import { useState } from "react";

export default function AddMembersCard() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO: wire to backend invite API
    console.log("Invite user:", email);
    setLoading(false);
    setEmail("");
  };

  return (
    <section className="flex flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          Add users to organization
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Invite teammates by email. They&apos;ll get access to projects in this
          organization based on their roles.
        </p>
      </div>

      <form onSubmit={handleInvite} className="px-4 py-4 space-y-4 flex-1">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-foreground">
            Email address
          </label>
          <input
            type="email"
            required
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary"
          />
          <p className="text-xs text-muted-foreground">
            Use the same email they use with your IdP (Cognito / SSO).
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-primary text-xs font-medium text-primary-foreground hover:bg-primary disabled:opacity-60 transition"
          >
            {loading ? "Inviting…" : "Invite user"}
          </button>
        </div>
      </form>
    </section>
  );
}
