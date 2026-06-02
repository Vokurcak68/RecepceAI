// E-mailové notifikace hostům (transakční) — potvrzení rezervace, check-in,
// check-out, storno. Branding dle provozovny. Odesílá se přes SMTP (Forpsi),
// konfigurace v .env (SMTP_*). Vše je BEST-EFFORT: když mail selže nebo není
// nakonfigurován / host nemá e-mail, rezervační flow běží dál bez chyby.
import nodemailer, { type Transporter } from "nodemailer";
import { Prisma, PaymentStatus, PaymentType } from "@prisma/client";
import { prisma } from "./prisma";

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

const unitLabel = (r: ResForMail) =>
  r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : r.roomType?.name ?? "—";

// ── HTML šablona (inline styly kvůli e-mailovým klientům) ─────
function layout(p: ResForMail["property"], title: string, intro: string, rowsHtml: string, ctaLabel?: string, ctaUrl?: string, extraHtml = ""): string {
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
      <div style="margin-top:10px;color:#9aa7b3;">Tato zpráva byla odeslána automaticky systémem ReceptionAI. Neodpovídejte na ni prosím, případné dotazy směřujte na kontakt výše.</div>
    </div>
  </div>
</body></html>`;
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:7px 0;color:#6b7a89;width:42%;">${esc(label)}</td><td style="padding:7px 0;font-weight:600;text-align:right;">${value}</td></tr>`;

function stayRows(r: ResForMail): string {
  const guests = `${r.adults} dosp.${r.children ? ` + ${r.children} dět.` : ""}`;
  return [
    row("Rezervační kód", `<span style="font-family:monospace;font-size:15px;">${esc(r.code)}</span>`),
    row("Příjezd", fmtDate(r.checkInDate)),
    row("Odjezd", fmtDate(r.checkOutDate)),
    row("Počet nocí", String(r.nights)),
    row("Ubytování", esc(unitLabel(r))),
    row("Hosté", guests),
    row("Cena celkem", money(r.totalAmount)),
  ].join("");
}

// ── Načtení rezervace se vším pro e-mail ─────────────────────
async function load(reservationId: string): Promise<ResForMail | null> {
  return prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { primaryGuest: true, property: true, room: true, bed: true, roomType: true },
  });
}

