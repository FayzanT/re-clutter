# Frontend

The Clutter web app: a Next.js 16 App Router project with React 19, React Flow (`@xyflow/react`) for the canvas, TanStack Query for server data, Zustand for UI state, Tailwind 4 and shadcn/ui components. It was bootstrapped with `create-next-app`.

Setup for the whole repo is in the root `README.md`. This page covers the frontend only. Commands run from the repo root.

## Run it

Use npm. The Dockerfile runs `npm ci`, and `pnpm-lock.yaml` is stale.

| Variant | Command | Result on 2026-10-30 |
| --- | --- | --- |
| With the local backend (the normal way) | `backend/devserver/run.sh`, then `NEXT_PUBLIC_API_ENDPOINT=http://localhost:8787 npm --prefix frontend/clutter run dev -- --hostname 127.0.0.1 --port 3100`, then open <http://localhost:3000/dev/login> | works; checked in a headless browser |
| Production build with the local backend | `NEXT_PUBLIC_API_ENDPOINT=http://localhost:8787 npm --prefix frontend/clutter run build`, copy `.next/static` and `public` into `.next/standalone`, then in `frontend/clutter/.next/standalone` run `PORT=3100 HOSTNAME=127.0.0.1 node server.js` | works; checked in a headless browser |
| Alone, no backend | `NEXT_PUBLIC_API_ENDPOINT=http://localhost:9999 npm --prefix frontend/clutter run dev` | `/` and `/login` render; everything else redirects to `/login` |
| Docker image | `docker build -f frontend/Dockerfile.frontend frontend` | the Dockerfile hard-codes the capstone's dead API address, which Next bakes in at build time, so the image talks to nothing |
| Root `docker-compose.yml` | `docker compose up` | does not work: it pulls the capstone's published image (`ghcr.io/alberta2514640/clutter-frontend`), which could not be pulled, and that image points at the dead API too |

`NEXT_PUBLIC_API_ENDPOINT` is the base URL of the Clutter API. Next reads it at build time, so a production build must be rebuilt to point somewhere else.

Real Google sign-in does not work locally: the Google client id is hard-coded and belongs to the capstone team's Google project. Locally you sign in through the devserver's `/dev/login`.

In development with a loopback HTTP API endpoint, the diagram toolbar also has
**Preview Terraform**. Save the diagram first, then use it to inspect or download
`main.tf` and `outputs.tf` without deploying. It shows generation progress and
errors in a dialog. This button is absent from production builds. The local
workflow and limitations are owned by `backend/devserver/README.md`.

## Check it

```bash
npx --prefix frontend/clutter tsc --noEmit -p frontend/clutter     # 0 errors
npm --prefix frontend/clutter run lint                             # 0 errors, 13 warnings (10 unused variables or imports, 3 React hook dependency warnings; not fixed, A changes only at the seams)
NEXT_PUBLIC_API_ENDPOINT=http://localhost:9999 npm --prefix frontend/clutter run build   # 16 routes
```

There are no frontend tests. Vitest, Testing Library and Playwright are installed but unused.

## What was checked in a browser

With the devserver and a headless Chrome on 2026-10-30:

| Page | Result |
| --- | --- |
| `/dev/login` (devserver only) | signs in, lands on `/dashboard` |
| `/dashboard` | renders projects, diagram and member counts, the project list and recent activity from the local database |
| `/projects`, `/projects/[projectId]/diagrams` | render the real project and its diagrams |
| `/settings/organization/aws-account` | renders |
| `/projects/[projectId]/diagram/[diagramId]` (the canvas) | shows "AWS account required" until the organization has a linked account (run `backend/devserver/link-fake-account.sh` locally); then renders the palette with 5 resources and Save, Deploy and Destroy |
| Dragging a node and saving | not checked by script (an automated drag timed out); check by hand |
| Deploy, Destroy, logs, code upload, Ansible | fail at their AWS call, as expected locally |

## Where things are

- `src/app/`: routes, in four groups.
  - `(auth)`: `login`, `register` (posts to a dead hard-coded host and is not reachable through the route guard) and `onboarding/create-org` (the first organization after sign-in).
  - `(dashboard)`: `dashboard`, `projects`, `projects/new`, and per project `diagrams`, `settings` (rename, delete) and `workspaces` (a placeholder).
  - `(diagram)`: the canvas at `projects/[projectId]/diagram/[diagramId]/`. Its `_components/` hold `DiagramEditor`, `Palette` (from `GET /resources`), `TopNav`, `AwsAccountRequiredModal`, `nodes/AwsServiceNode`, `nodes/ConfigPanel` and the `logs/` panel.
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

Member management is a mock, `settings/organization/create-org` and the workspaces page are stubs, `/register` is dead, Ansible polling never stops on success (`SUCCESS` vs the database's `COMPLETED`), the editor uses the user's first organization rather than the project's, and no deploy sends a region. The full list is in `.claude/findings/NOW.md`.

## Adding UI components

The capstone team added components with the shadcn CLI, for example:

```bash
npx shadcn@latest add https://21st.dev/r/kokonutd/shape-landing-hero
npx shadcn@latest add input
```

## Do not run `init.bash`

It is an early scaffold script that overwrites real source files with placeholders (root `README.md` § Do not run).
