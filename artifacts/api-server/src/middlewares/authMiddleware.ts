import crypto from "crypto";
import type { AuthUser } from "@workspace/api-zod";
import { type NextFunction, type Request, type Response } from "express";
import * as oidc from "openid-client";
import bcrypt from "bcryptjs";

import {
  clearSession,
  getOidcConfig,
  getSession,
  getSessionId,
  updateSession,
  type SessionData,
} from "../lib/auth";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

// Read at CALL time, not import time: a `const` here freezes the value
// before test setup (or a config reload) can set it, which is why the
// old AUTH_MODE=basic tests silently tested replit mode (review M5).
const AUTH_MODE = () => process.env.AUTH_MODE ?? "replit";
const OWNER_USER_ID = () => process.env.OWNER_USER_ID ?? "";

// ─── Replit OIDC session loader ───────────────────────────────────────────────

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;
  if (!session.refresh_token) return null;

  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(config, session.refresh_token);
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn()
      ? now + tokens.expiresIn()!
      : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

/**
 * Loads the authenticated user from the session cookie (replit mode only).
 * In basic mode this is a no-op — authentication happens entirely in requireAuth.
 * DEV_SKIP_AUTH=true (development only) sets a fake user for UI iteration.
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  // Dev bypass — never runs in production
  if (
    process.env["DEV_SKIP_AUTH"] === "true" &&
    process.env["NODE_ENV"] !== "production"
  ) {
    req.user = {
      id: "dev-user",
      email: "dev@jarvis.local",
      firstName: "Dev",
      lastName: null,
      profileImageUrl: null,
    };
    next();
    return;
  }

  if (AUTH_MODE() !== "replit") {
    next();
    return;
  }

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(_res, sid);
    next();
    return;
  }

  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(_res, sid);
    next();
    return;
  }

  req.user = refreshed.user;
  next();
}

// ─── requireAuth — protects all routes except /ingest ─────────────────────────

/**
 * Apply this to every route that requires authentication.
 *
 * replit mode:
 *   - 401 if no session
 *   - 403 if authenticated user is not the owner (OWNER_USER_ID)
 *
 * basic mode:
 *   - Parses Authorization: Basic <base64(user:pass)>
 *   - 401 if header missing, malformed, username mismatch, or wrong password
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (AUTH_MODE() === "basic") {
    await handleBasicAuth(req, res, next);
    return;
  }

  // replit mode
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Fail CLOSED: without a configured owner, nobody is the owner. The
  // previous `if (OWNER_USER_ID && ...)` guard meant an unset/typo'd
  // secret silently granted every authenticated Replit user full access
  // to personal data (review M2).
  if (!OWNER_USER_ID()) {
    res.status(503).json({
      error: "Server misconfigured: OWNER_USER_ID is not set",
    });
    return;
  }

  if (req.user.id !== OWNER_USER_ID()) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}

async function handleBasicAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"] ?? "";
  const BASIC_PREFIX = "Basic ";

  if (!authHeader.startsWith(BASIC_PREFIX)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Jarvis Mission Control"');
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const decoded = Buffer.from(
    authHeader.slice(BASIC_PREFIX.length),
    "base64",
  ).toString("utf-8");
  const colonIdx = decoded.indexOf(":");
  if (colonIdx < 0) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  const expectedUser = process.env.AUTH_BASIC_USER ?? "";
  const expectedHash = process.env.AUTH_BASIC_PASSWORD_HASH ?? "";

  // Constant-time username comparison via HMAC to normalise lengths
  const hmac = (v: string) =>
    crypto.createHmac("sha256", "jarvis-username").update(v).digest();
  const usernameOk = crypto.timingSafeEqual(hmac(username), hmac(expectedUser));

  // Always run bcrypt to prevent timing attacks that reveal which field failed
  const hashToCheck = usernameOk
    ? expectedHash
    : "$2b$10$invalidhashpaddingtopreventiingtimingleaksXXXXXXXXXXXXX"; // dummy
  const passwordOk = await bcrypt.compare(password, hashToCheck);

  if (!usernameOk || !passwordOk) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.user = {
    id: "basic-user",
    email: username,
    firstName: null,
    lastName: null,
    profileImageUrl: null,
  };
  next();
}
