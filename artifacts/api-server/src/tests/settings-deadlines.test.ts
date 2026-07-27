import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import { settingsTable, seasonDeadlinesTable } from "@workspace/db/schema";

function agent() {
  return request(app);
}

beforeAll(async () => {
  process.env["DEV_SKIP_AUTH"] = "true";
  await db.delete(settingsTable);
  await db.delete(seasonDeadlinesTable);
});

afterAll(async () => {
  await db.delete(settingsTable);
  await db.delete(seasonDeadlinesTable);
});

// ── GET /settings ──────────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  it("returns default target 10 when no setting stored", async () => {
    await db.delete(settingsTable);
    const res = await agent().get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.weekly_target).toBe(10);
  });

  it("returns stored value", async () => {
    await db.insert(settingsTable).values({ key: "weekly_target", value: "25" });
    const res = await agent().get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.weekly_target).toBe(25);
    await db.delete(settingsTable);
  });
});

// ── PUT /settings ──────────────────────────────────────────────────────────────

describe("PUT /api/settings", () => {
  it("stores and returns the new target", async () => {
    const res = await agent().put("/api/settings").send({ weekly_target: 20 });
    expect(res.status).toBe(200);
    expect(res.body.weekly_target).toBe(20);
    // Verify persisted
    const check = await agent().get("/api/settings");
    expect(check.body.weekly_target).toBe(20);
  });

  it("upserts when called twice", async () => {
    await agent().put("/api/settings").send({ weekly_target: 5 });
    const res = await agent().put("/api/settings").send({ weekly_target: 30 });
    expect(res.status).toBe(200);
    expect(res.body.weekly_target).toBe(30);
  });

  it("422 when weekly_target is missing", async () => {
    const res = await agent().put("/api/settings").send({});
    expect(res.status).toBe(422);
  });

  it("422 when weekly_target is not an integer", async () => {
    const res = await agent().put("/api/settings").send({ weekly_target: 3.5 });
    expect(res.status).toBe(422);
  });

  it("422 when weekly_target is 0", async () => {
    const res = await agent().put("/api/settings").send({ weekly_target: 0 });
    expect(res.status).toBe(422);
  });

  it("422 when weekly_target exceeds 1000", async () => {
    const res = await agent().put("/api/settings").send({ weekly_target: 1001 });
    expect(res.status).toBe(422);
  });

  it("accepts boundary values 1 and 1000", async () => {
    expect((await agent().put("/api/settings").send({ weekly_target: 1 })).status).toBe(200);
    expect((await agent().put("/api/settings").send({ weekly_target: 1000 })).status).toBe(200);
  });
});

// ── GET /deadlines ─────────────────────────────────────────────────────────────

describe("GET /api/deadlines", () => {
  it("returns empty array initially", async () => {
    await db.delete(seasonDeadlinesTable);
    const res = await agent().get("/api/deadlines");
    expect(res.status).toBe(200);
    expect(res.body.deadlines).toEqual([]);
  });
});

// ── POST /deadlines ────────────────────────────────────────────────────────────

describe("POST /api/deadlines", () => {
  it("creates a manual deadline", async () => {
    const res = await agent().post("/api/deadlines").send({
      company: "Acme",
      program: "SWE Intern",
      opens_date: "2026-09-01",
      closes_date: "2026-10-01",
      url: "https://acme.com/jobs",
      notes: "priority",
    });
    expect(res.status).toBe(201);
    expect(res.body.deadline.company).toBe("Acme");
    expect(res.body.deadline.program).toBe("SWE Intern");
    expect(res.body.deadline.opens_date).toBe("2026-09-01");
    expect(res.body.deadline.closes_date).toBe("2026-10-01");
    expect(res.body.deadline.source).toBe("manual");
    expect(res.body.deadline.id).toBeTypeOf("number");
  });

  it("accepts source 'import' (Undo restore of imported row)", async () => {
    const res = await agent().post("/api/deadlines").send({
      company: "RestoredCo",
      source: "import",
    });
    expect(res.status).toBe(201);
    expect(res.body.deadline.source).toBe("import");
  });

  it("422 when source is invalid", async () => {
    const res = await agent().post("/api/deadlines").send({
      company: "BadSourceCo",
      source: "csv",
    });
    expect(res.status).toBe(422);
  });

  it("422 when company is missing", async () => {
    const res = await agent().post("/api/deadlines").send({ program: "SWE" });
    expect(res.status).toBe(422);
  });

  it("422 when company is empty string", async () => {
    const res = await agent().post("/api/deadlines").send({ company: "  " });
    expect(res.status).toBe(422);
  });

  it("422 when opens_date is invalid format", async () => {
    const res = await agent().post("/api/deadlines").send({ company: "X", opens_date: "not-a-date" });
    expect(res.status).toBe(422);
  });

  it("accepts null dates", async () => {
    const res = await agent().post("/api/deadlines").send({
      company: "NullCo",
      opens_date: null,
      closes_date: null,
    });
    expect(res.status).toBe(201);
    expect(res.body.deadline.opens_date).toBeNull();
    expect(res.body.deadline.closes_date).toBeNull();
  });
});

// ── PATCH /deadlines/:id ───────────────────────────────────────────────────────

