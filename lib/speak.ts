"use client";

// ─── Text cleanup ─────────────────────────────────────────────────────────────
function cleanForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")          // bold
    .replace(/\*(.*?)\*/g, "$1")               // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, "")        // code
    .replace(/#{1,6}\s/g, "")                  // headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // links → label
    .replace(/^[-*]\s/gm, "")                  // list markers
    .replace(/\n{2,}/g, ". ")                  // paragraph breaks → pause
    .replace(/\n/g, " ")
    .trim();
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
// Fallback: Web Speech API utterance
let currentUtterance: SpeechSynthesisUtterance | null = null;

function cleanupAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function cleanupSpeechSynthesis() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
}

// ─── Fallback: Web Speech API ─────────────────────────────────────────────────
const PREFERRED_VOICES = [
  "Daniel",
  "Karen",
  "Moira",
  "Samantha",
  "Alex",
  "Google UK English Male",
  "Google UK English Female",
  "Google US English",
];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  for (const name of PREFERRED_VOICES) {
    const match = voices.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return (
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

function speakFallback(text: string, onEnd?: () => void): void {
  if (!window.speechSynthesis) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.92;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  utterance.onend = () => {
    currentUtterance = null;
    onEnd?.();
  };

  const go = () => {
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  };

  if (window.speechSynthesis.getVoices().length > 0) {
    go();
  } else {
    window.speechSynthesis.addEventListener("voiceschanged", go, { once: true });
  }
}

// ─── Primary: macOS say → MP3 via /api/tts ───────────────────────────────────
export async function speak(text: string, onEnd?: () => void): Promise<void> {
  if (typeof window === "undefined") return;

  // Cancel whatever is playing
  cleanupAudio();
  cleanupSpeechSynthesis();

  const clean = cleanForSpeech(text);
  if (!clean) {
    onEnd?.();
    return;
  }

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });

    if (!res.ok) throw new Error(`TTS API ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentObjectUrl = url;

    const audio = new Audio(url);
    currentAudio = audio;

    audio.onended = () => {
      cleanupAudio();
      onEnd?.();
    };

    audio.onerror = () => {
      cleanupAudio();
      speakFallback(clean, onEnd);
    };

    await audio.play();
  } catch {
    // API unavailable (e.g. server not running) — fall back gracefully
    speakFallback(clean, onEnd);
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────
export function stopSpeaking(): void {
  cleanupAudio();
  cleanupSpeechSynthesis();
}

export function isSpeaking(): boolean {
  if (currentAudio && !currentAudio.paused) return true;
  if (typeof window !== "undefined" && window.speechSynthesis?.speaking) return true;
  return false;
}
