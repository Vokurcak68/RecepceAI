// E-mailové notifikace hostům (transakční) — potvrzení rezervace, check-in,
// check-out, storno. Branding dle provozovny. Odesílá se přes SMTP (Forpsi),
// konfigurace v .env (SMTP_*). Vše je BEST-EFFORT: když mail selže nebo není
// nakonfigurován / host nemá e-mail, rezervační flow běží dál bez chyby.
import nodemailer, { type Transporter } from "nodemailer";
import QRCode from "qrcode";
import { Prisma, PaymentStatus, PaymentType } from "@prisma/client";
import { prisma } from "./prisma";
import { mailLang, mt, type MailLang } from "./mail-i18n";
import { computeFolio } from "./reservations";
import { reservationSpayd } from "./billing";

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport(): Transporter | null {
  if (!isMailConfigured()) return null;
  if (!transporter) {
    // EHLO jméno = doména odesílatele (rozlišitelná v DNS) místo názvu serveru —
    // přísní příjemci jinak odmítají „Sender IP/HELO must resolve".
    const ehlo = process.env.SMTP_EHLO || (process.env.SMTP_FROM || process.env.SMTP_USER || "").split("@")[1] || undefined;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? "true") !== "false", // 465 = SSL
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      ...(ehlo ? { name: ehlo } : {}),
    });
  }
  return transporter;
}

