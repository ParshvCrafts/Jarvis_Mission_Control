import { useGetAnalytics } from "@workspace/api-client-react";
import type {
  AnalyticsResponse,
  FunnelStage,
  ScoreBandRow,
  ResponseRateSplit,
  VelocityHop,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// ── tiny helpers ──────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-zinc-900 border border-zinc-800 rounded-lg p-5", className)}>
      {children}
    </div>
  );
}

/** Simple horizontal bar — percentage 0–100 */
function Bar({
  pct,
  color = "bg-blue-600",
  showPct = true,
}: {
  pct: number | null;
  color?: string;
  showPct?: boolean;
}) {
  const value = pct ?? 0;
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-28 bg-zinc-800 rounded-full overflow-hidden shrink-0">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      {showPct && (
        <span className="text-xs tabular-nums text-zinc-400 w-9 text-right shrink-0">
          {pct === null ? "—" : `${value}%`}
        </span>
      )}
    </div>
  );
}

// ── Funnel section ────────────────────────────────────────────────────────────

function FunnelSection({ funnel }: { funnel: FunnelStage[] }) {
  const maxCount = Math.max(...funnel.map((f) => f.count), 1);

  return (
    <Card>
      <SectionHeader
        title="Funnel"
        subtitle="Counts of apps that entered each stage. Conversion = apps that left the stage → next stage ÷ apps that left (in-flight excluded)."
      />
      <div className="space-y-1">
        {funnel.map((stage, i) => {
          const barWidth = Math.round((stage.count / maxCount) * 100);
          const isLast = i === funnel.length - 1;
          return (
            <div key={stage.stage}>
              <div className="flex items-center gap-3 py-1.5">
                {/* Stage label */}
                <span className="text-xs text-zinc-400 font-mono w-20 shrink-0 capitalize">
                  {stage.stage}
                </span>

                {/* Count bar */}
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div className="h-5 w-full max-w-48 bg-zinc-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-700/70 rounded transition-all"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-zinc-300 shrink-0 min-w-[2ch]">
                    {stage.count}
                  </span>
                  {stage.in_flight > 0 && (
                    <span className="text-[10px] text-zinc-600 shrink-0">
                      ({stage.in_flight} in flight)
                    </span>
                  )}
                </div>
              </div>

              {/* Conversion arrow between stages */}
              {!isLast && (
                <div className="flex items-center gap-3 py-0.5">
                  <span className="w-20 shrink-0" />
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                    <span>↓</span>
                    {stage.conversion_pct === null ? (
                      <span className="italic">all in flight — no conversion yet</span>
                    ) : (
                      <span className="tabular-nums">
                        <span
                          className={cn(
                            "font-medium",
                            stage.conversion_pct >= 50
                              ? "text-emerald-600"
                              : stage.conversion_pct >= 20
                                ? "text-amber-600"
                                : "text-red-700",
                          )}
                        >
                          {stage.conversion_pct}%
                        </span>{" "}
                        converted
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Score-band section ────────────────────────────────────────────────────────

const BAND_LABEL: Record<string, string> = {
  high: "High ≥4",
  mid: "Mid 3–4",
  low: "Low <3",
  unscored: "Unscored",
};

const BAND_COLOR: Record<string, string> = {
  high: "text-emerald-500",
  mid: "text-amber-500",
  low: "text-red-500",
  unscored: "text-zinc-500",
};

function ScoreBandSection({ bands }: { bands: ScoreBandRow[] }) {
  return (
    <Card>
      <SectionHeader
        title="Score-band conversion"
        subtitle="Eval score bucket × outcome. In flight = still active. Positive = offer/hired. Negative = rejected/withdrawn/discarded."
      />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left text-zinc-500 font-medium pb-2 pr-4">Band</th>
              <th className="text-right text-zinc-500 font-medium pb-2 px-3">n</th>
              <th className="text-right text-zinc-500 font-medium pb-2 px-3">In flight</th>
              <th className="text-right text-zinc-500 font-medium pb-2 px-3">Positive</th>
              <th className="text-right text-zinc-500 font-medium pb-2 pl-3">Negative</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((row) => (
              <tr key={row.band} className="border-b border-zinc-800/50">
                <td className={cn("py-2 pr-4 font-medium", BAND_COLOR[row.band])}>
                  {BAND_LABEL[row.band] ?? row.band}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-zinc-300">{row.n}</td>
                <td className="py-2 px-3 text-right tabular-nums text-zinc-400">{row.in_flight_n}</td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{row.terminal_positive_n}</td>
                <td className="py-2 pl-3 text-right tabular-nums text-red-700">{row.terminal_negative_n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Response-rate section ─────────────────────────────────────────────────────

function ResponseRateSplitList({
  splits,
  emptyNote,
}: {
  splits: ResponseRateSplit[];
  emptyNote: string;
}) {
  if (splits.length === 0 || splits.every((s) => s.n_applied === 0)) {
    return <p className="text-xs text-zinc-600 italic">{emptyNote}</p>;
  }
  return (
    <div className="space-y-2">
      {splits.map((split) => (
        <div key={split.label} className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 w-32 shrink-0 truncate capitalize" title={split.label}>
            {split.label}
          </span>
          <Bar pct={split.rate_pct} />
          <span className="text-[10px] text-zinc-600 shrink-0">
            {split.n_responded}/{split.n_applied}
          </span>
        </div>
      ))}
    </div>
  );
}

function ResponseRateSection({
  byLetterTone,
  byResume,
}: {
  byLetterTone: ResponseRateSplit[];
  byResume: ResponseRateSplit[];
}) {
  return (
    <Card>
      <SectionHeader
        title="Response rates"
        subtitle="Apps that received any reply (responded/interview/offer/hired) ÷ apps that entered 'applied'. Tiny n — treat directionally only."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">
            By letter tone
          </p>
          <ResponseRateSplitList
            splits={byLetterTone}
            emptyNote="No cover letter data yet."
          />
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">
            By resume
          </p>
          <ResponseRateSplitList
            splits={byResume}
            emptyNote="No resume data yet."
          />
        </div>
      </div>
    </Card>
  );
}

// ── Velocity section ──────────────────────────────────────────────────────────

function VelocitySection({ velocity }: { velocity: VelocityHop[] }) {
  return (
    <Card>
      <SectionHeader
        title="Velocity"
        subtitle="Median days between adjacent stage transitions, from status event timestamps."
      />
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left text-zinc-500 font-medium pb-2 pr-4">Hop</th>
            <th className="text-right text-zinc-500 font-medium pb-2 px-3">n</th>
            <th className="text-right text-zinc-500 font-medium pb-2 pl-3">Median days</th>
          </tr>
        </thead>
        <tbody>
          {velocity.map((hop) => (
            <tr key={`${hop.from_stage}→${hop.to_stage}`} className="border-b border-zinc-800/50">
              <td className="py-2 pr-4 text-zinc-400 font-mono capitalize">
                {hop.from_stage} → {hop.to_stage}
              </td>
              <td className="py-2 px-3 text-right tabular-nums text-zinc-500">{hop.n}</td>
              <td className="py-2 pl-3 text-right tabular-nums text-zinc-300">
                {hop.median_days === null ? (
                  <span className="text-zinc-700">—</span>
                ) : (
                  hop.median_days % 1 === 0
                    ? hop.median_days.toFixed(0)
                    : hop.median_days.toFixed(1)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data, isLoading, error } = useGetAnalytics();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
        Loading analytics…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
        Failed to load analytics.
      </div>
    );
  }

  const totalApps = data.total_apps;

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold text-zinc-100">Analytics</h1>
        <span className="text-xs text-zinc-600">{totalApps} application{totalApps !== 1 ? "s" : ""}</span>
      </div>

      {totalApps === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
          <p className="text-sm text-zinc-500">No applications yet. Ingest some data to see analytics.</p>
        </div>
      )}

      {totalApps > 0 && (
        <>
          <FunnelSection funnel={data.funnel} />
          <ScoreBandSection bands={data.score_bands} />
          <ResponseRateSection
            byLetterTone={data.response_rates.by_letter_tone}
            byResume={data.response_rates.by_resume}
          />
          <VelocitySection velocity={data.velocity} />
        </>
      )}
    </div>
  );
}
