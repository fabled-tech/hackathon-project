# RightsRadar Web

This package contains the standalone Next.js demo for the hackathon.

## Deploy to Vercel

This app lives inside a pnpm workspace and depends on the local `@rightsrader/api-client`
package, so Vercel needs to install from the monorepo root even though it builds `apps/web`.

1. Import the repository into Vercel and set **Root Directory** to `apps/web`.
2. Enable **Include source files outside of the Root Directory in the Build Step** in the
   project's Build & Development settings so the workspace packages and lockfile are visible.
3. Framework preset: Next.js (auto-detected). The install/build commands in `vercel.json`
   (`corepack enable && pnpm install --frozen-lockfile` / `pnpm build`) handle the workspace
   install for you.
4. Set `NEXT_PUBLIC_API_BASE_URL` if you want the demo to talk to a hosted API.
5. Deploy and share the generated public URL with judges.

If you leave `NEXT_PUBLIC_API_BASE_URL` empty, the demo UI still works as a polished static
walkthrough for the competition.