/** Ověří přihlášení k SMTP (bez odeslání). Pro diagnostiku. */
export async function verifyMail(): Promise<{ ok: boolean; error?: string }> {
  const t = getTransport();
  if (!t) return { ok: false, error: "SMTP není nakonfigurováno (SMTP_HOST/USER/PASS)." };
  try { await t.verify(); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ── Formátování ──────────────────────────────────────────────
const fmtDate = (d: Date) => `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
const money = (v: Prisma.Decimal | number | string) => `${Number(v).toLocaleString("cs-CZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Kč`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type ResForMail = Prisma.ReservationGetPayload<{ include: { primaryGuest: true; property: true; room: true; bed: true; roomType: true } }>;

const unitLabel = (r: ResForMail, lang: MailLang) =>
  r.room ? `${mt(lang, "roomWord")} ${r.room.number}` : r.bed ? `${mt(lang, "bedWord")} ${r.bed.label}` : r.roomType?.name ?? "—";

// ── HTML šablona (inline styly kvůli e-mailovým klientům) ─────
function layout(lang: MailLang, p: ResForMail["property"], title: string, intro: string, rowsHtml: string, ctaLabel?: string, ctaUrl?: string, extraHtml = ""): string {
  const addr = [p.street, [p.city, p.country].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const contact = [p.phone && `tel.: ${esc(p.phone)}`, p.email && `e-mail: ${esc(p.email)}`].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#243240;">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
    <div style="background:#1f2d3d;border-radius:14px 14px 0 0;padding:24px 28px;color:#fff;">
      <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#c8a35b;">🛎️ ${esc(p.name)}</div>
      <div style="font-size:22px;font-weight:700;margin-top:6px;">${esc(title)}</div>
    </div>
    <div style="background:#fff;padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${intro}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 4px;">${rowsHtml}</table>
      ${extraHtml}
      ${ctaUrl && ctaLabel ? `<div style="text-align:center;margin:26px 0 8px;"><a href="${ctaUrl}" style="background:#c8a35b;color:#1f2d3d;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:9px;display:inline-block;font-size:15px;">${esc(ctaLabel)}</a></div>` : ""}
    </div>
    <div style="background:#f6f8fa;border-radius:0 0 14px 14px;padding:18px 28px;font-size:12px;color:#6b7a89;line-height:1.6;border-top:1px solid #e6eaee;">
      <div style="font-weight:600;color:#243240;">${esc(p.name)}</div>
      ${addr ? `<div>${esc(addr)}</div>` : ""}
      ${contact ? `<div>${contact}</div>` : ""}
      <div style="margin-top:10px;color:#9aa7b3;">${esc(mt(lang, "footerAuto"))}</div>
    </div>
  </div>
</body></html>`;
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:7px 0;color:#6b7a89;width:42%;">${esc(label)}</td><td style="padding:7px 0;font-weight:600;text-align:right;">${value}</td></tr>`;

function stayRows(r: ResForMail, lang: MailLang): string {
  const guests = `${r.adults} ${mt(lang, "adultsShort")}${r.children ? ` + ${r.children} ${mt(lang, "childrenShort")}` : ""}`;
  return [
    row(mt(lang, "rowCode"), `<span style="font-family:monospace;font-size:15px;">${esc(r.code)}</span>`),
    row(mt(lang, "rowCheckin"), fmtDate(r.checkInDate)),
    row(mt(lang, "rowCheckout"), fmtDate(r.checkOutDate)),
    row(mt(lang, "rowNights"), String(r.nights)),
    row(mt(lang, "rowUnit"), esc(unitLabel(r, lang))),
    row(mt(lang, "rowGuests"), guests),
    row(mt(lang, "rowTotal"), money(r.totalAmount)),
  ].join("");
}

// ── Načtení rezervace se vším pro e-mail ─────────────────────
async function load(reservationId: string): Promise<ResForMail | null> {
  return prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { primaryGuest: true, property: true, room: true, bed: true, roomType: true },
  });
}

/** Lidské popisy typů e-mailů (pro přehled v adminu). */
export const EMAIL_TYPES: Record<string, string> = {
  created: "Potvrzení rezervace",
  checkin: "Uvítání (check-in)",
  checkout: "Poděkování (check-out)",
  cancellation: "Zrušení rezervace",
  reminder: "Připomínka před příjezdem",
  prepay_reminder: "Připomínka platby předem",
  proforma: "Zálohová faktura",
};

async function logEmail(reservationId: string, type: string, recipient: string, subject: string, status: string, error?: string) {
  try { await prisma.emailLog.create({ data: { reservationId, type, recipient, subject, status, error } }); }
  catch (e) { console.error(`📧 [mail] nelze zapsat EmailLog: ${(e as Error).message}`); }
}

type MailAttachment = { filename: string; content: Buffer; cid: string };

async function deliver(r: ResForMail, type: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<void> {
  const t = getTransport();
  const to = r.primaryGuest?.email;
  if (!to) return;                                  // host nemá e-mail → nelze poslat, nezaznamenáváme
  if (!t) { await logEmail(r.id, type, to, subject, "skipped", "SMTP není nakonfigurováno"); return; }
  try {
    await t.sendMail({
      from: `"${r.property.name}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      ...(r.property.email ? { replyTo: r.property.email } : {}),
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    });
    console.log(`📧 [mail] odesláno "${subject}" → ${to} (${r.code})`);
    await logEmail(r.id, type, to, subject, "sent");
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`📧 [mail] CHYBA při odeslání "${subject}" → ${to}: ${msg}`);
    await logEmail(r.id, type, to, subject, "failed", msg);
  }
}

const guestUrl = (code: string) =>
  process.env.PUBLIC_GUEST_URL ? `${process.env.PUBLIC_GUEST_URL.replace(/\/$/, "")}/?code=${encodeURIComponent(code)}` : null;
const feedbackUrl = (code: string) =>
  process.env.PUBLIC_GUEST_URL ? `${process.env.PUBLIC_GUEST_URL.replace(/\/$/, "")}/?code=${encodeURIComponent(code)}&rate=1` : null;

/** Neuhrazený zůstatek rezervace — jen když se NEplatí fakturou/firmou (jinak 0). */
async function unpaidBalance(r: ResForMail): Promise<number> {
  if (r.companyId || r.billingCompany) return 0; // platí fakturou → bez QR
  const folio = await computeFolio(r.id);
  const bal = Number(folio.balance);
  return bal > 0 ? bal : 0;
}

/** QR platba pro daný (kladný) zůstatek — HTML blok + PNG příloha (cid:qrpay).
 * Null, když provozovna nemá bankovní účet nebo se QR nepodaří vygenerovat. */
async function qrPayBlock(r: ResForMail, lang: MailLang, amount: number): Promise<{ html: string; attachment: MailAttachment } | null> {
  const spd = reservationSpayd(r.property, r.code, amount);
  if (!spd) return null;
  let buf: Buffer;
  try { buf = await QRCode.toBuffer(spd, { margin: 1, width: 240 }); } catch { return null; }
  const html = `<div style="margin:18px 0 0;padding:16px 18px;background:#f6f8fa;border-radius:10px;text-align:center;">
    <div style="font-weight:600;color:#243240;margin-bottom:4px;">${esc(mt(lang, "qrHeading"))} · ${money(amount)}</div>
    <img src="cid:qrpay" alt="QR" width="200" height="200" style="display:inline-block;margin:6px 0;" />
    <div style="font-size:12px;color:#6b7a89;line-height:1.6;">${esc(mt(lang, "qrNote"))}</div>
  </div>`;
  return { html, attachment: { filename: "qr-platba.png", content: buf, cid: "qrpay" } };
}

// ── Jednotlivé e-maily ───────────────────────────────────────
/** Potvrzení vytvořené rezervace. */
export async function sendReservationCreated(reservationId: string, proforma?: { number: string; total: number; dueDate?: Date | string | null }): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const lang = mailLang(r.primaryGuest?.language);
  const vars = { name: esc(r.primaryGuest.firstName), property: esc(r.property.name) };
  const link = guestUrl(r.code);
  // S proformou: do potvrzení rovnou zahrneme zálohovou fakturu (řádky + výzva k úhradě). Bez ní: obecná zmínka o záloze dle provozovny.
  let depositHtml: string;
  let rows = stayRows(r, lang);
  if (proforma) {
    const due = proforma.dueDate ? fmtDate(proforma.dueDate) : "—";
    rows += row(mt(lang, "titleProforma"), money(proforma.total)) + row(mt(lang, "rowDue"), due);
    depositHtml = `<p style="margin:14px 0 0;font-size:13px;color:#6b7a89;line-height:1.6;">${mt(lang, "proformaNote", { amount: money(proforma.total), due })}</p>`;
  } else {
    const deposit = r.property.depositPct > 0 ? Math.round(Number(r.totalAmount) * r.property.depositPct / 100) : 0;
    depositHtml = deposit > 0 ? `<p style="margin:14px 0 0;font-size:13px;color:#6b7a89;line-height:1.6;">${mt(lang, "depositNote", { amount: money(deposit), pct: r.property.depositPct })}</p>` : "";
  }
  // QR platba + věta o splatnosti — jen u neuhrazené nefiremní rezervace.
  const amount = await unpaidBalance(r);
  const qr = amount > 0 ? await qrPayBlock(r, lang, amount) : null;
  const prepayHtml = r.prepayDueAt && amount > 0
    ? `<p style="margin:14px 0 0;font-size:13px;color:#6b7a89;line-height:1.6;">${mt(lang, "prepayDueNote", { amount: money(amount), due: fmtDate(r.prepayDueAt) })}</p>`
    : "";
  const extra = depositHtml + prepayHtml + (qr ? qr.html : "") + (link ? `<p style="margin:14px 0 0;font-size:13px;color:#6b7a89;line-height:1.6;">${esc(mt(lang, "createdExtra"))}</p>` : "");
  const html = layout(lang, r.property, mt(lang, "titleCreated"), mt(lang, "introCreated", vars), rows,
    link ? mt(lang, "ctaManage") : undefined, link ?? undefined, extra);
  await deliver(r, "created", mt(lang, "subjCreated", { code: r.code, property: r.property.name }), html, qr ? [qr.attachment] : undefined);
}

/** E-mail se zálohovou fakturou (proforma) — odešle se po jejím vystavení. */
export async function sendProforma(reservationId: string, doc: { number: string; total: number; dueDate?: Date | string | null }): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const lang = mailLang(r.primaryGuest?.language);
  const due = doc.dueDate ? fmtDate(doc.dueDate) : "—";
  const rows = [row(mt(lang, "rowCode"), esc(r.code)), row(mt(lang, "rowUnit"), esc(unitLabel(r, lang))), row(mt(lang, "titleProforma"), money(doc.total)), row(mt(lang, "rowDue"), due)].join("");
  const note = `<p style="margin:14px 0 0;font-size:13px;color:#6b7a89;line-height:1.6;">${mt(lang, "proformaNote", { amount: money(doc.total), due })}</p>`;
  const html = layout(lang, r.property, mt(lang, "titleProforma"), mt(lang, "introProforma", { name: esc(r.primaryGuest.firstName) }), rows, undefined, undefined, note);
  await deliver(r, "proforma", mt(lang, "subjProforma", { number: doc.number, property: r.property.name }), html);
}

/** Uvítací e-mail po check-inu. */
export async function sendCheckIn(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const lang = mailLang(r.primaryGuest?.language);
  const vars = { name: esc(r.primaryGuest.firstName), property: esc(r.property.name) };
  const info = r.property.infoText
    ? `<div style="margin:20px 0 0;padding:16px 18px;background:#f6f8fa;border-radius:10px;font-size:13px;line-height:1.7;color:#3a4856;"><div style="font-weight:600;margin-bottom:6px;color:#243240;">${esc(mt(lang, "infoHeading"))}</div>${esc(r.property.infoText).replace(/\n/g, "<br>")}</div>`
    : "";
  const checkoutNote = `<p style="margin:18px 0 0;font-size:13px;color:#6b7a89;">${mt(lang, "checkoutNote", { date: fmtDate(r.checkOutDate) })}</p>`;
  const link = guestUrl(r.code);
  const html = layout(lang, r.property, mt(lang, "titleCheckin"), mt(lang, "introCheckin", vars),
    [row(mt(lang, "rowUnit"), esc(unitLabel(r, lang))), row(mt(lang, "rowCheckin"), fmtDate(r.checkInDate)), row(mt(lang, "rowCheckout"), fmtDate(r.checkOutDate))].join(""),
    link ? mt(lang, "ctaRequests") : undefined, link ?? undefined, info + checkoutNote);
  await deliver(r, "checkin", mt(lang, "subjCheckin", { property: r.property.name }), html);
}

/** Poděkování + souhrn po check-outu. */
export async function sendCheckOut(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const lang = mailLang(r.primaryGuest?.language);
  const full = await prisma.reservation.findUnique({ where: { id: reservationId }, include: { payments: true, charges: true } });
  let extra = new Prisma.Decimal(0);
  for (const c of full?.charges ?? []) extra = extra.add(c.amount);
  let paid = new Prisma.Decimal(0);
  for (const p of full?.payments ?? []) {
    if (p.status !== PaymentStatus.succeeded) continue;
    if (([PaymentType.deposit, PaymentType.balance, PaymentType.city_tax, PaymentType.refund] as PaymentType[]).includes(p.type)) paid = paid.add(p.amount);
  }
  const charges = r.totalAmount.add(extra);
  const vars = { name: esc(r.primaryGuest.firstName), property: esc(r.property.name) };
  const rows = [
    row(mt(lang, "rowCode"), `<span style="font-family:monospace;">${esc(r.code)}</span>`),
    row(mt(lang, "rowStay"), `${fmtDate(r.checkInDate)} – ${fmtDate(r.checkOutDate)} (${r.nights} ${mt(lang, "nightsWord")})`),
    row(mt(lang, "rowCosts"), money(charges)),
    row(mt(lang, "rowPaid"), money(paid)),
  ].join("");
  const rate = feedbackUrl(r.code);
  const html = layout(lang, r.property, mt(lang, "titleCheckout"), mt(lang, "introCheckout", vars), rows,
    rate ? mt(lang, "ctaRate") : undefined, rate ?? undefined,
    `<p style="margin:18px 0 0;font-size:13px;color:#6b7a89;">${esc(mt(lang, "thanksNote"))}</p>`);
  await deliver(r, "checkout", mt(lang, "subjCheckout", { property: r.property.name }), html);
}

/** Potvrzení zrušení rezervace (volitelně se storno poplatkem). */
export async function sendCancellation(reservationId: string, fee?: number): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const lang = mailLang(r.primaryGuest?.language);
  const vars = { name: esc(r.primaryGuest.firstName), property: esc(r.property.name) };
  const feeHtml = fee && fee > 0 ? `<p style="margin:18px 0 0;font-size:13px;color:#6b7a89;">${mt(lang, "cancelFeeNote", { amount: money(fee) })}</p>` : "";
  const html = layout(lang, r.property, mt(lang, "titleCancel"), mt(lang, "introCancel", vars),
    [row(mt(lang, "rowCode"), `<span style="font-family:monospace;">${esc(r.code)}</span>`), row(mt(lang, "rowOrigTerm"), `${fmtDate(r.checkInDate)} – ${fmtDate(r.checkOutDate)}`)].join(""), undefined, undefined, feeHtml);
  await deliver(r, "cancellation", mt(lang, "subjCancel", { code: r.code, property: r.property.name }), html);
}

/** Připomínka před příjezdem. */
export async function sendReminder(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const lang = mailLang(r.primaryGuest?.language);
  const vars = { name: esc(r.primaryGuest.firstName), property: esc(r.property.name), date: fmtDate(r.checkInDate) };
  const info = r.property.infoText
    ? `<div style="margin:20px 0 0;padding:16px 18px;background:#f6f8fa;border-radius:10px;font-size:13px;line-height:1.7;color:#3a4856;"><div style="font-weight:600;margin-bottom:6px;color:#243240;">${esc(mt(lang, "infoHeading"))}</div>${esc(r.property.infoText).replace(/\n/g, "<br>")}</div>`
    : "";
  const link = guestUrl(r.code);
  const html = layout(lang, r.property, mt(lang, "titleReminder"), mt(lang, "introReminder", vars),
    [row(mt(lang, "rowCheckin"), fmtDate(r.checkInDate)), row(mt(lang, "rowCheckout"), fmtDate(r.checkOutDate)), row(mt(lang, "rowUnit"), esc(unitLabel(r, lang)))].join(""),
    link ? mt(lang, "ctaManage") : undefined, link ?? undefined, info);
  await deliver(r, "reminder", mt(lang, "subjReminder", { property: r.property.name }), html);
}

/** Připomínka platby předem (den před vypršením lhůty) — s QR platbou. Posílá se jen
 * u neuhrazené nefiremní rezervace; jinak nemá co připomínat a vrací se bez odeslání. */
export async function sendPrepayReminder(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const amount = await unpaidBalance(r);
  if (!(amount > 0)) return;                       // uhrazeno / faktura → nic neposíláme
  const lang = mailLang(r.primaryGuest?.language);
  const due = r.prepayDueAt ? fmtDate(r.prepayDueAt) : "—";
  const link = guestUrl(r.code);
  const qr = await qrPayBlock(r, lang, amount);
  const rows = [
    row(mt(lang, "rowCode"), `<span style="font-family:monospace;">${esc(r.code)}</span>`),
    row(mt(lang, "rowUnit"), esc(unitLabel(r, lang))),
    row(mt(lang, "rowTotal"), money(amount)),
    row(mt(lang, "rowDue"), due),
  ].join("");
  const note = `<p style="margin:14px 0 0;font-size:13px;color:#6b7a89;line-height:1.6;">${mt(lang, "prepayDueNote", { amount: money(amount), due })}</p>`;
  const html = layout(lang, r.property, mt(lang, "titlePrepay"),
    mt(lang, "introPrepay", { name: esc(r.primaryGuest.firstName), property: esc(r.property.name), due }), rows,
    link ? mt(lang, "ctaManage") : undefined, link ?? undefined, note + (qr ? qr.html : ""));
  await deliver(r, "prepay_reminder", mt(lang, "subjPrepay", { code: r.code, property: r.property.name }), html, qr ? [qr.attachment] : undefined);
}

/** Souhrnný e-mail organizátorovi skupinové rezervace (jeden za celou skupinu). */
export async function sendGroupSummary(groupId: string): Promise<void> {
  const group = await prisma.reservationGroup.findUnique({
    where: { id: groupId },
    include: { property: true, organizer: true, reservations: { include: { roomType: true } } },
  });
  if (!group) return;
  const active = group.reservations.filter((r) => r.status !== "cancelled");
  if (!active.length) return;
  const to = group.organizer?.email;
  if (!to) return; // bez e-mailu organizátora nelze poslat
  const lang = mailLang(group.organizer?.language);
  const from = active.reduce((m, r) => (r.checkInDate < m ? r.checkInDate : m), active[0].checkInDate);
  const until = active.reduce((m, r) => (r.checkOutDate > m ? r.checkOutDate : m), active[0].checkOutDate);
  let total = new Prisma.Decimal(0);
  const roomRows = active.map((r) => {
    total = total.add(r.totalAmount);
    const guests = `${r.adults} ${mt(lang, "adultsShort")}${r.children ? ` + ${r.children} ${mt(lang, "childrenShort")}` : ""}`;
    return row(esc(r.roomType?.name ?? "—"), `${guests} · ${money(r.totalAmount)}`);
  }).join("");
  const rows = row(mt(lang, "rowStay"), `${fmtDate(from)} – ${fmtDate(until)}`) + roomRows + row(mt(lang, "rowTotal"), money(total));
  const vars = { name: esc(group.organizer?.firstName ?? ""), group: esc(group.name), rooms: String(active.length), property: esc(group.property.name) };
  const html = layout(lang, group.property, mt(lang, "titleGroup"), mt(lang, "introGroup", vars), rows);
  const subject = mt(lang, "subjGroup", { group: group.name, property: group.property.name });
  const log = (status: string, error?: string) =>
    prisma.emailLog.create({ data: { groupId, type: "group_summary", recipient: to, subject, status, error } }).catch((e) => console.error(`📧 [mail] EmailLog skupiny: ${(e as Error).message}`));
  const t = getTransport();
  if (!t) { await log("skipped", "SMTP není nakonfigurováno"); console.log(`📧 [mail] souhrn skupiny ${group.code} přeskočen (SMTP nenakonfigurováno)`); return; }
  try {
    await t.sendMail({ from: `"${group.property.name}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`, to, ...(group.property.email ? { replyTo: group.property.email } : {}), subject, html });
    console.log(`📧 [mail] souhrn skupiny "${group.name}" → ${to} (${group.code})`);
    await log("sent");
  } catch (e) { const msg = (e as Error).message; console.error(`📧 [mail] souhrn skupiny CHYBA → ${to}: ${msg}`); await log("failed", msg); }
}

// ── Přehled odeslaných e-mailů + znovuodeslání ───────────────
export const listEmails = (reservationId: string) =>
  prisma.emailLog.findMany({ where: { reservationId }, orderBy: { createdAt: "desc" } });

/** Znovu odešle e-mail daného typu pro rezervaci. */
export async function resend(reservationId: string, type: string): Promise<void> {
  switch (type) {
    case "created": return sendReservationCreated(reservationId);
    case "checkin": return sendCheckIn(reservationId);
    case "checkout": return sendCheckOut(reservationId);
    case "cancellation": return sendCancellation(reservationId);
    case "reminder": return sendReminder(reservationId);
    case "prepay_reminder": return sendPrepayReminder(reservationId);
    default: throw new Error("Neznámý typ e-mailu.");
  }
}

/** Testovací e-mail pro ověření SMTP. */
export async function sendTestMail(to: string): Promise<{ ok: boolean; error?: string }> {
  const t = getTransport();
  if (!t) return { ok: false, error: "SMTP není nakonfigurováno." };
  try {
    await t.sendMail({
      from: `"ReceptionAI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject: "ReceptionAI — test SMTP",
      html: `<p>Toto je testovací zpráva z ReceptionAI. Pokud ji vidíte, odesílání e-mailů funguje. ✅</p>`,
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
