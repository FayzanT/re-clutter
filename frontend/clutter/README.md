# Frontend

The Clutter web app: a Next.js 16 App Router project with React 19, React Flow (`@xyflow/react`) for the canvas, TanStack Query for server data, Zustand for UI state, Tailwind 4 and shadcn/ui components. It was bootstrapped with `create-next-app`.

Setup for the whole repo is in the root `README.md`. This page covers the frontend only. Commands run from the repo root.

## Run it

Use npm. The Dockerfile runs `npm ci`, and `pnpm-lock.yaml` is stale.

| Variant | Command | Result on 2026-11-04 |
| --- | --- | --- |
| With the local backend (the normal way) | `npm run dev` at the repo root, then open <http://localhost:3000/login> | works; checked in a headless browser |
| Production build with the local backend | `backend/devserver/dev.sh --backend-only`, then `NEXT_PUBLIC_API_ENDPOINT=http://localhost:8787 npm --prefix frontend/clutter run build`, copy `.next/static` and `public` into `.next/standalone`, then in `frontend/clutter/.next/standalone` run `PORT=3100 HOSTNAME=127.0.0.1 node server.js` | works; checked in a headless browser |
| Alone, no backend | `NEXT_PUBLIC_API_ENDPOINT=http://localhost:9999 npm --prefix frontend/clutter run dev` | `/` and `/login` render; everything else redirects to `/login` |
| Docker image | `docker build -f frontend/Dockerfile.frontend frontend` | the Dockerfile hard-codes the capstone's dead API address, which Next bakes in at build time, so the image talks to nothing |
| Root `docker-compose.yml` | `docker compose up` | does not work: it pulls the capstone's published image (`ghcr.io/alberta2514640/clutter-frontend`), which could not be pulled, and that image points at the dead API too |

`NEXT_PUBLIC_API_ENDPOINT` is the base URL of the Clutter API. Next reads it at build time, so a production build must be rebuilt to point somewhere else.

## Check it

```bash
npx --prefix frontend/clutter tsc --noEmit -p frontend/clutter     # 0 errors
npm --prefix frontend/clutter run lint                             # 0 errors, 13 warnings (10 unused variables or imports, 3 React hook dependency warnings; not fixed, ADR-006 limits changes to A)
NEXT_PUBLIC_API_ENDPOINT=http://localhost:9999 npm --prefix frontend/clutter run build   # 16 routes
```

One Vitest test file exists (`src/lib/features/diagram/types.test.ts`), with no `test` script, so CI does not run it. Testing Library and Playwright are installed but unused.

## What was checked in a browser

With the devserver and a headless Chrome, 2026-11-04:

| Page | Result |
| --- | --- |
| `/dev/login` (devserver only) | signs in, lands on `/dashboard` |
| `/dashboard` | renders projects, diagram and member counts, the project list and recent activity from the local database |
| `/projects`, `/projects/[projectId]/diagrams` | render the real project and its diagrams |
| `/settings/organization/aws-account` | renders |
| `/projects/[projectId]/diagram/[diagramId]` (the canvas) | shows "AWS account required" until the organization has a linked account (locally, press **Link fake account** on that popup); then renders the palette with 5 resources and Save, Deploy and Destroy |
| Dropping nodes, naming them in the config panel, saving, reloading | works; both nodes persist (checked 2026-11-04 with scripted drag events) |
| Saving generates Terraform, and Preview Terraform reads it | works; the panel text equals the file on disk, with download. The button is disabled while there are unsaved changes |
| Deploy, Destroy, Ansible jobs | fail at their ECS or SQS call, as expected locally |

## Interface experiment (2026-11-13)

`experiment/user-interfaces` uses Re-Clutter branding, predominantly black and white surfaces, and pale green accents and gradients in both themes, with neutral grey dark surfaces and a plain login background (ADR-013). `src/app/globals.css` owns both palettes. The sun/moon control in public navigation, workspace navigation and the diagram toolbar switches modes. An explicit choice is saved in the browser and synchronized between tabs; without a saved choice the app follows the system theme. The root layout applies the preference before hydration. `src/lib/theme.ts` owns runtime synchronization and handles disabled storage.

