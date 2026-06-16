import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_ELEVENLABS_MODEL = "eleven_flash_v2_5";

// macOS voices in preference order — all use the high-quality neural engine
const VOICE_FALLBACKS = ["Daniel", "Karen", "Samantha", "Alex"];
// Arabic voices — macOS ships Maged (Saudi) by default; Tarik may be installed
const ARABIC_VOICE_FALLBACKS = ["Maged", "Tarik", "Majed"];

// Detect Arabic by scanning for Arabic Unicode ranges (Arabic, Arabic Supplement,
// Arabic Extended-A, Arabic Presentation Forms-A/B). If even ~25% of the
// alphabetic characters are Arabic, treat the text as Arabic.
function isArabic(text: string): boolean {
  const arabic = text.match(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g);
  if (!arabic || arabic.length === 0) return false;
  const letters = text.match(/[\p{L}]/gu);
  if (!letters || letters.length === 0) return true;
  return arabic.length / letters.length > 0.25;
}

async function synthesizeWithElevenLabs(text: string, arabic: boolean): Promise<Response | null> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return null;

  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_ELEVENLABS_MODEL;
  const url = `${ELEVENLABS_TTS_URL}/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": key,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      ...(arabic ? { language_code: "ar" } : {}),
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.2,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn(`[tts] ElevenLabs failed (${res.status}):`, err || res.statusText);
    return null;
  }

  const audio = await res.arrayBuffer();
  return new Response(audio, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { text?: string; voice?: string; forceLang?: "ar" | "en" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "No text" }, { status: 400 });

  const arabic = body.forceLang === "ar" || (body.forceLang !== "en" && isArabic(text));
  const ttsProvider = process.env.ELEVENLABS_TTS_PROVIDER?.trim();
  if (ttsProvider === "elevenlabs") {
    try {
      const elevenLabsResponse = await synthesizeWithElevenLabs(text, arabic);
      if (elevenLabsResponse) return elevenLabsResponse;
    } catch (err) {
      console.warn("[tts] ElevenLabs unavailable, falling back:", err instanceof Error ? err.message : err);
    }
  }

  const defaultVoice = arabic ? "Maged" : "Daniel";
  const voice = body.voice ?? defaultVoice;
  const tmpDir = os.tmpdir();
  const id = `marven_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const txtFile = path.join(tmpDir, `${id}.txt`);
  const aiffFile = path.join(tmpDir, `${id}.aiff`);
  const mp3File = path.join(tmpDir, `${id}.mp3`);
  const m4aFile = path.join(tmpDir, `${id}.m4a`);
  let outPath = "";
  let outMime = "";

  try {
    // Write to file — avoids shell-injection and CLI length limits
    fs.writeFileSync(txtFile, text, "utf8");

    // Try preferred voice, fall back through the list (Arabic-first when text is Arabic)
    let generated = false;
    const baseFallbacks = arabic ? ARABIC_VOICE_FALLBACKS : VOICE_FALLBACKS;
    const voices = baseFallbacks.includes(voice) ? baseFallbacks : [voice, ...baseFallbacks];
    for (const v of voices) {
      try {
        await execAsync(`say -v "${v}" -f "${txtFile}" -o "${aiffFile}"`);
        generated = true;
        break;
      } catch (e) {
        console.warn(`[tts] say -v ${v} failed:`, e instanceof Error ? e.message : e);
      }
    }

    if (!generated) {
      return NextResponse.json({ error: "No suitable voice found" }, { status: 500 });
    }

    // Try MP3 first (broadly compatible). macOS 15+ removed MP3 encoding from
    // afconvert, so fall back to AAC/m4a — every browser <audio> supports it.
    try {
      await execAsync(`afconvert "${aiffFile}" "${mp3File}" -d mp3 -f 'MPG3'`);
      outPath = mp3File;
      outMime = "audio/mpeg";
    } catch (mp3Err) {
      console.warn("[tts] mp3 encode failed, falling back to AAC:", mp3Err instanceof Error ? mp3Err.message : mp3Err);
      // AAC in an MPEG-4 container — afconvert ships forever on macOS.
      await execAsync(`afconvert "${aiffFile}" "${m4aFile}" -d aac -f m4af`);
      outPath = m4aFile;
      outMime = "audio/mp4";
    }

    const buffer = fs.readFileSync(outPath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": outMime,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TTS failed";
    console.error("[tts] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    for (const f of [txtFile, aiffFile, mp3File, m4aFile]) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  }
}