async function deliver(r: ResForMail, subject: string, html: string): Promise<void> {
  const t = getTransport();
  const to = r.primaryGuest?.email;
  if (!t || !to) return; // bez SMTP nebo bez e-mailu hosta tiše přeskoč
  try {
    await t.sendMail({
      from: `"${r.property.name}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      ...(r.property.email ? { replyTo: r.property.email } : {}),
      subject,
      html,
    });
    console.log(`📧 [mail] odesláno "${subject}" → ${to} (${r.code})`);
  } catch (e) {
    console.error(`📧 [mail] CHYBA při odeslání "${subject}" → ${to}: ${(e as Error).message}`);
  }
}

const guestUrl = (code: string) =>
  process.env.PUBLIC_GUEST_URL ? `${process.env.PUBLIC_GUEST_URL.replace(/\/$/, "")}/?code=${encodeURIComponent(code)}` : null;

// ── Jednotlivé e-maily ───────────────────────────────────────
/** Potvrzení vytvořené rezervace. */
export async function sendReservationCreated(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const g = r.primaryGuest;
  const intro = `Dobrý den, ${esc(g.firstName)},<br>děkujeme za vaši rezervaci v <b>${esc(r.property.name)}</b>. Níže najdete její shrnutí. Těšíme se na vaši návštěvu!`;
  const link = guestUrl(r.code);
  const html = layout(r.property, "Potvrzení rezervace", intro, stayRows(r),
    link ? "Spravovat rezervaci" : undefined, link ?? undefined,
    link ? `<p style="margin:18px 0 0;font-size:13px;color:#6b7a89;line-height:1.6;">Přes odkaz níže můžete kdykoli zobrazit detaily a zadávat požadavky během pobytu.</p>` : "");
  await deliver(r, `Potvrzení rezervace ${r.code} — ${r.property.name}`, html);
}

/** Uvítací e-mail po check-inu. */
export async function sendCheckIn(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const g = r.primaryGuest;
  const intro = `Dobrý den, ${esc(g.firstName)},<br>vítáme vás v <b>${esc(r.property.name)}</b>! Váš pobyt byl zahájen, přejeme příjemné ubytování.`;
  const info = r.property.infoText
    ? `<div style="margin:20px 0 0;padding:16px 18px;background:#f6f8fa;border-radius:10px;font-size:13px;line-height:1.7;color:#3a4856;"><div style="font-weight:600;margin-bottom:6px;color:#243240;">Užitečné informace</div>${esc(r.property.infoText).replace(/\n/g, "<br>")}</div>`
    : "";
  const checkoutNote = `<p style="margin:18px 0 0;font-size:13px;color:#6b7a89;">Odjezd (check-out) máte naplánovaný na <b>${fmtDate(r.checkOutDate)}</b>.</p>`;
  const link = guestUrl(r.code);
  const html = layout(r.property, "Vítejte!", intro,
    [row("Ubytování", esc(unitLabel(r))), row("Příjezd", fmtDate(r.checkInDate)), row("Odjezd", fmtDate(r.checkOutDate))].join(""),
    link ? "Požadavky během pobytu" : undefined, link ?? undefined, info + checkoutNote);
  await deliver(r, `Vítejte v ${r.property.name}`, html);
}

/** Poděkování + souhrn po check-outu. */
export async function sendCheckOut(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const g = r.primaryGuest;
  // Souhrn účtu (bez závislosti na reservations.ts): náklady = ubytování + položky, uhrazeno = platby.
  const full = await prisma.reservation.findUnique({ where: { id: reservationId }, include: { payments: true, charges: true } });
  let extra = new Prisma.Decimal(0);
  for (const c of full?.charges ?? []) extra = extra.add(c.amount);
  let paid = new Prisma.Decimal(0);
  for (const p of full?.payments ?? []) {
    if (p.status !== PaymentStatus.succeeded) continue;
    if (([PaymentType.deposit, PaymentType.balance, PaymentType.city_tax, PaymentType.refund] as PaymentType[]).includes(p.type)) paid = paid.add(p.amount);
  }
  const charges = r.totalAmount.add(extra);
  const intro = `Dobrý den, ${esc(g.firstName)},<br>děkujeme, že jste si vybrali <b>${esc(r.property.name)}</b>. Doufáme, že jste byli spokojeni, a budeme se těšit na vaši příští návštěvu.`;
  const rows = [
    row("Rezervační kód", `<span style="font-family:monospace;">${esc(r.code)}</span>`),
    row("Pobyt", `${fmtDate(r.checkInDate)} – ${fmtDate(r.checkOutDate)} (${r.nights} nocí)`),
    row("Náklady celkem", money(charges)),
    row("Uhrazeno", money(paid)),
  ].join("");
  const html = layout(r.property, "Děkujeme za návštěvu", intro, rows, undefined, undefined,
    `<p style="margin:18px 0 0;font-size:13px;color:#6b7a89;">Budeme rádi za vaši zpětnou vazbu. Přejeme šťastnou cestu! 👋</p>`);
  await deliver(r, `Děkujeme za návštěvu — ${r.property.name}`, html);
}

/** Potvrzení zrušení rezervace. */
export async function sendCancellation(reservationId: string): Promise<void> {
  const r = await load(reservationId);
  if (!r) return;
  const g = r.primaryGuest;
  const intro = `Dobrý den, ${esc(g.firstName)},<br>vaše rezervace v <b>${esc(r.property.name)}</b> byla zrušena. Pokud jste o zrušení nežádali, kontaktujte nás prosím.`;
  const html = layout(r.property, "Zrušení rezervace", intro,
    [row("Rezervační kód", `<span style="font-family:monospace;">${esc(r.code)}</span>`), row("Původní termín", `${fmtDate(r.checkInDate)} – ${fmtDate(r.checkOutDate)}`)].join(""));
  await deliver(r, `Zrušení rezervace ${r.code} — ${r.property.name}`, html);
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
