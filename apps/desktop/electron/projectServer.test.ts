import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";

const require = createRequire(import.meta.url);
const { createProjectServers, resolveRequest, pageUrl } = require("./projectServer");

let base: string;
let root: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "marven-serve-")));
  root = path.join(base, "site");
  fs.mkdirSync(path.join(root, "about"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "index.html"), "<h1>Ali Itani</h1>");
  fs.writeFileSync(path.join(root, "style.css"), "body{background:red}");
  fs.writeFileSync(path.join(root, "about", "index.html"), "about");
  fs.writeFileSync(path.join(root, "docs", "a.txt"), "a");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
  fs.writeFileSync(path.join(base, "outside.txt"), "nope");
  fs.symlinkSync(path.join(base, "outside.txt"), path.join(root, "escape.txt"));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("resolveRequest", () => {
  it("serves files and a folder's index.html", () => {
    expect(resolveRequest(root, "/")).toEqual({ file: path.join(root, "index.html") });
    expect(resolveRequest(root, "/style.css?v=2")).toEqual({ file: path.join(root, "style.css") });
    expect(resolveRequest(root, "/about/")).toEqual({ file: path.join(root, "about", "index.html") });
    expect(resolveRequest(root, "/about")).toEqual({ redirect: "/about/" });
    expect(resolveRequest(root, "/docs/")).toEqual({ dir: path.join(root, "docs") });
  });
  it("refuses hidden files, escapes and odd paths", () => {
    expect(resolveRequest(root, "/.env")).toBeNull();
    expect(resolveRequest(root, "/../outside.txt")).toBeNull();
    expect(resolveRequest(root, "/%2e%2e/outside.txt")).toBeNull();
    expect(resolveRequest(root, "/escape.txt")).toBeNull();
    expect(resolveRequest(root, "/..%5coutside.txt")).toBeNull();
    expect(resolveRequest(root, "/%E0%A4%A")).toBeNull();
    expect(resolveRequest(root, "/missing.html")).toBeNull();
  });
});

describe("pageUrl", () => {
  it("stays on the server", () => {
    expect(pageUrl("http://127.0.0.1:5000/", "index.html")).toBe("http://127.0.0.1:5000/index.html");
    expect(pageUrl("http://127.0.0.1:5000/", "/about/team%20a.html")).toBe("http://127.0.0.1:5000/about/team%20a.html");
    expect(pageUrl("http://127.0.0.1:5000/", "//evil.com/x")).toBe("http://127.0.0.1:5000/evil.com/x");
    expect(pageUrl("http://127.0.0.1:5000/", "https://evil.com/")).toBeNull();
  });
});

function get(url: string, host?: string): Promise<{ status: number; body: string; type?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: host ? { Host: host } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: res.headers["content-type"] }));
    });
    req.on("error", reject);
  });
}

describe("project server", () => {
  it("serves the folder on 127.0.0.1 and reuses the server", async () => {
    const servers = createProjectServers();
    try {
      const url = await servers.urlFor(root);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(await servers.urlFor(root + "/")).toBe(url);
      const page = await get(url);
      expect(page.status).toBe(200);
      expect(page.body).toContain("Ali Itani");
      expect(page.type).toContain("text/html");
      expect((await get(`${url}style.css`)).type).toContain("text/css");
      expect((await get(`${url}.env`)).status).toBe(404);
      // DNS rebinding: a foreign Host is refused.
      expect((await get(url, "evil.example:80")).status).toBe(403);
    } finally {
      servers.closeAll();
    }
  });
  it("refuses what isn't a folder", async () => {
    const servers = createProjectServers();
    expect(await servers.urlFor("relative/path")).toBeNull();
    expect(await servers.urlFor(path.join(root, "index.html"))).toBeNull();
    expect(await servers.urlFor(path.join(base, "missing"))).toBeNull();
    servers.closeAll();
  });
});
