export type MentionKind = "file" | "folder" | "codebase" | "web";

export interface FileMention {
  kind: "file";
  /** Workspace-relative path. */
  path: string;
}

export interface FolderMention {
  kind: "folder";
  /** Workspace-relative path. */
  path: string;
}

export interface CodebaseMention {
  kind: "codebase";
  query: string;
  /** Default 8, capped at 20. */
  limit?: number;
}

export interface WebMention {
  kind: "web";
  url: string;
}

export type Mention = FileMention | FolderMention | CodebaseMention | WebMention;

export interface ResolvedMention {
  mention: Mention;
  /** Text representation injected into the context block. */
  body: string;
  /** Was the body truncated to fit the budget? */
  truncated: boolean;
  /** Was the fetch/read successful? */
  ok: boolean;
  /** Error message if !ok. */
  error?: string;
}
