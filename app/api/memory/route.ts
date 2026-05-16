import { NextResponse } from "next/server";
import { readMemory, clearMemory } from "@/lib/memoryClient";

export async function GET() {
  try {
    return NextResponse.json({ memory: readMemory() });
  } catch (err) {
    return NextResponse.json(
      { memory: "", error: err instanceof Error ? err.message : "Read failed" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    clearMemory();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Clear failed" },
      { status: 500 }
    );
  }
}