Pale green actions use dark text, and light-mode accent labels use a deeper green for contrast. The login is a centered sign-in card with plain typography, clear spacing and text-only supporting information. `WorkspaceShell` owns dashboard, project and settings navigation; `Brand` owns the wordmark and reads the shared Re-CL logo from `public/logos/re-cl.svg`, also used as the browser icon. The dashboard combines projects and activity with direct shortcuts. Projects and resources support local text filtering; the canvas switches its colors with the rest of the app.

Checked in Chrome: both login themes, persisted choice across reload/navigation, system changes before an explicit choice, tab synchronization, toggling with storage blocked, phone layouts without horizontal overflow, project/resource filtering, and resource configuration in both editor themes. Signed-in visual checks use isolated browser fixtures. Four theme tests (`npx --prefix frontend/clutter vitest run frontend/clutter/src/lib/theme.test.tsx` from the repository root), type-check and webpack build pass. Lint has 0 errors and 6 existing warnings. Backend smoke passed earlier in this UI experiment (0 failures). Google OAuth and real cloud deployments were not exercised.

## Where things are

- `src/app/`: routes, in four groups.
  - `(auth)`: `login`, `register` (posts to a dead hard-coded host and is not reachable through the route guard) and `onboarding/create-org` (the first organization after sign-in).
  - `(dashboard)`: `dashboard`, `projects`, `projects/new`, and per project `diagrams`, `settings` (rename, delete) and `workspaces` (a placeholder).
  - `(diagram)`: the canvas at `projects/[projectId]/diagram/[diagramId]/`. Its `_components/` hold `DiagramEditor`, `Palette` (from `GET /resources`), `TopNav`, `TerraformPreview` (reads `GET /terraform-engine/files`), `AwsAccountRequiredModal`, `nodes/AwsServiceNode`, `nodes/ConfigPanel` and the `logs/` panel.
  - `(settings)`: `settings/organization/aws-account` (the account link), `manage` (members; a mock) and `create-org` (a stub).
- `src/lib/features/<feature>/`: one folder per backend area, each with `api.ts`, `types.ts`, `keys.ts`, `hooks.ts` and sometimes `uiStore.ts`. Features: `user` (sign-in, token), `organization`, `projects`, `diagram` (CRUD, save, deploy), `resources`, `logs`, `runs` (Ansible jobs), `codeUpload`, `members` (a mock). Follow this shape for a new feature.
- `src/lib/stores/loginStore.ts`: unused. It holds a dead hard-coded login URL and the Google client id; nothing imports it.
- `src/providers/`: Google sign-in. `src/app/providers.tsx` sets up TanStack Query (60-second stale time, one retry).
- `src/components/common/` (sidebar and navbar) and `src/components/ui/` (shadcn components).
- `src/proxy.ts`: the route guard. It checks only that the `clutter_token` cookie exists, not that it is valid.
- `public/`: AWS service icons, logos and the account-link guide.

## How sign-in and data flow

1. `/login` shows Google sign-in. The Google ID token goes to `POST /log-in`, which returns Clutter's JWT.
2. The JWT is stored twice: in `localStorage` as `google_data` (the API client reads it from there) and in the `clutter_token` cookie (the route guard reads it).
3. Every API call sends the JWT raw in the `Authorization` header, without `Bearer`.
4. Logs and Ansible jobs are polled about every 10 seconds; nothing is pushed.

## Known gaps

They are listed in `.claude/findings/NOW.md`.

## Adding UI components

The capstone team added components with the shadcn CLI, for example:

```bash
npx shadcn@latest add https://21st.dev/r/kokonutd/shape-landing-hero
npx shadcn@latest add input
```

## Do not run `init.bash`

It is an early scaffold script that overwrites real source files with placeholders (root `README.md` § Do not run).
