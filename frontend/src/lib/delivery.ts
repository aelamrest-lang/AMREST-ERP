import type { SalesOrder, DeliverySchedule } from "./types";

export function totalOrderQty(so: SalesOrder): number {
  return (so.items || []).reduce((a, it) => a + (Number(it.qty) || 0), 0);
}

export function totalScheduledQty(so: SalesOrder): number {
  return (so.schedules || []).reduce((a, s) => a + (Number(s.qty) || 0), 0);
}

export function totalDeliveredQty(so: SalesOrder): number {
  return (so.schedules || []).reduce((a, s) => a + (Number(s.deliveredQty) || 0), 0);
}

export function unscheduledBalance(so: SalesOrder): number {
  return Math.max(0, totalOrderQty(so) - totalScheduledQty(so));
}

// --- Per-item variants ---
// A schedule slot with no itemName is treated as belonging to no specific item.
// When an SO has a single item, we may omit itemName; helpers below accept undefined too.
export function schedulesForItem(so: SalesOrder, itemName?: string): DeliverySchedule[] {
  const all = so.schedules || [];
  if (itemName === undefined) return all;
  return all.filter(s => (s.itemName || "") === itemName);
}

export function orderQtyForItem(so: SalesOrder, itemName: string): number {
  const it = (so.items || []).find(i => i.name === itemName);
  return Number(it?.qty) || 0;
}

export function scheduledQtyForItem(so: SalesOrder, itemName: string): number {
  return schedulesForItem(so, itemName).reduce((a, s) => a + (Number(s.qty) || 0), 0);
}

export function deliveredQtyForItem(so: SalesOrder, itemName: string): number {
  return schedulesForItem(so, itemName).reduce((a, s) => a + (Number(s.deliveredQty) || 0), 0);
}

export function unscheduledBalanceForItem(so: SalesOrder, itemName: string): number {
  return Math.max(0, orderQtyForItem(so, itemName) - scheduledQtyForItem(so, itemName));
}

export interface ScheduleStatus {
  pending: number;       // scheduled - delivered (>=0)
  balance: number;       // alias for pending (order-level balance = pending)
  isOverdue: boolean;
  isCompleted: boolean;
  delayDays: number;     // 0 unless overdue
}

export function scheduleStatus(s: DeliverySchedule, now: Date = new Date()): ScheduleStatus {
  const scheduled = Math.max(0, Number(s.qty) || 0);
  const delivered = Math.max(0, Number(s.deliveredQty) || 0);
  const pending = Math.max(0, scheduled - delivered);
  const isCompleted = pending === 0;

  const due = new Date(s.date);
  due.setHours(23, 59, 59, 999);
  const isOverdue = !isCompleted && !isNaN(due.getTime()) && now > due;

  const msPerDay = 24 * 60 * 60 * 1000;
  const delayDays = isOverdue ? Math.max(1, Math.floor((now.getTime() - due.getTime()) / msPerDay)) : 0;

  return { pending, balance: pending, isOverdue, isCompleted, delayDays };
}

export interface OrderDelayInfo {
  hasDelay: boolean;
  maxDelayDays: number;   // largest delay across schedules
  pendingQty: number;     // total pending across overdue schedules
  earliestOverdueDate?: string;
}

export function orderDelayInfo(so: SalesOrder, now: Date = new Date()): OrderDelayInfo {
  const schedules = so.schedules || [];
  let hasDelay = false, maxDelayDays = 0, pendingQty = 0;
  let earliest: string | undefined;
  schedules.forEach(s => {
    const st = scheduleStatus(s, now);
    if (st.isOverdue) {
      hasDelay = true;
      if (st.delayDays > maxDelayDays) maxDelayDays = st.delayDays;
      pendingQty += st.pending;
      if (!earliest || s.date < earliest) earliest = s.date;
    }
  });
  return { hasDelay, maxDelayDays, pendingQty, earliestOverdueDate: earliest };
}

/** True when the sum of scheduled qty exactly matches (or is within 1 unit of) the order qty. */
export function isScheduleBalanced(so: SalesOrder): boolean {
  return totalScheduledQty(so) === totalOrderQty(so);
}

export function canManageSchedule(so: SalesOrder, currentUser: { id: string; role: string } | null | undefined): boolean {
  if (!currentUser) return false;
  if (currentUser.role === "admin") return true;
  return so.ownerId === currentUser.id;
}
