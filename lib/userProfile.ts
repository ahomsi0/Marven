"use client";

const PROFILE_KEY = "marven_user_profile";
const MEMORIES_KEY = "marven_memories";

export interface UserProfile {
  name: string;
}

export function loadProfile(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadMemories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MEMORIES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function saveMemories(memories: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MEMORIES_KEY, JSON.stringify(memories));
  } catch {
    // Ignore storage quota errors
  }
}

export function addMemory(memory: string): string[] {
  const existing = loadMemories();
  const updated = [...existing, memory];
  saveMemories(updated);
  return updated;
}
