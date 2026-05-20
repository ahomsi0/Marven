import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRestRequest, loadRestCollections, saveRestCollections } from "@/lib/restStorage";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  writable: true,
});

describe("createRestRequest", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns an object with correct defaults", () => {
    const req = createRestRequest();
    expect(req.method).toBe("GET");
    expect(req.url).toBe("");
    expect(typeof req.id).toBe("string");
    expect(req.id.length).toBeGreaterThan(0);
    expect(req.name).toBe("New Request");
    expect(req.bodyType).toBe("none");
    expect(req.body).toBe("");
    expect(Array.isArray(req.headers)).toBe(true);
  });

  it("returns a unique id each time", () => {
    const r1 = createRestRequest();
    const r2 = createRestRequest();
    expect(r1.id).not.toBe(r2.id);
  });
});

describe("loadRestCollections", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns [] when localStorage is absent", () => {
    const cols = loadRestCollections();
    expect(cols).toEqual([]);
  });

  it("returns [] on corrupt JSON", () => {
    localStorageMock.setItem("marven-rest-collections", "not-valid-json{{{");
    const cols = loadRestCollections();
    expect(cols).toEqual([]);
  });
});

describe("round-trip: save and load collections", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("saves a collection and loads it back correctly", () => {
    const col = {
      id: "col-1",
      name: "Test",
      requests: [
        {
          id: "req-1",
          name: "Get Users",
          method: "GET" as const,
          url: "https://api.example.com/users",
          headers: [],
          body: "",
          bodyType: "none" as const,
        },
      ],
    };

    saveRestCollections([col]);
    const loaded = loadRestCollections();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("col-1");
    expect(loaded[0].name).toBe("Test");
    expect(loaded[0].requests).toHaveLength(1);
    expect(loaded[0].requests[0].url).toBe("https://api.example.com/users");
    expect(loaded[0].requests[0].method).toBe("GET");
  });

  it("persists multiple collections", () => {
    const cols = [
      { id: "col-1", name: "Public", requests: [] },
      { id: "col-2", name: "Private", requests: [] },
    ];
    saveRestCollections(cols);
    const loaded = loadRestCollections();
    expect(loaded).toHaveLength(2);
    expect(loaded.map((c) => c.name)).toEqual(["Public", "Private"]);
  });
});
