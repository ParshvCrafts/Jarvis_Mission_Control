import { useEffect, useState } from "react";
import { todayIso } from "./calendarHelpers";

/**
 * Today's date (YYYY-MM-DD, America/Los_Angeles) as reactive state.
 * Re-checks every 30s and on tab focus/visibility, so a calendar left open
 * past midnight re-renders with fresh urgency colors and "in Xd" labels.
 */
export function useTodayIso(): string {
  const [today, setToday] = useState(() => todayIso());

  useEffect(() => {
    const check = () => {
      const now = todayIso();
      setToday((prev) => (prev === now ? prev : now));
    };
    const interval = setInterval(check, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);

  return today;
}
