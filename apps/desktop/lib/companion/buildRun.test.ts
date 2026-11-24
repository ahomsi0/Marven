import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/types";
import { approvalSummary, extractLiveUrl, isInsideRoot, packageScripts, plainSummary, progressLabel, runsProjectCode, shouldAutoApprove } from "./buildRun";

const ROOT = "/Users/me/Marven Projects/cafe-menu";
const WIN_ROOT = "C:\\Users\\me\\Marven Projects\\cafe-menu";

type Pending = Extract<AgentEvent, { type: "pending_approval" }>;
const write = (path: unknown, previewPath: string | null = typeof path === "string" ? path : null, tool = "write_file"): Pending => ({
  type: "pending_approval",
  callId: "c1",
  tool,
  args: { path, content: "<h1>Menu</h1>" },
  ...(previewPath !== null ? { preview: { path: previewPath, before: "", after: "<h1>Menu</h1>", diff: "" } } : {}),
});

describe("isInsideRoot", () => {
  it("accepts relative paths that stay inside the root", () => {
    expect(isInsideRoot("index.html", ROOT)).toBe(true);
    expect(isInsideRoot("./css/styles.css", ROOT)).toBe(true);
    expect(isInsideRoot("src/../index.html", ROOT)).toBe(true);
    expect(isInsideRoot("a//b/./c.js", ROOT)).toBe(true);
  });

  it("accepts absolute paths under the root", () => {
    expect(isInsideRoot(`${ROOT}/index.html`, ROOT)).toBe(true);
    expect(isInsideRoot(`${ROOT}/`, `${ROOT}/`)).toBe(false);
  });

  it("rejects the root itself, escapes, and lookalike siblings", () => {
    expect(isInsideRoot(".", ROOT)).toBe(false);
    expect(isInsideRoot(ROOT, ROOT)).toBe(false);
    expect(isInsideRoot("../other/index.html", ROOT)).toBe(false);
    expect(isInsideRoot("src/../../x", ROOT)).toBe(false);
    expect(isInsideRoot("/etc/passwd", ROOT)).toBe(false);
    expect(isInsideRoot(`${ROOT}-2/index.html`, ROOT)).toBe(false);
    expect(isInsideRoot(`${ROOT}/../cafe-menu-evil/x`, ROOT)).toBe(false);
    expect(isInsideRoot("/../../Users/me/Marven Projects/cafe-menu/x", "/")).toBe(true);
  });

  it("treats backslashes as separators, so a Windows-style escape is caught", () => {
    expect(isInsideRoot("..\\..\\x", ROOT)).toBe(false);
    expect(isInsideRoot("css\\styles.css", ROOT)).toBe(true);
  });

  it("handles Windows roots, case-insensitively", () => {
    expect(isInsideRoot("index.html", WIN_ROOT)).toBe(true);
    expect(isInsideRoot("c:\\users\\ME\\Marven Projects\\cafe-menu\\a.js", WIN_ROOT)).toBe(true);
    expect(isInsideRoot("D:\\x.js", WIN_ROOT)).toBe(false);
    expect(isInsideRoot("..\\x.js", WIN_ROOT)).toBe(false);
  });

  it("refuses anything it can't read with confidence", () => {
    expect(isInsideRoot("", ROOT)).toBe(false);
    expect(isInsideRoot("   ", ROOT)).toBe(false);
    expect(isInsideRoot("~/x", ROOT)).toBe(false);
    expect(isInsideRoot("a\0b", ROOT)).toBe(false);
    expect(isInsideRoot("index.html", "relative/root")).toBe(false);
    expect(isInsideRoot("index.html", "")).toBe(false);
  });
});

