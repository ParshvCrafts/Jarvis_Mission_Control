import { Router } from "express";
import { db } from "@workspace/db";
import {
  applicationsTable,
  statusEventsTable,
  evalSummariesTable,
  coverLettersTable,
} from "@workspace/db/schema";
import {
  computeFunnel,
  computeScoreBandsResult,
  computeResponseRates,
  computeVelocity,
} from "../lib/analytics";

const router = Router();

// GET /analytics
router.get("/analytics", async (_req, res) => {
  const [apps, events, evals, covers] = await Promise.all([
    db
      .select({
        num: applicationsTable.num,
        status: applicationsTable.status,
        resume: applicationsTable.resume,
      })
      .from(applicationsTable),
    db
      .select({
        num: statusEventsTable.num,
        toStatus: statusEventsTable.toStatus,
        date: statusEventsTable.date,
      })
      .from(statusEventsTable),
    db
      .select({
        num: evalSummariesTable.num,
        score: evalSummariesTable.score,
      })
      .from(evalSummariesTable),
    db
      .select({
        num: coverLettersTable.num,
        file: coverLettersTable.file,
        date: coverLettersTable.date,
        tone: coverLettersTable.tone,
      })
      .from(coverLettersTable),
  ]);

  const funnel = computeFunnel(apps, events);
  const score_bands = computeScoreBandsResult(apps, evals);
  const response_rates = computeResponseRates(apps, events, covers);
  const velocity = computeVelocity(events);

  res.json({
    total_apps: apps.length,
    funnel,
    score_bands,
    response_rates,
    velocity,
  });
});

export default router;
