import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Eyebrow } from "@/components/landing/Section";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What data Marven handles, where it goes, and what it never touches. No telemetry.",
  alternates: { canonical: "/privacy" },
};

// The policy lives once, at the repo root, and is rendered here at build time.
const POLICY_PATH = path.join(process.cwd(), "..", "..", "PRIVACY.md");

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

export default async function PrivacyPage() {
  const source = await fs.readFile(POLICY_PATH, "utf8");
  const updated = source.match(/\*\*Last updated:\s*([^*]+)\*\*/)?.[1]?.trim();
  const body = source.replace(/\*\*Last updated:[^\n]*\n/, "");

  return (
    <div className="px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
      <article className="mx-auto max-w-3xl">
        <Eyebrow tone="local">Privacy</Eyebrow>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-ink sm:text-5xl">Privacy policy</h1>
        <p className="mt-4 font-mono text-xs text-dim">
          {updated && <>Last updated {updated} · </>}
          <a href={`${REPO_URL}/blob/master/PRIVACY.md`} className="underline decoration-line-2 underline-offset-2 hover:text-ink-2">
            view on GitHub
          </a>
        </p>
        <div className="prose-m mt-10">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => <h2 id={slug(textOf(children))}>{children}</h2>,
              h3: ({ children }) => <h3 id={slug(textOf(children))}>{children}</h3>,
              table: ({ children }) => (
                <div className="table-wrap">
                  <table>{children}</table>
                </div>
              ),
              a: ({ href = "", children }) => {
                // Relative links point at files in the repo, not pages on this site.
                const target = /^(https?:|mailto:|#)/.test(href) ? href : `${REPO_URL}/blob/master/${href.replace(/^\.\//, "")}`;
                return <a href={target}>{children}</a>;
              },
            }}
          >
            {body}
          </Markdown>
        </div>
      </article>
    </div>
  );
}
