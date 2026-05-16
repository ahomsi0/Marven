import { NextResponse } from "next/server";
import { readMemory, clearMemory } from "@/lib/memoryClient";

export function GET() {
  return NextResponse.json({ memory: readMemory() });
}

export function DELETE() {
  clearMemory();
  return NextResponse.json({ ok: true });
}
