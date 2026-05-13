import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// macOS voices in preference order — all use the high-quality neural engine
const VOICE_FALLBACKS = ["Daniel", "Karen", "Samantha", "Alex"];

export async function POST(req: NextRequest) {
  let body: { text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "No text" }, { status: 400 });

  const voice = body.voice ?? "Daniel";
  const tmpDir = os.tmpdir();
  const id = `marven_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const txtFile = path.join(tmpDir, `${id}.txt`);
  const aiffFile = path.join(tmpDir, `${id}.aiff`);
  const mp3File = path.join(tmpDir, `${id}.mp3`);

  try {
    // Write to file — avoids shell-injection and CLI length limits
    fs.writeFileSync(txtFile, text, "utf8");

    // Try preferred voice, fall back through the list
    let generated = false;
    const voices = voice === "Daniel" ? VOICE_FALLBACKS : [voice, ...VOICE_FALLBACKS];
    for (const v of voices) {
      try {
        await execAsync(`say -v "${v}" -f "${txtFile}" -o "${aiffFile}"`);
        generated = true;
        break;
      } catch {
        // try next voice
      }
    }

    if (!generated) {
      return NextResponse.json({ error: "No suitable voice found" }, { status: 500 });
    }

    // Convert AIFF → MP3 using macOS built-in afconvert (no ffmpeg needed)
    await execAsync(`afconvert "${aiffFile}" "${mp3File}" -d mp3 -f 'MPG3'`);

    const buffer = fs.readFileSync(mp3File);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    for (const f of [txtFile, aiffFile, mp3File]) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  }
}
