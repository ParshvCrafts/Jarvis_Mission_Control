import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod/v4";
import { db, pendingChangesTable } from "@workspace/db";
import { formatPendingCommand } from "../lib/ingestSchema";

const router: IRouter = Router();

// ── Shared schemas ─────────────────────────────────────────────────────────────

const KindSchema = z.enum(["status", "note", "contact", "followup_done"]);
const StateSchema = z.enum(["pending", "copied", "applied", "dismissed"]);

// ── GET /pending-changes ───────────────────────────────────────────────────────

router.get("/pending-changes", async (req: Request, res: Response): Promise<void> => {
  const { state: stateFilter, num: numFilter } = req.query as Record<string, string | undefined>;

  // Build where clause
  const conditions = [];
  if (stateFilter) {
    const parsed = StateSchema.safeParse(stateFilter);
    if (!parsed.success) {
      res.status(422).json({ error: `Invalid state: ${stateFilter}` });
      return;
    }
    conditions.push(eq(pendingChangesTable.state, parsed.data));
  }
  if (numFilter) {
    const n = parseInt(numFilter);
    if (isNaN(n)) {
      res.status(422).json({ error: `Invalid num: ${numFilter}` });
      return;
    }
    conditions.push(eq(pendingChangesTable.num, n));
  }

  const changes =
    conditions.length === 0
      ? await db
          .select()
          .from(pendingChangesTable)
          .orderBy(desc(pendingChangesTable.createdAt))
      : await db
          .select()
          .from(pendingChangesTable)
          .where(conditions.length === 1 ? conditions[0] : and(...conditions))
          .orderBy(desc(pendingChangesTable.createdAt));

  res.json({ changes: changes.map(serializeChange) });
});

// ── POST /pending-changes ──────────────────────────────────────────────────────

const CreateSchema = z.object({
  num: z.number().int().positive(),
  kind: KindSchema,
  payload: z.record(z.string(), z.unknown()),
  // Accepted for backward compatibility but IGNORED: the server rebuilds
  // the command from (kind, payload) so a compromised/CSRF'd client can
  // never stage an arbitrary string behind the copy button (review B2/M1).
  command: z.string().optional(),
});

const VALID_STATUSES = new Set([
  "evaluated", "applied", "oa", "responded", "interview",
  "offer", "hired", "rejected", "discarded", "withdrawn",
]);

/** Rebuild the CLI command server-side from the structured payload. */
function commandFor(
  kind: z.infer<typeof KindSchema>,
  num: number,
  payload: Record<string, unknown>,
): string | null {
  const str = (key: string) =>
    typeof payload[key] === "string" ? (payload[key] as string) : "";
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  switch (kind) {
    case "status": {
      const target = str("target_status");
      if (!VALID_STATUSES.has(target)) return null;
      return formatPendingCommand("status", num, target, today);
    }
    case "note": {
      const note = str("note");
      if (!note.trim()) return null;
      return formatPendingCommand("note", num, note, today);
    }
    case "contact": {
      const contact = str("target_contact");
      if (!contact.trim()) return null;
      return formatPendingCommand("contact", num, contact, today);
    }
    case "followup_done":
      return formatPendingCommand(
        "followup_done", num, str("reason") || "marked done via dashboard",
        today);
  }
}

router.post("/pending-changes", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: "Validation failed",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const { num, kind, payload } = parsed.data;

  const command = commandFor(kind, num, payload);
  if (command === null) {
    res.status(422).json({ error: `Invalid payload for kind "${kind}"` });
    return;
  }

  const [change] = await db
    .insert(pendingChangesTable)
    .values({ num, kind, payload, command, state: "pending" })
    .returning();

  res.status(201).json({ change: serializeChange(change!) });
});

// ── PATCH /pending-changes/:id ─────────────────────────────────────────────────

const UpdateStateSchema = z.object({
  state: z.enum(["copied", "applied", "dismissed"]),
});

router.patch("/pending-changes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = UpdateStateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: "Validation failed",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const [change] = await db
    .update(pendingChangesTable)
    .set({ state: parsed.data.state })
    .where(eq(pendingChangesTable.id, id))
    .returning();

  if (!change) {
    res.status(404).json({ error: "Pending change not found" });
    return;
  }

  res.json({ change: serializeChange(change) });
});

// ── Serializer ─────────────────────────────────────────────────────────────────

function serializeChange(c: typeof pendingChangesTable.$inferSelect) {
  return {
    id: c.id,
    createdAt: c.createdAt?.toISOString() ?? null,
    num: c.num,
    kind: c.kind,
    payload: c.payload,
    command: c.command,
    state: c.state,
  };
}

export default router;
