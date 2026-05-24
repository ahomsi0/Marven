import { NextResponse } from "next/server";
import { cancelRun } from "../_state";

export async function POST() {
  const ok = cancelRun();
  return NextResponse.json({ ok });
}
