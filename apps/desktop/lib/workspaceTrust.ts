const TRUST_KEY = "marven_workspace_trust_v1";

function readTrust(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(TRUST_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

export function isWorkspaceTrusted(root: string | null): boolean {
  return !!root && readTrust()[root] === true;
}

export function setWorkspaceTrusted(root: string, trusted: boolean): void {
  const next = readTrust();
  next[root] = trusted;
  try { localStorage.setItem(TRUST_KEY, JSON.stringify(next)); } catch {}
}
