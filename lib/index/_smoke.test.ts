import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

describe("native deps", () => {
  it("opens sqlite and loads sqlite-vec extension", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    const row = db.prepare("SELECT vec_version() AS v").get() as { v: string };
    expect(typeof row.v).toBe("string");
    expect(row.v.length).toBeGreaterThan(0);
    db.close();
  });

  it("creates a vec0 virtual table", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    db.exec("CREATE VIRTUAL TABLE v USING vec0(embedding float[8])");
    db.prepare("INSERT INTO v(rowid, embedding) VALUES (?, ?)").run(
      BigInt(1),
      Buffer.from(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]).buffer),
    );
    const row = db.prepare("SELECT COUNT(*) AS n FROM v").get() as { n: number };
    expect(row.n).toBe(1);
    db.close();
  });
});
