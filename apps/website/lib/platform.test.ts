import { describe, expect, it } from "vitest";
import { detectPlatform } from "./platform";

const UA = {
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
};

describe("detectPlatform", () => {
  it("recognises the three desktop platforms", () => {
    expect(detectPlatform({ userAgent: UA.macChrome, platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ userAgent: UA.winEdge, platform: "Win32" })).toBe("windows");
    expect(detectPlatform({ userAgent: UA.linuxFirefox, platform: "Linux x86_64" })).toBe("linux");
  });

  it("prefers userAgentData.platform when present", () => {
    expect(detectPlatform({ userAgent: "", uaPlatform: "macOS" })).toBe("mac");
    expect(detectPlatform({ userAgent: "", uaPlatform: "Windows" })).toBe("windows");
  });

  it("returns null for phones (Android reports Linux, iOS reports Mac OS X)", () => {
    expect(detectPlatform({ userAgent: UA.android, platform: "Linux armv8l" })).toBeNull();
    expect(detectPlatform({ userAgent: UA.iphone, platform: "iPhone" })).toBeNull();
  });

  it("returns null when nothing is recognisable", () => {
    expect(detectPlatform({})).toBeNull();
  });
});
