import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Replit/VPS reverse proxy: needed for correct req.ip (rate limiting)
// and secure-cookie detection behind TLS termination.
app.set("trust proxy", 1);

// 5 MB body limit (ingest payloads)
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
// Same-origin app: the dashboard is served by this server, so no
// cross-origin caller is ever legitimate. Reflecting arbitrary origins
// with credentials (the previous `origin: true`) let any website read the
// API with cached credentials (review M1). ALLOWED_ORIGINS env (comma-
// separated) exists for a split-host setup; default is no CORS at all.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (allowedOrigins.length > 0) {
  app.use(cors({ credentials: true, origin: allowedOrigins }));
}
app.use(cookieParser());

// Load session user (replit mode only — no-op in basic mode)
app.use(authMiddleware);

app.use("/api", router);

export default app;
