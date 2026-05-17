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
        { error: "No Groq API key — add one in Settings → API Keys" },
        { status: 500 }
      );
    }

    // Forward audio to Groq Whisper
    const prompt = formData.get("prompt") as string | null;
    const groqForm = new FormData();
    groqForm.append("file", audio, audio.name || "audio.webm");
    groqForm.append("model", "whisper-large-v3-turbo");
    groqForm.append("response_format", "json");
    groqForm.append("language", "en");
    groqForm.append("temperature", "0");
    // initial_prompt biases Whisper toward expected vocabulary
    if (prompt) groqForm.append("prompt", prompt);

    const res = await fetch(GROQ_STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: groqForm,
    });

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
