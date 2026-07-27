import { useState, useRef } from "react";
import { Upload, Check, AlertCircle, Save, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useGetSettings,
  useUpdateSettings,
  useSubmitFallbackIngest,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme, type Theme } from "@/hooks/use-theme";

// ─── Theme Toggle ──────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "dark", label: "Dark", icon: Moon },
    { value: "light", label: "Light", icon: Sun },
  ];

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs text-zinc-400">Theme</p>
        <p className="text-[10px] text-zinc-600 mt-0.5">Saved on this device.</p>
      </div>
      <div className="flex items-center rounded-md border border-zinc-800 p-0.5 gap-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
              theme === opt.value
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300",
            )}
            aria-pressed={theme === opt.value}
          >
            <opt.icon className="h-3 w-3" />
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Ingest Drop Zone ──────────────────────────────────────────────────────────

function IngestDropZone() {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const ingestMut = useSubmitFallbackIngest();

  async function process(text: string) {
    setStatus("loading");
    setMsg("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setStatus("error");
      setMsg("Invalid JSON — check your file");
      return;
    }
    try {
      const res = await ingestMut.mutateAsync({ data: parsed as Record<string, unknown> });
      const counts = Object.entries(res.counts ?? {})
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      setStatus("done");
      setMsg(counts || "Done");
      toast.success(`Ingest complete: ${counts || "no counts returned"}`);
      setTimeout(() => { setStatus("idle"); setMsg(""); }, 5000);
    } catch (e) {
      setStatus("error");
      setMsg(e instanceof Error ? e.message : "Ingest failed — check API server");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0]!;
    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setStatus("error");
      setMsg("Please drop a .json file");
      return;
    }
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
      onClick={() => status !== "loading" && fileRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors text-center",
        dragging
          ? "border-blue-500 bg-blue-950/20 text-blue-300"
          : status === "done"
          ? "border-emerald-800 bg-emerald-950/10"
          : status === "error"
          ? "border-red-800 bg-red-950/10"
          : status === "loading"
          ? "border-zinc-700 bg-zinc-900/20 cursor-wait"
          : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/10",
      )}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {status === "loading" ? (
        <>
          <div className="h-5 w-5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          <p className="text-xs text-zinc-500">Ingesting…</p>
        </>
      ) : status === "done" ? (
        <>
          <Check className="h-5 w-5 text-emerald-500" />
          <p className="text-xs text-emerald-400 font-medium">Ingest complete</p>
          <p className="text-[10px] text-zinc-600 font-mono">{msg}</p>
        </>
      ) : status === "error" ? (
        <>
          <AlertCircle className="h-5 w-5 text-red-500" />
          <p className="text-xs text-red-400 font-medium">Failed</p>
          <p className="text-[10px] text-zinc-600">{msg}</p>
          <p className="text-[10px] text-zinc-700">Click to try again</p>
        </>
      ) : (
        <>
          <Upload className="h-6 w-6 text-zinc-600" />
          <p className="text-sm text-zinc-400 font-medium">Drop tracker JSON here</p>
          <p className="text-xs text-zinc-600">or click to pick a file</p>
          <p className="text-[10px] text-zinc-700 mt-1">
            Same payload as <code className="font-mono bg-zinc-900 px-1 py-0.5 rounded">POST /api/ingest</code>
          </p>
        </>
      )}
    </div>
  );
}

// ─── Weekly Target ─────────────────────────────────────────────────────────────

function WeeklyTargetEditor() {
  const { data, isLoading } = useGetSettings();
  const updateMut = useUpdateSettings();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const currentTarget = data?.weekly_target ?? 10;

  function startEdit() {
    setValue(String(currentTarget));
    setEditing(true);
  }

  async function save() {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      toast.error("Target must be between 1 and 1000");
      return;
    }
    setSaving(true);
    try {
      await updateMut.mutateAsync({ data: { weekly_target: n } });
      await qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      setEditing(false);
      toast.success(`Weekly target updated to ${n}`);
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            {isLoading ? (
              <span className="text-2xl font-mono font-bold text-zinc-600">—</span>
            ) : editing ? (
              <Input
                type="number"
                min={1}
                max={1000}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="h-9 w-24 text-lg font-mono bg-zinc-900 border-zinc-700"
                autoFocus
              />
            ) : (
              <span className="text-2xl font-mono font-bold text-zinc-100">{currentTarget}</span>
            )}
            <span className="text-xs text-zinc-600">applications / week</span>
          </div>
          <p className="text-[10px] text-zinc-700 mt-1">
            Used in the Today view weekly progress bar.
          </p>
        </div>
        {editing ? (
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>
              {saving ? "Saving…" : <><Save className="h-3 w-3 mr-1" />Save</>}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700 shrink-0" onClick={startEdit}>
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="px-5 py-3 border-b border-zinc-800 shrink-0">
        <h1 className="text-sm font-semibold text-zinc-100">Settings</h1>
        <p className="text-[11px] text-zinc-600 mt-0.5">App configuration and data management</p>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-xl">
        {/* Appearance */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wider">Appearance</h2>
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4">
            <ThemeToggle />
          </div>
        </section>

        {/* Weekly goal */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wider">Weekly Application Goal</h2>
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4">
            <WeeklyTargetEditor />
          </div>
        </section>

        {/* Ingest upload */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-300 mb-1 uppercase tracking-wider">Fallback Ingest</h2>
          <p className="text-[11px] text-zinc-600 mb-3">
            If your Mac can't push directly, drop the tracker JSON export here. Uses the same validation as the CLI ingest endpoint.
          </p>
          <IngestDropZone />
          <div className="mt-2 bg-zinc-900/30 border border-zinc-800 rounded p-3">
            <p className="text-[10px] text-zinc-600 font-mono mb-1">Expected format</p>
            <pre className="text-[10px] text-zinc-700 font-mono leading-relaxed whitespace-pre-wrap">{`{
  "payload_version": 1,
  "applications": [...],
  "status_events": [...],
  "queue": [...],
  "evals": [...],
  ...
}`}</pre>
          </div>
        </section>

        {/* Danger zone info */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wider">About</h2>
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-600">Auth mode</span>
              <span className="font-mono text-zinc-400">{import.meta.env.MODE}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-600">Build stage</span>
              <span className="font-mono text-zinc-400">8 / 8</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-600">Data source</span>
              <span className="font-mono text-zinc-400">Mac push → POST /api/ingest</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
