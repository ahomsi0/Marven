"use client";

const PROFILE_KEY = "marven_user_profile";
const MEMORIES_KEY = "marven_memories";

/** Your picture: your initial on a colour, your Mini Me's face, or a photo (a small data URL kept on this machine). */
export type ProfileAvatar =
  | { kind: "initial"; color: string }
  | { kind: "minime" }
  | { kind: "photo"; dataUrl: string };

export interface UserProfile {
  name: string;
  /** Unset: your initial on the default colour. */
  avatar?: ProfileAvatar;
}

/** Fired on window when the profile is saved, so every view can show the new name and picture. */
export const PROFILE_CHANGED_EVENT = "marven:profile-changed";

/** The colours offered for an initial (Marven's accent first). */
export const AVATAR_COLORS = ["#d19a66", "#61afef", "#98c379", "#c678dd", "#e06c75", "#56b6c2", "#9ca3af"] as const;

const NAME_MAX = 60;
/** A photo is resized to 128 px before saving; anything far bigger isn't ours. */
const PHOTO_MAX_CHARS = 300_000;
const PHOTO_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function parseAvatar(value: unknown): ProfileAvatar | undefined {
  if (!value || typeof value !== "object") return undefined;
  const a = value as Record<string, unknown>;
  if (a.kind === "initial" && typeof a.color === "string" && (AVATAR_COLORS as readonly string[]).includes(a.color)) {
    return { kind: "initial", color: a.color };
  }
  if (a.kind === "minime") return { kind: "minime" };
  if (a.kind === "photo" && typeof a.dataUrl === "string" && a.dataUrl.length <= PHOTO_MAX_CHARS && PHOTO_URL.test(a.dataUrl)) {
    return { kind: "photo", dataUrl: a.dataUrl };
  }
  return undefined;
}

/** A stored profile, checked: null without a usable name; a picture it can't trust is dropped. */
export function parseProfile(value: unknown): UserProfile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p.name !== "string") return null;
  const name = p.name.trim().slice(0, NAME_MAX);
  if (!name) return null;
  const avatar = parseAvatar(p.avatar);
  return avatar ? { name, avatar } : { name };
}

export function loadProfile(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return parseProfile(JSON.parse(raw));
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
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
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
