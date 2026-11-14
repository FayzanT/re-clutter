# frontend/clutter

Next.js 16 (App Router), React 19, React Flow (`@xyflow/react`), TanStack Query, Zustand, Tailwind 4, shadcn-style components in `src/components/ui`. Code rules: `engineering-conventions` § Frontend.

Traps:

- **npm is the package manager.** The Dockerfile runs `npm ci` against `package-lock.json`; `pnpm-lock.yaml` is stale. Install with `npm ci`.
- **Next 16 and React 19 APIs differ from what you remember.** Request interception lives in `src/proxy.ts` (the Next 16 name for middleware). Check current docs before using a Next or React API.
- **The canvas is AWS-shaped.** `Palette.tsx`, `nodes/AwsServiceNode.tsx` and `nodes/ConfigPanel.tsx` hard-code AWS services, icons and option lists. These are A's screens and stay AWS-only (ADR-006). B's editor and Connections page are new and read each connector's manifest from B's API, never these lists. An A resource change follows `add-cloud-resource`.
- **Option lists here must match the backend.** The Lambda runtimes (`nodejs24.x`) do not match code upload (`nodejs24`) today, so Node uploads fail; the account-link page offers a handful of the backend's 17 regions, and `runTerraform` never sends a region, so every deploy runs in `us-west-2`. Ansible job polling expects `SUCCESS` and `CANCELLED`, but the database uses `COMPLETED`, so polling never stops on success. The diagram editor uses the user's first organization, not the project's.
- **There is no `test` script.** One Vitest file exists (`lib/features/diagram/types.test.ts`); run it with `npx vitest`, and CI does not run it. `lint` is the only script check. To see a change against real data, run the app locally (`frontend/clutter/README.md` § Run it).

Server data lives in `src/lib/features/<feature>/` (`api.ts`, `types.ts`, `keys.ts`, `hooks.ts`, optional `uiStore.ts`). Follow that shape for a new feature.
