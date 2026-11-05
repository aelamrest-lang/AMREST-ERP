import { useStore } from "../lib/store";
import { Button, Modal } from "./ui";

const fmt = (v: any) => v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v);
const STATE: Record<string, { label: string; cls: string }> = {
  saving: { label: "Saving…", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900" },
  saved: { label: "Saved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  unsaved: { label: "Unsaved changes", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
  failed: { label: "Save failed", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900" },
  conflict: { label: "Conflict detected", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900" },
  expired: { label: "Session expired", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900" },
};

export function SaveIndicator() {
  const { saveState } = useStore();
  const s = STATE[saveState];
  return <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border whitespace-nowrap ${s.cls}`} data-testid="save-indicator" data-state={saveState}>{s.label}</span>;
}

export function SaveBanner() {
  const { saveState, syncError, syncNow, logout, conflicts, resolveConflicts } = useStore();
  return (
    <>
      {(saveState === "failed" || saveState === "expired") && (
        <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm text-rose-800 dark:text-rose-300" data-testid="sync-error-banner">
          <b>Not saved to server.</b><span className="flex-1">{syncError}</span>
          {saveState === "expired"
            ? <button type="button" onClick={() => logout()} className="px-3 py-1 rounded-md bg-rose-600 text-white text-xs font-semibold" data-testid="sync-relogin-btn">Log in again</button>
            : /Reload the page/.test(syncError)
              ? <button type="button" onClick={() => window.location.reload()} className="px-3 py-1 rounded-md bg-rose-600 text-white text-xs font-semibold" data-testid="sync-reload-btn">Reload page</button>
              : <button type="button" onClick={() => syncNow()} className="px-3 py-1 rounded-md bg-rose-600 text-white text-xs font-semibold" data-testid="sync-retry-btn">Retry now</button>}
        </div>
      )}
      <Modal open={saveState === "conflict" && conflicts.length > 0} onClose={() => {}} title="Conflict detected — another user changed the same record" size="xl">
        <div className="space-y-4 text-sm" data-testid="conflict-panel">
          <p className="text-slate-600 dark:text-slate-300">Nothing has been overwritten. Your changes below are NOT saved yet. Review them against the latest saved values.</p>
          {conflicts.map((c, i) => (
            <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700" data-testid={`conflict-item-${i}`}>
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 font-semibold text-xs">{c.label} {c.reason === "deleted" && <span className="text-rose-600">· deleted by another user</span>}</div>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500"><th className="px-3 py-1.5">Field</th><th className="px-3 py-1.5">When you opened it</th><th className="px-3 py-1.5">Your change</th><th className="px-3 py-1.5">Latest saved (other user)</th></tr></thead>
                <tbody>{c.fields.slice(0, 12).map(f => (
                  <tr key={f.field} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-1.5 font-medium">{f.field}</td><td className="px-3 py-1.5 text-slate-500">{fmt(f.base)}</td>
                    <td className="px-3 py-1.5 text-indigo-700 dark:text-indigo-300 font-semibold">{fmt(f.mine)}</td><td className="px-3 py-1.5 text-amber-700 dark:text-amber-300 font-semibold">{fmt(f.theirs)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          <div className="flex flex-wrap justify-end gap-2 border-t pt-3 dark:border-slate-700">
            <Button variant="outline" onClick={() => resolveConflicts("reload")} data-testid="conflict-reload-btn">Reload latest (discard my changes to these records)</Button>
            <Button onClick={() => resolveConflicts("reapply")} data-testid="conflict-reapply-btn">Re-apply my changes on the latest version</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
