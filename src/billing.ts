// Doklady (faktury, zálohy, účtenky) — tvorba s číselnými řadami a DPH dle
// plátcovství provozovny. Dodavatel i odběratel se ukládají jako SNÍMEK na doklad,
// aby byl neměnný. Karty se jen evidují (žádná integrace terminálu).
import { Prisma, BillingDocType, DocumentStatus, PaymentStatus, PaymentType, PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly, addDays, nightsBetween } from "./dates";
import { computeFolio, CHARGE_LABEL } from "./reservations";
import * as cash from "./cashregister";

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
const iso = (d: Date) => toDateOnly(d).toISOString().slice(0, 10);
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
        // Dodavatel = provozovatel (fakturující firma), pokud je vyplněn; jinak fallback na údaje provozovny.
        supplierName: p.operatorName || p.name,
        supplierAddress: p.operatorAddress || ([p.street, p.city].filter(Boolean).join(", ") || null),
        supplierIco: p.operatorIco || p.ico,
        supplierDic: p.operatorDic || p.dic,
        supplierRegistration: p.operatorRegistration || null,
        supplierAccount: p.operatorAccount || null,
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
    include: { primaryGuest: true, roomType: true, payments: true, charges: true, company: true },
  });
  if (!r) throw NOT_FOUND();
  return r;
}

