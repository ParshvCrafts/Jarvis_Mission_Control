/**
 * Security audit tests
 *
 * Verifies:
 * 1. All protected routes return 401 without a session (no DEV_SKIP_AUTH)
 * 2. Non-owner user gets 403 in replit mode
 * 3. POST /api/ingest is public but requires a valid bearer token
 * 4. GET /api/health is public (no auth)
 * 5. File-upload paths reject non-JSON bodies
 * 6. No INGEST_TOKEN appears in server response bodies
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from "vitest";
import request from "supertest";
import app from "../app";

// ── Test token used only for ingest auth tests ─────────────────────────────────
const TEST_TOKEN = "test-security-token-abc123";

beforeAll(() => {
  // Ensure we are NOT bypassing auth for these tests
  delete process.env["DEV_SKIP_AUTH"];
  // Defaults to replit mode — no session → 401 for all protected routes
  process.env["AUTH_MODE"] = "replit";
  process.env["INGEST_TOKEN"] = TEST_TOKEN;
});

afterAll(() => {
  // Restore so subsequent test files are unaffected
  process.env["DEV_SKIP_AUTH"] = "true";
  delete process.env["INGEST_TOKEN"];
});

// ── 1. Protected routes return 401 without a session ──────────────────────────

const PROTECTED_ROUTES = [
  { method: "get", path: "/api/applications" },
  { method: "get", path: "/api/today" },
  { method: "get", path: "/api/queue" },
  { method: "get", path: "/api/analytics" },
  { method: "get", path: "/api/pending-changes" },
  { method: "get", path: "/api/deadlines" },
  { method: "get", path: "/api/settings" },
  { method: "put", path: "/api/settings" },
  { method: "post", path: "/api/deadlines" },
  { method: "post", path: "/api/settings/ingest" },
];

describe("Route protection: unauthenticated requests return 401", () => {
  for (const { method, path } of PROTECTED_ROUTES) {
    it(`${method.toUpperCase()} ${path} → 401`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = (request(app) as any)[method](path);
      if (method === "put" || method === "post") {
        req.send({});
      }
      const res = await req;
      expect(res.status).toBe(401);
    });
  }
});

// ── 2. Non-owner user gets 403 in replit mode ─────────────────────────────────

describe("Non-owner 403: requireAuth blocks non-owner user", () => {
  it("returns 403 when user id does not match OWNER_USER_ID", async () => {
    vi.resetModules();
    const savedOwner = process.env["OWNER_USER_ID"];
    const savedMode = process.env["AUTH_MODE"];
    const savedSkip = process.env["DEV_SKIP_AUTH"];

    process.env["OWNER_USER_ID"] = "real-owner-id-xyz";
    process.env["AUTH_MODE"] = "replit";
    delete process.env["DEV_SKIP_AUTH"];

    const { requireAuth } = await import("../middlewares/authMiddleware");

    const mockReq = {
      isAuthenticated: () => true,
      user: {
        id: "intruder-user-id",
        email: "intruder@evil.com",
        firstName: null,
        lastName: null,
        profileImageUrl: null,
      },
      headers: {},
    } as Parameters<typeof requireAuth>[0];

    let capturedStatus = 0;
    const mockRes = {
      status: (code: number) => {
        capturedStatus = code;
        return { json: () => {} };
      },
    } as unknown as Parameters<typeof requireAuth>[1];
    const mockNext = vi.fn();

    await requireAuth(mockReq, mockRes, mockNext);

    expect(capturedStatus).toBe(403);
    expect(mockNext).not.toHaveBeenCalled();

    // Restore
    if (savedOwner !== undefined) process.env["OWNER_USER_ID"] = savedOwner;
    else delete process.env["OWNER_USER_ID"];
    if (savedMode !== undefined) process.env["AUTH_MODE"] = savedMode;
    else delete process.env["AUTH_MODE"];
    if (savedSkip !== undefined) process.env["DEV_SKIP_AUTH"] = savedSkip;

    vi.resetModules();
  });

  it("returns 200 when user id matches OWNER_USER_ID", async () => {
    vi.resetModules();
    const savedOwner = process.env["OWNER_USER_ID"];
    const savedMode = process.env["AUTH_MODE"];
    const savedSkip = process.env["DEV_SKIP_AUTH"];

    process.env["OWNER_USER_ID"] = "real-owner-id-xyz";
    process.env["AUTH_MODE"] = "replit";
    delete process.env["DEV_SKIP_AUTH"];

    const { requireAuth } = await import("../middlewares/authMiddleware");

    const mockReq = {
      isAuthenticated: () => true,
      user: {
        id: "real-owner-id-xyz",
        email: "owner@jarvis.local",
        firstName: null,
        lastName: null,
        profileImageUrl: null,
      },
      headers: {},
    } as Parameters<typeof requireAuth>[0];

    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Parameters<typeof requireAuth>[1];
    const mockNext = vi.fn();

    await requireAuth(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockRes.status).not.toHaveBeenCalled();

    // Restore
    if (savedOwner !== undefined) process.env["OWNER_USER_ID"] = savedOwner;
    else delete process.env["OWNER_USER_ID"];
    if (savedMode !== undefined) process.env["AUTH_MODE"] = savedMode;
    else delete process.env["AUTH_MODE"];
    if (savedSkip !== undefined) process.env["DEV_SKIP_AUTH"] = savedSkip;

    vi.resetModules();
  });
});

// ── 3. POST /api/ingest auth: public but requires valid bearer token ──────────

describe("Ingest auth: bearer token required", () => {
  it("GET /api/healthz → 200 (public, no token needed)", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("POST /api/ingest without Authorization header → 401", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .send({ payload_version: 1 });
    expect(res.status).toBe(401);
    expect(res.body).not.toMatchObject({ token: expect.anything() });
  });

  it("POST /api/ingest with wrong token → 401", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", "Bearer wrong-token-xxx")
      .send({ payload_version: 1 });
    expect(res.status).toBe(401);
  });

  it("POST /api/ingest with correct token but invalid payload → 422 (not 401)", async () => {
    // Confirms the token check passes before schema validation
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${TEST_TOKEN}`)
      .send({ payload_version: 999 }); // invalid version
    // 422 = auth passed, schema rejected — not 401
    expect(res.status).toBe(422);
  });
});

// ── 4. INGEST_TOKEN never appears in API response bodies ──────────────────────

describe("Secret leak: INGEST_TOKEN not exposed in responses", () => {
  it("error response from /api/ingest does not contain INGEST_TOKEN value", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .send({ payload_version: 1 });
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(TEST_TOKEN);
  });

  it("healthz response does not contain INGEST_TOKEN value", async () => {
    const res = await request(app).get("/api/healthz");
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(TEST_TOKEN);
  });
});

// ── 5. Non-JSON / non-object bodies rejected on upload endpoints ───────────────

describe("Input rejection: non-JSON bodies on upload endpoints", () => {
  // Restore DEV_SKIP_AUTH so we can reach the protected settings/ingest route
  beforeEach(() => {
    process.env["DEV_SKIP_AUTH"] = "true";
  });
  afterAll(() => {
    // Back to no-skip for remaining tests in THIS file (none, but be tidy)
    delete process.env["DEV_SKIP_AUTH"];
  });

  it("POST /api/settings/ingest with plain text body → rejected (400/415/422)", async () => {
    const res = await request(app)
      .post("/api/settings/ingest")
      .set("Content-Type", "text/plain")
      .send("this is not json");
    // Express json() ignores non-JSON content types (body arrives as undefined/empty),
    // so Zod schema validation fires and returns 422. 400/415 are also acceptable.
    expect([400, 415, 422]).toContain(res.status);
  });

  it("POST /api/settings/ingest with empty object → 422 (schema validation catches it)", async () => {
    const res = await request(app)
      .post("/api/settings/ingest")
      .send({});
    expect(res.status).toBe(422);
  });

  it("POST /api/deadlines/csv-import with missing csv field → 422", async () => {
    const res = await request(app)
      .post("/api/deadlines/csv-import")
      .send({ notcsv: "value" });
    expect(res.status).toBe(422);
  });
});
