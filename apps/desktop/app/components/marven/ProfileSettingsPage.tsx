"use client";

// Settings → Profile: the name Marven calls you and the picture it shows for
// you (your initial on a colour, your Mini Me's face, or a photo). Saved to
// this machine only; the rest of the app updates as you change it.

import { useEffect, useRef, useState } from "react";
import { AVATAR_COLORS, loadProfile, saveProfile, type ProfileAvatar as Avatar } from "@/lib/userProfile";
import { ProfileAvatar } from "./ProfileAvatar";
import { Card, useTr } from "./minime/primitives";

const PHOTO_PX = 128;
const NAME_SAVE_DELAY_MS = 400;

/** A photo, center-cropped to a square and shrunk to 128 px, as a JPEG data URL. */
async function photoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("empty");
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_PX;
    canvas.height = PHOTO_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Kind = Avatar["kind"];

export function ProfileSettingsPage() {
  const { tr } = useTr();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<Avatar | undefined>(undefined);
  const [photoError, setPhotoError] = useState(false);
  const loaded = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last photo picked, so switching to Initial and back doesn't lose it.
  const lastPhoto = useRef<string | null>(null);

  useEffect(() => {
    const p = loadProfile();
    setName(p?.name ?? "");
    setAvatar(p?.avatar);
    if (p?.avatar?.kind === "photo") lastPhoto.current = p.avatar.dataUrl;
    loaded.current = true;
  }, []);
  useEffect(() => () => {
    if (nameTimer.current) clearTimeout(nameTimer.current);
  }, []);

  /** Saves now (a picture change) or shortly after typing stops (the name). An empty name isn't saved. */
  function save(nextName: string, nextAvatar: Avatar | undefined, delay = 0) {
    if (nameTimer.current) clearTimeout(nameTimer.current);
    const write = () => {
      const trimmed = nextName.trim();
      if (!trimmed) return;
      saveProfile(nextAvatar ? { name: trimmed, avatar: nextAvatar } : { name: trimmed });
    };
    if (delay) nameTimer.current = setTimeout(write, delay);
    else write();
  }

  function pick(next: Avatar | undefined) {
    setAvatar(next);
    setPhotoError(false);
    save(name, next);
  }

  function choose(kind: Kind) {
    if (kind === "initial") pick({ kind: "initial", color: avatar?.kind === "initial" ? avatar.color : AVATAR_COLORS[0] });
    else if (kind === "minime") pick({ kind: "minime" });
    else if (lastPhoto.current) pick({ kind: "photo", dataUrl: lastPhoto.current });
    else fileRef.current?.click();
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await photoDataUrl(file);
      lastPhoto.current = dataUrl;
      pick({ kind: "photo", dataUrl });
    } catch {
      setPhotoError(true);
    }
  }

  const kind: Kind = avatar?.kind ?? "initial";
  const shownName = name.trim() || tr("account.you");
  const tile = (on: boolean) =>
    `flex flex-col items-center gap-2 rounded-lg border px-3 pb-2.5 pt-3 text-[12px] transition-colors ${
      on ? "border-[var(--m-accent)] bg-[var(--m-accent-soft)] text-[var(--m-text)]" : "border-[var(--m-border-subtle)] text-[var(--m-text-muted)] hover:border-[var(--m-border)] hover:text-[var(--m-text)]"
    }`;

  return (
    <div className="space-y-4">
      {/* How you'll appear, as in the sidebar */}
      <div className="flex items-center gap-4 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
        <ProfileAvatar avatar={avatar} name={shownName} size={56} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-[var(--m-text)]">{shownName}</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--m-text-faint)]">{tr("settings.profile.previewHint")}</p>
        </div>
      </div>

      <Card title={tr("settings.profile.name")} hint={tr("settings.profile.nameHint")}>
        <input
          type="text"
          value={name}
          maxLength={60}
          placeholder={tr("settings.profile.namePlaceholder")}
          aria-label={tr("settings.profile.name")}
          onChange={(e) => {
            setName(e.target.value);
            if (loaded.current) save(e.target.value, avatar, NAME_SAVE_DELAY_MS);
          }}
          onBlur={() => save(name, avatar)}
          className="w-full rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2 text-[13px] text-[var(--m-text)] outline-none focus:border-[var(--m-accent)]"
        />
        {!name.trim() && loaded.current && <p className="text-[11px] text-[var(--m-text-faint)]">{tr("settings.profile.nameEmpty")}</p>}
      </Card>

      <Card title={tr("settings.profile.picture")} hint={tr("settings.profile.pictureHint")}>
        <div role="radiogroup" aria-label={tr("settings.profile.picture")} className="grid grid-cols-3 gap-2">
          <button type="button" role="radio" aria-checked={kind === "initial"} onClick={() => choose("initial")} className={tile(kind === "initial")}>
            <ProfileAvatar avatar={{ kind: "initial", color: avatar?.kind === "initial" ? avatar.color : AVATAR_COLORS[0] }} name={shownName} size={40} />
            {tr("settings.profile.initial")}
          </button>
          <button type="button" role="radio" aria-checked={kind === "minime"} onClick={() => choose("minime")} className={tile(kind === "minime")}>
            <ProfileAvatar avatar={{ kind: "minime" }} name={shownName} size={40} />
            {tr("settings.profile.miniMe")}
          </button>
          <button type="button" role="radio" aria-checked={kind === "photo"} onClick={() => choose("photo")} className={tile(kind === "photo")}>
            {lastPhoto.current ? (
              <ProfileAvatar avatar={{ kind: "photo", dataUrl: lastPhoto.current }} name={shownName} size={40} />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-[var(--m-border)] text-[18px] leading-none text-[var(--m-text-faint)]">+</span>
            )}
            {tr("settings.profile.photo")}
          </button>
        </div>

        {kind === "initial" && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-[12px] text-[var(--m-text)]">{tr("settings.profile.colour")}</span>
            <div role="radiogroup" aria-label={tr("settings.profile.colour")} className="flex gap-1.5">
              {AVATAR_COLORS.map((c) => {
                const on = avatar?.kind === "initial" ? avatar.color === c : c === AVATAR_COLORS[0];
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={c}
                    onClick={() => pick({ kind: "initial", color: c })}
                    style={{ background: c }}
                    className={`h-6 w-6 rounded-full outline-none ring-offset-2 ring-offset-[var(--m-surface)] transition ${on ? "ring-2 ring-[var(--m-text)]" : "hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--m-accent)]"}`}
                  />
                );
              })}
            </div>
          </div>
        )}
        {kind === "minime" && <p className="text-[11.5px] leading-snug text-[var(--m-text-faint)]">{tr("settings.profile.miniMeHint")}</p>}
        {kind === "photo" && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-[11.5px] text-[var(--m-text-faint)]">{tr("settings.profile.photoHint")}</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="shrink-0 rounded-md border border-[var(--m-border-subtle)] px-2.5 py-1 text-[12px] text-[var(--m-text)] hover:border-[var(--m-border)]"
            >
              {tr("settings.profile.replacePhoto")}
            </button>
          </div>
        )}
        {photoError && <p className="text-[11.5px] text-red-400">{tr("settings.profile.photoError")}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void onPhoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Card>
    </div>
  );
}
