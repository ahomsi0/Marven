export const REPO = "ahomsi0/Marven";
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`;
export const LICENSE_URL = `${REPO_URL}/blob/master/LICENSE`;
export const ISSUES_URL = `${REPO_URL}/issues`;

/** Where the site is served; used for canonical URLs, the sitemap and OG tags. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://marven-ah.vercel.app").replace(/\/$/, "");

export const TAGLINE = "An AI coding agent and a full code editor, in one desktop app.";
export const DESCRIPTION =
  "Marven is a free, open-source desktop app that pairs an AI coding agent with a real code editor, terminal and browser. Bring your own model, or run everything locally.";
