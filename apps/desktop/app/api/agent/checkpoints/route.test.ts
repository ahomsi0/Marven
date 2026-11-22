import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";
import type { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { CHECKPOINT_TOO_LARGE, clearCheckpoints, recordCheckpoint } from "@/lib/agent/checkpointStore";
import { setActiveWorkspaceRoot } from "@/lib/workspaceState";

let workspaceRoot: string;

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "marven-checkpoints-"));
  setActiveWorkspaceRoot(workspaceRoot);
  clearCheckpoints();
});

afterEach(() => {
  clearCheckpoints();
  setActiveWorkspaceRoot(null);
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("agent checkpoint routes", () => {
  it("does not expose checkpoints recorded outside the active workspace", async () => {
    const outside = join(tmpdir(), `${basename(workspaceRoot)}-outside-secret.txt`);
    writeFileSync(outside, "secret", "utf8");
    recordCheckpoint(outside, "secret");

    const body = await (await GET()).json();
    expect(body.items).toEqual([]);
    rmSync(outside, { force: true });
  });

  it("does not restore a large-file marker as file contents", async () => {
    const target = join(workspaceRoot, "large.txt");
    recordCheckpoint(target, CHECKPOINT_TOO_LARGE);

    const response = await POST(makeReq({ path: target, action: "revert" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("too large") });
  });
});
