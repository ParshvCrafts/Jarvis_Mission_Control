import { useState, useCallback, useRef } from "react";
import { Plus, Pencil, Trash2, X, Check, Upload, List, Grid3X3, ChevronLeft, ChevronRight, AlertCircle, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useListDeadlines,
  useCreateDeadline,
  useUpdateDeadline,
  useDeleteDeadline,
  useImportDeadlinesCsv,
  getListDeadlinesQueryKey,
  type SeasonDeadline,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildMonthGrid,
  isoDay,
  isWindowDeadline,
  computeWeekSegments,
  type BandSegment,
} from "./calendarHelpers";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "grid" | "list";

interface DeadlineFormState {
  company: string;
  program: string;
  opens_date: string;
  closes_date: string;
  url: string;
  notes: string;
}

const EMPTY_FORM: DeadlineFormState = {
  company: "",
  program: "",
  opens_date: "",
  closes_date: "",
  url: "",
  notes: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysFromNow(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const todayMs = new Date(today + "T12:00:00").getTime();
  const targetMs = new Date(iso + "T12:00:00").getTime();
  return Math.round((targetMs - todayMs) / 86_400_000);
}

function urgencyClass(days: number | null): string {
  if (days === null) return "text-zinc-600";
  if (days < 0) return "text-zinc-700 line-through";
  if (days <= 3) return "text-red-400";
  if (days <= 7) return "text-amber-400";
  if (days <= 14) return "text-yellow-500";
  return "text-zinc-500";
}

function daysLabel(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  return `in ${days}d`;
}

// ─── Calendar Grid Helpers ────────────────────────────────────────────────────
// Pure grid/band math lives in calendarHelpers.ts so it can be unit-tested.

// ─── Window Bands ─────────────────────────────────────────────────────────────

/** Urgency color for a window band, based on days until close. */
function bandColorClass(closesDays: number | null): string {
  if (closesDays === null || closesDays < 0)
    return "bg-zinc-800/60 text-zinc-500 ring-zinc-700/60 hover:bg-zinc-800";
  if (closesDays <= 3)
    return "bg-red-900/60 text-red-300 ring-red-700/60 hover:bg-red-900/80";
  if (closesDays <= 14)
    return "bg-amber-900/60 text-amber-300 ring-amber-700/60 hover:bg-amber-900/80";
  return "bg-emerald-900/60 text-emerald-300 ring-emerald-700/60 hover:bg-emerald-900/80";
}

/** Deadlines that render as bands: both dates present and opens <= closes. */

const BAND_TOP = 24; // px below the day number
const LANE_HEIGHT = 16; // px per band lane
const MAX_VISIBLE_LANES = 4; // cap stacked bands per week; the rest go to "+N more"

// ─── Form ─────────────────────────────────────────────────────────────────────

function DeadlineForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: DeadlineFormState;
  onSave: (f: DeadlineFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [f, setF] = useState<DeadlineFormState>(initial);
  const set = (k: keyof DeadlineFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Company *</label>
          <Input value={f.company} onChange={set("company")} placeholder="Acme Corp" className="h-7 text-xs bg-zinc-900 border-zinc-800 mt-1" />
        </div>
        <div>
          <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Program</label>
          <Input value={f.program} onChange={set("program")} placeholder="SWE Intern" className="h-7 text-xs bg-zinc-900 border-zinc-800 mt-1" />
        </div>
        <div>
          <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Opens</label>
          <Input value={f.opens_date} onChange={set("opens_date")} placeholder="YYYY-MM-DD" type="date" className="h-7 text-xs bg-zinc-900 border-zinc-800 mt-1" />
        </div>
        <div>
          <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Closes</label>
          <Input value={f.closes_date} onChange={set("closes_date")} placeholder="YYYY-MM-DD" type="date" className="h-7 text-xs bg-zinc-900 border-zinc-800 mt-1" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-zinc-600 uppercase tracking-wider">URL</label>
          <Input value={f.url} onChange={set("url")} placeholder="https://..." className="h-7 text-xs bg-zinc-900 border-zinc-800 mt-1" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Notes</label>
          <Input value={f.notes} onChange={set("notes")} placeholder="Optional notes" className="h-7 text-xs bg-zinc-900 border-zinc-800 mt-1" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => onSave(f)} disabled={saving || !f.company.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── List Row ─────────────────────────────────────────────────────────────────

function DeadlineRow({
  d,
  onEdit,
  onDelete,
  onJump,
}: {
  d: SeasonDeadline;
  onEdit: (d: SeasonDeadline) => void;
  onDelete: (d: SeasonDeadline) => void;
  onJump: (d: SeasonDeadline) => void;
}) {
  const closesDays = daysFromNow(d.closes_date);
  const opensDays = daysFromNow(d.opens_date);
  const hasDate = !!(d.opens_date || d.closes_date);

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-zinc-800/50 last:border-0 group">
      {/* Source badge */}
      <span className={cn(
        "text-[9px] font-mono px-1 py-px rounded ring-1 ring-inset shrink-0",
        d.source === "import"
          ? "bg-purple-950 text-purple-400 ring-purple-800"
          : "bg-zinc-900 text-zinc-600 ring-zinc-800"
      )}>
        {d.source}
      </span>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-medium text-zinc-200">{d.company}</span>
          {d.program && <span className="text-[11px] text-zinc-500">{d.program}</span>}
        </div>
        <div
          className={cn("flex items-center gap-3 mt-0.5 flex-wrap", hasDate && "cursor-pointer")}
          onClick={hasDate ? () => onJump(d) : undefined}
          title={hasDate ? "Show on calendar" : undefined}
        >
          {d.opens_date && (
            <span className="text-[10px] font-mono">
              <span className="text-zinc-700">opens </span>
              <span className={urgencyClass(opensDays)}>{formatDate(d.opens_date)}</span>
              {opensDays !== null && opensDays >= 0 && (
                <span className="ml-1 text-zinc-600">{daysLabel(opensDays)}</span>
              )}
            </span>
          )}
          {d.closes_date && (
            <span className="text-[10px] font-mono">
              <span className="text-zinc-700">closes </span>
              <span className={urgencyClass(closesDays)}>{formatDate(d.closes_date)}</span>
              {closesDays !== null && closesDays >= 0 && (
                <span className="ml-1 text-zinc-600">{daysLabel(closesDays)}</span>
              )}
            </span>
          )}
          {!d.opens_date && !d.closes_date && (
            <span className="text-[10px] text-zinc-700 font-mono">no dates set</span>
          )}
        </div>
        {d.notes && <p className="text-[10px] text-zinc-600 mt-0.5 truncate">{d.notes}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {hasDate && (
          <button
            onClick={() => onJump(d)}
            className="p-1 rounded text-zinc-600 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
            title="Show on calendar"
          >
            <CalendarDays className="h-3 w-3" />
          </button>
        )}
        {d.url && (
          <a
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded text-zinc-600 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
            title="Open URL"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
        <button
          onClick={() => onEdit(d)}
          className="p-1 rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          onClick={() => onDelete(d)}
          className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── CSV Import Drop Zone ──────────────────────────────────────────────────────

function CsvImportZone({ onImport }: { onImport: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = useImportDeadlinesCsv();
  const qc = useQueryClient();

  async function process(text: string) {
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await importMut.mutateAsync({ data: { csv: text } });
      await qc.invalidateQueries({ queryKey: getListDeadlinesQueryKey() });
      setStatus("done");
      toast.success(`Imported ${res.inserted} deadline${res.inserted !== 1 ? "s" : ""}${res.errors.length > 0 ? ` (${res.errors.length} skipped)` : ""}`);
      onImport();
      setTimeout(() => setStatus("idle"), 3000);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Import failed");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0]!;
    const text = await file.text();
    await process(text);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        await handleFiles(e.dataTransfer.files);
      }}
      onClick={() => fileRef.current?.click()}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded border border-dashed cursor-pointer transition-colors text-xs",
        dragging
          ? "border-blue-500 bg-blue-950/20 text-blue-300"
          : status === "done"
          ? "border-emerald-800 bg-emerald-950/10 text-emerald-500"
          : status === "error"
          ? "border-red-800 bg-red-950/10 text-red-400"
          : "border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400"
      )}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {status === "loading" ? (
        <span className="text-zinc-500">Importing…</span>
      ) : status === "done" ? (
        <><Check className="h-3.5 w-3.5" /><span>CSV imported</span></>
      ) : status === "error" ? (
        <><AlertCircle className="h-3.5 w-3.5" /><span>{errorMsg || "Import failed"}</span></>
      ) : (
        <><Upload className="h-3.5 w-3.5" /><span>Drop CSV or click to import</span><span className="text-zinc-700">· company,program,opens_date,closes_date,url,notes</span></>
      )}
    </div>
  );
}

// ─── Month Grid Cell ──────────────────────────────────────────────────────────

function GridCell({
  day,
  iso,
  deadlines,
  isToday,
  selected,
  laneCount,
  onClick,
}: {
  day: number | null;
  iso: string | null;
  deadlines: SeasonDeadline[];
  isToday: boolean;
  selected: boolean;
  laneCount: number;
  onClick: () => void;
}) {
  const minHeight = 60 + laneCount * LANE_HEIGHT;

  if (day === null) {
    return <div style={{ minHeight }} />;
  }

  // Window deadlines (both dates) render as bands in the week overlay, so
  // only single-date deadlines keep their per-day markers here.
  const opens = deadlines.filter((d) => d.opens_date === iso && !isWindowDeadline(d));
  const closes = deadlines.filter((d) => d.closes_date === iso && !isWindowDeadline(d));

  return (
    <button
      onClick={onClick}
      style={{ minHeight }}
      className={cn(
        "p-1 rounded text-left border transition-colors w-full",
        selected
          ? "border-blue-700 bg-blue-950/30"
          : isToday
          ? "border-zinc-600 bg-zinc-900/50"
          : "border-transparent hover:border-zinc-800 hover:bg-zinc-900/30",
      )}
    >
      <div className={cn(
        "text-[11px] font-mono mb-1",
        isToday ? "text-blue-400 font-semibold" : "text-zinc-500",
      )}>
        {day}
      </div>
      <div className="space-y-0.5" style={{ marginTop: laneCount * LANE_HEIGHT }}>
        {opens.map((d) => (
          <div key={`o-${d.id}`} className="text-[9px] bg-emerald-950/60 text-emerald-400 rounded px-0.5 truncate leading-4">
            ↑ {d.company}
          </div>
        ))}
        {closes.map((d) => (
          <div key={`c-${d.id}`} className="text-[9px] bg-red-950/60 text-red-400 rounded px-0.5 truncate leading-4">
            ↓ {d.company}
          </div>
        ))}
      </div>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const todayYear = parseInt(today.split("-")[0]!);
  const todayMonth = parseInt(today.split("-")[1]!) - 1;

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [year, setYear] = useState(todayYear);
  const [month, setMonth] = useState(todayMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedDeadlineId, setSelectedDeadlineId] = useState<number | null>(null);
  const [overflowWeek, setOverflowWeek] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const { data, isLoading, isError } = useListDeadlines();
  const createMut = useCreateDeadline();
  const updateMut = useUpdateDeadline();
  const deleteMut = useDeleteDeadline();
  const qc = useQueryClient();

  const deadlines = data?.deadlines ?? [];

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: getListDeadlinesQueryKey() });
  }, [qc]);

  async function handleAdd(f: DeadlineFormState) {
    setAddSaving(true);
    try {
      await createMut.mutateAsync({
        data: {
          company: f.company,
          program: f.program || undefined,
          opens_date: f.opens_date || null,
          closes_date: f.closes_date || null,
          url: f.url || undefined,
          notes: f.notes || undefined,
        },
      });
      await refresh();
      setShowAddForm(false);
      toast.success("Deadline added");
    } catch {
      toast.error("Failed to add deadline");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleUpdate(id: number, f: DeadlineFormState) {
    setSavingId(id);
    try {
      await updateMut.mutateAsync({
        id,
        data: {
          company: f.company,
          program: f.program,
          opens_date: f.opens_date || null,
          closes_date: f.closes_date || null,
          url: f.url,
          notes: f.notes,
        },
      });
      await refresh();
      setEditingId(null);
      toast.success("Deadline updated");
    } catch {
      toast.error("Failed to update deadline");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(d: SeasonDeadline) {
    // Optimistic delete with undo toast
    const prev = [...deadlines];
    qc.setQueryData(getListDeadlinesQueryKey(), { deadlines: prev.filter((x) => x.id !== d.id) });

    let undone = false;
    toast(`Deleted: ${d.company}`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          qc.setQueryData(getListDeadlinesQueryKey(), { deadlines: prev });
          toast.success("Restored");
        },
      },
    });

    await new Promise((r) => setTimeout(r, 5200));
    if (undone) return;

    try {
      await deleteMut.mutateAsync({ id: d.id });
      await refresh();
    } catch {
      qc.setQueryData(getListDeadlinesQueryKey(), { deadlines: prev });
      toast.error("Failed to delete deadline");
    }
  }

  /** Switch to grid view at the month containing this deadline's window and select it. */
  function jumpToDeadline(d: SeasonDeadline) {
    const target = d.opens_date ?? d.closes_date;
    if (!target) return;
    const [y, m] = target.split("-");
    setYear(parseInt(y!));
    setMonth(parseInt(m!) - 1);
    setOverflowWeek(null);
    if (isWindowDeadline(d)) {
      // Windows render as bands — select the band so the detail panel opens
      setSelectedDay(null);
      setSelectedDeadlineId(d.id);
    } else {
      // Single-date deadlines only have a day marker — select that day instead
      setSelectedDeadlineId(null);
      setSelectedDay(target);
    }
    setViewMode("grid");
  }

  // Month grid
  const grid = buildMonthGrid(year, month);
  const monthName = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
    setSelectedDay(null);
    setSelectedDeadlineId(null);
    setOverflowWeek(null);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
    setSelectedDay(null);
    setSelectedDeadlineId(null);
    setOverflowWeek(null);
  }

  const selectedDayDeadlines = selectedDay
    ? deadlines.filter(
        (d) =>
          d.opens_date === selectedDay ||
          d.closes_date === selectedDay ||
          (isWindowDeadline(d) && d.opens_date! <= selectedDay && selectedDay <= d.closes_date!)
      )
    : [];
  const selectedDeadline = selectedDeadlineId !== null
    ? deadlines.find((d) => d.id === selectedDeadlineId) ?? null
    : null;

  // Split the month grid into week rows and precompute window bands per week.
  // Lanes are capped: overflow segments are hidden behind a "+N more" indicator.
  const windowDeadlines = deadlines.filter(isWindowDeadline);
  const weeks: {
    days: (number | null)[];
    isos: (string | null)[];
    segments: BandSegment<SeasonDeadline>[];
    hiddenSegments: BandSegment<SeasonDeadline>[];
    laneCount: number;
  }[] = [];
  for (let w = 0; w < grid.length / 7; w++) {
    const days = grid.slice(w * 7, w * 7 + 7);
    const isos = days.map((d) => (d ? isoDay(year, month, d) : null));
    const allSegments = computeWeekSegments(isos, windowDeadlines);
    const totalLanes = allSegments.reduce((m, s) => Math.max(m, s.lane + 1), 0);
    const overflowing = totalLanes > MAX_VISIBLE_LANES;
    const segments = overflowing ? allSegments.filter((s) => s.lane < MAX_VISIBLE_LANES) : allSegments;
    const hiddenSegments = overflowing ? allSegments.filter((s) => s.lane >= MAX_VISIBLE_LANES) : [];
    // Reserve one extra lane row for the "+N more" indicator when overflowing
    const laneCount = overflowing ? MAX_VISIBLE_LANES + 1 : totalLanes;
    weeks.push({ days, isos, segments, hiddenSegments, laneCount });
  }

  // Sort deadlines by soonest date
  const sortedDeadlines = [...deadlines].sort((a, b) => {
    const aDate = a.closes_date ?? a.opens_date ?? "9999";
    const bDate = b.closes_date ?? b.opens_date ?? "9999";
    return aDate.localeCompare(bDate);
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="shrink-0">
          <h1 className="text-sm font-semibold text-zinc-100">Season Calendar</h1>
          <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">
            {isLoading ? "—" : `${deadlines.length} deadline${deadlines.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <CsvImportZone onImport={refresh} />

          {/* View toggle */}
          <div className="flex items-center rounded border border-zinc-800 overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode("list")}
              title="List view"
              className={cn("px-2 py-1.5 transition-colors", viewMode === "list" ? "bg-zinc-800 text-zinc-100" : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900")}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              title="Month grid"
              className={cn("px-2 py-1.5 transition-colors", viewMode === "grid" ? "bg-zinc-800 text-zinc-100" : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900")}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={() => { setShowAddForm((v) => !v); setEditingId(null); }}
          >
            {showAddForm ? <X className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
            {showAddForm ? "Cancel" : "Add deadline"}
          </Button>
        </div>
      </div>

      {/* ── Add Form ── */}
      {showAddForm && (
        <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/20 shrink-0">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">New Deadline</p>
          <DeadlineForm
            initial={EMPTY_FORM}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            saving={addSaving}
          />
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden min-h-0">
        {isLoading && (
          <div className="flex items-center justify-center h-40 text-xs text-zinc-600 font-mono">Loading…</div>
        )}
        {isError && (
          <div className="flex items-center justify-center h-40 text-xs text-red-500">Failed to load. Check API server.</div>
        )}

        {data && viewMode === "list" && (
          <div className="overflow-y-auto h-full px-5 py-3">
            {sortedDeadlines.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-zinc-700">No deadlines yet.</p>
                <p className="text-xs text-zinc-800 mt-1">Add one manually or import from CSV.</p>
              </div>
            ) : (
              sortedDeadlines.map((d) =>
                editingId === d.id ? (
                  <div key={d.id} className="py-3 border-b border-zinc-800/50">
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Edit</p>
                    <DeadlineForm
                      initial={{
                        company: d.company,
                        program: d.program,
                        opens_date: d.opens_date ?? "",
                        closes_date: d.closes_date ?? "",
                        url: d.url,
                        notes: d.notes,
                      }}
                      onSave={(f) => handleUpdate(d.id, f)}
                      onCancel={() => setEditingId(null)}
                      saving={savingId === d.id}
                    />
                  </div>
                ) : (
                  <DeadlineRow
                    key={d.id}
                    d={d}
                    onEdit={() => { setEditingId(d.id); setShowAddForm(false); }}
                    onDelete={handleDelete}
                    onJump={jumpToDeadline}
                  />
                )
              )
            )}
          </div>
        )}

        {data && viewMode === "grid" && (
          <div className="flex h-full overflow-hidden">
            {/* Month grid */}
            <div className="flex-1 overflow-y-auto p-4 min-w-0">
              {/* Month nav */}
              <div className="flex items-center gap-3 mb-3">
                <button onClick={prevMonth} className="p-1 rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-zinc-200 flex-1 text-center">{monthName}</span>
                <button onClick={nextMonth} className="p-1 rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Weekday labels */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} className="text-[10px] text-zinc-700 text-center py-1">{d}</div>
                ))}
              </div>

              {/* Day grid — one relative row per week so window bands can overlay */}
              <div className="space-y-1">
                {weeks.map((week, w) => (
                  <div key={w} className="relative grid grid-cols-7 gap-1">
                    {week.days.map((day, i) => {
                      const iso = week.isos[i]!;
                      return (
                        <GridCell
                          key={i}
                          day={day}
                          iso={iso}
                          deadlines={deadlines}
                          isToday={iso === today}
                          selected={iso === selectedDay}
                          laneCount={week.laneCount}
                          onClick={() => {
                            if (iso) {
                              setSelectedDeadlineId(null);
                              setOverflowWeek(null);
                              setSelectedDay(selectedDay === iso ? null : iso);
                            }
                          }}
                        />
                      );
                    })}
                    {week.segments.map((seg) => {
                      const span = seg.endCol - seg.startCol + 1;
                      const closesDays = daysFromNow(seg.d.closes_date);
                      return (
                        <button
                          key={`${seg.d.id}-${seg.startCol}`}
                          title={`${seg.d.company}${seg.d.program ? ` · ${seg.d.program}` : ""} — ${formatDate(seg.d.opens_date)} → ${formatDate(seg.d.closes_date)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDay(null);
                            setOverflowWeek(null);
                            setSelectedDeadlineId(selectedDeadlineId === seg.d.id ? null : seg.d.id);
                          }}
                          style={{
                            left: `calc(${seg.startCol} * (100% + 4px) / 7 + 2px)`,
                            width: `calc(${span} * (100% + 4px) / 7 - 4px - 4px)`,
                            top: BAND_TOP + seg.lane * LANE_HEIGHT,
                            height: LANE_HEIGHT - 3,
                          }}
                          className={cn(
                            "absolute z-10 flex items-center px-1 text-[9px] font-medium ring-1 ring-inset transition-colors truncate",
                            seg.startsHere ? "rounded-l" : "rounded-l-none",
                            seg.endsHere ? "rounded-r" : "rounded-r-none",
                            bandColorClass(closesDays),
                            selectedDeadlineId === seg.d.id && "ring-2 ring-blue-500"
                          )}
                        >
                          <span className="truncate">{seg.d.company}</span>
                        </button>
                      );
                    })}
                    {week.hiddenSegments.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDay(null);
                          setSelectedDeadlineId(null);
                          setOverflowWeek(overflowWeek === w ? null : w);
                        }}
                        title={`Show ${week.hiddenSegments.length} more window${week.hiddenSegments.length !== 1 ? "s" : ""}`}
                        style={{
                          left: 2,
                          top: BAND_TOP + MAX_VISIBLE_LANES * LANE_HEIGHT,
                          height: LANE_HEIGHT - 3,
                        }}
                        className={cn(
                          "absolute z-10 flex items-center px-1.5 rounded text-[9px] font-medium ring-1 ring-inset transition-colors",
                          overflowWeek === w
                            ? "bg-blue-950/60 text-blue-300 ring-blue-600"
                            : "bg-zinc-800/80 text-zinc-400 ring-zinc-700 hover:bg-zinc-700/80 hover:text-zinc-200"
                        )}
                      >
                        +{week.hiddenSegments.length} more
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-3">
                <span className="text-[10px] text-zinc-700 flex items-center gap-1">
                  <span className="inline-block w-2 h-2 bg-emerald-950/60 rounded-sm" />
                  <span className="text-emerald-700">Opens</span>
                </span>
                <span className="text-[10px] text-zinc-700 flex items-center gap-1">
                  <span className="inline-block w-2 h-2 bg-red-950/60 rounded-sm" />
                  <span className="text-red-700">Closes</span>
                </span>
                <span className="text-[10px] text-zinc-700 flex items-center gap-1 ml-2">
                  <span className="inline-block w-4 h-2 bg-emerald-900/60 rounded-sm" />
                  <span className="inline-block w-4 h-2 bg-amber-900/60 rounded-sm" />
                  <span className="inline-block w-4 h-2 bg-red-900/60 rounded-sm" />
                  <span>Window (far → closing soon)</span>
                </span>
              </div>
            </div>

            {/* Detail panel: selected window band, overflow list, or selected day */}
            {(selectedDeadline || selectedDay || overflowWeek !== null) && (
              <div className="w-64 shrink-0 border-l border-zinc-800 overflow-y-auto p-4">
                {overflowWeek !== null ? (
                  <>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">
                      {weeks[overflowWeek]?.hiddenSegments.length ?? 0} more window{(weeks[overflowWeek]?.hiddenSegments.length ?? 0) !== 1 ? "s" : ""} this week
                    </p>
                    <div className="space-y-2">
                      {(weeks[overflowWeek]?.hiddenSegments ?? []).map((seg) => {
                        const closesDays = daysFromNow(seg.d.closes_date);
                        return (
                          <button
                            key={seg.d.id}
                            onClick={() => {
                              setOverflowWeek(null);
                              setSelectedDay(null);
                              setSelectedDeadlineId(seg.d.id);
                            }}
                            className="w-full text-left text-xs bg-zinc-900 hover:bg-zinc-800 transition-colors rounded p-2"
                          >
                            <p className="font-medium text-zinc-200">{seg.d.company}</p>
                            {seg.d.program && <p className="text-zinc-500 text-[11px]">{seg.d.program}</p>}
                            <div className="mt-1 space-y-0.5 font-mono">
                              <p className="text-[10px]">
                                <span className="text-zinc-700">opens </span>
                                <span className="text-emerald-500">{formatDate(seg.d.opens_date)}</span>
                              </p>
                              <p className="text-[10px]">
                                <span className="text-zinc-700">closes </span>
                                <span className={urgencyClass(closesDays)}>{formatDate(seg.d.closes_date)}</span>
                                <span className="ml-1 text-zinc-600">{daysLabel(closesDays)}</span>
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : selectedDeadline ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Application Window</p>
                      {editingId !== selectedDeadline.id && (
                        <button
                          onClick={() => { setEditingId(selectedDeadline.id); setShowAddForm(false); }}
                          className="p-1 rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {editingId === selectedDeadline.id ? (
                      <DeadlineForm
                        initial={{
                          company: selectedDeadline.company,
                          program: selectedDeadline.program,
                          opens_date: selectedDeadline.opens_date ?? "",
                          closes_date: selectedDeadline.closes_date ?? "",
                          url: selectedDeadline.url,
                          notes: selectedDeadline.notes,
                        }}
                        onSave={(f) => handleUpdate(selectedDeadline.id, f)}
                        onCancel={() => setEditingId(null)}
                        saving={savingId === selectedDeadline.id}
                      />
                    ) : (
                    <div className="text-xs bg-zinc-900 rounded p-2">
                      <p className="font-medium text-zinc-200">{selectedDeadline.company}</p>
                      {selectedDeadline.program && <p className="text-zinc-500 text-[11px]">{selectedDeadline.program}</p>}
                      <div className="mt-1.5 space-y-0.5 font-mono">
                        <p className="text-[10px]">
                          <span className="text-zinc-700">opens </span>
                          <span className="text-emerald-500">{formatDate(selectedDeadline.opens_date)}</span>
                        </p>
                        <p className="text-[10px]">
                          <span className="text-zinc-700">closes </span>
                          <span className={urgencyClass(daysFromNow(selectedDeadline.closes_date))}>
                            {formatDate(selectedDeadline.closes_date)}
                          </span>
                          <span className="ml-1 text-zinc-600">{daysLabel(daysFromNow(selectedDeadline.closes_date))}</span>
                        </p>
                      </div>
                      {selectedDeadline.notes && <p className="text-[10px] text-zinc-600 mt-1.5">{selectedDeadline.notes}</p>}
                      {selectedDeadline.url && (
                        <a
                          href={selectedDeadline.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-400 hover:underline mt-1.5 inline-block truncate max-w-full"
                        >
                          {selectedDeadline.url}
                        </a>
                      )}
                    </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">
                      {new Date(selectedDay! + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </p>
                    {selectedDayDeadlines.length === 0 ? (
                      <p className="text-xs text-zinc-700">No events</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedDayDeadlines.map((d) =>
                          editingId === d.id ? (
                            <div key={d.id} className="text-xs bg-zinc-900 rounded p-2">
                              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Edit</p>
                              <DeadlineForm
                                initial={{
                                  company: d.company,
                                  program: d.program,
                                  opens_date: d.opens_date ?? "",
                                  closes_date: d.closes_date ?? "",
                                  url: d.url,
                                  notes: d.notes,
                                }}
                                onSave={(f) => handleUpdate(d.id, f)}
                                onCancel={() => setEditingId(null)}
                                saving={savingId === d.id}
                              />
                            </div>
                          ) : (
                          <div key={d.id} className="text-xs bg-zinc-900 rounded p-2 group">
                            <div className="flex items-start justify-between gap-1">
                              <p className="font-medium text-zinc-200">{d.company}</p>
                              <button
                                onClick={() => { setEditingId(d.id); setShowAddForm(false); }}
                                className="p-1 -m-1 rounded text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                            {d.program && <p className="text-zinc-500 text-[11px]">{d.program}</p>}
                            <div className="mt-1 space-y-0.5">
                              {d.opens_date === selectedDay && <p className="text-[10px] text-emerald-500">↑ Opens today</p>}
                              {d.closes_date === selectedDay && <p className="text-[10px] text-red-400">↓ Closes today</p>}
                              {d.opens_date !== selectedDay && d.closes_date !== selectedDay && isWindowDeadline(d) && (
                                <p className="text-[10px] text-amber-400">▬ Window active</p>
                              )}
                            </div>
                          </div>
                          )
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
