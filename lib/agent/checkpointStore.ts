const checkpoints = new Map<string, string | null>();

export function recordCheckpoint(path: string, before: string | null): void {
  if (!checkpoints.has(path)) checkpoints.set(path, before);
}

export function getCheckpoint(path: string): string | null | undefined {
  return checkpoints.get(path);
}

export function clearCheckpoints(): void {
  checkpoints.clear();
}

export function listCheckpoints(): string[] {
  return Array.from(checkpoints.keys());
}
