import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { seasonDeadlinesTable } from "@workspace/db/schema";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

type DeadlineRow = typeof seasonDeadlinesTable.$inferSelect;

/** Serialize Drizzle camelCase row to snake_case API shape. */
function ser(d: DeadlineRow) {
  return {
    id: d.id,
    company: d.company,
    program: d.program,
    opens_date: d.opensDate ?? null,
    closes_date: d.closesDate ?? null,
    url: d.url,
    notes: d.notes,
    source: d.source,
  };
}

function strictId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseDate(v: unknown): string | null | undefined {
  // Accept null, undefined, or YYYY-MM-DD strings
  if (v === null || v === undefined) return v as null | undefined;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
    return undefined; // invalid
  }
  return undefined;
}

// ── GET /deadlines — list all ──────────────────────────────────────────────────

router.get("/deadlines", async (_req, res) => {
  const deadlines = await db
    .select()
    .from(seasonDeadlinesTable)
    .orderBy(seasonDeadlinesTable.closesDate, seasonDeadlinesTable.opensDate);
  res.json({ deadlines: deadlines.map(ser) });
});

// ── POST /deadlines — create manual deadline ───────────────────────────────────

router.post("/deadlines", async (req, res) => {
  const { company, program, opens_date, closes_date, url, notes } = req.body ?? {};

  if (!company || typeof company !== "string" || !company.trim()) {
    res.status(422).json({ error: "company is required" });
    return;
  }

  // When the field is omitted (undefined), default to null. Only reject if
  // the field was explicitly provided but is an invalid non-null string.
  const opensDateParsed = opens_date !== undefined ? parseDate(opens_date) : null;
  const closesDateParsed = closes_date !== undefined ? parseDate(closes_date) : null;

  if (opensDateParsed === undefined || closesDateParsed === undefined) {
    res.status(422).json({ error: "opens_date and closes_date must be YYYY-MM-DD or null" });
    return;
  }

  const [row] = await db
    .insert(seasonDeadlinesTable)
    .values({
      company: String(company).trim(),
      program: typeof program === "string" ? program.trim() : "",
      opensDate: opensDateParsed ?? null,
      closesDate: closesDateParsed ?? null,
      url: typeof url === "string" ? url.trim() : "",
      notes: typeof notes === "string" ? notes.trim() : "",
      source: "manual",
    })
    .returning();

  res.status(201).json({ deadline: ser(row!) });
});

// ── PATCH /deadlines/:id — update fields ───────────────────────────────────────

router.patch("/deadlines/:id", async (req, res) => {
  const id = strictId(req.params.id);
  if (!id) {
    res.status(422).json({ error: "id must be a positive integer" });
    return;
  }

  const existing = await db
    .select()
    .from(seasonDeadlinesTable)
    .where(eq(seasonDeadlinesTable.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: "Deadline not found" });
    return;
  }

  const { company, program, opens_date, closes_date, url, notes } = req.body ?? {};
  const updates: Partial<typeof seasonDeadlinesTable.$inferInsert> = {};

  if (company !== undefined) {
    if (typeof company !== "string" || !company.trim()) {
      res.status(422).json({ error: "company must be a non-empty string" });
      return;
    }
    updates.company = company.trim();
  }
  if (program !== undefined) updates.program = typeof program === "string" ? program.trim() : "";
  if (url !== undefined) updates.url = typeof url === "string" ? url.trim() : "";
  if (notes !== undefined) updates.notes = typeof notes === "string" ? notes.trim() : "";

  if (opens_date !== undefined) {
    const parsed = parseDate(opens_date);
    if (parsed === undefined) {
      res.status(422).json({ error: "opens_date must be YYYY-MM-DD or null" });
      return;
    }
    updates.opensDate = parsed ?? null;
  }
  if (closes_date !== undefined) {
    const parsed = parseDate(closes_date);
    if (parsed === undefined) {
      res.status(422).json({ error: "closes_date must be YYYY-MM-DD or null" });
      return;
    }
    updates.closesDate = parsed ?? null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(422).json({ error: "No updatable fields provided" });
    return;
  }

  const [updated] = await db
    .update(seasonDeadlinesTable)
    .set(updates)
    .where(eq(seasonDeadlinesTable.id, id))
    .returning();

  res.json({ deadline: ser(updated!) });
});

// ── DELETE /deadlines/:id ──────────────────────────────────────────────────────

router.delete("/deadlines/:id", async (req, res) => {
  const id = strictId(req.params.id);
  if (!id) {
    res.status(422).json({ error: "id must be a positive integer" });
    return;
  }

  const deleted = await db
    .delete(seasonDeadlinesTable)
    .where(eq(seasonDeadlinesTable.id, id))
    .returning({ id: seasonDeadlinesTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Deadline not found" });
    return;
  }

  res.status(204).send();
});

// ── POST /deadlines/csv-import — bulk import from CSV ─────────────────────────
// Accepts JSON body: { csv: "<raw CSV text>" }
// Columns (in order, header required): company,program,opens_date,closes_date,url,notes

router.post("/deadlines/csv-import", async (req, res) => {
  const { csv } = req.body ?? {};
  if (!csv || typeof csv !== "string") {
    res.status(422).json({ error: "csv field (string) is required" });
    return;
  }

  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    res.status(422).json({ error: "CSV is empty" });
    return;
  }

  // Parse header
  const header = lines[0]!.toLowerCase().split(",").map((h) => h.trim().replace(/['"]/g, ""));
  const requiredCols = ["company"];
  const missing = requiredCols.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    res.status(422).json({ error: `CSV missing required columns: ${missing.join(", ")}` });
    return;
  }

  function col(row: string[], name: string): string {
    const idx = header.indexOf(name);
    if (idx < 0) return "";
    const cell = row[idx] ?? "";
    return cell.replace(/^["']|["']$/g, "").trim();
  }

  const errors: string[] = [];
  const rows: typeof seasonDeadlinesTable.$inferInsert[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Simple CSV parse (handles quoted fields with commas if not nested quotes)
    const fields = parseCSVLine(line);
    const company = col(fields, "company");
    if (!company) {
      errors.push(`Row ${i + 1}: company is empty — skipped`);
      continue;
    }
    const opensRaw = col(fields, "opens_date");
    const closesRaw = col(fields, "closes_date");
    const opensDate = opensRaw && /^\d{4}-\d{2}-\d{2}$/.test(opensRaw) ? opensRaw : null;
    const closesDate = closesRaw && /^\d{4}-\d{2}-\d{2}$/.test(closesRaw) ? closesRaw : null;

    rows.push({
      company,
      program: col(fields, "program"),
      opensDate,
      closesDate,
      url: col(fields, "url"),
      notes: col(fields, "notes"),
      source: "import",
    });
  }

  if (rows.length > 0) {
    await db.insert(seasonDeadlinesTable).values(rows);
  }

  res.json({ inserted: rows.length, errors });
});

/** Simple CSV line parser — handles quoted fields containing commas. */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

export default router;
