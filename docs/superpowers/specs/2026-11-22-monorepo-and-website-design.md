# Monorepo layout and Marven website — design

Date: 2026-11-22 · Status: approved

## Goal

Hold the desktop app and a public marketing website in one repository,
each as its own independent project, and build the website.

## Repo layout

```
Marven/
├── apps/desktop/   the Electron + Next.js app, moved here with git mv
├── apps/website/   the public website (new)
├── design/  marketing/  docs/  .github/
├── README.md  LICENSE  PRIVACY.md  HANDOFF.md
└── package.json    convenience scripts only, no dependencies
```

- No npm workspaces. Hoisting would move `node_modules` to the root and break
  electron-builder, the native rebuilds (node-pty, better-sqlite3) and
  `scripts/prepare-standalone.js`. Each app has its own lockfile.
- `apps/desktop/next.config.ts` pins `outputFileTracingRoot` to its own folder
  so the standalone server layout does not change if a lockfile ever appears
  higher up.
- Both GitHub workflows run in `apps/desktop` (`defaults.run.working-directory`,
  `cache-dependency-path`, artifact paths). Releases and auto-update are
  unchanged.
- `PRIVACY.md`, `README.md`, `LICENSE` stay at the root; the app links to
  `PRIVACY.md` on GitHub by that path.

## Website

Stack: Next.js 15, React 19, Tailwind v4, `output: "export"` (static). Hosted
on Vercel with Root Directory `apps/website` and an ignored-build step so
desktop-only commits skip deploys.

Pages:

- `/` — nav; hero with OS-aware download button, GitHub link, explainer video
  with poster; "local or cloud" provider strip (8 providers, local/cloud
  chips); feature grid (agent mode, editor, terminal, in-app browser and agent
  browsing, voice, chat); privacy summary; open source (AGPLv3) call; footer.
- `/download` — macOS (Apple Silicon .dmg), Windows (.exe), Linux (.AppImage)
  cards. Latest release and asset URLs come from the GitHub Releases API at
  build time; on failure every button links to `releases/latest`. The
  visitor's OS card is highlighted client-side.
- `/privacy` — rendered at build time from the root `PRIVACY.md`.
- 404, metadata, Open Graph image, sitemap, robots.

Look: the app's `--m-*` tokens and the Marven logo; dark by default, light via
system preference plus a toggle; editor/terminal-flavoured details; works at
phone width.

## Testing

- Desktop after the move: `npm test`, `npm run typecheck`, `npm run build`
  pass in `apps/desktop`.
- Website: unit tests for the release-asset picker and OS detection; clean
  `next build`; browser check at desktop and phone widths in both themes.
