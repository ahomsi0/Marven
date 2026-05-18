"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { blobToFloat32Mono16k, getLocalSttPipeline } from "@/lib/localStt";

export type VoiceState = "idle" | "wake-listening" | "command-listening";
export type SttProvider = "groq" | "local";

// Wake match — must be at the START of the transcription (no scattered match
// in mid-sentence). "hey/ok/okay" prefix optional but recommended; the name
// itself is constrained to plausible mishearings of "Marven" (marvin, mervin)
// so we stop triggering on "Martin", "maven", or "Marvell" in regular speech.
const WAKE_WORD_REGEX =
  /^\s*[,.!?]*\s*(?:(?:hey|ok|okay)\s*[,.]?\s*)?(?:marv|merv)(?:en|in|yn|on|an)?\b/i;

const SPEECH_THRESHOLD = 0.006; // RMS above = speaking
const SPEECH_END_MS    = 600;   // ms of silence that ends an utterance
const CMD_SILENCE_MS   = 2000;  // ms of silence that ends command recording

function hasWakeWord(t: string) { return WAKE_WORD_REGEX.test(t); }
function stripWakeWord(t: string) {
  return t.replace(WAKE_WORD_REGEX, "").replace(/^[\s,.:;!?-]+/, "").trim();
}

function preferredMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", ""])
    if (!m || MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

async function transcribeBlob(
  blob: Blob,
  prompt?: string,
  provider: SttProvider = "groq",
): Promise<{ text: string; error?: string }> {
  // ~1 KB is roughly half a second of Opus audio. Below that Groq's STT often
  // rejects the upload with "could not process file - is it a valid media
  // file?" — silently skip so we don't show a confusing dev-overlay error.
  if (blob.size < 1024) {
    console.warn("[stt] blob too small:", blob.size, "bytes — skipping");
    return { text: "" };
  }

  // ── Local Whisper via transformers.js (WASM, fully offline after first model
  //    download). Falls back to the Groq path on unexpected failure so the user
  //    still has a chance to hear a response. ──
  if (provider === "local") {
    try {
      const audio = await blobToFloat32Mono16k(blob);
      const pipe  = await getLocalSttPipeline();
      const { text } = await pipe(audio);
      return { text };
    } catch (e) {
      console.error("[stt] local STT failed:", e);
      return { text: "", error: e instanceof Error ? e.message : "local STT failed" };
    }
  }

  const ext  = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "mp4" : "webm";
  const form = new FormData();
  form.append("audio", new File([blob], `audio.${ext}`, { type: blob.type }));
  if (prompt) form.append("prompt", prompt);
  try {
    const res = await fetch("/api/stt", { method: "POST", body: form });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[stt] API error", res.status, errText);
      let message = `STT ${res.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error) message = parsed.error;
      } catch { /* not json */ }
      if (res.status === 500 && /api key/i.test(message)) {
        message = "Groq API key missing — add it in Settings → API Keys";
      }
      return { text: "", error: message };
    }
    const data = await res.json();
    return { text: (data.text ?? "").trim() };
  } catch (e) {
    console.error("[stt] fetch error:", e);
    return { text: "", error: e instanceof Error ? e.message : "network error" };
  }
}

export function useVoice(
  onCommand: (text: string) => void,
  onWakeWordDetected?: () => void,
  onInterimTranscript?: (text: string) => void,
) {
  const [voiceState, setVoiceState]   = useState<VoiceState>("idle");
  const [isSupported, setIsSupported] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [voiceError, setVoiceError]   = useState<string | null>(null);
  const [lastHeard, setLastHeard]     = useState<string>("");
  // Mirror of sttProviderRef.current as React state so consumers (e.g. the
  // InputBar badge) re-render when the user flips the setting.
  const [sttProvider, setSttProvider] = useState<SttProvider>("local");

  const wakeEnabledRef = useRef(false);
  const onCommandRef   = useRef(onCommand);           onCommandRef.current   = onCommand;
  const onWakeRef      = useRef(onWakeWordDetected);  onWakeRef.current      = onWakeWordDetected;
  const onInterimRef   = useRef(onInterimTranscript); onInterimRef.current   = onInterimTranscript;

  // ── STT provider preference ───────────────────────────────────────────────
  // Default to "local" — wake-word transcription runs on the user's machine
  // unless they opt back into Groq Cloud. Loaded from Electron settings on
  // mount and refreshed when settings-changed events fire.
  const sttProviderRef = useRef<SttProvider>("local");
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = typeof window !== "undefined" ? (window as any).marvenElectron : null;
    if (!electron?.getSettings) return;

    const load = () => {
      electron.getSettings().then((s: { voiceSttProvider?: string }) => {
        const next: SttProvider = s?.voiceSttProvider === "groq" ? "groq" : "local";
        sttProviderRef.current = next;
        setSttProvider(next);
      }).catch(() => { /* keep default */ });
    };
    load();

    // Listen for in-app settings changes so flipping the provider in Settings
    // takes effect without a reload.
    const handler = () => load();
    window.addEventListener("marven:settings-changed", handler);
    return () => window.removeEventListener("marven:settings-changed", handler);
  }, []);

  // ── Wake state ────────────────────────────────────────────────────────────
  const wakeActiveRef  = useRef(false);
  const wakeStreamRef  = useRef<MediaStream | null>(null);
  const wakeRecRef     = useRef<MediaRecorder | null>(null);  // current utterance recorder
  const wakeRafRef     = useRef<number>(0);
  const wakeAudioRef   = useRef<{ ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array } | null>(null);
  const wakeSilStart   = useRef<number>(0);
  const wakeSpeaking   = useRef(false);
  const wakeChecking   = useRef(false);
  const wakeMime       = useRef<string>("");
  const wakeChunks     = useRef<Blob[]>([]);

  // ── Command state ─────────────────────────────────────────────────────────
  const cmdActiveRef   = useRef(false);
  const cmdStreamRef   = useRef<MediaStream | null>(null);
  const cmdRecRef      = useRef<MediaRecorder | null>(null);
  const cmdChunksRef   = useRef<Blob[]>([]);
  const cmdRafRef      = useRef<number>(0);
  const cmdAudioRef    = useRef<{ ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array } | null>(null);
  const cmdSilStart    = useRef<number>(0);
  const cmdSpeaking    = useRef(false);

  useEffect(() => { setIsSupported(!!navigator.mediaDevices?.getUserMedia); }, []);

  // ── Stop wake ──────────────────────────────────────────────────────────────
  const stopWakeListener = useCallback(() => {
    wakeActiveRef.current = false;
    cancelAnimationFrame(wakeRafRef.current);
    if (wakeAudioRef.current) {
      try { wakeAudioRef.current.ctx.close(); } catch { /**/ }
      wakeAudioRef.current = null;
    }
    if (wakeRecRef.current?.state !== "inactive") try { wakeRecRef.current?.stop(); } catch { /**/ }
    wakeRecRef.current = null;
    wakeStreamRef.current?.getTracks().forEach(t => t.stop());
    wakeStreamRef.current = null;
    wakeChunks.current = [];
    wakeSpeaking.current = false;
    wakeChecking.current = false;
    wakeSilStart.current = 0;
  }, []);

  // ── Stop command ───────────────────────────────────────────────────────────
  const stopCommandCapture = useCallback(() => {
    cmdActiveRef.current = false;
    cancelAnimationFrame(cmdRafRef.current);
    if (cmdAudioRef.current) {
      try { cmdAudioRef.current.ctx.close(); } catch { /**/ }
      cmdAudioRef.current = null;
    }
    if (cmdRecRef.current?.state !== "inactive") try { cmdRecRef.current?.stop(); } catch { /**/ }
    cmdStreamRef.current?.getTracks().forEach(t => t.stop());
    cmdStreamRef.current = null; cmdRecRef.current = null; cmdChunksRef.current = [];
  }, []);

  // ── Start a fresh MediaRecorder on the shared stream ──────────────────────
  // Strategy: one stream, one AudioContext (VAD), new MediaRecorder per utterance.
  // Stopping the recorder flushes a *complete* valid WebM blob — no header issues.
  const startWakeListener = useCallback(() => {
    if (wakeActiveRef.current) return;
    wakeActiveRef.current = true;
    wakeSpeaking.current  = false;
    wakeChecking.current  = false;
    wakeSilStart.current  = 0;
    wakeChunks.current    = [];

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (!wakeActiveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      wakeStreamRef.current = stream;
      wakeMime.current = preferredMime();

      // ── AudioContext VAD ───────────────────────────────────────────────────
      const ctx      = new AudioContext();
      const src      = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      wakeAudioRef.current = { ctx, analyser, buf };

      // ── Start the initial utterance recorder ───────────────────────────────
      function startRec() {
        if (!wakeActiveRef.current) return;
        const mime = wakeMime.current;
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        wakeRecRef.current = mr;
        wakeChunks.current = [];
        mr.ondataavailable = e => { if (e.data.size > 0) wakeChunks.current.push(e.data); };
        mr.start(100);
      }
      startRec();

      // ── RAF VAD loop ───────────────────────────────────────────────────────
      const tick = () => {
        if (!wakeActiveRef.current) return;

        analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
        const now = Date.now();

        if (rms > SPEECH_THRESHOLD) {
          wakeSpeaking.current = true;
          wakeSilStart.current = 0;
        } else if (wakeSpeaking.current) {
          if (!wakeSilStart.current) wakeSilStart.current = now;

          if (now - wakeSilStart.current >= SPEECH_END_MS && !wakeChecking.current) {
            wakeSpeaking.current = false;
            wakeSilStart.current = 0;
            wakeChecking.current = true;

            // Stop current recorder — onstop gives us a complete valid WebM
            const mr = wakeRecRef.current;
            if (!mr || mr.state === "inactive") {
              wakeChecking.current = false;
              wakeRafRef.current = requestAnimationFrame(tick);
              return;
            }

            const capturedChunks = wakeChunks.current;
            const capturedMime   = wakeMime.current || "audio/webm";
            wakeChunks.current   = [];
            wakeRecRef.current   = null;

            mr.onstop = () => {
              // Build the blob from a completed recording — guaranteed valid WebM
              const blob = new Blob(capturedChunks, { type: capturedMime });
              console.log("[wake] blob", blob.size, "bytes,", capturedChunks.length, "chunks");

              // Start the next recorder immediately so we never miss audio
              startRec();

              transcribeBlob(blob, "Hey Marven, Hey Marvin", sttProviderRef.current)
                .then(({ text, error }) => {
                  if (!wakeActiveRef.current) return;
                  wakeChecking.current = false;
                  if (error) {
                    console.error("[wake] transcribe error:", error);
                    setVoiceError(error);
                    return;
                  }
                  console.log("[wake] whisper →", JSON.stringify(text));
                  setLastHeard(text || "(empty)");

                  if (hasWakeWord(text)) {
                    stopWakeListener();
                    onWakeRef.current?.();
                    const rest = stripWakeWord(text);
                    if (rest.length > 1) {
                      onCommandRef.current(rest);
                      setTimeout(() => { if (wakeEnabledRef.current) startWakeListener(); }, 500);
                    } else {
                      startCommandCapture();
                    }
                  }
                })
                .catch(() => { if (wakeActiveRef.current) wakeChecking.current = false; });
            };

            try { mr.stop(); } catch { wakeChecking.current = false; startRec(); }
          }
        }

        wakeRafRef.current = requestAnimationFrame(tick);
      };
      wakeRafRef.current = requestAnimationFrame(tick);

    }).catch(err => {
      wakeActiveRef.current = false;
      setVoiceError(err?.message ?? "mic-denied");
      setVoiceState("idle");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopWakeListener]);

  // ── Command capture ────────────────────────────────────────────────────────
  const startCommandCapture = useCallback(() => {
    if (cmdActiveRef.current) return;
    cmdActiveRef.current = true;
    cmdChunksRef.current = [];
    setVoiceState("command-listening");
    onInterimRef.current?.("Listening...");

    // Reuse the wake stream if available (avoids mic re-acquisition gap)
    const existingStream = wakeStreamRef.current;
    const streamPromise = existingStream
      ? Promise.resolve(existingStream)
      : navigator.mediaDevices.getUserMedia({ audio: true });

    streamPromise.then(stream => {
      if (!cmdActiveRef.current) {
        if (!existingStream) stream.getTracks().forEach(t => t.stop());
        return;
      }
      cmdStreamRef.current = stream;
      const mime = preferredMime();
      const mr   = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      cmdRecRef.current = mr;
      cmdSpeaking.current = false; cmdSilStart.current = 0;

      mr.ondataavailable = e => { if (e.data.size > 0) cmdChunksRef.current.push(e.data); };

      mr.onstop = async () => {
        cancelAnimationFrame(cmdRafRef.current);
        if (cmdAudioRef.current) { try { cmdAudioRef.current.ctx.close(); } catch { /**/ } cmdAudioRef.current = null; }
        // Only stop the stream if we own it (not borrowed from wake listener)
        if (!existingStream) stream.getTracks().forEach(t => t.stop());
        cmdStreamRef.current = null; cmdActiveRef.current = false;

        const blob = new Blob(cmdChunksRef.current, { type: mr.mimeType || "audio/webm" });
        cmdChunksRef.current = [];
        onInterimRef.current?.("");

        const result = await transcribeBlob(blob, undefined, sttProviderRef.current);
        if (result.error) setVoiceError(result.error);
        const clean = (result.text ?? "").trim();
        const cmd   = hasWakeWord(clean) ? stripWakeWord(clean) : clean;
        if (cmd.length > 1) onCommandRef.current(cmd);

        if (wakeEnabledRef.current) { setVoiceState("wake-listening"); startWakeListener(); }
        else setVoiceState("idle");
      };

      mr.start(100);

      const ctx2      = new AudioContext();
      const src2      = ctx2.createMediaStreamSource(stream);
      const analyser2 = ctx2.createAnalyser();
      analyser2.fftSize = 256;
      src2.connect(analyser2);
      const buf2 = new Float32Array(analyser2.fftSize);
      cmdAudioRef.current = { ctx: ctx2, analyser: analyser2, buf: buf2 };

      const cmdTick = () => {
        if (!cmdActiveRef.current) return;
        analyser2.getFloatTimeDomainData(buf2);
        const rms2 = Math.sqrt(buf2.reduce((s, v) => s + v * v, 0) / buf2.length);
        const now2 = Date.now();
        if (rms2 > SPEECH_THRESHOLD) { cmdSpeaking.current = true; cmdSilStart.current = 0; }
        else if (cmdSpeaking.current) {
          if (!cmdSilStart.current) cmdSilStart.current = now2;
          if (now2 - cmdSilStart.current >= CMD_SILENCE_MS) {
            cmdSpeaking.current = false;
            if (mr.state !== "inactive") try { mr.stop(); } catch { /**/ }
            return;
          }
        }
        cmdRafRef.current = requestAnimationFrame(cmdTick);
      };
      cmdRafRef.current = requestAnimationFrame(cmdTick);

    }).catch(err => {
      cmdActiveRef.current = false;
      setVoiceError(err?.message ?? "mic-denied");
      setVoiceState("idle");
      onInterimRef.current?.("");
    });
  }, [startWakeListener]);

  // ── Public controls ────────────────────────────────────────────────────────
  function enableWakeWord() {
    wakeEnabledRef.current = true; setWakeEnabled(true); setVoiceError(null);
    setVoiceState("wake-listening"); startWakeListener();
  }
  function disableWakeWord() {
    wakeEnabledRef.current = false; setWakeEnabled(false);
    stopWakeListener(); stopCommandCapture(); onInterimRef.current?.(""); setVoiceState("idle");
  }
  function toggleWakeWord() { wakeEnabledRef.current ? disableWakeWord() : enableWakeWord(); }

  function startManualListen() {
    if (cmdActiveRef.current) {
      stopCommandCapture(); onInterimRef.current?.("");
      setVoiceState(wakeEnabledRef.current ? "wake-listening" : "idle");
      if (wakeEnabledRef.current) startWakeListener();
    } else { stopWakeListener(); startCommandCapture(); }
  }
  function pauseVoiceCapture() {
    stopWakeListener(); stopCommandCapture(); onInterimRef.current?.(""); setVoiceState("idle");
  }
  function resumeWakeWord() {
    if (!wakeEnabledRef.current || wakeActiveRef.current) return;
    setVoiceState("wake-listening"); startWakeListener();
  }

  useEffect(() => () => {
    wakeEnabledRef.current = false; stopWakeListener(); stopCommandCapture();
  }, [stopWakeListener, stopCommandCapture]);

  return { voiceState, isSupported, wakeEnabled, voiceError, lastHeard, sttProvider, toggleWakeWord, startManualListen, pauseVoiceCapture, resumeWakeWord };
}
