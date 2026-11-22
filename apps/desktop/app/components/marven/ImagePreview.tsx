"use client";

// Renders an image file inside the editor's tab content area. The image is
// fetched through /api/workspace/files/raw which streams bytes with the
// correct Content-Type so the browser renders it natively (no need to
// base64-encode through the JSON pipe).

import { useEffect, useState } from "react";

interface ImagePreviewProps {
  path: string;
  name: string;
  workspaceRoot?: string | null;
}

export function ImagePreview({ path, name, workspaceRoot }: ImagePreviewProps) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const src = `/api/workspace/files/raw?path=${encodeURIComponent(path)}${
    workspaceRoot ? `&root=${encodeURIComponent(workspaceRoot)}` : ""
  }`;

  // Re-key on path so the <img> remounts when the user switches tabs to a
  // different image. Otherwise the previous image flashes momentarily.
  useEffect(() => {
    setDims(null);
    setError(null);
  }, [path]);

  return (
    <div className="flex h-full w-full flex-col bg-[var(--m-bg)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--m-border-subtle)] px-4 py-1.5 text-[10px] text-[var(--m-text-faint)]">
        <span className="font-mono">{name}</span>
        {dims && <span className="font-mono">{dims.w} × {dims.h}px</span>}
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {error ? (
          <p className="font-mono text-[11px] text-red-400">{error}</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={path}
            src={src}
            alt={name}
            className="max-h-full max-w-full"
            style={{ imageRendering: "auto" }}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDims({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError("Could not load image — is the file still on disk?")}
          />
        )}
      </div>
    </div>
  );
}
