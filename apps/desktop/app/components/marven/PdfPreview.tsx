"use client";

// Renders a PDF inside the tab content area using the browser's built-in
// PDF viewer (Chromium/Electron ship one). The file is served via our raw
// bytes endpoint with the correct Content-Type so <iframe> just works.

interface PdfPreviewProps {
  path: string;
  workspaceRoot?: string | null;
}

export function PdfPreview({ path, workspaceRoot }: PdfPreviewProps) {
  const src = `/api/workspace/files/raw?path=${encodeURIComponent(path)}${
    workspaceRoot ? `&root=${encodeURIComponent(workspaceRoot)}` : ""
  }`;
  return (
    <div className="flex h-full w-full flex-col bg-[var(--m-bg)]">
      <iframe
        key={path}
        src={src}
        className="h-full w-full border-0"
        title={path}
      />
    </div>
  );
}
