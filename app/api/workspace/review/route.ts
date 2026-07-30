import { NextRequest, NextResponse } from "next/server";
import { runGit } from "@/lib/agent/git";

interface ReviewBody {
  workspaceRoot?: string;
}

interface Finding {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  file?: string;
}

function extractChangedFiles(nameStatus: string): string[] {
  return nameStatus
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).slice(1).join(" "))
    .filter(Boolean);
}

function packageDiffNeedsLockfile(diff: string): boolean {
  const packageSection = diff.split(/^diff --git /m).find((section) => section.includes(" a/package.json "));
  if (!packageSection) return false;
  return /^\+.*"(dependencies|devDependencies|optionalDependencies|peerDependencies|overrides)"\s*:/.test(packageSection)
    || /^\+.*"[^"]+"\s*:\s*"[~^]?\d+\.\d+\.\d+/.test(packageSection);
}

function buildFindings(diff: string, files: string[]): Finding[] {
  const findings: Finding[] = [];
  const changedTests = files.some((file) => /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes("__tests__"));
  const sourceChanges = files.some((file) => /\.(ts|tsx|js|jsx)$/.test(file) && !/\.(test|spec)\.[jt]sx?$/.test(file));

  if (sourceChanges && !changedTests) {
    findings.push({
      severity: "medium",
      title: "Source changed without nearby tests",
      detail: "Code files changed, but no test files are in the current diff. Run the relevant test suite or add focused coverage.",
    });
  }

  for (const file of files) {
    if (
      /package\.json$/.test(file)
      && packageDiffNeedsLockfile(diff)
      && !files.some((f) => /package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?/.test(f))
    ) {
      findings.push({
        severity: "high",
        title: "Package manifest changed without lockfile",
        detail: "Dependency or script changes should usually update the lockfile so installs are reproducible.",
        file,
      });
    }
    if (/\.env($|\.)/.test(file) && !file.includes("example")) {
      findings.push({
        severity: "high",
        title: "Environment file changed",
        detail: "Check that secrets or machine-local values were not staged.",
        file,
      });
    }
  }

  const suspiciousPatterns: Array<[RegExp, Finding["severity"], string, string]> = [
    [/^\+.*\bconsole\.log\(/m, "low", "Console logging added", "Confirm debug logging is intentional before release."],
    [/^\+.*\bTODO\b|\bFIXME\b/m, "low", "TODO marker added", "Track this follow-up explicitly or finish it before shipping."],
    [/^\+.*dangerouslySetInnerHTML/m, "high", "Raw HTML rendering added", "Review sanitization and trust boundaries carefully."],
    [/^\+.*(process\.env|import\.meta\.env).*KEY/m, "medium", "Environment key access changed", "Confirm missing-key behavior and setup docs."],
    [/^\+.*git reset --hard/m, "high", "Destructive git command added", "Destructive commands should be gated or removed."],
  ];

  for (const [pattern, severity, title, detail] of suspiciousPatterns) {
    if (pattern.test(diff)) findings.push({ severity, title, detail });
  }

  return findings;
}

export async function POST(req: NextRequest) {
  let body: ReviewBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceRoot = body.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return NextResponse.json({ error: "workspaceRoot is required" }, { status: 400 });
  }

  const [status, nameStatus, untracked, diffStat, diff] = await Promise.all([
    runGit(["status", "--short", "--branch"], workspaceRoot),
    runGit(["diff", "--name-status", "HEAD"], workspaceRoot),
    runGit(["ls-files", "--others", "--exclude-standard"], workspaceRoot),
    runGit(["diff", "--stat", "HEAD"], workspaceRoot),
    runGit(["diff", "HEAD"], workspaceRoot),
  ]);

  if (/Not a git repository|Git error/i.test(status)) {
    return NextResponse.json({ error: status }, { status: 400 });
  }

  const files = Array.from(new Set([
    ...extractChangedFiles(nameStatus),
    ...untracked.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  ])).sort();
  const findings = buildFindings(diff, files);
  return NextResponse.json({
    status,
    diffStat,
    changedFiles: files,
    findings,
    summary:
      files.length === 0
        ? "No local changes to review."
        : findings.length === 0
          ? `Reviewed ${files.length} changed file${files.length === 1 ? "" : "s"} and found no heuristic issues.`
          : `Reviewed ${files.length} changed file${files.length === 1 ? "" : "s"} and found ${findings.length} item${findings.length === 1 ? "" : "s"} to check.`,
    reviewedAt: new Date().toISOString(),
  });
}