describe("shouldAutoApprove", () => {
  it("approves write_file and apply_patch inside the new project", () => {
    expect(shouldAutoApprove(write("index.html"), ROOT)).toBe(true);
    expect(shouldAutoApprove(write("css/site.css", "css/site.css", "apply_patch"), ROOT)).toBe(true);
    expect(shouldAutoApprove(write(`${ROOT}/index.html`), ROOT)).toBe(true);
  });

  it("asks for writes outside the project", () => {
    expect(shouldAutoApprove(write("../index.html"), ROOT)).toBe(false);
    expect(shouldAutoApprove(write("/Users/me/.zshrc"), ROOT)).toBe(false);
  });

  it("asks when the target can't be determined", () => {
    expect(shouldAutoApprove(write(undefined, null), ROOT)).toBe(false);
    expect(shouldAutoApprove(write(42), ROOT)).toBe(false);
    expect(shouldAutoApprove(write("index.html", null), ROOT)).toBe(false); // no preview
    expect(shouldAutoApprove(write("index.html", "other.html"), ROOT)).toBe(false); // preview disagrees
  });

  it("never approves other tools, browser actions, or the plan", () => {
    const base = { type: "pending_approval" as const, callId: "c", args: { path: "index.html" } };
    for (const tool of ["run_command", "git_commit", "fetch_url", "remember", "mcp__fs__write", "__plan__", "browser_click"]) {
      expect(shouldAutoApprove({ ...base, tool, preview: { path: "index.html", before: "", after: "", diff: "" } }, ROOT)).toBe(false);
    }
    const withBrowser = { ...write("index.html"), browser: { kind: "submit" } } as unknown as AgentEvent;
    expect(shouldAutoApprove(withBrowser, ROOT)).toBe(false);
  });

  it("ignores events that aren't approvals", () => {
    expect(shouldAutoApprove({ type: "tool_call", callId: "c", tool: "write_file", args: { path: "a" } }, ROOT)).toBe(false);
  });
});

describe("progressLabel", () => {
  const call = (tool: string, args: Record<string, unknown> = {}): AgentEvent => ({ type: "tool_call", callId: "c", tool, args });

  it("names the file being written or edited", () => {
    expect(progressLabel(call("write_file", { path: "src/index.html" }))).toEqual({ key: "companion.build.step.writing", params: { file: "index.html" } });
    expect(progressLabel(call("apply_patch", { path: "css\\styles.css" }))).toEqual({ key: "companion.build.step.editing", params: { file: "styles.css" } });
  });

  it("shows the command being run, shortened", () => {
    expect(progressLabel(call("run_command", { command: "npm install" }))).toEqual({ key: "companion.build.step.running", params: { command: "npm install" } });
    const long = progressLabel(call("run_command", { command: `npx create-vite@latest ${"x".repeat(80)}` }));
    expect(long?.params?.command.length).toBeLessThanOrEqual(40);
    expect(long?.params?.command.endsWith("…")).toBe(true);
  });

  it("groups reading and looking things up", () => {
    for (const tool of ["list_files", "read_file", "search_files", "search_codebase", "git_status", "git_diff", "git_log"]) {
      expect(progressLabel(call(tool))?.key).toBe("companion.build.step.looking");
    }
    expect(progressLabel(call("web_search"))?.key).toBe("companion.build.step.lookingUp");
    expect(progressLabel(call("fetch_url"))?.key).toBe("companion.build.step.lookingUp");
    expect(progressLabel(call("git_commit"))?.key).toBe("companion.build.step.git");
    expect(progressLabel(call("remember"))?.key).toBe("companion.build.step.noting");
    expect(progressLabel(call("mcp__x__y"))?.key).toBe("companion.build.step.working");
  });

  it("falls back when the path is missing, and ignores other events", () => {
    expect(progressLabel(call("write_file"))).toEqual({ key: "companion.build.step.writingSomething" });
    expect(progressLabel({ type: "done", toolCallCount: 0 })).toBeNull();
  });
});

describe("approvalSummary", () => {
  const pending = (tool: string, args: Record<string, unknown>, previewPath?: string): Pending => ({
    type: "pending_approval",
    callId: "c",
    tool,
    args,
    ...(previewPath ? { preview: { path: previewPath, before: "", after: "", diff: "" } } : {}),
  });

  it("describes each kind of request", () => {
    expect(approvalSummary(pending("run_command", { command: "npm install" }))).toEqual({ kind: "command", detail: "npm install" });
    expect(approvalSummary(pending("fetch_url", { url: "https://example.com/a" }, "fetch:example.com"))).toEqual({ kind: "fetch", detail: "example.com" });
    expect(approvalSummary(pending("git_commit", { message: "Init" }))).toEqual({ kind: "git", detail: "git commit: Init" });
    expect(approvalSummary(pending("git_checkout", { target: "main" }))).toEqual({ kind: "git", detail: "git checkout: main" });
    expect(approvalSummary(pending("remember", { content: "Likes blue" }, "memory:global"))).toEqual({ kind: "memory", detail: "Likes blue" });
    expect(approvalSummary(pending("mcp__fs__write", {}, "mcp:fs/write"))).toEqual({ kind: "mcp", detail: "fs/write" });
    expect(approvalSummary(pending("write_file", { path: "../x" }, "../x"))).toEqual({ kind: "write", detail: "../x" });
    expect(approvalSummary(pending("something_new", {}))).toEqual({ kind: "other", detail: "something_new" });
  });
});

