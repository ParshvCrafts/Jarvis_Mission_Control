import { Router } from "express";
import { eq, and, ilike, asc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { queueItemsTable } from "@workspace/db/schema";
import { z } from "zod/v4";

const router = Router();

function postedAgeDays(posted: string): number {
  if (!posted) return 0;
  const d = new Date(posted + "T12:00:00");
  if (isNaN(d.getTime())) return 0;
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

// GET /queue
router.get("/queue", async (req, res) => {
  const { filter = "unreviewed", company = "", page = "1", page_size = "50" } =
    req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(page_size) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  if (filter === "unreviewed") {
    conditions.push(eq(queueItemsTable.reviewed, false));
  }
  if (company) {
    conditions.push(ilike(queueItemsTable.company, `%${company}%`));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(queueItemsTable)
      .where(where)
      .orderBy(asc(queueItemsTable.rank))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(queueItemsTable)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  res.json({
    items: items.map((item) => ({
      ...item,
      posted_age_days: postedAgeDays(item.posted),
    })),
    total,
    page: pageNum,
    page_size: pageSize,
  });
});

// PATCH /queue/:id/reviewed
router.patch("/queue/:id/reviewed", async (req, res) => {
  const rawId = req.params.id ?? "";
  // Strict integer check: must be all digits (no leading sign, no decimals, no trailing chars)
  if (!/^\d+$/.test(rawId)) {
    res.status(422).json({ error: "id must be a positive integer" });
    return;
  }
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(422).json({ error: "id must be a positive integer" });
    return;
  }

  const parse = z.object({ reviewed: z.boolean() }).safeParse(req.body);
  if (!parse.success) {
    res.status(422).json({ error: "reviewed (boolean) required" });
    return;
  }

  const [updated] = await db
    .update(queueItemsTable)
    .set({ reviewed: parse.data.reviewed })
    .where(eq(queueItemsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Queue item not found" });
    return;
  }

  res.json({
    item: { ...updated, posted_age_days: postedAgeDays(updated.posted) },
  });
});

export default router;
