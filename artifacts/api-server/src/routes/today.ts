import { Router } from "express";
import { eq, and, desc, gte, lte, notInArray, sql } from "drizzle-orm";
import { chooseSoonestAlert } from "../lib/seasonAlert";
import {
  db,
  followupItemsTable,
  replySuggestionsTable,
  queueItemsTable,
  evalSummariesTable,
  applicationsTable,
  statusEventsTable,
  seasonDeadlinesTable,
  ingestSnapshotsTable,
  settingsTable,
} from "@workspace/db";
import { WEEKLY_TARGET_KEY, DEFAULT_WEEKLY_TARGET } from "./settings";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayLADate(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

/**
 * ISO week boundaries (Mon–Sun) for a given YYYY-MM-DD date string in LA tz.
 */
function isoWeekBoundaries(todayLA: string): { weekStart: string; weekEnd: string } {
  const d = new Date(todayLA + "T12:00:00"); // noon prevents DST edge cases
  const day = d.getDay(); // 0=Sun
  const daysToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + daysToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

type UrgencyLabel = "urgent" | "overdue" | "needs-data" | "waiting" | "cold";

/**
 * Map (urgency field, next_date) → display urgency label.
 * Priority: overdue/today date beats stored urgency field.
 */
function computeUrgency(urgency: string, nextDate: string, todayLA: string): UrgencyLabel {
  if (!nextDate) return "needs-data";
  if (nextDate < todayLA) return "overdue";
  if (nextDate === todayLA) return "urgent";
  if (urgency === "high") return "urgent";
  if (urgency === "low" || urgency === "cold") return "cold";
  return "waiting";
}

const URGENCY_RANK: Record<UrgencyLabel, number> = {
  urgent: 0,
  overdue: 1,
  "needs-data": 2,
  waiting: 3,
  cold: 4,
};

const TERMINAL_STATUSES = ["hired", "rejected", "discarded", "withdrawn"] as const;

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/today", async (_req, res) => {
  const todayLA = todayLADate();
  const { weekStart, weekEnd } = isoWeekBoundaries(todayLA);

  // Window for season alerts: today through +7 days
  const d7 = new Date(todayLA + "T12:00:00");
  d7.setDate(d7.getDate() + 7);
  const alertWindowEnd = d7.toISOString().slice(0, 10);

  // ── All queries in parallel ──────────────────────────────────────────────
  const [
    followupsRaw,
    suggestionsRaw,
    queueRaw,
    blockersRaw,
    weeklyAppliedRaw,
    lastSyncRaw,
    seasonRaw,
    settingsRaw,
  ] = await Promise.all([
    // 1. All follow-up items
    db.select().from(followupItemsTable),

    // 2. Actionable reply suggestions (blocker = "")
    db
      .select()
      .from(replySuggestionsTable)
      .where(eq(replySuggestionsTable.blocker, "")),

    // 3. Top 5 unreviewed queue items by score desc
    db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.reviewed, false))
      .orderBy(desc(queueItemsTable.score))
      .limit(5),

    // 4. Non-terminal apps with non-empty blockers (joined to evals)
    db
      .select({
        num: applicationsTable.num,
        company: applicationsTable.company,
        status: applicationsTable.status,
        blockers: evalSummariesTable.blockers,
      })
      .from(applicationsTable)
      .innerJoin(
        evalSummariesTable,
        eq(applicationsTable.num, evalSummariesTable.num),
      )
      .where(
        and(
          notInArray(applicationsTable.status, [...TERMINAL_STATUSES]),
          sql`array_length(${evalSummariesTable.blockers}, 1) > 0`,
        ),
      ),

    // 5. Count applied status events this ISO week (for weekly goal)
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(statusEventsTable)
      .where(
        and(
          eq(statusEventsTable.toStatus, "applied"),
          gte(statusEventsTable.date, weekStart),
          lte(statusEventsTable.date, weekEnd),
        ),
      ),

    // 6. Most recent ingest snapshot
    db
      .select({ receivedAt: ingestSnapshotsTable.receivedAt })
      .from(ingestSnapshotsTable)
      .orderBy(desc(ingestSnapshotsTable.receivedAt))
      .limit(1),

    // 7. Season deadlines with at least one event within the 7-day window.
    // ORDER BY the soonest *in-window* candidate date (not LEAST of raw dates,
    // which could be dominated by a past opensDate on the same row).
    db
      .select()
      .from(seasonDeadlinesTable)
      .where(
        sql`(${seasonDeadlinesTable.opensDate} >= ${todayLA} AND ${seasonDeadlinesTable.opensDate} <= ${alertWindowEnd})
         OR (${seasonDeadlinesTable.closesDate} >= ${todayLA} AND ${seasonDeadlinesTable.closesDate} <= ${alertWindowEnd})`,
      )
      .orderBy(
        sql`LEAST(
          CASE WHEN ${seasonDeadlinesTable.opensDate} >= ${todayLA} AND ${seasonDeadlinesTable.opensDate} <= ${alertWindowEnd}
            THEN ${seasonDeadlinesTable.opensDate} ELSE '9999-12-31' END,
          CASE WHEN ${seasonDeadlinesTable.closesDate} >= ${todayLA} AND ${seasonDeadlinesTable.closesDate} <= ${alertWindowEnd}
            THEN ${seasonDeadlinesTable.closesDate} ELSE '9999-12-31' END
        ) ASC`,
      )
      .limit(5),

    // 8. Weekly target from settings table
    db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, WEEKLY_TARGET_KEY))
      .limit(1),
  ]);

  // ── Process follow-ups ───────────────────────────────────────────────────
  const followups = followupsRaw
    .map((f) => ({
      id: f.id,
      num: f.num,
      company: f.company,
      role: f.role,
      urgency_label: computeUrgency(f.urgency, f.nextDate, todayLA),
      next_date: f.nextDate,
      reason: f.reason,
    }))
    .sort((a, b) => {
      const ra = URGENCY_RANK[a.urgency_label as UrgencyLabel] ?? 99;
      const rb = URGENCY_RANK[b.urgency_label as UrgencyLabel] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.next_date.localeCompare(b.next_date);
    });

  // ── Process reply suggestions ────────────────────────────────────────────
  const replySuggestions = suggestionsRaw.map((s) => ({
    id: s.id,
    message_date: s.messageDate,
    subject: s.subject,
    from_addr: s.fromAddr,
    kind: s.kind,
    confidence: s.confidence,
    suggested_command: s.suggestedCommand,
  }));

  // ── Process queue items ──────────────────────────────────────────────────
  const nowMs = Date.now();
  const queueTop = queueRaw.map((q) => {
    const postedMs = new Date(q.posted + "T12:00:00").getTime();
    return {
      id: q.id,
      company: q.company,
      title: q.title,
      score: q.score,
      posted: q.posted,
      posted_age_days: Math.max(0, Math.floor((nowMs - postedMs) / 86_400_000)),
    };
  });

  // ── Staleness ────────────────────────────────────────────────────────────
  const lastSyncAt = lastSyncRaw[0]?.receivedAt?.toISOString() ?? null;
  const isStale = lastSyncAt
    ? Date.now() - new Date(lastSyncAt).getTime() > 48 * 60 * 60 * 1_000
    : true;

  // ── Weekly goal ──────────────────────────────────────────────────────────
  const rawTarget = settingsRaw[0]?.value;
  const weeklyTarget = rawTarget
    ? Math.max(1, Math.min(1000, parseInt(rawTarget, 10) || DEFAULT_WEEKLY_TARGET))
    : DEFAULT_WEEKLY_TARGET;
  const weeklyGoal = {
    target: weeklyTarget,
    progress: weeklyAppliedRaw[0]?.count ?? 0,
    week_start: weekStart,
  };

  // ── Season alert ─────────────────────────────────────────────────────────
  // chooseSoonestAlert handles in-window filtering correctly, excluding past
  // opensDate/closesDate values that may appear on rows alongside an in-window date.
  const seasonAlert = chooseSoonestAlert(seasonRaw, todayLA, alertWindowEnd);

  res.json({
    today_date: todayLA,
    last_sync_at: lastSyncAt,
    is_stale: isStale,
    followups,
    reply_suggestions: replySuggestions,
    queue_top: queueTop,
    blockers: blockersRaw,
    weekly_goal: weeklyGoal,
    season_alert: seasonAlert,
  });
});

export default router;