describe("extractLiveUrl", () => {
  it("reads the Agent's Live URL line", () => {
    expect(extractLiveUrl("SERVER READY at http://localhost:5173\n\nLive URL: http://localhost:5173")).toBe("http://localhost:5173");
    expect(extractLiveUrl("**Live URL:** `http://127.0.0.1:8080/app`.")).toBe("http://127.0.0.1:8080/app");
    expect(extractLiveUrl("live url: <http://localhost:3001/>")).toBe("http://localhost:3001/");
  });

  it("only takes local http(s) addresses", () => {
    expect(extractLiveUrl("Live URL: https://evil.example.com")).toBeNull();
    expect(extractLiveUrl("Live URL: file:///etc/passwd")).toBeNull();
    expect(extractLiveUrl("Live URL: javascript:alert(1)")).toBeNull();
    expect(extractLiveUrl("Live URL: http://localhost.evil.com:80")).toBeNull();
  });

  it("returns null without a Live URL line", () => {
    expect(extractLiveUrl("Your site is at http://localhost:3000")).toBeNull();
    expect(extractLiveUrl("")).toBeNull();
  });
});

describe("plainSummary", () => {
  it("drops markdown decoration and blank lines (the bubble is small)", () => {
    expect(plainSummary("## Done\n\n\n\nI made **index.html** with `styles.css`.\n")).toBe("Done\nI made index.html with styles.css.");
  });
});

describe("runsProjectCode", () => {
  it("spots commands that run code from the project", () => {
    for (const cmd of [
      "npm install",
      "npm i",
      "npm ci",
      "npm run dev",
      "npm start",
      "npm test",
      "pnpm install",
      "pnpm dev",
      "yarn",
      "yarn install",
      "yarn run build",
      "bun install",
      "bun run dev",
      "npx vite",
      "bunx serve",
      "node server.js",
      "python app.py",
      "python3 manage.py runserver",
      "sh setup.sh",
      "bash ./build.sh",
      "./run.sh",
      "make",
      "make build",
      "cd app && npm install",
      "NODE_ENV=production node index.js",
      "ls; npm run build",
    ]) {
      expect(runsProjectCode(cmd), cmd).toBe(true);
    }
  });

  it("leaves other commands alone", () => {
    for (const cmd of ["ls -la", "mkdir css", "node -v", "node --version", "python -m http.server 8000", "npm -v", "git status", "cat package.json", "echo make", "", "   "]) {
      expect(runsProjectCode(cmd), cmd).toBe(false);
    }
  });
});

describe("packageScripts", () => {
  it("lists the scripts block as name: command lines", () => {
    const pkg = JSON.stringify({ name: "x", scripts: { dev: "vite", build: "vite build", postinstall: "node evil.js" } });
    expect(packageScripts(pkg)).toBe("dev: vite\nbuild: vite build\npostinstall: node evil.js");
  });

  it("is null without usable scripts", () => {
    expect(packageScripts("{}")).toBeNull();
    expect(packageScripts(JSON.stringify({ scripts: {} }))).toBeNull();
    expect(packageScripts(JSON.stringify({ scripts: ["a"] }))).toBeNull();
    expect(packageScripts("not json")).toBeNull();
    expect(packageScripts(JSON.stringify({ scripts: { a: 1 } }))).toBeNull();
  });

  it("caps very long lists", () => {
    const scripts = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`s${i}`, "x"]));
    const out = packageScripts(JSON.stringify({ scripts }))!;
    expect(out.split("\n").length).toBe(31);
    expect(out.endsWith("…")).toBe(true);
  });
});
