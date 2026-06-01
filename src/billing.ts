// Doklady (faktury, zálohy, účtenky) — tvorba s číselnými řadami a DPH dle
// plátcovství provozovny. Dodavatel i odběratel se ukládají jako SNÍMEK na doklad,
// aby byl neměnný. Karty se jen evidují (žádná integrace terminálu).
import { Prisma, BillingDocType, DocumentStatus, PaymentStatus, PaymentType } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly, addDays } from "./dates";
import { computeFolio } from "./reservations";

// Sazby DPH v ČR: ubytování 12 %, pobytový poplatek mimo DPH (0), ostatní 21 %.
export const VAT_ACCOMMODATION = 12;
export const VAT_DEFAULT = 21;

const PREFIX: Record<BillingDocType, string> = {
  proforma: "ZF",     // zálohová faktura
  advance_tax: "DDZ", // daňový doklad k záloze
  invoice: "FA",      // faktura
  receipt: "UCT",     // účtenka / doklad o zaplacení
  credit_note: "OD",  // opravný doklad
};

const round2 = (d: Prisma.Decimal) => new Prisma.Decimal(d.toFixed(2));
const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });

/** Atomicky vrátí další číslo řady: <PREFIX>-<ROK>-<NNNN>. */
async function nextNumber(tx: Prisma.TransactionClient, type: BillingDocType, year: number): Promise<string> {
  const key = `${type}-${year}`;
  const c = await tx.documentCounter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return `${PREFIX[type]}-${year}-${String(c.value).padStart(4, "0")}`;
}

/** Rozloží koncovou (gross) cenu na základ a DPH. rate<=0 → vše do základu. */
function splitVat(gross: Prisma.Decimal, rate: number): { base: Prisma.Decimal; vat: Prisma.Decimal } {
  if (rate <= 0) return { base: gross, vat: new Prisma.Decimal(0) };
  const base = round2(gross.div(1 + rate / 100));
  return { base, vat: gross.sub(base) };
}

export type LineInput = { label: string; qty?: number; unitPrice: Prisma.Decimal | number; vatRate: number };

const DOC_INCLUDE = { lines: true, property: true, reservations: { include: { reservation: { select: { code: true } } } } } as const;

type CreateDocInput = {
  propertyId: string;
  type: BillingDocType;
  customer: { name: string; address?: string | null; ico?: string | null; dic?: string | null };
  lines: LineInput[];
  reservationIds?: string[];
  paidTotal?: Prisma.Decimal | number;
  dueInDays?: number;
  taxDate?: Date | null;
  note?: string;
};

/** Jádro: vytvoří doklad se snímkem dodavatele, položkami a DPH. */
export async function createDocument(input: CreateDocInput) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.property.findUniqueOrThrow({ where: { id: input.propertyId } });
    const year = new Date().getFullYear();
    const number = await nextNumber(tx, input.type, year);

    let subtotal = new Prisma.Decimal(0);
    let vatTotal = new Prisma.Decimal(0);
    let total = new Prisma.Decimal(0);
    const lineData = input.lines.map((l) => {
      const qty = new Prisma.Decimal(l.qty ?? 1);
      const unit = new Prisma.Decimal(l.unitPrice);
      const gross = round2(unit.mul(qty));
      const rate = p.vatPayer ? l.vatRate : 0;
      const { base, vat } = splitVat(gross, rate);
      subtotal = subtotal.add(base); vatTotal = vatTotal.add(vat); total = total.add(gross);
      return { label: l.label, qty, unitPrice: unit, vatRate: new Prisma.Decimal(rate), lineTotal: gross };
    });

    const paid = new Prisma.Decimal(input.paidTotal ?? 0);
    const status: DocumentStatus = total.lessThanOrEqualTo(paid) ? DocumentStatus.paid : DocumentStatus.issued;

    return tx.document.create({
      data: {
        propertyId: p.id, type: input.type, number, status,
        taxDate: input.taxDate === null ? null : toDateOnly(input.taxDate ?? new Date()),
        dueDate: input.dueInDays != null ? addDays(new Date(), input.dueInDays) : null,
        supplierName: p.name, supplierAddress: [p.street, p.city].filter(Boolean).join(", ") || null, supplierIco: p.ico, supplierDic: p.dic,
        vatPayer: p.vatPayer,
        customerName: input.customer.name, customerAddress: input.customer.address ?? null, customerIco: input.customer.ico ?? null, customerDic: input.customer.dic ?? null,
        subtotal, vatTotal, total, paidTotal: paid, note: input.note,
        lines: { create: lineData },
        ...(input.reservationIds?.length ? { reservations: { create: input.reservationIds.map((reservationId) => ({ reservationId })) } } : {}),
      },
      include: DOC_INCLUDE,
    });
  });
}

