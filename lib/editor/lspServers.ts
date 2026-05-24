export type LanguageId = "typescript";

export interface LspServerSpec {
  languageId: LanguageId;
  /** File extensions this server handles (no leading dot). */
  extensions: string[];
  /** Package(s) to npm-install. */
  npmPackages: string[];
  /** Command (relative to install dir's node_modules/.bin/). */
  command: string;
  /** Args to pass to the command. */
  args: string[];
  /** Initialization options sent in LSP `initialize`. */
  initializationOptions?: Record<string, unknown>;
}

export const LSP_SERVERS: Record<LanguageId, LspServerSpec> = {
  typescript: {
    languageId: "typescript",
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
    npmPackages: ["typescript", "typescript-language-server"],
    command: "typescript-language-server",
    args: ["--stdio"],
    initializationOptions: {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      },
    },
  },
};

export function languageIdForExtension(ext: string): LanguageId | null {
  const norm = ext.toLowerCase();
  for (const spec of Object.values(LSP_SERVERS)) {
    if (spec.extensions.includes(norm)) return spec.languageId;
  }
  return null;
}
