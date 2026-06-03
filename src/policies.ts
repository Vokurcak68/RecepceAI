// Storno / zálohové politiky + automatika (no-show, připomínky před příjezdem).
// Pravidla jsou na provozovně (freeCancelDays/cancelFeePct/depositPct/
// reminderHours/noShowHours). Automatika běží in-process jako u iCalu.
import { ReservationStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly } from "./dates";
import * as mailer from "./mailer";

const MS_DAY = 86_400_000;

/** Storno poplatek dle politiky provozovny. Bezplatné do `freeCancelDays` dní
 * před příjezdem; po lhůtě `cancelFeePct` % z ceny. */
export function computeCancellationFee(
  prop: { freeCancelDays: number; cancelFeePct: number },
  res: { checkInDate: Date; totalAmount: Prisma.Decimal },
  now: Date = new Date(),
): { fee: number; withinFree: boolean; freeUntil: Date } {
  const freeUntil = new Date(res.checkInDate.getTime() - prop.freeCancelDays * MS_DAY);
  const withinFree = now.getTime() < freeUntil.getTime();
  const fee = !withinFree && prop.cancelFeePct > 0 ? Math.round(Number(res.totalAmount) * prop.cancelFeePct / 100) : 0;
  return { fee, withinFree, freeUntil };
}

/** Požadovaná záloha dle politiky (informativně). */
export function computeDeposit(prop: { depositPct: number }, total: Prisma.Decimal | number): number {
  return prop.depositPct > 0 ? Math.round(Number(total) * prop.depositPct / 100) : 0;
}

// ── Automatika ───────────────────────────────────────────────
/** Nedoražení hosté → no-show (po `noShowHours` od data příjezdu). */
export async function processNoShows(): Promise<number> {
  const props = await prisma.property.findMany({ where: { noShowHours: { gt: 0 } }, select: { id: true, noShowHours: true } });
  let total = 0;
  for (const p of props) {
    const cutoff = new Date(Date.now() - p.noShowHours * 3_600_000);
    const r = await prisma.reservation.updateMany({
      where: { propertyId: p.id, status: { in: [ReservationStatus.confirmed, ReservationStatus.pending] }, checkInDate: { lt: cutoff } },
      data: { status: ReservationStatus.no_show },
    });
    if (r.count) { total += r.count; console.log(`[policies] no-show: ${r.count} rezervací (provozovna ${p.id})`); }
  }
  return total;
}

/** Připomínky před příjezdem (H hodin předem), 1× na rezervaci (dedup přes EmailLog). */
export async function sendReminders(): Promise<number> {
  const props = await prisma.property.findMany({ where: { reminderHours: { gt: 0 } }, select: { id: true, reminderHours: true } });
  const today0 = toDateOnly(new Date());
  let sent = 0;
  for (const p of props) {
    const windowEnd = new Date(Date.now() + p.reminderHours * 3_600_000);
    const res = await prisma.reservation.findMany({
      where: { propertyId: p.id, status: ReservationStatus.confirmed, checkInDate: { gte: today0, lte: windowEnd } },
      select: { id: true }, take: 300,
    });
    for (const r of res) {
      if (await prisma.emailLog.count({ where: { reservationId: r.id, type: "reminder" } })) continue;
      await mailer.sendReminder(r.id);
      sent++;
    }
  }
  return sent;
}

// ── Scheduler (in-process, hodinový) ─────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startPolicyScheduler() {
  const run = async () => {
    if (running) return;
    running = true;
    try { await processNoShows(); await sendReminders(); }
    catch (e) { console.error(`[policies] chyba: ${(e as Error).message}`); }
    finally { running = false; }
  };
  setTimeout(() => { void run(); }, 90_000); // ~1,5 min po startu
  timer = setInterval(() => { void run(); }, 60 * 60 * 1000); // každou hodinu
  console.log("[policies] automatika (no-show + připomínky) každou hodinu");
}

export function stopPolicyScheduler() { if (timer) { clearInterval(timer); timer = null; } }
