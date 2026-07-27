import { useState, useEffect } from "react";
import {
  useListApplications,
  useGetApplicationDetail,
  getGetApplicationDetailQueryKey,
  getListApplicationsQueryKey,
  type ApplicationRow,
  type ApplicationDetail,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronUp, ChevronDown, ChevronsUpDown, List, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePendingChanges } from "@/contexts/PendingChangesContext";
import { formatPendingCommand, todayLA } from "@/lib/pendingCommands";
import { isAllowedTransition, PIPELINE_ORDER, EXIT_STATUSES } from "@/lib/transitions";
import BoardView from "./BoardView";

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: string }) {
  const n = parseFloat(score);
  if (!score || score.toUpperCase() === "N/A" || isNaN(n)) {
    return <span className="text-zinc-700 text-xs">—</span>;
  }
  const cls =
    n >= 4
      ? "bg-emerald-950 text-emerald-300 ring-emerald-800"
      : n >= 3
        ? "bg-amber-950 text-amber-300 ring-amber-800"
        : "bg-red-950 text-red-300 ring-red-800";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold ring-1 ring-inset ${cls}`}>
      {n.toFixed(1)}
    </span>
  );
}

// ─── Status chip ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  evaluated: "text-blue-400",
  applied: "text-yellow-400",
  oa: "text-orange-400",
  responded: "text-teal-400",
  interview: "text-emerald-400",
  offer: "text-green-300",
  hired: "text-green-200 font-semibold",
  rejected: "text-red-400",
  discarded: "text-zinc-600",
  withdrawn: "text-zinc-600",
};

function StatusChip({ status, pending = false }: { status: string; pending?: boolean }) {
  return (
    <span className={cn("text-xs font-medium", STATUS_COLORS[status] ?? "text-zinc-400")}>
      {status}
      {pending && <span className="ml-1 text-amber-500 text-[9px]">~</span>}
    </span>
  );
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(iso?: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortCol = "date" | "company" | "role" | "score" | "status" | "days_in_stage";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 text-zinc-700 shrink-0" />;
  return dir === "asc"
    ? <ChevronUp className="h-3 w-3 text-blue-400 shrink-0" />
    : <ChevronDown className="h-3 w-3 text-blue-400 shrink-0" />;
}

function SortableHead({
  label, col, current, dir, onSort, className, align = "left",
}: {
  label: string; col: SortCol; current: SortCol; dir: SortDir;
  onSort: (col: SortCol) => void; className?: string; align?: "left" | "right";
}) {
  return (
    <TableHead
      className={cn("cursor-pointer select-none py-2", align === "right" && "text-right", className)}
      onClick={() => onSort(col)}
    >
      <div className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
        <span className={current === col ? "text-zinc-200" : "text-zinc-600"}>{label}</span>
        <SortIcon active={current === col} dir={dir} />
      </div>
    </TableHead>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function DrawerField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={cn("text-sm text-zinc-300 truncate", mono && "font-mono text-xs text-zinc-400")}>
        {value || "—"}
      </p>
    </div>
  );
}

const ALL_STATUSES = [...PIPELINE_ORDER, ...Array.from(EXIT_STATUSES)] as string[];

function ApplicationDrawer({ detail }: { detail: ApplicationDetail }) {
  const { application: app, status_events: events, eval: ev } = detail;
  const { createChange } = usePendingChanges();

  // Edit state
  const [editStatus, setEditStatus] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editContact, setEditContact] = useState(app.contact);
  const [staging, setStaging] = useState<string | null>(null);

  async function stage(action: () => Promise<void>, key: string) {
    setStaging(key);
    try {
      await action();
    } catch {
      toast.error("Failed to stage change");
    } finally {
      setStaging(null);
    }
  }

  async function handleStageStatus() {
    if (!editStatus || editStatus === app.status) return;
    if (!isAllowedTransition(app.status, editStatus)) {
      toast.error("Backward/terminal corrections happen on the Mac with --force");
      return;
    }
    await stage(async () => {
      const cmd = formatPendingCommand("status", app.num, editStatus, todayLA());
      await createChange({ num: app.num, kind: "status", payload: { target_status: editStatus }, command: cmd });
      toast.success(`Staged: ${app.status} → ${editStatus}`);
      setEditStatus("");
    }, "status");
  }

  async function handleStageNote() {
    if (!editNote.trim()) return;
    await stage(async () => {
      const cmd = formatPendingCommand("note", app.num, editNote, todayLA());
      await createChange({ num: app.num, kind: "note", payload: { note: editNote }, command: cmd });
      toast.success("Note staged");
      setEditNote("");
    }, "note");
  }

  async function handleStageContact() {
    if (!editContact.trim() || editContact === app.contact) return;
    await stage(async () => {
      const cmd = formatPendingCommand("contact", app.num, editContact, todayLA());
      await createChange({ num: app.num, kind: "contact", payload: { target_contact: editContact }, command: cmd });
      toast.success("Contact update staged");
    }, "contact");
  }

  async function handleFollowupDone() {
    await stage(async () => {
      const cmd = formatPendingCommand("followup_done", app.num, "marked done via dashboard", todayLA());
      await createChange({ num: app.num, kind: "followup_done", payload: { reason: "marked done via dashboard" }, command: cmd });
      toast.success("Follow-up done staged");
    }, "followup");
  }

  const validNextStatuses = ALL_STATUSES.filter(
    (s) => s !== app.status && isAllowedTransition(app.status, s)
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-6 pb-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100 truncate">{app.company}</h2>
            <p className="text-sm text-zinc-500 mt-0.5 truncate">{app.role}</p>
          </div>
          <ScoreBadge score={app.score} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-xs"><span className="text-zinc-600">Status </span><StatusChip status={app.status} /></span>
          <span className="text-xs font-mono text-zinc-500">{app.date}</span>
          <span className="text-xs"><span className="text-zinc-600">Day </span><span className="text-zinc-400 font-mono">{app.days_in_stage}</span></span>
          {app.has_ghost_flag && <span className="text-xs text-orange-400">👻 no activity 21+ d</span>}
        </div>
      </div>

      {/* Meta */}
      <div className="px-5 py-4 border-b border-zinc-800 grid grid-cols-2 gap-x-6 gap-y-3 shrink-0">
        <DrawerField label="Contact" value={app.contact} />
        <DrawerField label="Via" value={app.via} />
        <DrawerField label="Resume" value={app.resume} mono />
        <DrawerField label="Letter" value={app.letter} mono />
        {app.report && <div className="col-span-2"><DrawerField label="Report" value={app.report} mono /></div>}
      </div>

      {/* Notes */}
      {app.notes && (
        <div className="px-5 py-4 border-b border-zinc-800 shrink-0">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Notes</p>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{app.notes}</p>
        </div>
      )}

      {/* Status history */}
      <div className="px-5 py-4 border-b border-zinc-800 shrink-0">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Status History</p>
        {events.length === 0 ? (
          <p className="text-xs text-zinc-700">No events recorded.</p>
        ) : (
          <ol className="space-y-3 relative border-l border-zinc-800 ml-1">
            {events.map((e) => (
              <li key={e.id} className="pl-4 relative">
                <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-zinc-950" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[11px] font-mono text-zinc-500">{e.date}</span>
                  {e.from_status && <span className="text-[11px] text-zinc-600">{e.from_status} →</span>}
                  <span className="text-[11px] font-medium text-zinc-200">{e.to_status}</span>
                  {e.source && <span className="text-[11px] text-zinc-700">via {e.source}</span>}
                </div>
                {e.note && <p className="text-[11px] text-zinc-500 mt-0.5 italic">"{e.note}"</p>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Eval */}
      <div className="px-5 py-4 border-b border-zinc-800 shrink-0">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Evaluation</p>
        {!ev ? (
          <p className="text-xs text-zinc-700">No evaluation available.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <DrawerField label="Rec." value={ev.recommendation} />
              <DrawerField label="Legitimacy" value={ev.legitimacy} />
            </div>
            {ev.blockers.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">Blockers</p>
                <ul className="space-y-1">
                  {ev.blockers.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-red-500 shrink-0 mt-0.5">✕</span>
                      <span className="text-red-300">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ev.warnings.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">Warnings</p>
                <ul className="space-y-1">
                  {ev.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-amber-500 shrink-0 mt-0.5">⚠</span>
                      <span className="text-amber-300">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Edit → Pending Commands ── */}
      <div className="px-5 py-4 shrink-0">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">
          Edit → Pending Command
        </p>
        <div className="space-y-4">
          {/* Status */}
          <div>
            <p className="text-xs text-zinc-600 mb-1.5">Change status</p>
            <div className="flex gap-2">
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="h-7 flex-1 text-xs bg-zinc-900 border-zinc-800">
                  <SelectValue placeholder="Select target…" />
                </SelectTrigger>
                <SelectContent>
                  {validNextStatuses.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-zinc-700 shrink-0"
                disabled={!editStatus || staging === "status"}
                onClick={handleStageStatus}
              >
                Stage
              </Button>
            </div>
          </div>

          {/* Note */}
          <div>
            <p className="text-xs text-zinc-600 mb-1.5">Add note</p>
            <Textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Note text…"
              className="text-xs bg-zinc-900 border-zinc-800 min-h-16 resize-none"
              rows={2}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 text-xs border-zinc-700"
              disabled={!editNote.trim() || staging === "note"}
              onClick={handleStageNote}
            >
              Stage note
            </Button>
          </div>

          {/* Contact */}
          <div>
            <p className="text-xs text-zinc-600 mb-1.5">Set contact</p>
            <div className="flex gap-2">
              <Input
                value={editContact}
                onChange={(e) => setEditContact(e.target.value)}
                placeholder="email or name…"
                className="h-7 flex-1 text-xs bg-zinc-900 border-zinc-800"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-zinc-700 shrink-0"
                disabled={!editContact.trim() || editContact === app.contact || staging === "contact"}
                onClick={handleStageContact}
              >
                Stage
              </Button>
            </div>
          </div>

          {/* Followup done */}
          <div>
            <p className="text-xs text-zinc-600 mb-1.5">Follow-up</p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-zinc-700"
              disabled={staging === "followup"}
              onClick={handleFollowupDone}
            >
              Mark done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApplicationsPage() {
  const [view, setView] = useState<"table" | "board">("table");

  // Table filter/sort/page state
  const [statusFilter, setStatusFilter] = useState("");
  const [scoreBandFilter, setScoreBandFilter] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [debouncedCompany, setDebouncedCompany] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [selectedNum, setSelectedNum] = useState<number | null>(null);

  const { getActiveChange } = usePendingChanges();

  // Debounce company
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedCompany(companySearch); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [companySearch]);

  // Table query (paginated, active when view=table)
  const tableParams = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(scoreBandFilter ? { score_band: scoreBandFilter as "unscored" | "low" | "mid" | "high" } : {}),
    ...(debouncedCompany ? { company: debouncedCompany } : {}),
    sort_col: sortCol as "date" | "company" | "role" | "score" | "status" | "days_in_stage",
    sort_dir: sortDir as "asc" | "desc",
    page,
    page_size: 50,
  };
  const { data: tableData, isLoading, isError } = useListApplications(tableParams, {
    query: {
      queryKey: getListApplicationsQueryKey(tableParams),
      enabled: view === "table",
    },
  });

  // Board query (all apps, active when view=board)
  const boardParams = { page_size: 500, sort_col: "date" as const, sort_dir: "desc" as const };
  const { data: boardData } = useListApplications(boardParams, {
    query: {
      queryKey: getListApplicationsQueryKey(boardParams),
      enabled: view === "board",
    },
  });

  // Meta (sync time from whichever query has data)
  const metaData = view === "table" ? tableData : boardData;

  // Detail drawer
  const { data: detail } = useGetApplicationDetail(selectedNum ?? 0, {
    query: { queryKey: getGetApplicationDetailQueryKey(selectedNum ?? 0), enabled: selectedNum !== null },
  });

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  const totalPages = tableData ? Math.ceil(tableData.total / (tableData.page_size || 50)) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="shrink-0">
          <h1 className="text-sm font-semibold text-zinc-100 leading-tight">Applications</h1>
          <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">
            {metaData ? `${metaData.total} tracked` : "—"} · sync {relativeTime(metaData?.last_sync_at)}
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded border border-zinc-800 overflow-hidden ml-2 shrink-0">
          <button
            onClick={() => setView("table")}
            title="Table view"
            className={cn("px-2 py-1.5 transition-colors", view === "table" ? "bg-zinc-800 text-zinc-100" : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900")}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setView("board")}
            title="Board view"
            className={cn("px-2 py-1.5 transition-colors", view === "board" ? "bg-zinc-800 text-zinc-100" : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900")}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Table filters (hidden in board) */}
        {view === "table" && (
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <Input
              placeholder="Company…"
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              className="h-7 w-36 text-xs bg-zinc-900 border-zinc-800 placeholder:text-zinc-700"
            />
            <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-7 w-34 text-xs bg-zinc-900 border-zinc-800"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="evaluated">Evaluated</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
                <SelectItem value="oa">OA</SelectItem>
                <SelectItem value="responded">Responded</SelectItem>
                <SelectItem value="interview">Interview</SelectItem>
                <SelectItem value="offer">Offer</SelectItem>
                <SelectItem value="hired">Hired</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="discarded">Discarded</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scoreBandFilter || "all"} onValueChange={(v) => { setScoreBandFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-7 w-30 text-xs bg-zinc-900 border-zinc-800"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scores</SelectItem>
                <SelectItem value="high">≥ 4.0</SelectItem>
                <SelectItem value="mid">3.0–3.9</SelectItem>
                <SelectItem value="low">&lt; 3.0</SelectItem>
                <SelectItem value="unscored">Unscored</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {view === "board" ? (
        <BoardView apps={boardData?.items ?? []} />
      ) : (
        <>
          {/* Table */}
          <div className="flex-1 overflow-auto min-h-0">
            {isLoading && (
              <div className="flex items-center justify-center h-32 text-xs text-zinc-600 font-mono">Loading…</div>
            )}
            {isError && (
              <div className="flex items-center justify-center h-32 text-xs text-red-500">Failed to load. Check API server.</div>
            )}
            {tableData && (
              <Table className="text-xs">
                <TableHeader className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800">
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-10 text-right pr-4 py-2 text-[11px] text-zinc-700 font-mono">#</TableHead>
                    <SortableHead label="Company" col="company" current={sortCol} dir={sortDir} onSort={handleSort} />
                    <SortableHead label="Role" col="role" current={sortCol} dir={sortDir} onSort={handleSort} />
                    <SortableHead label="Score" col="score" current={sortCol} dir={sortDir} onSort={handleSort} className="w-20" />
                    <SortableHead label="Status" col="status" current={sortCol} dir={sortDir} onSort={handleSort} className="w-28" />
                    <SortableHead label="Days" col="days_in_stage" current={sortCol} dir={sortDir} onSort={handleSort} className="w-16" align="right" />
                    <TableHead className="w-8 text-center py-2 text-[11px] text-zinc-700">R</TableHead>
                    <TableHead className="w-8 text-center py-2 text-[11px] text-zinc-700">L</TableHead>
                    <TableHead className="w-8 text-center py-2 text-[11px] text-zinc-700" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-zinc-700 py-12 font-mono text-[11px]">
                        No applications match the current filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {tableData.items.map((row: ApplicationRow) => {
                    const activeChange = getActiveChange(row.num);
                    const hasPending = !!activeChange;
                    // Effective status: pending override if present
                    const effStatus =
                      activeChange?.kind === "status"
                        ? String(activeChange.payload["target_status"] ?? row.status)
                        : row.status;

                    return (
                      <TableRow
                        key={row.num}
                        className={cn(
                          "border-zinc-800/60 cursor-pointer transition-colors",
                          selectedNum === row.num ? "bg-zinc-900" : "hover:bg-zinc-900/60",
                          hasPending && "border-l-2 border-l-amber-700/60",
                        )}
                        onClick={() => setSelectedNum(selectedNum === row.num ? null : row.num)}
                      >
                        <TableCell className="text-right pr-4 font-mono text-zinc-600 py-2.5">{row.num}</TableCell>
                        <TableCell className="font-medium text-zinc-100 py-2.5">{row.company}</TableCell>
                        <TableCell className="text-zinc-400 py-2.5 max-w-[220px] truncate">{row.role}</TableCell>
                        <TableCell className="py-2.5"><ScoreBadge score={row.score} /></TableCell>
                        <TableCell className="py-2.5"><StatusChip status={effStatus} pending={hasPending && activeChange?.kind === "status"} /></TableCell>
                        <TableCell className="text-right font-mono text-zinc-500 py-2.5 pr-4">{row.days_in_stage}</TableCell>
                        <TableCell className="text-center py-2.5">
                          {row.resume_present ? <span className="text-emerald-500 text-[13px]">✓</span> : <span className="text-zinc-800">—</span>}
                        </TableCell>
                        <TableCell className="text-center py-2.5">
                          {row.letter_present ? <span className="text-emerald-500 text-[13px]">✓</span> : <span className="text-zinc-800">—</span>}
                        </TableCell>
                        <TableCell className="text-center py-2.5 text-sm">
                          {row.has_ghost_flag ? "👻" : ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Pagination */}
          {tableData && totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-2 border-t border-zinc-800 shrink-0">
              <Button variant="ghost" size="sm" className="h-6 text-xs text-zinc-500 hover:text-zinc-200"
                onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                ← Prev
              </Button>
              <span className="text-[11px] text-zinc-600 font-mono">{page} / {totalPages} · {tableData.total} total</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-zinc-500 hover:text-zinc-200"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next →
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Detail drawer ── */}
      <Sheet open={selectedNum !== null} onOpenChange={(open) => !open && setSelectedNum(null)}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 bg-zinc-950 border-l border-zinc-800 overflow-hidden">
          {detail ? (
            <ApplicationDrawer detail={detail} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-zinc-700 font-mono">Loading…</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
