import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray, desc, asc } from "drizzle-orm";
import {
  db,
  applicationsTable,
  statusEventsTable,
  evalSummariesTable,
  ingestSnapshotsTable,
} from "@workspace/db";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Today's date as YYYY-MM-DD in America/Los_Angeles timezone */
function todayLA(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

/** Days between two YYYY-MM-DD strings (non-negative) */
function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T12:00:00Z");
  const to = new Date(toDate + "T12:00:00Z");
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/** Parse score string → number | null */
function parseScore(score: string): number | null {
  if (!score || score.trim() === "" || score.toUpperCase() === "N/A") return null;
  const n = parseFloat(score);
  return isNaN(n) ? null : n;
}

/** Score band for filtering */
function scoreBand(score: string): "unscored" | "low" | "mid" | "high" {
  const n = parseScore(score);
  if (n === null) return "unscored";
  if (n < 3.0) return "low";
  if (n < 4.0) return "mid";
  return "high";
}

type ApplicationRow = {
  num: number;
  date: string;
  company: string;
  role: string;
  score: string;
  status: string;
  contact: string;
  via: string;
  resume: string;
  letter: string;
  report: string;
  notes: string;
  days_in_stage: number;
  has_ghost_flag: boolean;
  resume_present: boolean;
  letter_present: boolean;
};

type SortCol = "date" | "company" | "role" | "score" | "status" | "days_in_stage";

// ─── GET /applications ─────────────────────────────────────────────────────────

router.get("/applications", async (req: Request, res: Response): Promise<void> => {
  const {
    status: statusFilter,
    score_band: scoreBandFilter,
    company: companySearch,
    sort_col: sortColRaw = "date",
    sort_dir: sortDirRaw = "desc",
    page: pageRaw = "1",
    page_size: pageSizeRaw = "50",
  } = req.query as Record<string, string>;

  const sortCol = (["date", "company", "role", "score", "status", "days_in_stage"].includes(sortColRaw)
    ? sortColRaw
    : "date") as SortCol;
  const sortDir = sortDirRaw === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(pageRaw) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeRaw) || 50));

  // 1. Fetch all applications from DB
  const apps = await db.select().from(applicationsTable).orderBy(desc(applicationsTable.num));

  // 2. Fetch all status events for these apps, grouped by num
  const nums = apps.map((a) => a.num);
  const allEvents =
    nums.length > 0
      ? await db
          .select()
          .from(statusEventsTable)
          .where(inArray(statusEventsTable.num, nums))
          .orderBy(desc(statusEventsTable.date), desc(statusEventsTable.id))
      : [];

  // Group events by num (first entry = most recent, already sorted desc)
  const eventsByNum = new Map<number, typeof allEvents>();
  for (const e of allEvents) {
    if (!eventsByNum.has(e.num)) eventsByNum.set(e.num, []);
    eventsByNum.get(e.num)!.push(e);
  }

  const today = todayLA();

  // 3. Build enriched rows with computed fields
  const rows: ApplicationRow[] = apps.map((app) => {
    const events = eventsByNum.get(app.num) ?? [];
    const latestEvent = events[0]; // most recent (desc sorted)
    const sinceDate = latestEvent?.date ?? app.date;
    const daysInStage = daysBetween(sinceDate, today);
    const hasGhostFlag = app.status === "applied" && daysInStage > 21;

    return {
      num: app.num,
      date: app.date,
      company: app.company,
      role: app.role,
      score: app.score,
      status: app.status,
      contact: app.contact,
      via: app.via,
      resume: app.resume,
      letter: app.letter,
      report: app.report,
      notes: app.notes,
      days_in_stage: daysInStage,
      has_ghost_flag: hasGhostFlag,
      resume_present: app.resume !== "",
      letter_present: app.letter !== "",
    };
  });

  // 4. Apply filters
  let filtered = rows;

  if (statusFilter) {
    filtered = filtered.filter((r) => r.status === statusFilter);
  }
  if (companySearch) {
    const lower = companySearch.toLowerCase();
    filtered = filtered.filter((r) => r.company.toLowerCase().includes(lower));
  }
  if (scoreBandFilter) {
    filtered = filtered.filter((r) => scoreBand(r.score) === scoreBandFilter);
  }

  // 5. Sort
  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortCol) {
      case "company":
        cmp = a.company.localeCompare(b.company);
        break;
      case "role":
        cmp = a.role.localeCompare(b.role);
        break;
      case "score": {
        const sa = parseScore(a.score) ?? -Infinity;
        const sb = parseScore(b.score) ?? -Infinity;
        cmp = sa - sb;
        break;
      }
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "days_in_stage":
        cmp = a.days_in_stage - b.days_in_stage;
        break;
      default: // date
        cmp = a.date.localeCompare(b.date);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // 6. Paginate
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  // 7. Last sync timestamp
  const [lastSync] = await db
    .select({ receivedAt: ingestSnapshotsTable.receivedAt })
    .from(ingestSnapshotsTable)
    .orderBy(desc(ingestSnapshotsTable.receivedAt))
    .limit(1);

  res.json({
    items,
    total,
    page,
    page_size: pageSize,
    last_sync_at: lastSync?.receivedAt?.toISOString() ?? null,
  });
});

// ─── GET /applications/:num ────────────────────────────────────────────────────

router.get("/applications/:num", async (req: Request, res: Response): Promise<void> => {
  const num = parseInt(String(req.params.num));
  if (isNaN(num)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [app] = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.num, num));
  if (!app) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  // Status events (chronological, oldest first)
  const events = await db
    .select()
    .from(statusEventsTable)
    .where(eq(statusEventsTable.num, num))
    .orderBy(asc(statusEventsTable.date), asc(statusEventsTable.id));

  // Eval summary
  const [evalRow] = await db
    .select()
    .from(evalSummariesTable)
    .where(eq(evalSummariesTable.num, num));

  const today = todayLA();
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const sinceDate = latestEvent?.date ?? app.date;
  const daysInStage = daysBetween(sinceDate, today);
  const hasGhostFlag = app.status === "applied" && daysInStage > 21;

  const row: ApplicationRow = {
    num: app.num,
    date: app.date,
    company: app.company,
    role: app.role,
    score: app.score,
    status: app.status,
    contact: app.contact,
    via: app.via,
    resume: app.resume,
    letter: app.letter,
    report: app.report,
    notes: app.notes,
    days_in_stage: daysInStage,
    has_ghost_flag: hasGhostFlag,
    resume_present: app.resume !== "",
    letter_present: app.letter !== "",
  };

  res.json({
    application: row,
    status_events: events.map((e) => ({
      id: e.id,
      num: e.num,
      date: e.date,
      from_status: e.fromStatus,
      to_status: e.toStatus,
      source: e.source,
      note: e.note,
    })),
    eval: evalRow
      ? {
          num: evalRow.num,
          url: evalRow.url,
          company: evalRow.company,
          role: evalRow.role,
          score: evalRow.score,
          recommendation: evalRow.recommendation,
          legitimacy: evalRow.legitimacy,
          blockers: evalRow.blockers,
          warnings: evalRow.warnings,
        }
      : null,
  });
});

export default router;