// ── Odběratel a položky z rezervace ──────────────────────────
async function loadReservationForDoc(propertyId: string, reservationId: string) {
  const r = await prisma.reservation.findFirst({
    where: { id: reservationId, propertyId },
    include: { primaryGuest: true, roomType: true, payments: true },
  });
  if (!r) throw NOT_FOUND();
  return r;
}

function customerFromReservation(r: Awaited<ReturnType<typeof loadReservationForDoc>>) {
  if (r.billingCompany) return { name: r.billingCompany, ico: r.billingIco, dic: r.billingDic };
  return { name: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}` };
}

/** Položky vyúčtování rezervace: ubytování, pobytový poplatek, připsané položky. */
function linesFromReservation(r: Awaited<ReturnType<typeof loadReservationForDoc>>): LineInput[] {
  const lines: LineInput[] = [];
  const accommodation = r.totalAmount.sub(r.cityTax);
  lines.push({ label: `Ubytování — ${r.roomType?.name ?? "pokoj"} (${r.nights} ${r.nights === 1 ? "noc" : "nocí"})`, unitPrice: accommodation, vatRate: VAT_ACCOMMODATION });
  if (!r.cityTax.isZero()) lines.push({ label: "Pobytový poplatek", unitPrice: r.cityTax, vatRate: 0 });
  for (const pay of r.payments) {
    if (pay.status === PaymentStatus.succeeded && pay.type === PaymentType.extra) {
      lines.push({ label: pay.description ?? "Položka", unitPrice: pay.amount, vatRate: VAT_DEFAULT });
    }
  }
  return lines;
}

/** Konečná faktura / účtenka za pobyt (zúčtuje přijaté platby). */
export async function issueReservationDocument(propertyId: string, reservationId: string, type: BillingDocType = BillingDocType.invoice) {
  const r = await loadReservationForDoc(propertyId, reservationId);
  const folio = await computeFolio(reservationId);
  return createDocument({
    propertyId, type,
    customer: customerFromReservation(r),
    lines: linesFromReservation(r),
    reservationIds: [r.id],
    paidTotal: folio.paid,
    dueInDays: type === BillingDocType.invoice ? 14 : undefined,
  });
}

/** Zálohová faktura (proforma) na zadanou částku. */
export async function issueProforma(propertyId: string, reservationId: string, amount: number, dueInDays = 7) {
  const r = await loadReservationForDoc(propertyId, reservationId);
  return createDocument({
    propertyId, type: BillingDocType.proforma,
    customer: customerFromReservation(r),
    lines: [{ label: `Záloha na ubytování — rezervace ${r.code}`, unitPrice: amount, vatRate: 0 }],
    reservationIds: [r.id],
    dueInDays,
    taxDate: null,
  });
}

// ── Čtení ────────────────────────────────────────────────────
export function listDocuments(propertyId: string, filter: { type?: BillingDocType; from?: Date; to?: Date } = {}) {
  const where: Prisma.DocumentWhereInput = { propertyId };
  if (filter.type) where.type = filter.type;
  if (filter.from || filter.to) where.issuedAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: toDateOnly(addDays(filter.to, 1)) } : {}) };
  return prisma.document.findMany({
    where,
    include: { reservations: { include: { reservation: { select: { code: true } } } } },
    orderBy: { issuedAt: "desc" }, take: 500,
  });
}

export async function getDocument(propertyId: string, id: string) {
  const doc = await prisma.document.findFirst({ where: { id, propertyId }, include: DOC_INCLUDE });
  if (!doc) throw NOT_FOUND();
  return doc;
}

/** Storno dokladu (opravný doklad se řeší zvlášť). */
export async function cancelDocument(propertyId: string, id: string) {
  await prisma.document.updateMany({ where: { id, propertyId }, data: { status: DocumentStatus.cancelled } });
  return { ok: true };
}
