import { Link, useRoute } from "wouter";
import {
  Briefcase,
  LayoutGrid,
  Sun,
  ClipboardList,
  BarChart3,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Applications", href: "/applications", icon: Briefcase, enabled: true },
  { label: "Board", href: "/board", icon: LayoutGrid, enabled: false },
  { label: "Today", href: "/today", icon: Sun, enabled: false },
  { label: "Queue", href: "/queue", icon: ClipboardList, enabled: false },
  { label: "Analytics", href: "/analytics", icon: BarChart3, enabled: false },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, enabled: false },
];

function NavLink({ item }: { item: NavItem }) {
  const [isActive] = useRoute(item.href + "(.*)");

  if (!item.enabled) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-md cursor-not-allowed select-none opacity-30">
        <item.icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">{item.label}</span>
      </div>
    );
  }

  return (
    <Link href={item.href}>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors",
          isActive
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900",
        )}
      >
        <item.icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">{item.label}</span>
      </div>
    </Link>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside className="w-44 shrink-0 flex flex-col border-r border-zinc-800/60">
        {/* Brand */}
        <div className="px-4 pt-4 pb-3 border-b border-zinc-800/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-blue-500/90 flex items-center justify-center shadow-sm shadow-blue-900">
              <span className="text-[9px] font-bold text-white tracking-tight">J</span>
            </div>
            <span className="text-xs font-bold tracking-[0.15em] text-zinc-200 uppercase">
              Jarvis
            </span>
          </div>
          <p className="text-[10px] text-zinc-600 mt-0.5 tracking-wide">
            Mission Control
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 pb-3 pt-2 border-t border-zinc-800/60 shrink-0">
          <p className="text-[10px] text-zinc-700 font-mono">Stage 2 / 8</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
