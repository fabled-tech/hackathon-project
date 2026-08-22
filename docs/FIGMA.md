# Connecting Figma designs to RightsRadar

This guide covers how to connect your Figma wireframe project to this repository so designs can be
referenced from issues and implemented in the Next.js web app (`apps/web`).

## 1. Link designs to issues and PRs (no setup required)

The simplest connection: paste your Figma file or frame URL directly into a GitHub issue or pull
request. GitHub renders Figma links as rich embeds, so reviewers can see the wireframe inline.

- Use **Share → Copy link** in Figma to get a link to a specific frame (not just the whole file).
- Paste it in the issue body. This keeps design context next to the work item, which fits this
  repository's issue → branch → PR workflow in `docs/PROJECT_WORKFLOW.md`.
- If the file is private, make sure reviewers have Figma access, or set the file to
  "anyone with the link can view".

## 2. Implement a frame in the web app with shadcn (recommended)

The web app (`apps/web`) is Next.js 16 + React 19 + Tailwind CSS v4. The fastest way to turn a
Figma frame into code here is the [shadcn Figma integration](https://ui.shadcn.com/docs/figma),
which generates a React + Tailwind component from a frame URL:

1. In Figma, right-click the frame → **Copy link to selection** (Dev Mode required for the MCP path).
2. From the repository root:

   ```bash
   pnpm dlx shadcn add <figma-frame-url>
   ```

3. Review the generated component and adapt it to the app's design tokens. The app's theme colors
   are defined as CSS custom properties in `apps/web/app/globals.css` under `@theme` (for example
   `brand`, `ink`, `panel`, `line`). Replace any hard-coded colors from Figma with these tokens so
   the new UI matches the existing dark interface.
4. Add components under `apps/web/components/` and pages under `apps/web/app/`, following the
   existing structure (see `components/script-review.tsx` and `app/page.tsx`).

This requires a Figma access token (Dev Mode). See section 4 for how to configure it locally
without committing it.

## 3. Use the Figma Dev Mode MCP server with Copilot

If you work with GitHub Copilot (or another MCP-capable assistant), you can connect Figma directly
via the **Figma Dev Mode MCP server**, which lets the assistant read your frames, components, and
tokens as context for code generation:

1. Open the Figma desktop app and go to your wireframe file.
2. In the Figma menu, enable **Dev Mode → Enable MCP server**.
3. Configure your editor's MCP settings to point at `http://127.0.0.1:3845/mcp` (the Dev Mode MCP
   server's default local endpoint). In VS Code this goes in your user or workspace `mcp.json`.
4. With the server running, select a frame in Figma and ask the assistant to implement it — it can
   read the frame's structure, spacing, colors, and assets directly.

The MCP server runs locally on your machine; nothing is installed into this repository.

## 4. Tokens and secrets

- **Never commit Figma personal access tokens.** The repository's `.env.example` documents
  server-side configuration; Figma tokens are personal and belong only in your local `.env` or
  your editor's MCP configuration, both of which are git-ignored.
- The web app has no build-time need for Figma credentials — tokens are only used by local
  tooling (shadcn CLI, MCP server) that you run yourself.

## 5. Exporting assets

For static assets (icons, images) from the wireframe:

1. Select the layer/frame in Figma → **Export** (PNG, SVG).
2. Place exported files under `apps/web/public/` and reference them with Next.js `<Image>` or
   standard `img` tags. Prefer SVG for icons so they scale cleanly in the dark UI.

## Which option should I use?

| Goal | Recommended path |
| --- | --- |
| Share a wireframe for discussion/review | Paste the Figma link in an issue or PR (section 1) |
| Turn a frame into working UI code | `pnpm dlx shadcn add <frame-url>` (section 2) |
| Have Copilot read designs as context | Enable the Dev Mode MCP server (section 3) |
| Add icons/images from the design | Export to `apps/web/public/` (section 5) |

No repository configuration or code change is required for any of these paths.
