import { ReactNode, useState } from "react";
import { useStore } from "../lib/store";
import { cn } from "../utils/cn";
import { canAccessRoute, roleLabels, type RouteId } from "../lib/permissions";
import { IconBolt, IconDashboard, IconUsers, IconUser, IconBriefcase, IconFile, IconShop, IconBox, IconTruck, IconFactory, IconCart, IconClipboard, IconSettings, IconChart, IconLogout, IconSun, IconMoon, IconMenu, IconBell } from "./icons";

export type Route = RouteId;

const navGroups: { label: string; items: { id: Route; label: string; icon: any }[] }[] = [
  { label: "Overview", items: [
    { id: "dashboard", label: "Dashboard", icon: IconDashboard },
  ]},
  { label: "Sales CRM", items: [
    { id: "leads", label: "Sales CRM", icon: IconBriefcase },
    { id: "parties", label: "Party Master", icon: IconUsers },
    { id: "quotations", label: "Quotations", icon: IconFile },
    { id: "proformas", label: "Proforma Invoices", icon: IconFile },
    { id: "salesorders", label: "Sales Orders", icon: IconShop },
  ]},
  { label: "Procurement", items: [
    { id: "purchase", label: "Purchase Orders", icon: IconCart },
    { id: "grn", label: "Goods Receipt (GRN)", icon: IconBox },
  ]},
  { label: "Inventory & Production", items: [
    { id: "items", label: "Item Master", icon: IconBox },
    { id: "inventory", label: "Inventory", icon: IconBox },
    { id: "rawissue", label: "Raw Material Issue", icon: IconClipboard },
    { id: "bom", label: "Bill of Material", icon: IconClipboard },
    { id: "jobcards", label: "Job Cards", icon: IconClipboard },
    { id: "production", label: "Production", icon: IconFactory },
    { id: "testing", label: "QC Testing", icon: IconClipboard },
    { id: "challans", label: "Delivery Challan", icon: IconTruck },
  ]},
  { label: "Insights", items: [
    { id: "reports", label: "Reports", icon: IconChart },
  ]},
  { label: "Administration", items: [
    { id: "users", label: "Users", icon: IconUser },
    { id: "logs", label: "Activity Logs", icon: IconBell },
    { id: "settings", label: "Company Settings", icon: IconSettings },
    { id: "docformats", label: "Document Format Settings", icon: IconFile },
  ]},
];

export function Layout({ route, setRoute, children }: { route: Route; setRoute: (r: Route) => void; children: ReactNode }) {
  const { currentUser, logout, theme, toggleTheme, db } = useStore();
  const [open, setOpen] = useState(false);
  const canSeeLowStock = currentUser?.role === "admin" || currentUser?.role === "store";

  const lowStock = db.items.filter(i => i.currentStock <= i.minStock).length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-40 w-64 bg-gradient-to-b from-slate-900 to-slate-950 text-slate-200 transition-transform lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-16 flex items-center gap-2 px-5 border-b border-slate-800">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-white shadow overflow-hidden">
            {db.settings.logoUrl ? <img src={db.settings.logoUrl} alt="Logo" className="h-full w-full object-contain bg-white" /> : <IconBolt size={20} />}
          </div>
          <div className="leading-tight">
            <div className="font-bold text-white text-sm">AMREST</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Electricals Ltd.</div>
          </div>
        </div>
        <nav className="overflow-y-auto h-[calc(100vh-4rem)] py-3 px-2 space-y-3">
          {navGroups.map(group => {
            const visible = group.items.filter(i => canAccessRoute(currentUser, i.id));
            if (!visible.length) return null;
            return (
              <div key={group.label}>
                <div className="px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{group.label}</div>
                <div className="space-y-0.5">
                  {visible.map(item => {
                    const Icon = item.icon;
                    const active = route === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setRoute(item.id); setOpen(false); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition",
                          active ? "bg-indigo-600 text-white shadow" : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                        )}
                      >
                        <Icon size={16} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 lg:px-6 gap-3 sticky top-0 z-20">
          <button className="lg:hidden p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setOpen(true)}>
            <IconMenu />
          </button>
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Welcome back,</div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{currentUser?.name}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canSeeLowStock && lowStock > 0 && (
              <button onClick={() => setRoute("inventory")} className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" title={`${lowStock} items low on stock`}>
                <IconBell />
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{lowStock}</span>
              </button>
            )}
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" title="Toggle theme">
              {theme === "light" ? <IconMoon /> : <IconSun />}
            </button>
            <button onClick={() => setRoute("profile")} className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-sm font-bold">
                {currentUser?.name.charAt(0)}
              </div>
              <div className="leading-tight text-left">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{currentUser?.name}</div>
                <div className="text-[10px] uppercase text-slate-500">{currentUser ? roleLabels[currentUser.role] : ""}</div>
              </div>
            </button>
            <button onClick={logout} className="p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 text-rose-600" title="Logout">
              <IconLogout />
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
