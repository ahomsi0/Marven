import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  const screenshotPath = "/tmp/marven_vision.png";
  try {
    let body: { question?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Use default question
    }

    const question =
      body.question ||
      "What do you see on this screen? Describe it concisely.";

    // Take screenshot (non-interactive)
    await execAsync(`screencapture -x ${screenshotPath}`);

    // Read and encode as base64
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64 = imageBuffer.toString("base64");

    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error("GROQ_API_KEY is not set.");
    }

    // Call Groq vision API
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64}` },
              },
              {
                type: "text",
                text: question,
              },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vision API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const reply = (data.choices?.[0]?.message?.content as string ?? "").trim();

    return NextResponse.json({ reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    try {
      if (fs.existsSync(screenshotPath)) {
        fs.unlinkSync(screenshotPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
