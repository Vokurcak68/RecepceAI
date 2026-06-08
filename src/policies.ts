// Storno / zálohové politiky + automatika (no-show, připomínky před příjezdem).
// Pravidla jsou na provozovně (freeCancelDays/cancelFeePct/depositPct/
// reminderHours/noShowHours). Automatika běží in-process jako u iCalu.
import { ReservationStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly, addDays } from "./dates";
import { computeFolio } from "./reservations";
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

/** Denní úklid: na provozovnách s `dailyCleaning` označí obsazené pokoje bez
 * dnešního odjezdu jako „Zkontrolovat" (to_inspect). 1× denně na pokoj (dedup
 * přes `dailyServiceDate`); nepřepisuje dirty/out_of_service. */
export async function processDailyService(): Promise<number> {
  const today = toDateOnly(new Date());
  const props = await prisma.property.findMany({ where: { dailyCleaning: true }, select: { id: true } });
  if (!props.length) return 0;
  const occ = await prisma.reservation.findMany({
    where: { propertyId: { in: props.map((p) => p.id) }, status: ReservationStatus.checked_in, roomId: { not: null }, checkOutDate: { gt: today } },
    select: { id: true, roomId: true },
  });
  const resByRoom = new Map<string, string>();
  for (const r of occ) if (!resByRoom.has(r.roomId!)) resByRoom.set(r.roomId!, r.id);
  const roomIds = [...resByRoom.keys()];
  if (!roomIds.length) return 0;
  const rooms = await prisma.room.findMany({
    where: { id: { in: roomIds }, OR: [{ dailyServiceDate: null }, { dailyServiceDate: { lt: today } }] },
    select: { id: true, status: true, propertyId: true },
  });
  let tasks = 0;
  for (const r of rooms) {
    const ready = r.status === "clean" || r.status === "inspected";
    await prisma.room.update({ where: { id: r.id }, data: { dailyServiceDate: today, ...(ready ? { status: "to_inspect" } : {}) } });
    if (r.status === "out_of_service") continue; // mimo provoz neuklízíme
    // úkol denního úklidu do fronty (dedup: jen když není otevřený stejný úkol)
    const open = await prisma.serviceRequest.count({ where: { roomId: r.id, type: "cleaning", description: "Denní úklid", status: { in: ["open", "in_progress"] } } });
    if (!open) {
      await prisma.serviceRequest.create({ data: { propertyId: r.propertyId, reservationId: resByRoom.get(r.id), roomId: r.id, type: "cleaning", domain: "housekeeping", description: "Denní úklid", fromGuest: false } });
      tasks++;
    }
  }
  if (tasks) console.log(`[policies] denní úklid: ${tasks} úkolů + pokoje → Zkontrolovat`);
  return tasks;
}

/** Platba předem: den před vypršením lhůty pošle připomínku s QR, po vypršení
 * neuhrazenou nefiremní rezervaci automaticky stornuje. Dedup připomínky přes EmailLog. */
export async function processPrepay(): Promise<{ reminded: number; cancelled: number }> {
  const today = toDateOnly(new Date());
  const tomorrow = addDays(today, 1);
  const list = await prisma.reservation.findMany({
    where: {
      prepayDueAt: { not: null },
      status: { in: [ReservationStatus.pending, ReservationStatus.confirmed] },
      companyId: null, billingCompany: null, // firemní/faktura se předem QR neplatí
    },
    select: { id: true, prepayDueAt: true },
    take: 500,
  });
  let reminded = 0, cancelled = 0;
  for (const r of list) {
    const folio = await computeFolio(r.id);
    if (folio.balance.lte(0)) continue; // už uhrazeno → bez akce
    const due = toDateOnly(r.prepayDueAt!);
    if (due.getTime() < today.getTime()) {
      // lhůta prošla a stále neuhrazeno → auto-storno + e-mail
      await prisma.reservation.update({ where: { id: r.id }, data: { status: ReservationStatus.cancelled } });
      await mailer.sendCancellation(r.id);
      cancelled++;
    } else if (due.getTime() === tomorrow.getTime()) {
      // den před vypršením → připomínka (1× na rezervaci)
      if (await prisma.emailLog.count({ where: { reservationId: r.id, type: "prepay_reminder" } })) continue;
      await mailer.sendPrepayReminder(r.id);
      reminded++;
    }
  }
  if (reminded || cancelled) console.log(`[policies] platba předem: ${reminded} připomínek, ${cancelled} storno`);
  return { reminded, cancelled };
}

// ── Scheduler (in-process, hodinový) ─────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startPolicyScheduler() {
  const run = async () => {
    if (running) return;
    running = true;
    try { await processNoShows(); await sendReminders(); await processPrepay(); await processDailyService(); }
    catch (e) { console.error(`[policies] chyba: ${(e as Error).message}`); }
    finally { running = false; }
  };
  setTimeout(() => { void run(); }, 90_000); // ~1,5 min po startu
  timer = setInterval(() => { void run(); }, 60 * 60 * 1000); // každou hodinu
  console.log("[policies] automatika (no-show + připomínky) každou hodinu");
}

export function stopPolicyScheduler() { if (timer) { clearInterval(timer); timer = null; } }
