import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ingestRouter from "./ingest";
import applicationsRouter from "./applications";
import { requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();

// Public routes
router.use(healthRouter);
router.use(ingestRouter);
router.use(authRouter);

// All routes below require authentication
router.use(requireAuth);
router.use(applicationsRouter);

export default router;
