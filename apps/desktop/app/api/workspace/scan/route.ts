import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { resolveRequestRoot } from "@/lib/workspaceState";

interface ScanBody {
  workspaceRoot?: string;
}

interface PackageJsonShape {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const STACK_MARKERS: Array<[string, string]> = [
  ["next", "Next.js"],
  ["react", "React"],
  ["electron", "Electron"],
  ["typescript", "TypeScript"],
  ["tailwindcss", "Tailwind CSS"],
  ["vite", "Vite"],
  ["express", "Express"],
  ["prisma", "Prisma"],
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["playwright", "Playwright"],
];

const ENTRYPOINT_CANDIDATES = [
  "app/page.tsx",
  "app/page.ts",
  "src/App.tsx",
  "src/App.ts",
  "src/main.tsx",
  "src/main.ts",
  "pages/index.tsx",
  "pages/index.ts",
  "electron/main.js",
  "electron/main.ts",
  "main.js",
  "server.ts",
  "server.js",
];

const IMPORTANT_FILES = [
  "README.md",
  "HANDOFF.md",
  "PRIVACY.md",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "vite.config.ts",
  "tailwind.config.ts",
  "electron/main.js",
  ".env.example",
  ".env.local.example",
];

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(root: string): Promise<PackageJsonShape | null> {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return null;
  }
}

async function detectPackageManager(root: string): Promise<string | null> {
  const checks: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, name] of checks) {
    if (await exists(path.join(root, file))) return name;
  }
  return null;
}

function commandFor(pm: string | null, script: string): string {
  if (pm === "pnpm") return `pnpm ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return script === "test" ? "npm test" : `npm run ${script}`;
}

export async function POST(req: NextRequest) {
  let body: ScanBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceRoot = body.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return NextResponse.json({ error: "workspaceRoot is required" }, { status: 400 });
  }
  const root = resolveRequestRoot(workspaceRoot);
  if (!root) {
    return NextResponse.json({ error: "Workspace not approved" }, { status: 403 });
  }

  const pkg = await readPackageJson(root);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const packageManager = await detectPackageManager(root);
  const scripts = pkg?.scripts ?? {};
  const stack = STACK_MARKERS.filter(([dep]) => dep in deps).map(([, label]) => label);

  const [entrypoints, importantFiles, envFiles] = await Promise.all([
    Promise.all(
      ENTRYPOINT_CANDIDATES.map(async (file) => ((await exists(path.join(root, file))) ? file : null)),
    ).then((items) => items.filter((item): item is string => Boolean(item))),
    Promise.all(
      IMPORTANT_FILES.map(async (file) => ((await exists(path.join(root, file))) ? file : null)),
    ).then((items) => items.filter((item): item is string => Boolean(item))),
    fs.readdir(root)
      .then((items) => items.filter((file) => file.startsWith(".env")).sort())
      .catch(() => []),
  ]);

  const verificationCommands = ["typecheck", "lint", "test", "build"]
    .filter((script) => Boolean(scripts[script]?.trim()) && !/no test specified/i.test(scripts[script]))
    .map((script) => commandFor(packageManager, script));

  const recommendations = [
    verificationCommands.length === 0
      ? "Add test, build, or typecheck scripts so Marven can verify changes automatically."
      : null,
    !scripts.lint ? "Consider adding a lint script for faster review feedback." : null,
    !envFiles.some((file) => file.includes("example"))
      ? "Add a .env.example file so project setup is easier to understand."
      : null,
    !importantFiles.includes("README.md") ? "Add a README with setup and release notes." : null,
  ].filter((item): item is string => Boolean(item));

  return NextResponse.json({
    name: pkg?.name ?? path.basename(root),
    version: pkg?.version ?? null,
    packageManager,
    stack,
    scripts,
    verificationCommands,
    entrypoints,
    importantFiles,
    envFiles,
    recommendations,
    scannedAt: new Date().toISOString(),
  });
}
