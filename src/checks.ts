// Kontrolní agent (fáze 4) — rule-based, READ-ONLY nálezy ve třech doménách:
// compliance/ubyhost, billing/pohledávky a inventář. Slouží jako akční drill-down
// k ranímu briefingu: ten dává počty, tady jsou konkrétní položky (kdo/co/kde).
//
// Žádné LLM, žádné mutace, žádná odchozí komunikace s hostem (concierge záměrně
// neřešíme — náklady + souhlas; WhatsApp je dle pravidla jen pro personál).
import { ReservationStatus, EquipmentCondition } from "@prisma/client";
import { prisma } from "./prisma";
import { computeFolio } from "./reservations";
import { toDateOnly } from "./dates";

export type Severity = "high" | "medium" | "low";
export type Category = "compliance" | "billing" | "inventory";

export type Finding = {
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  ref: string | null; // čitelný odkaz (kód rezervace, kód kusu…)
};

export type ChecksResult = {
  generatedAt: string;
  counts: { high: number; medium: number; low: number; total: number };
  byCategory: { compliance: Finding[]; billing: Finding[]; inventory: Finding[] };
};

const MAX_PER_KIND = 100; // strop, ať se UI nezahltí; přebytek shrneme jednou položkou

// ── Compliance / ubyhost ─────────────────────────────────────
export async function complianceFindings(propertyId: string): Promise<Finding[]> {
  const today = toDateOnly(new Date());
  const out: Finding[] = [];

  const inHouse = await prisma.reservation.findMany({
    where: { propertyId, status: ReservationStatus.checked_in },
    select: { code: true, room: { select: { number: true } }, bed: { select: { label: true } },
      primaryGuest: { select: { firstName: true, lastName: true } }, _count: { select: { registrationEntries: true } } },
  });
  for (const r of inHouse) {
    if (r._count.registrationEntries === 0) {
      const unit = r.room ? `pokoj ${r.room.number}` : r.bed ? `lůžko ${r.bed.label}` : "—";
      out.push({ severity: "high", category: "compliance", title: "Ubytovaný host bez evidence",
        detail: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}, ${unit} — chybí zápis do evidenční knihy (ohlašovací povinnost).`, ref: r.code });
    }
  }

  const toPurge = await prisma.registrationEntry.count({ where: { reservation: { propertyId }, retentionUntil: { lt: today } } });
  if (toPurge > 0) out.push({ severity: "low", category: "compliance", title: "Evidence ke skartaci",
    detail: `${toPurge} evidenčních záznamů je po zákonné lhůtě uchování — lze skartovat (POST /maintenance/purge-registrations).`, ref: null });

  return out;
}

// ── Billing / pohledávky ─────────────────────────────────────
export async function billingFindings(propertyId: string): Promise<Finding[]> {
  const now = new Date();
  const out: Finding[] = [];

  const inHouse = await prisma.reservation.findMany({
    where: { propertyId, status: ReservationStatus.checked_in },
    select: { id: true, code: true, billingCycle: true, primaryGuest: { select: { firstName: true, lastName: true } } },
  });
  let monthly = 0;
  for (const r of inHouse) {
    if (r.billingCycle === "monthly") monthly++;
    const folio = await computeFolio(r.id);
    const bal = Number(folio.balance);
    if (bal > 0.005) out.push({ severity: "high", category: "billing", title: "Nevyrovnaný účet",
      detail: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName} dluží ${folio.balance.toFixed(0)} Kč.`, ref: r.code });
  }

  const expiredHolds = await prisma.reservation.count({ where: { propertyId, status: ReservationStatus.hold, holdExpiresAt: { lt: now } } });
  if (expiredHolds > 0) out.push({ severity: "medium", category: "billing", title: "Předběžné držby po expiraci",
    detail: `${expiredHolds} rezervací v držbě má prošlou platnost — uvolnit (POST /maintenance/release-holds).`, ref: null });

  if (monthly > 0) out.push({ severity: "low", category: "billing", title: "Měsíční fakturace",
    detail: `${monthly} dlouhodobých pobytů s měsíční fakturací — zkontrolovat vystavení faktur.`, ref: null });

  return out;
}

// ── Inventář / DHIM ──────────────────────────────────────────
export async function inventoryFindings(propertyId: string): Promise<Finding[]> {
  const out: Finding[] = [];

  const damaged = await prisma.equipmentItem.findMany({
    where: { propertyId, condition: EquipmentCondition.damaged },
    select: { name: true, code: true, room: { select: { number: true } } }, take: MAX_PER_KIND + 1,
  });
  for (const it of damaged.slice(0, MAX_PER_KIND)) {
    const loc = it.room ? `pokoj ${it.room.number}` : "sklad provozovny";
    out.push({ severity: "medium", category: "inventory", title: "Poškozené vybavení",
      detail: `${it.name} (${loc}) — vyřešit opravu nebo vyřazení.`, ref: it.code });
  }
  if (damaged.length > MAX_PER_KIND) out.push({ severity: "medium", category: "inventory", title: "Poškozené vybavení",
    detail: `…a další poškozené kusy (celkem přes ${MAX_PER_KIND}).`, ref: null });

  // Vyřazené kusy, které pořád „visí" v pokoji (měly by jít do skladu / k likvidaci).
  const retiredInRoom = await prisma.equipmentItem.findMany({
    where: { propertyId, condition: EquipmentCondition.retired, roomId: { not: null } },
    select: { name: true, code: true, room: { select: { number: true } } }, take: MAX_PER_KIND,
  });
  for (const it of retiredInRoom) out.push({ severity: "low", category: "inventory", title: "Vyřazený kus stále v pokoji",
    detail: `${it.name} (pokoj ${it.room?.number}) je vyřazený, ale stále umístěný v pokoji — přesunout/zlikvidovat.`, ref: it.code });

  return out;
}

// ── Agregace ─────────────────────────────────────────────────
const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export async function runChecks(propertyId: string): Promise<ChecksResult> {
  const [compliance, billing, inventory] = await Promise.all([
    complianceFindings(propertyId),
    billingFindings(propertyId),
    inventoryFindings(propertyId),
  ]);
  const sort = (a: Finding[]) => a.sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity]);
  sort(compliance); sort(billing); sort(inventory);

  const all = [...compliance, ...billing, ...inventory];
  const counts = {
    high: all.filter((f) => f.severity === "high").length,
    medium: all.filter((f) => f.severity === "medium").length,
    low: all.filter((f) => f.severity === "low").length,
    total: all.length,
  };
  return { generatedAt: new Date().toISOString(), counts, byCategory: { compliance, billing, inventory } };
}
