import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ingestRouter from "./ingest";
import { requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();

// Health — public
router.use(healthRouter);

// Ingest — token-authed (no session required), public from route perspective
router.use(ingestRouter);

// Auth — OIDC login/callback/logout/user (public redirects + session-read)
router.use(authRouter);

// All routes below this point require authentication
router.use(requireAuth);

export default router;