describe("PATCH /api/deadlines/:id", () => {
  it("updates a deadline", async () => {
    const created = await agent().post("/api/deadlines").send({ company: "PatchCo" });
    const id = created.body.deadline.id as number;

    const res = await agent().patch(`/api/deadlines/${id}`).send({
      company: "PatchCo Updated",
      closes_date: "2026-12-31",
    });
    expect(res.status).toBe(200);
    expect(res.body.deadline.company).toBe("PatchCo Updated");
    expect(res.body.deadline.closes_date).toBe("2026-12-31");
  });

  it("404 for non-existent id", async () => {
    const res = await agent().patch("/api/deadlines/999999").send({ company: "X" });
    expect(res.status).toBe(404);
  });

  it("422 for non-integer id", async () => {
    const res = await agent().patch("/api/deadlines/abc").send({ company: "X" });
    expect(res.status).toBe(422);
  });

  it("422 when no updatable fields provided", async () => {
    const created = await agent().post("/api/deadlines").send({ company: "NoFields" });
    const id = created.body.deadline.id as number;
    const res = await agent().patch(`/api/deadlines/${id}`).send({});
    expect(res.status).toBe(422);
  });
});

// ── DELETE /deadlines/:id ──────────────────────────────────────────────────────

describe("DELETE /api/deadlines/:id", () => {
  it("deletes a deadline (204)", async () => {
    const created = await agent().post("/api/deadlines").send({ company: "DeleteMe" });
    const id = created.body.deadline.id as number;

    const res = await agent().delete(`/api/deadlines/${id}`);
    expect(res.status).toBe(204);

    // Verify gone
    const list = await agent().get("/api/deadlines");
    const ids = list.body.deadlines.map((d: { id: number }) => d.id);
    expect(ids).not.toContain(id);
  });

  it("404 for non-existent id", async () => {
    const res = await agent().delete("/api/deadlines/999999");
    expect(res.status).toBe(404);
  });

  it("422 for non-integer id like 'abc'", async () => {
    const res = await agent().delete("/api/deadlines/abc");
    expect(res.status).toBe(422);
  });

  it("422 for float id like '1.5'", async () => {
    const res = await agent().delete("/api/deadlines/1.5");
    expect(res.status).toBe(422);
  });
});

// ── POST /deadlines/csv-import ────────────────────────────────────────────────

describe("POST /api/deadlines/csv-import", () => {
  it("imports valid CSV", async () => {
    await db.delete(seasonDeadlinesTable);
    const csv = [
      "company,program,opens_date,closes_date,url,notes",
      "Alpha Corp,SWE Intern,2026-09-01,2026-10-15,https://alpha.com,notes1",
      "Beta Inc,PM,2026-10-01,2026-11-01,,",
    ].join("\n");

    const res = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.errors).toHaveLength(0);

    const list = await agent().get("/api/deadlines");
    expect(list.body.deadlines).toHaveLength(2);
    const alpha = list.body.deadlines.find((d: { company: string }) => d.company === "Alpha Corp");
    expect(alpha?.source).toBe("import");
    expect(alpha?.opens_date).toBe("2026-09-01");
    expect(alpha?.closes_date).toBe("2026-10-15");
  });

  it("skips rows with empty company", async () => {
    await db.delete(seasonDeadlinesTable);
    const csv = [
      "company,program",
      ",No Company",
      "Real Co,Program A",
    ].join("\n");

    const res = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatch(/company is empty/);
  });

  it("accepts CRLF line endings", async () => {
    await db.delete(seasonDeadlinesTable);
    const csv = "company,program\r\nCRLF Corp,Test\r\n";
    const res = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
  });

  it("422 when csv field is missing", async () => {
    const res = await agent().post("/api/deadlines/csv-import").send({});
    expect(res.status).toBe(422);
  });

  it("422 when csv is empty", async () => {
    const res = await agent().post("/api/deadlines/csv-import").send({ csv: "" });
    expect(res.status).toBe(422);
  });

  it("422 when company column is absent from header", async () => {
    const csv = "program,url\nSWE Intern,https://x.com";
    const res = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/company/);
  });

  it("handles quoted fields with commas", async () => {
    await db.delete(seasonDeadlinesTable);
    const csv = `company,program\n"Smith, Jones & Co","Dev, Lead"\n`;
    const res = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    const list = await agent().get("/api/deadlines");
    expect(list.body.deadlines[0].company).toBe("Smith, Jones & Co");
  });

  it("re-importing the same CSV skips duplicates instead of re-inserting", async () => {
    await db.delete(seasonDeadlinesTable);
    const csv = [
      "company,program,opens_date,closes_date",
      "Dup Corp,SWE,2026-09-01,2026-10-15",
      "Other Inc,PM,2026-10-01,2026-11-01",
    ].join("\n");

    const first = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(first.body.inserted).toBe(2);
    expect(first.body.duplicates).toBe(0);

    const second = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(second.status).toBe(200);
    expect(second.body.inserted).toBe(0);
    expect(second.body.duplicates).toBe(2);

    const list = await agent().get("/api/deadlines");
    expect(list.body.deadlines).toHaveLength(2);
  });

  it("dedupes duplicate rows within a single CSV and matches company case-insensitively", async () => {
    await db.delete(seasonDeadlinesTable);
    const csv = [
      "company,program,opens_date,closes_date",
      "Same Co,SWE,2026-09-01,2026-10-15",
      "SAME CO,swe,2026-09-01,2026-10-15",
      "Same Co,SWE,2026-09-02,2026-10-15",
    ].join("\n");

    const res = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.duplicates).toBe(1);
  });

  it("ignores non-matching date formats (stores as null)", async () => {
    await db.delete(seasonDeadlinesTable);
    // Both dates don't match YYYY-MM-DD pattern → stored as null
    const csv = "company,opens_date,closes_date\nBadDates,notadate,jan-10-2026";
    const res = await agent().post("/api/deadlines/csv-import").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    const list = await agent().get("/api/deadlines");
    expect(list.body.deadlines[0].opens_date).toBeNull();
    expect(list.body.deadlines[0].closes_date).toBeNull();
  });
});
