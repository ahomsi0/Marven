// electron/lsp/lspServers.js
// CommonJS twin of lib/editor/lspServers.ts.
// Kept in sync via electron/lsp/__tests__/lspServersSync.test.js.

const LSP_SERVERS = {
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

function languageIdForExtension(ext) {
  if (!ext) return null;
  const norm = String(ext).toLowerCase();
  for (const spec of Object.values(LSP_SERVERS)) {
    if (spec.extensions.includes(norm)) return spec.languageId;
  }
  return null;
}

module.exports = { LSP_SERVERS, languageIdForExtension };
