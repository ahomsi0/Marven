import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

// apiToken.js is CommonJS (Electron main process), so load it with require
// rather than an ES import.
const require = createRequire(import.meta.url);
type Headers = Record<string, string>;
type Frame = { parent: Frame | null; url: string };
type Details = {
  url: string;
  method?: string;
  webContentsId?: number;
  frame?: Frame | null;
  requestHeaders: Headers;
};
const {
  API_TOKEN_HEADER,
  createApiToken,
  appOriginPatterns,
  isAppOriginUrl,
  withApiToken,
  createRequestHeaderHandler,
} = require("./apiToken") as {
  API_TOKEN_HEADER: string;
  createApiToken: () => string;
  appOriginPatterns: (port: number) => string[];
  isAppOriginUrl: (url: string, port: number) => boolean;
  withApiToken: (headers: Headers, token: string) => Headers;
  createRequestHeaderHandler: (o: {
    port: number;
    token: string | null;
    speechOrigin: string;
    isAppWebContents?: (id: number) => boolean;
  }) => {
    filter: { urls: string[] };
    listener: (d: Details, cb: (r: { requestHeaders: Headers }) => void) => void;
  };
};

describe("createApiToken", () => {
  it("returns 32 random bytes as hex, different each launch", () => {
    const a = createApiToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(createApiToken()).not.toBe(a);
  });
});

describe("isAppOriginUrl", () => {
  it("matches the app origin on localhost and 127.0.0.1 at the exact port", () => {
    expect(isAppOriginUrl("http://localhost:47891/api/mcp", 47891)).toBe(true);
    expect(isAppOriginUrl("http://127.0.0.1:47891/api/health?x=1", 47891)).toBe(true);
    expect(isAppOriginUrl("http://LOCALHOST:47891/", 47891)).toBe(true);
  });

  it("rejects other ports, hosts and schemes", () => {
    expect(isAppOriginUrl("http://localhost:3000/api/mcp", 47891)).toBe(false);
    expect(isAppOriginUrl("http://localhost:478910/api/mcp", 47891)).toBe(false);
    expect(isAppOriginUrl("http://localhost/api/mcp", 47891)).toBe(false);
    expect(isAppOriginUrl("https://localhost:47891/api/mcp", 47891)).toBe(false);
    expect(isAppOriginUrl("ws://localhost:47891/", 47891)).toBe(false);
    expect(isAppOriginUrl("http://localhost:47891.evil.com/api/mcp", 47891)).toBe(false);
    expect(isAppOriginUrl("http://evil.com/?u=http://localhost:47891/", 47891)).toBe(false);
    expect(isAppOriginUrl("http://localhost:47891@evil.com/", 47891)).toBe(false);
    expect(isAppOriginUrl("http://user:pw@localhost:47891/", 47891)).toBe(false);
    expect(isAppOriginUrl("not a url", 47891)).toBe(false);
  });
});

describe("appOriginPatterns", () => {
  it("covers both loopback names at the app port", () => {
    expect(appOriginPatterns(47891)).toEqual(["http://localhost:47891/*", "http://127.0.0.1:47891/*"]);
  });
});

describe("withApiToken", () => {
  it("adds the token and replaces any case variant", () => {
    const out = withApiToken({ Accept: "*/*", "X-Marven-Token": "forged" }, "t");
    expect(out).toEqual({ Accept: "*/*", [API_TOKEN_HEADER]: "t" });
  });
});

