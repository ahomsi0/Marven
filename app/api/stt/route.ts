// Server-side speech-to-text using Groq Whisper
// Accepts: multipart/form-data with an "audio" file field
// Returns: { text: string }

import { NextRequest, NextResponse } from "next/server";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;

    if (!audio) {
      return NextResponse.json({ text: "" }, { status: 400 });
    }

    const key = process.env.GROQ_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "No Groq API key — add one in Settings → Model APIs" },
        { status: 500 }
      );
    }

    // Forward audio to Groq Whisper. Try models in fallback order in case one
    // is blocked at the org level or temporarily unavailable.
    const prompt = formData.get("prompt") as string | null;
    const audioBytes = await audio.arrayBuffer();

    const MODEL_FALLBACKS = [
      "whisper-large-v3-turbo",       // fastest, best quality (preferred)
      "whisper-large-v3",             // slower, more accurate
      "distil-whisper-large-v3-en",   // English only, very fast (last resort)
    ];

    let res: Response | null = null;
    let lastError = "";
    for (const model of MODEL_FALLBACKS) {
      const groqForm = new FormData();
      groqForm.append("file", new File([audioBytes], audio.name || "audio.webm", { type: audio.type }), audio.name || "audio.webm");
      groqForm.append("model", model);
      groqForm.append("response_format", "json");
      groqForm.append("language", "en");
      groqForm.append("temperature", "0");
      if (prompt) groqForm.append("prompt", prompt);

      const attempt = await fetch(GROQ_STT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: groqForm,
      });
      if (attempt.ok) { res = attempt; break; }
      // If it's an org-block / model-unavailable error, try the next model.
      const body = await attempt.text();
      lastError = body;
      const isModelBlocked = /blocked at the organization|model.*(not available|unavailable|not found)|invalid_request_error.*model/i.test(body);
      if (!isModelBlocked) {
        // Real error (auth, rate limit, etc.) — don't retry other models
        res = attempt;
        // Re-create the response so downstream can still read it
        const rebuilt = new Response(body, { status: attempt.status, headers: attempt.headers });
        res = rebuilt;
        break;
      }
      // Otherwise loop and try the next fallback model
    }
    if (!res) {
      return NextResponse.json(
        { error: `All Whisper models blocked for your Groq org. Enable one at https://console.groq.com/settings/limits` },
        { status: 500 }
      );
    }

    if (!res.ok) {
      const err = await res.text();
      console.error("[STT] Groq error:", res.status, err);
      // Try to pull the actual message out of Groq's JSON response so the UI
      // can surface something useful (instead of just "STT 500").
      let message = `Groq STT ${res.status}`;
      try {
        const parsed = JSON.parse(err);
        const msg = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
        if (typeof msg === "string" && msg) message = msg;
      } catch { /* not JSON */ }
      if (res.status === 401 || /invalid api key|unauthorized/i.test(message)) {
        message = "Groq API key is invalid — check Settings → API Keys";
      } else if (res.status === 429) {
        message = "Groq STT rate-limited — wait a moment and try again";
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text ?? "" });
  } catch (err) {
    console.error("[STT] Unexpected error:", err);
    return NextResponse.json({ text: "" }, { status: 500 });
  }
}
