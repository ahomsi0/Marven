"use client";

import type { RestCollection, RestRequest, RestMethod } from "@/types";

const COLLECTIONS_KEY = "marven-rest-collections";

export function loadRestCollections(): RestCollection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RestCollection[];
  } catch {
    return [];
  }
}

export function saveRestCollections(cols: RestCollection[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(cols));
  } catch {
    // ignore quota errors
  }
}

export function createRestRequest(collectionId?: string): RestRequest {
  const request: RestRequest = {
    id: `rest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: "New Request",
    method: "GET" as RestMethod,
    url: "",
    headers: [{ key: "Content-Type", value: "application/json", enabled: false }],
    body: "",
    bodyType: "none",
  };

  if (collectionId) {
    // Add to existing collection
    const cols = loadRestCollections();
    const target = cols.find((c) => c.id === collectionId);
    if (target) {
      target.requests.push(request);
      saveRestCollections(cols);
      return request;
    }
  }

  // Find or create default collection
  const cols = loadRestCollections();
  const defaultCol = cols.find((c) => c.name === "Default");
  if (defaultCol) {
    defaultCol.requests.push(request);
    saveRestCollections(cols);
  } else {
    const newCol: RestCollection = {
      id: `col-${Date.now()}`,
      name: "Default",
      requests: [request],
    };
    saveRestCollections([...cols, newCol]);
  }

  return request;
}

export function saveRestRequest(request: RestRequest): void {
  const cols = loadRestCollections();
  let found = false;
  for (const col of cols) {
    const idx = col.requests.findIndex((r) => r.id === request.id);
    if (idx >= 0) {
      col.requests[idx] = { ...request, savedAt: new Date().toISOString() };
      found = true;
      break;
    }
  }
  if (!found) {
    // If not found in any collection, add to default
    const defaultCol = cols.find((c) => c.name === "Default");
    if (defaultCol) {
      defaultCol.requests.push({ ...request, savedAt: new Date().toISOString() });
    } else {
      cols.push({
        id: `col-${Date.now()}`,
        name: "Default",
        requests: [{ ...request, savedAt: new Date().toISOString() }],
      });
    }
  }
  saveRestCollections(cols);
}

export function loadRestRequest(id: string): RestRequest | null {
  const cols = loadRestCollections();
  for (const col of cols) {
    const req = col.requests.find((r) => r.id === id);
    if (req) return req;
  }
  return null;
}
