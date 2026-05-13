"use client";

import { useState } from "react";

interface SetupModalProps {
  onSave: (name: string) => void;
}

export function SetupModal({ onSave }: SetupModalProps) {
  const [name, setName] = useState("");

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSubmit();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1a1a1a]">
      {/* Centered panel */}
      <div className="relative flex flex-col items-center gap-8 px-8 py-10 text-center rounded-2xl border border-[#333] bg-[#1e1e1e] max-w-[400px] w-full mx-4">
        <div className="space-y-2">
          <h1 className="text-[20px] font-semibold text-[#d4d4d4]">
            Welcome to Marven
          </h1>
          <p className="text-[14px] text-[#777]">
            What should I call you?
          </p>
        </div>

        <div className="flex w-full flex-col gap-4">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Your name"
            className="border-b border-[#383838] bg-transparent text-[#d4d4d4] text-[16px] focus:border-[#d19a66] outline-none pb-2 w-full placeholder:text-[#555] transition-colors"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="w-full rounded-xl border border-[#d19a66]/30 bg-[#d19a66]/10 px-6 py-2.5 text-[14px] text-[#d19a66] transition-all hover:bg-[#d19a66]/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
