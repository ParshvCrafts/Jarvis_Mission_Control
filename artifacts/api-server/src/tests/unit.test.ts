import { describe, it, expect } from "vitest";
import { formatPendingCommand } from "../lib/ingestSchema";

describe("formatPendingCommand", () => {
  it("status command", () => {
    const cmd = formatPendingCommand("status", 5, "interview", "2026-07-26");
    expect(cmd).toBe(
      "python3.11 scripts/track.py set 5 interview --date 2026-07-26",
    );
  });

  it("note command with double-quotes", () => {
    const cmd = formatPendingCommand(
      "note",
      3,
      'They said "we\'ll follow up"',
      "2026-07-26",
    );
    expect(cmd).toBe(
      `python3.11 scripts/track.py set 3 --note "They said \\"we'll follow up\\"" --date 2026-07-26`,
    );
  });

  it("note command with dollar sign", () => {
    const cmd = formatPendingCommand(
      "note",
      7,
      "Offers $180k base",
      "2026-07-26",
    );
    expect(cmd).toBe(
      `python3.11 scripts/track.py set 7 --note "Offers \\$180k base" --date 2026-07-26`,
    );
  });

  it("note command with both special chars", () => {
    const cmd = formatPendingCommand(
      "note",
      1,
      '"$500k ARR" said recruiter',
      "2026-07-26",
    );
    // Exact string equality — " → \" and $ → \$
    expect(cmd).toBe(
      `python3.11 scripts/track.py set 1 --note "\\"\\$500k ARR\\" said recruiter" --date 2026-07-26`,
    );
  });

  it("contact command escapes special chars", () => {
    const cmd = formatPendingCommand(
      "contact",
      2,
      'Jane "J" Doe',
      "2026-07-26",
    );
    expect(cmd).toBe(
      `python3.11 scripts/track.py contact 2 --contact "Jane \\"J\\" Doe"`,
    );
  });

  it("followup_done command", () => {
    const cmd = formatPendingCommand(
      "followup_done",
      4,
      "Sent follow-up email",
      "2026-07-26",
    );
    expect(cmd).toBe(
      `python3.11 scripts/track.py followup 4 --note "Sent follow-up email"`,
    );
  });

  it("note with newline is replaced by space", () => {
    const cmd = formatPendingCommand(
      "note",
      1,
      "line one\nline two",
      "2026-07-26",
    );
    expect(cmd).toBe(
      `python3.11 scripts/track.py set 1 --note "line one line two" --date 2026-07-26`,
    );
  });
});
