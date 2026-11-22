export interface GitFileEntry {
  path: string;
  statusCode: string;
}

export interface ParsedStatus {
  branch: string;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
}

export function parsePorcelain(output: string): Omit<ParsedStatus, "branch"> {
  const staged: GitFileEntry[] = [];
  const unstaged: GitFileEntry[] = [];
  const untracked: GitFileEntry[] = [];

  const lines = output.split("\n");
  for (const raw of lines) {
    if (raw.length < 2) continue;
    const X = raw[0];
    const Y = raw[1];
    const rest = raw.slice(3);
    const path = rest.includes(" -> ") ? rest.split(" -> ")[0].trim() : rest.trim();
    if (!path) continue;

    if (X === "?" && Y === "?") {
      untracked.push({ path, statusCode: "?" });
      continue;
    }

    if (X !== " " && X !== "?") {
      staged.push({ path, statusCode: X });
    }

    if (Y !== " " && Y !== "?") {
      unstaged.push({ path, statusCode: Y });
    }
  }

  return { staged, unstaged, untracked };
}
