import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// appCsp.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
const { withAppCsp } = require("./appCsp") as {
  withAppCsp: (
    url: string,
    headers: Record<string, string[]>,
    opts: { appOrigin: string; csp: string },
  ) => Record<string, string[]>;
};

const appOrigin = "http://localhost:47891";
const csp = "default-src 'self'; frame-ancestors 'none'";
const previewCsp = "sandbox allow-scripts; default-src 'self' data: blob:";

describe("withAppCsp", () => {
  it("stamps the app's policy on the app's own pages and API responses", () => {
    const out = withAppCsp(`${appOrigin}/`, { "content-type": ["text/html"] }, { appOrigin, csp });
    expect(out["Content-Security-Policy"]).toEqual([csp]);
  });

  it("leaves other origins untouched", () => {
    const headers = { "content-type": ["text/html"] };
    expect(withAppCsp("https://example.com/", headers, { appOrigin, csp })).toBe(headers);
  });

  it("keeps a workspace preview's own sandbox policy and lets the app window frame it", () => {
    const out = withAppCsp(
      `${appOrigin}/api/workspace/preview/@abc/index.html`,
      { "content-security-policy": [previewCsp], "content-type": ["text/html"] },
      { appOrigin, csp },
    );
    const values = Object.entries(out)
      .filter(([k]) => k.toLowerCase() === "content-security-policy")
      .flatMap(([, v]) => v);
    expect(values).toHaveLength(1);
    expect(values[0]).toContain("sandbox allow-scripts");
    expect(values[0]).toContain(`frame-ancestors ${appOrigin}`);
    expect(values[0]).not.toContain("frame-ancestors 'none'");
  });

  it("never lets a preview drop the sandbox, even if the route sent no policy", () => {
    const out = withAppCsp(`${appOrigin}/api/workspace/preview/@abc/style.css`, {}, { appOrigin, csp });
    const value = (out["Content-Security-Policy"] ?? [])[0] ?? "";
    expect(value).toContain("sandbox");
    expect(value).toContain(`frame-ancestors ${appOrigin}`);
  });

  it("does not treat look-alike paths as previews", () => {
    const out = withAppCsp(`${appOrigin}/api/workspace/previewx/a`, {}, { appOrigin, csp });
    expect(out["Content-Security-Policy"]).toEqual([csp]);
  });
});

describe("the Mini Me preview page", () => {
  const opts = { appOrigin: "http://localhost:3000", csp: "default-src 'self'; frame-ancestors 'none'" };
  it("may frame the project server on 127.0.0.1", () => {
    const h = withAppCsp("http://localhost:3000/companion/preview?u=x", {}, opts);
    expect(h["Content-Security-Policy"][0]).toContain("frame-src http://127.0.0.1:*");
  });
  it("other pages may not", () => {
    for (const url of ["http://localhost:3000/companion", "http://localhost:3000/", "http://localhost:3000/companion/previewx"]) {
      expect(withAppCsp(url, {}, opts)["Content-Security-Policy"][0]).not.toContain("frame-src");
    }
  });
});