function customerFromReservation(r: Awaited<ReturnType<typeof loadReservationForDoc>>) {
  // Přednost má přiřazená firma (centrální), pak starší volný override, jinak host.
  if (r.company) {
    const address = [r.company.street, [r.company.zip, r.company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
    return { name: r.company.name, address, ico: r.company.ico, dic: r.company.dic };
  }
  if (r.billingCompany) return { name: r.billingCompany, ico: r.billingIco, dic: r.billingDic };
  return { name: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}` };
}

/** Položky vyúčtování rezervace: ubytování, pobytový poplatek, připsané položky účtu. */
function linesFromReservation(r: Awaited<ReturnType<typeof loadReservationForDoc>>): LineInput[] {
  const lines: LineInput[] = [];
  const accommodation = r.totalAmount.sub(r.cityTax);
  lines.push({ label: `Ubytování — ${r.roomType?.name ?? "pokoj"} (${r.nights} ${r.nights === 1 ? "noc" : "nocí"})`, unitPrice: accommodation, vatRate: VAT_ACCOMMODATION });
  if (!r.cityTax.isZero()) lines.push({ label: "Pobytový poplatek", unitPrice: r.cityTax, vatRate: 0 });
  for (const c of r.charges) {
    lines.push({ label: `${CHARGE_LABEL[c.category]}${c.description ? ` — ${c.description}` : ""}`, qty: Number(c.quantity), unitPrice: c.unitPrice, vatRate: Number(c.vatRate) });
  }
  return lines;
}

/** Odečet uhrazených záloh — mínusové řádky do konečné faktury (advance settlement). */
async function advanceDeductions(reservationId: string): Promise<LineInput[]> {
  const advances = await prisma.document.findMany({
    where: { status: { not: DocumentStatus.cancelled }, reservations: { some: { reservationId } }, type: { in: [BillingDocType.advance_tax, BillingDocType.proforma] } },
    include: { lines: true }, orderBy: { issuedAt: "asc" },
  });
  const tax = advances.filter((a) => a.type === BillingDocType.advance_tax);
  const use = tax.length ? tax : advances.filter((a) => a.type === BillingDocType.proforma && a.status === DocumentStatus.paid);
  return use.map((a) => ({ label: `Odečet zálohy ${a.number}`, unitPrice: a.total.neg(), vatRate: Number(a.lines[0]?.vatRate ?? 0) }));
}

/** Konečná faktura / účtenka za pobyt. Faktura odečte uhrazené zálohy. */
export async function issueReservationDocument(propertyId: string, reservationId: string, type: BillingDocType = BillingDocType.invoice) {
  const r = await loadReservationForDoc(propertyId, reservationId);
  const folio = await computeFolio(reservationId);
  const lines = linesFromReservation(r);
  let paidTotal: Prisma.Decimal | number = 0;
  if (type === BillingDocType.receipt) {
    paidTotal = folio.paid; // účtenka potvrzuje, co bylo zaplaceno
  } else if (type === BillingDocType.invoice) {
    lines.push(...(await advanceDeductions(reservationId))); // odečet uhrazených záloh
  }
  return createDocument({ propertyId, type, customer: customerFromReservation(r), lines, reservationIds: [r.id], paidTotal, dueInDays: type === BillingDocType.invoice ? 14 : undefined });
}

/** Periodická faktura za období (dlouhodobí) — poměrná část ubytování. */
export async function issuePeriodInvoice(propertyId: string, reservationId: string, from: Date, to: Date) {
  const r = await loadReservationForDoc(propertyId, reservationId);
  const nights = nightsBetween(from, to);
  if (nights < 1) throw new Error("Neplatné období.");
  const dailyAccommodation = r.totalAmount.sub(r.cityTax).div(r.nights);
  const accommodation = round2(dailyAccommodation.mul(nights));
  return createDocument({
    propertyId, type: BillingDocType.invoice,
    customer: customerFromReservation(r),
    lines: [{ label: `Ubytování za období ${iso(from)} – ${iso(to)} (${nights} ${nights === 1 ? "noc" : "nocí"})`, unitPrice: accommodation, vatRate: VAT_ACCOMMODATION }],
    reservationIds: [r.id], dueInDays: 14, note: `Periodická faktura za období ${iso(from)} – ${iso(to)}`,
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

/** Daňový doklad k přijaté záloze (plátce DPH) — z uhrazené zálohové faktury. */
export async function issueAdvanceTaxDoc(propertyId: string, proformaId: string) {
  const pf = await prisma.document.findFirst({ where: { id: proformaId, propertyId, type: BillingDocType.proforma }, include: { reservations: true } });
  if (!pf) throw NOT_FOUND();
  return createDocument({
    propertyId, type: BillingDocType.advance_tax,
    customer: { name: pf.customerName, address: pf.customerAddress, ico: pf.customerIco, dic: pf.customerDic },
    lines: [{ label: `Přijatá záloha k ${pf.number}`, unitPrice: pf.total, vatRate: VAT_ACCOMMODATION }],
    reservationIds: pf.reservations.map((r) => r.reservationId),
    paidTotal: pf.total, // záloha je uhrazená
    note: `Daňový doklad k přijaté záloze (${pf.number})`,
  });
}

/** Opravný daňový doklad (dobropis) — zrcadlí původní doklad s mínusovými částkami. */
export async function createCreditNote(propertyId: string, originalId: string, reason?: string) {
  const orig = await prisma.document.findFirst({ where: { id: originalId, propertyId }, include: { lines: true, reservations: true } });
  if (!orig) throw NOT_FOUND();
  if (orig.type === BillingDocType.credit_note) throw new Error("Z opravného dokladu nelze dělat další.");
  return createDocument({
    propertyId, type: BillingDocType.credit_note,
    customer: { name: orig.customerName, address: orig.customerAddress, ico: orig.customerIco, dic: orig.customerDic },
    lines: orig.lines.map((l) => ({ label: l.label, qty: Number(l.qty), unitPrice: l.unitPrice.neg(), vatRate: Number(l.vatRate) })),
    reservationIds: orig.reservations.map((r) => r.reservationId),
    note: `Opravný doklad k ${orig.number}${reason ? ` — ${reason}` : ""}`,
    taxDate: null,
  });
}

/** Hromadná faktura za víc rezervací (firma / skupina) — jeden odběratel. */
export async function issueBulkInvoice(propertyId: string, reservationIds: string[]) {
  if (!reservationIds.length) throw new Error("Vyber alespoň jednu rezervaci.");
  const lines: LineInput[] = [];
  let customer: { name: string; address?: string | null; ico?: string | null; dic?: string | null } | null = null;
  let paid = new Prisma.Decimal(0);
  for (const rid of reservationIds) {
    const r = await loadReservationForDoc(propertyId, rid);
    if (!customer) customer = customerFromReservation(r);
    for (const l of linesFromReservation(r)) lines.push({ ...l, label: `${r.code}: ${l.label}` });
    paid = paid.add((await computeFolio(rid)).paid);
  }
  void paid; // hromadná faktura je splatná (platí se přes payDocument)
  return createDocument({ propertyId, type: BillingDocType.invoice, customer: customer!, lines, reservationIds, paidTotal: 0, dueInDays: 14 });
}

/** Faktura firmě za lůžkovou obsazenost (bed-nights). Sečte vybraná obsazení a označí je jako vyfakturovaná. */
export async function issueCompanyOccupancyInvoice(propertyId: string, companyId: string, occupancyIds: string[]) {
  if (!occupancyIds.length) throw new Error("Vyber alespoň jedno obsazení.");
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw NOT_FOUND();
  const occ = await prisma.bedOccupancy.findMany({
    where: { id: { in: occupancyIds }, propertyId, companyId, invoicedAt: null },
    include: { bed: { select: { label: true } }, occupant: { select: { firstName: true, lastName: true } } },
  });
  if (!occ.length) throw new Error("Žádné nevyfakturované obsazení k fakturaci.");
  const energyRate = Number((await prisma.property.findUnique({ where: { id: propertyId }, select: { energyFeePerNight: true } }))?.energyFeePerNight ?? 0);
  const lines: LineInput[] = [];
  for (const o of occ) {
    const nights = Math.max(0, Math.round((o.toDate.getTime() - o.fromDate.getTime()) / 86_400_000));
    const who = `Lůžko ${o.bed.label} — ${o.occupant.firstName} ${o.occupant.lastName} (${iso(o.fromDate)}–${iso(o.toDate)})`;
    lines.push({ label: who, qty: nights, unitPrice: o.pricePerNight, vatRate: VAT_ACCOMMODATION });
    if (!o.energyFeeExempt && energyRate > 0) lines.push({ label: `Energie (vzdušné) — ${o.bed.label} (${nights} ${nights === 1 ? "noc" : "nocí"})`, qty: nights, unitPrice: energyRate, vatRate: VAT_DEFAULT });
  }
  const address = [company.street, [company.zip, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const doc = await createDocument({
    propertyId, type: BillingDocType.invoice,
    customer: { name: company.name, address, ico: company.ico, dic: company.dic },
    lines, paidTotal: 0, dueInDays: 14, note: `Ubytování — ${company.name}`,
  });
  await prisma.bedOccupancy.updateMany({ where: { id: { in: occ.map((o) => o.id) } }, data: { invoicedAt: new Date() } });
  return doc;
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

/** mod 97 nad libovolně dlouhým číselným řetězcem (pro IBAN kontrolní číslice). */
function mod97(num: string): number {
  let rem = 0;
  for (let i = 0; i < num.length; i++) rem = (rem * 10 + (num.charCodeAt(i) - 48)) % 97;
  return rem;
}

/** Normalizuje účet na IBAN. Přijme už hotový IBAN, nebo český formát [předčíslí-]číslo/kódbanky a převede ho. */
export function toCzIban(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "");
  if (/^[A-Za-z]{2}\d{2}/.test(s)) return s.toUpperCase(); // už je IBAN
  const m = s.match(/^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/);
  if (!m) return null;
  const bban = m[3] + (m[1] ?? "").padStart(6, "0") + m[2].padStart(10, "0"); // kódbanky(4)+předčíslí(6)+číslo(10)
  const check = 98 - mod97(bban + "123500"); // CZ -> 1235, +"00"
  return "CZ" + String(check).padStart(2, "0") + bban;
}

/** SPAYD řetězec pro QR platbu (jen proforma; účet provozovatele má přednost před IBANem provozovny). */
function spaydFor(doc: { type: BillingDocType; number: string; total: Prisma.Decimal; supplierAccount: string | null; property: { iban: string | null } }): string | null {
  if (doc.type !== BillingDocType.proforma) return null;
  const acc = toCzIban(doc.supplierAccount) ?? toCzIban(doc.property.iban);
  if (!acc) return null;
  const vs = doc.number.replace(/\D/g, "").slice(-10);
  return `SPD*1.0*ACC:${acc}*AM:${doc.total.toFixed(2)}*CC:CZK*X-VS:${vs}*MSG:Zaloha ${doc.number}`;
}

export async function getDocument(propertyId: string, id: string) {
  const doc = await prisma.document.findFirst({ where: { id, propertyId }, include: DOC_INCLUDE });
  if (!doc) throw NOT_FOUND();
  return { ...doc, qrPayment: spaydFor(doc) };
}

/** Export dokladů do CSV (oddělovač ;, kódování UTF-8 s BOM pro Excel). */
export async function exportDocumentsCsv(propertyId: string, filter: { type?: BillingDocType; from?: Date; to?: Date } = {}): Promise<string> {
  const docs = await listDocuments(propertyId, filter);
  const header = ["Číslo", "Datum", "Typ", "Odběratel", "IČO", "Základ", "DPH", "Celkem", "Zaplaceno", "Stav"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = docs.map((d) => [d.number, iso(d.issuedAt), d.type, d.customerName, d.customerIco ?? "", d.subtotal.toFixed(2), d.vatTotal.toFixed(2), d.total.toFixed(2), d.paidTotal.toFixed(2), d.status]);
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

/**
 * Úhrada dokladu zákazníkem (hotově / kartou). Platba se naváže na DOKLAD i rezervaci,
 * u hotovosti spadne do otevřené pokladní směny s odkazem na číslo dokladu a zákazníka.
 */
export async function payDocument(propertyId: string, documentId: string, method: PaymentMethod) {
  const doc = await prisma.document.findFirst({ where: { id: documentId, propertyId }, include: { reservations: true } });
  if (!doc) throw NOT_FOUND();
  if (doc.status === DocumentStatus.cancelled) throw new Error("Doklad je stornovaný.");
  const remaining = doc.total.sub(doc.paidTotal);
  if (remaining.lessThanOrEqualTo(0.005)) throw new Error("Doklad je již uhrazen.");
  const reservationId = doc.reservations[0]?.reservationId;
  if (!reservationId) throw new Error("Doklad není navázán na rezervaci.");

  const payment = await prisma.payment.create({
    data: { reservationId, documentId: doc.id, type: PaymentType.balance, amount: remaining, method, status: PaymentStatus.succeeded, description: `Úhrada ${doc.number}` },
  });
  // Naváže platbu na otevřenou směnu (hotovost i do šuplíku, karta jako tržba kartou).
  await cash.recordPayment(propertyId, { paymentId: payment.id, amount: remaining, method, documentId: doc.id, note: `${doc.number} — ${doc.customerName}` });
  // paidTotal = součet plateb navázaných na tento doklad.
  const agg = await prisma.payment.aggregate({ where: { documentId: doc.id, status: PaymentStatus.succeeded }, _sum: { amount: true } });
  const paidTotal = agg._sum.amount ?? new Prisma.Decimal(0);
  return prisma.document.update({
    where: { id: doc.id },
    data: { paidTotal, status: paidTotal.greaterThanOrEqualTo(doc.total) ? DocumentStatus.paid : DocumentStatus.issued },
    include: DOC_INCLUDE,
  });
}

/** Storno dokladu (opravný doklad se řeší zvlášť). */
export async function cancelDocument(propertyId: string, id: string) {
  await prisma.document.updateMany({ where: { id, propertyId }, data: { status: DocumentStatus.cancelled } });
  return { ok: true };
}