describe("createRequestHeaderHandler", () => {
  const run = (handler: ReturnType<typeof createRequestHeaderHandler>, url: string, requestHeaders: Headers = {}) => {
    const cb = vi.fn();
    handler.listener({ url, requestHeaders }, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    return cb.mock.calls[0][0].requestHeaders as Headers;
  };

  const handler = createRequestHeaderHandler({ port: 47891, token: "secret", speechOrigin: "http://localhost:47891" });

  it("filters to the speech service and the app origins", () => {
    expect(handler.filter.urls).toEqual([
      "https://www.google.com/*",
      "wss://www.google.com/*",
      "http://localhost:47891/*",
      "http://127.0.0.1:47891/*",
    ]);
  });

  it("stamps the token on app-origin requests", () => {
    expect(run(handler, "http://localhost:47891/api/mcp", { Accept: "*/*" })).toEqual({
      Accept: "*/*",
      "x-marven-token": "secret",
    });
    expect(run(handler, "http://127.0.0.1:47891/api/health")["x-marven-token"]).toBe("secret");
  });

  it("never sends the token anywhere else", () => {
    expect(run(handler, "https://api.openai.com/v1/chat")).toEqual({});
    expect(run(handler, "http://localhost:3000/api/mcp")).toEqual({});
    expect(run(handler, "http://localhost:47891.evil.com/")).toEqual({});
  });

  it("keeps the Web Speech Origin fix", () => {
    const h = run(handler, "wss://www.google.com/speech-api/full-duplex/v1/up", { Origin: "null" });
    expect(h).toEqual({ Origin: "http://localhost:47891" });
    expect(h["x-marven-token"]).toBeUndefined();
  });

  it("adds no token in dev (token null) but still fixes speech Origin", () => {
    const dev = createRequestHeaderHandler({ port: 3000, token: null, speechOrigin: "http://localhost:3000" });
    expect(run(dev, "http://localhost:3000/api/mcp", { Accept: "*/*" })).toEqual({ Accept: "*/*" });
    expect(run(dev, "https://www.google.com/speech-api/x")).toEqual({ Origin: "http://localhost:3000" });
  });
});

describe("createRequestHeaderHandler: which frames get the token", () => {
  const APP = "http://localhost:47891";
  const MAIN_WC = 1;
  const handler = createRequestHeaderHandler({
    port: 47891,
    token: "secret",
    speechOrigin: APP,
    isAppWebContents: (id) => id === MAIN_WC,
  });
  const top: Frame = { parent: null, url: `${APP}/` };
  const previewFrame: Frame = { parent: top, url: `${APP}/api/workspace/preview/index.html` };

  const tokenFor = (d: Partial<Details> & { url: string }) => {
    const cb = vi.fn();
    handler.listener({ method: "GET", requestHeaders: {}, ...d }, cb);
    return (cb.mock.calls[0][0].requestHeaders as Headers)["x-marven-token"];
  };

  it("stamps fetch/EventSource/img requests from the app window's top frame", () => {
    for (const method of ["GET", "POST", "PATCH"]) {
      expect(tokenFor({ url: `${APP}/api/mcp`, method, webContentsId: MAIN_WC, frame: top })).toBe("secret");
    }
  });

  it("does not stamp a subframe's requests to general API routes", () => {
    expect(tokenFor({ url: `${APP}/api/mcp`, method: "POST", webContentsId: MAIN_WC, frame: previewFrame })).toBeUndefined();
    expect(tokenFor({ url: `${APP}/api/workspace/git?op=status`, webContentsId: MAIN_WC, frame: previewFrame })).toBeUndefined();
    expect(tokenFor({ url: `${APP}/api/workspace/files`, webContentsId: MAIN_WC, frame: previewFrame })).toBeUndefined();
  });

  it("lets subframes GET the read-only preview and file routes they load from", () => {
    const ok = [
      `${APP}/api/workspace/preview/index.html`,
      `${APP}/api/workspace/preview/css/style.css`,
      `${APP}/api/workspace/serve?path=a.html`,
      `${APP}/api/workspace/files/raw?path=doc.pdf`,
    ];
    for (const url of ok) expect(tokenFor({ url, webContentsId: MAIN_WC, frame: previewFrame })).toBe("secret");
    expect(tokenFor({ url: ok[0], method: "HEAD", webContentsId: MAIN_WC, frame: previewFrame })).toBe("secret");
  });

  it("does not stamp a subframe's non-GET requests, even to preview routes", () => {
    expect(
      tokenFor({ url: `${APP}/api/workspace/preview/x`, method: "POST", webContentsId: MAIN_WC, frame: previewFrame }),
    ).toBeUndefined();
    expect(
      tokenFor({ url: `${APP}/api/workspace/files/raw/x`, webContentsId: MAIN_WC, frame: previewFrame }),
    ).toBeUndefined();
  });

  it("treats a top frame that isn't on the app origin, or another WebContents, like a subframe", () => {
    const foreignTop: Frame = { parent: null, url: "https://evil.example/" };
    expect(tokenFor({ url: `${APP}/api/mcp`, webContentsId: MAIN_WC, frame: foreignTop })).toBeUndefined();
    expect(tokenFor({ url: `${APP}/api/mcp`, webContentsId: 99, frame: top })).toBeUndefined();
    expect(tokenFor({ url: `${APP}/api/mcp`, webContentsId: 99 })).toBeUndefined();
    expect(tokenFor({ url: `${APP}/api/workspace/serve?path=a`, webContentsId: 99 })).toBe("secret");
  });

  it("does not stamp a frame Electron has already disposed", () => {
    const disposed = {
      get parent(): Frame | null {
        throw new Error("Render frame was disposed");
      },
      url: `${APP}/`,
    };
    expect(tokenFor({ url: `${APP}/api/mcp`, webContentsId: MAIN_WC, frame: disposed })).toBeUndefined();
  });

  it("falls back to destination when Electron gives no frame", () => {
    // Main-window request whose frame is gone (null): attributed by WebContents.
    expect(tokenFor({ url: `${APP}/api/mcp`, webContentsId: MAIN_WC, frame: null })).toBe("secret");
    // Worker requests carry neither frame nor WebContents.
    expect(tokenFor({ url: `${APP}/api/mcp` })).toBe("secret");
  });

  it("strips a token the page set itself when it doesn't qualify", () => {
    const cb = vi.fn();
    handler.listener(
      { url: `${APP}/api/mcp`, method: "POST", webContentsId: MAIN_WC, frame: previewFrame, requestHeaders: { "X-Marven-Token": "guess" } },
      cb,
    );
    expect(cb.mock.calls[0][0].requestHeaders).toEqual({});
  });
});
