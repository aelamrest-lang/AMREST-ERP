import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../lib/types";
import { Input } from "./ui";
import { IconSearch } from "./icons";

interface Props {
  items: Item[];
  value: string;
  onPick: (item: Item) => void;
  placeholder?: string;
  testId?: string;
  onCreateNew?: (seedName: string) => void;
}

export function FinishedGoodCombobox({ items, value, onPick, placeholder = "Search item by name or code...", testId, onCreateNew }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const displayText = open ? query : (value || "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it =>
      it.name.toLowerCase().includes(q) ||
      (it.hsn || "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const recomputePos = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPopupPos({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recomputePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => recomputePos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const pick = (it: Item) => {
    onPick(it);
    setOpen(false);
    setQuery("");
  };

  const triggerCreate = () => {
    if (!onCreateNew) return;
    const seed = query.trim();
    setOpen(false);
    setQuery("");
    onCreateNew(seed);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const onBlur = () => {
    setTimeout(() => {
      if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) {
        setOpen(false);
        setQuery("");
      }
    }, 0);
  };

  return (
    <div className="relative" ref={wrapRef} onBlur={onBlur}>
      <div className="relative">
        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
        <Input
          className="pl-9"
          value={displayText}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setHighlight(0); }}
          onChange={(e: any) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={handleKey}
          data-testid={testId}
        />
      </div>
      {open && (
        <div
          className="fixed z-[100] max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
          style={{ top: popupPos.top, left: popupPos.left, width: popupPos.width }}
        >
          {filtered.length === 0 && !onCreateNew && <div className="p-3 text-sm text-slate-500">No finished goods match “{query}”.</div>}
          {filtered.length === 0 && onCreateNew && (
            <div className="p-3 text-sm text-slate-500">
              No finished goods match “{query}”.
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); triggerCreate(); }}
                className="mt-2 block w-full text-left px-2 py-1.5 rounded bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-200 font-medium"
                data-testid={testId ? `${testId}-create-new-empty` : undefined}
              >
                + Create new finished good{query.trim() ? ` "${query.trim()}"` : ""}
              </button>
            </div>
          )}
          {filtered.map((it, idx) => (
            <button
              type="button"
              key={it.id}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
              onMouseEnter={() => setHighlight(idx)}
              data-testid={testId ? `${testId}-option-${it.id}` : undefined}
              className={"w-full text-left px-3 py-2 flex items-start justify-between gap-3 " + (idx === highlight ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-800 dark:text-slate-100 truncate">{it.name}</div>
                <div className="text-xs text-slate-500 truncate">
                  {[it.hsn && `HSN ${it.hsn}`, `₹${it.saleRate || 0}`, `${it.gstRate}% GST`, `Stock: ${it.currentStock}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              {it.name === value && <span className="text-xs text-indigo-600 font-semibold">Selected</span>}
            </button>
          ))}
          {filtered.length > 0 && onCreateNew && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); triggerCreate(); }}
              className="w-full text-left px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-indigo-50 dark:bg-slate-800/60 dark:hover:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 font-medium text-sm sticky bottom-0"
              data-testid={testId ? `${testId}-create-new` : undefined}
            >
              + Create new finished good{query.trim() ? ` "${query.trim()}"` : "..."}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
