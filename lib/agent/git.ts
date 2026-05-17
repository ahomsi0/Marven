import { execFile } from "child_process";

export function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const anyErr = err as NodeJS.ErrnoException;
        if (anyErr.code === "ENOENT") {
          resolve("Git is not installed or not in PATH.");
          return;
        }
        const text = (stderr || stdout || err.message || "").trim();
        if (/not a git repository/i.test(text)) {
          resolve("Not a git repository.");
          return;
        }
        resolve(`Git error: ${text}`);
        return;
      }
      resolve(stdout.toString().trim());
    });
  });
}
