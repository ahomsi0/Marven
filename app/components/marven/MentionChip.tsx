"use client";

import type { Mention } from "@/types";
import { FileIcon, FolderIcon, SearchIcon, GlobeIcon } from "./Icons";

interface MentionChipProps {
  mention: Mention;
  onRemove: () => void;
}

function labelFor(m: Mention): string {
  switch (m.kind) {
    case "file":   return `@file ${m.path}`;
    case "folder": return `@folder ${m.path}`;
    case "codebase": return `@codebase "${m.query}"`;
    case "web": {
      // Trim protocol for readability.
      const trimmed = m.url.replace(/^https?:\/\//, "");
      return `@web ${trimmed}`;
    }
  }
}

function IconFor({ kind }: { kind: Mention["kind"] }) {
  switch (kind) {
    case "file":     return <FileIcon />;
    case "folder":   return <FolderIcon />;
    case "codebase": return <SearchIcon />;
    case "web":      return <GlobeIcon />;
  }
}

export function MentionChip({ mention, onRemove }: MentionChipProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        background: "var(--m-surface, rgba(127,127,127,0.12))",
        border: "1px solid var(--m-border, rgba(127,127,127,0.25))",
        color: "var(--m-text, inherit)",
        maxWidth: 320,
      }}
      title={labelFor(mention)}
    >
      <span aria-hidden style={{ display: "inline-flex" }}><IconFor kind={mention.kind} /></span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {labelFor(mention)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        style={{
          marginLeft: 2,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontSize: 14,
          lineHeight: 1,
          color: "inherit",
          opacity: 0.7,
        }}
      >
        ×
      </button>
    </span>
  );
}
