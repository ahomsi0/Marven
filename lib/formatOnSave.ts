"use client";

// ── Format-on-save ────────────────────────────────────────────────────────────
// Client-side Prettier formatting for known languages. Runs on the buffer just
// before the file is written to disk. If parsing fails (syntax error etc.) we
// return the original content unchanged — the user can still save broken code.
//
// Prettier's standalone bundle + a few parsers (~1.5MB minified+gzipped) are
// loaded lazily on the first format request so we don't pay the cost when the
// user has the toggle off.

const KEY = "marven-format-on-save";

export function getFormatOnSave(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(KEY);
  // Default: enabled.
  return v !== "false";
}

export function setFormatOnSave(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, String(value));
}

// Map file extension → Prettier parser name.
const PARSER_BY_EXT: Record<string, string> = {
  js: "babel",
  jsx: "babel",
  mjs: "babel",
  cjs: "babel",
  ts: "typescript",
  tsx: "typescript",
  css: "css",
  scss: "scss",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  yaml: "yaml",
  yml: "yaml",
};

export function isFormattable(ext: string): boolean {
  return Object.prototype.hasOwnProperty.call(PARSER_BY_EXT, ext.toLowerCase());
}

// Lazy plugin loader — Prettier's standalone build + relevant plugins are only
// imported once we need them.
type PrettierStandalone = typeof import("prettier/standalone");
type PrettierPlugin = unknown;

let prettierPromise: Promise<{ prettier: PrettierStandalone; plugins: PrettierPlugin[] }> | null = null;

function loadPrettier() {
  if (!prettierPromise) {
    prettierPromise = (async () => {
      const [prettier, babel, estree, typescript, postcss, markdown, html, yaml] = await Promise.all([
        import("prettier/standalone"),
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
        import("prettier/plugins/typescript"),
        import("prettier/plugins/postcss"),
        import("prettier/plugins/markdown"),
        import("prettier/plugins/html"),
        import("prettier/plugins/yaml"),
      ]);
      return {
        prettier: prettier as PrettierStandalone,
        plugins: [
          (babel as { default?: PrettierPlugin }).default ?? babel,
          (estree as { default?: PrettierPlugin }).default ?? estree,
          (typescript as { default?: PrettierPlugin }).default ?? typescript,
          (postcss as { default?: PrettierPlugin }).default ?? postcss,
          (markdown as { default?: PrettierPlugin }).default ?? markdown,
          (html as { default?: PrettierPlugin }).default ?? html,
          (yaml as { default?: PrettierPlugin }).default ?? yaml,
        ],
      };
    })();
  }
  return prettierPromise;
}

export async function formatBeforeSave(content: string, ext: string): Promise<string> {
  const parser = PARSER_BY_EXT[ext.toLowerCase()];
  if (!parser) return content;
  try {
    const { prettier, plugins } = await loadPrettier();
    return await prettier.format(content, {
      parser,
      // @ts-expect-error — plugins type is loose for the standalone build
      plugins,
    });
  } catch {
    return content; // syntax errors etc. — keep original
  }
}
