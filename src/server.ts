// HTTP vrstva multi-tenant systému.
//  - /auth/*      přihlášení uživatele (role)
//  - /central/*   centrální správa (super_admin): provozovny, uživatelé
//  - /admin/*     provozovnu-scopovaný admin (auth + přístup k provozovně)
//  - veřejné      kiosek: availability / rezervace (scopováno přes x-property-id)
import express, { type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { DocumentType, PaymentType, PaymentMethod, RoomStatus, LockType, PropertyType, UserRole, InventoryUnit, EquipmentCondition, ServiceType, ServiceStatus, ServiceDomain, BillingDocType, ChargeCategory } from "@prisma/client";
import { prisma } from "./prisma";
import {
  getAvailability, createWalkInHold, confirmReservation, findReservationByCode, findReservationsByLastName,
  checkIn, addRegistrationEntry, addPayment, computeFolio, checkOut, releaseExpiredHolds, purgeExpiredRegistrations,
  addCharge, listCharges, deleteCharge, onlineCheckinInfo, completeOnlineCheckin, occupancyCalendar, tapeChart,
} from "./index";
import { serialize } from "./serialize";
import * as admin from "./admin";
import * as central from "./central";
import * as equip from "./equipment";
import * as service from "./service";
import { buildHousekeepingPlan, briefHousekeeping } from "./dispatch";
import { runNightAudit, briefManager } from "./orchestrator";
import { suggestRates, applyRates } from "./pricing-agent";
import { runChecks } from "./checks";
import { buildMaintenancePlan, briefMaintenance } from "./maintenance-triage";
import * as callsStore from "./calls";
import { isJaasConfigured, mintJaasToken } from "./jaas";
import * as billing from "./billing";
import * as cash from "./cashregister";
import { initWhatsApp, whatsappStatus, sendWhatsApp, destroyWhatsApp } from "./whatsapp";
import * as mailer from "./mailer";
import { icalToken, buildExportIcs, listIcalFeeds, addIcalFeed, deleteIcalFeed, syncProperty, startIcalScheduler, stopIcalScheduler } from "./ical";
import { chat as aiChat, type ChatMsg } from "./ai";
import * as guests from "./guests";
import * as groups from "./groups";
import { startPolicyScheduler, stopPolicyScheduler } from "./policies";
import { UPLOAD_DIR } from "./uploads";
import { createToken, readToken, verifyPassword } from "./auth";

export const app = express();
app.use(express.json({ limit: "12mb" })); // vyšší limit kvůli fotkám (base64) z telefonu personálu
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));

// Dynamické API — nic se nesmí cachovat. Bez toho upstream proxy (nginx/ARR) cachuje
// GET odpovědi (~1 min) a admin pak vidí zastaralý stav (zvoneček „visel" minutu po
// odbavení hovoru). no-store na všech odpovědích + vypnutý ETag = vždy čerstvá data.
app.set("etag", false);
app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate"); next(); });

// ── Pomocníci ────────────────────────────────────────────────
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).then((data) => { if (!res.headersSent) res.json(serialize(data)); }).catch(next);

const asyncWrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

const dateStr = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "neplatné datum");

/** Provozovna z hlavičky x-property-id (UUID) nebo ?property= (identifikátor/id). */
async function resolvePropertyId(req: Request): Promise<string> {
  const raw = req.header("x-property-id") || String(req.query.property || "");
  if (!raw) throw new Error("Chybí provozovna (x-property-id / ?property=).");
  const p = await prisma.property.findFirst({ where: { OR: [{ id: raw }, { identifier: raw }], active: true } });
  if (!p) throw new Error("Neznámá nebo neaktivní provozovna.");
  return p.id;
}

// ── Health ───────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ── iCal feed obsazenosti (veřejný, chráněný tokenem) ────────
app.get("/ical/:identifier/:token", asyncWrap(async (req, res) => {
  const ident = req.params.identifier;
  if (req.params.token.replace(/\.ics$/i, "") !== icalToken(ident)) return res.status(403).send("forbidden");
  const p = await prisma.property.findFirst({ where: { OR: [{ identifier: ident }, { id: ident }] }, select: { id: true } });
  if (!p) return res.status(404).send("not found");
  const roomType = typeof req.query.roomType === "string" ? req.query.roomType : undefined;
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(await buildExportIcs(p.id, roomType));
}));

// ── Veřejné: info o provozovně (pro konfiguraci kiosku) ──────
app.get("/properties/:identifier", h(async (req) => {
  const p = await prisma.property.findFirst({ where: { OR: [{ identifier: req.params.identifier }, { id: req.params.identifier }], active: true } });
  if (!p) throw Object.assign(new Error("not_found"), { code: "P2025" });
  return {
    id: p.id, identifier: p.identifier, name: p.name, type: p.type,
    inventoryUnit: p.inventoryUnit, cityTaxEnabled: p.cityTaxEnabled, selfCheckin: p.selfCheckin,
    breakfastIncluded: p.breakfastIncluded, allowLongTerm: p.allowLongTerm,
  };
}));

// ── Veřejné (kiosek): dostupnost ─────────────────────────────
const availabilityQuery = z.object({ from: dateStr, to: dateStr, guests: z.coerce.number().int().positive().default(1) });
app.get("/availability", h(async (req) => {
  await releaseExpiredHolds();
  const propertyId = await resolvePropertyId(req);
  const q = availabilityQuery.parse(req.query);
  return getAvailability(propertyId, new Date(q.from), new Date(q.to), q.guests);
}));

// ── Veřejné (kiosek): identifikace rezervace ─────────────────
app.get("/reservations/lookup", h(async (req) => {
  const propertyId = await resolvePropertyId(req);
  const q = z.object({ code: z.string().optional(), lastName: z.string().optional() })
    .refine((v) => v.code || v.lastName, "zadej code nebo lastName").parse(req.query);
  if (q.code) { const r = await findReservationByCode(propertyId, q.code); return r ? [r] : []; }
  return findReservationsByLastName(propertyId, q.lastName!);
}));

// ── Veřejné (kiosek): walk-in ────────────────────────────────
const walkInBody = z.object({
  roomTypeId: z.string().uuid(), from: dateStr, to: dateStr,
  adults: z.number().int().positive(), children: z.number().int().nonnegative().optional(), childAges: z.array(z.number().int().min(0).max(25)).optional(),
  guest: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), language: z.string().optional() }),
});
app.post("/reservations/walkin", h(async (req) => {
  const propertyId = await resolvePropertyId(req);
  const b = walkInBody.parse(req.body);
  return createWalkInHold({ propertyId, roomTypeId: b.roomTypeId, from: new Date(b.from), to: new Date(b.to), adults: b.adults, children: b.children, childAges: b.childAges, guest: b.guest });
}));

// ── Veřejné (kiosek): operace nad rezervací (id-based) ───────
app.post("/reservations/:id/confirm", h((req) => confirmReservation(req.params.id)));
app.post("/reservations/:id/checkin", h((req) => checkIn(req.params.id)));
app.get("/reservations/:id/folio", h((req) => computeFolio(req.params.id)));
app.post("/reservations/:id/checkout", h(async (req) => {
  const result = await checkOut(req.params.id);
  const document = await billing.issueReservationDocument(result.reservation.propertyId, req.params.id, "receipt" as BillingDocType).catch(() => null); // self-checkout účtenka
  return { ...result, document };
}));

const registrationBody = z.object({
  guestId: z.string().uuid(), fullName: z.string().min(1), dateOfBirth: dateStr, nationality: z.string().min(1),
  documentType: z.nativeEnum(DocumentType), documentNumber: z.string().min(1), homeAddress: z.string().min(1),
  visaNumber: z.string().optional(), purposeOfStay: z.string().optional(), stayFrom: dateStr, stayTo: dateStr,
});
app.post("/reservations/:id/registration", h(async (req) => {
  const b = registrationBody.parse(req.body);
  return addRegistrationEntry({ reservationId: req.params.id, guestId: b.guestId, fullName: b.fullName, dateOfBirth: new Date(b.dateOfBirth), nationality: b.nationality, documentType: b.documentType, documentNumber: b.documentNumber, homeAddress: b.homeAddress, visaNumber: b.visaNumber, purposeOfStay: b.purposeOfStay, stayFrom: new Date(b.stayFrom), stayTo: new Date(b.stayTo) });
}));

const paymentBody = z.object({ type: z.nativeEnum(PaymentType), amount: z.number(), method: z.nativeEnum(PaymentMethod).optional(), description: z.string().optional(), invoiceNumber: z.string().optional() });
app.post("/reservations/:id/payments", h(async (req) => { const b = paymentBody.parse(req.body); return addPayment({ reservationId: req.params.id, ...b }); }));

app.post("/maintenance/release-holds", h(async () => ({ released: await releaseExpiredHolds() })));
app.post("/maintenance/purge-registrations", h(async () => ({ purged: await purgeExpiredRegistrations() })));

// ── Přivolání člověka: WhatsApp personálu + zvoneček manažerům (kiosek) ──
app.post("/call/notify", h(async (req) => {
  const b = z.object({ joinUrl: z.string().url(), propertyName: z.string().optional() }).parse(req.body);
  const propName = b.propertyName || "recepce";

  // Provozovnu zkus dohledat z hlavičky, ať má zvoneček odkaz na hotel.
  let propertyId: string | null = null;
  const raw = req.header("x-property-id");
  if (raw) {
    const p = await prisma.property.findFirst({ where: { OR: [{ id: raw }, { identifier: raw }] }, select: { id: true } });
    propertyId = p?.id ?? null;
  }

  // Zvoneček pro manažery (vznikne vždy, i kdyby WhatsApp selhal).
  const call = callsStore.addCall({ propertyId, propertyName: propName, joinUrl: b.joinUrl });

  // WhatsApp je best-effort a může být POMALÉ (puppeteer) — posíláme NA POZADÍ a callId
  // vracíme HNED. Kiosek callId potřebuje, aby po připojení mohl zvoneček zhasnout
  // (jinak join-eventy proběhnou dřív, než callId dorazí, a zvoneček zůstane viset).
  const staff = process.env.STAFF_WHATSAPP || "420724239572";
  console.log(`[calls] NOTIFY callId=${call.id} property=${propName} @ ${new Date().toISOString()}`);
  sendWhatsApp(staff, `🛎️ Host volá z recepce ${propName}. Připojte se k videohovoru: ${b.joinUrl}`)
    .then(() => console.log(`[calls] whatsapp SENT for callId=${call.id} @ ${new Date().toISOString()}`))
    .catch((e) => console.log(`[calls] whatsapp FAIL for callId=${call.id}: ${(e as Error).message} @ ${new Date().toISOString()}`));

  return { sent: true, callId: call.id };
}));

// ── Jitsi/JaaS token pro videohovor (kiosek) — odstraní 5min limit i hlášku ──
// Když JaaS není nakonfigurováno, vrátí jwt:null a kiosek jede na veřejném meet.jit.si.
app.get("/call/token", h(async () => (isJaasConfigured() ? { jwt: mintJaasToken() } : { jwt: null })));

// ── Vyřešení hovoru z kiosku (někdo se připojil / hovor skončil) → zhasne zvoneček ──
app.post("/call/resolve", h(async (req) => {
  const b = z.object({ callId: z.string().min(1) }).parse(req.body);
  const resolved = callsStore.resolveCall(b.callId);
  console.log(`[calls] RESOLVE callId=${b.callId} resolved=${resolved} @ ${new Date().toISOString()}`);
  return { resolved };
}));

// ── AI recepční (kiosek, scopováno na provozovnu) ────────────
app.post("/ai/chat", h(async (req) => {
  const propertyId = await resolvePropertyId(req);
  const b = z.object({
    lang: z.string().optional(),
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1).max(40),
  }).parse(req.body);
  return aiChat(propertyId, b.lang || "cs", b.messages as ChatMsg[]);
}));

// ── Auth ─────────────────────────────────────────────────────
app.post("/auth/login", asyncWrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "invalid_credentials" });
  const props = await central.accessibleProperties(user);
  res.json(serialize({ token: createToken(user.id), user: { id: user.id, name: user.name, email: user.email, role: user.role }, properties: props }));
}));

const requireAuth = asyncWrap(async (req, res, next) => {
  const userId = readToken(req.header("x-admin-token") || "");
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const user = await central.loadUser(userId);
  if (!user || !user.active) return res.status(401).json({ error: "unauthorized" });
  res.locals.user = user;
  next();
});

app.get("/auth/me", requireAuth, h(async (_req, res) => {
  const user = res.locals.user;
  const props = await central.accessibleProperties(user);
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, properties: props };
}));

// ── Centrální správa (super_admin) ───────────────────────────
const requireSuperAdmin = (_req: Request, res: Response, next: NextFunction) => {
  if (res.locals.user.role !== UserRole.super_admin) return res.status(403).json({ error: "forbidden" });
  next();
};
const centralRouter = express.Router();
centralRouter.use(requireAuth, requireSuperAdmin);

centralRouter.get("/properties", h(() => central.listProperties()));
centralRouter.post("/properties", h((req) => {
  const b = z.object({ identifier: z.string().min(2), name: z.string().min(1), type: z.nativeEnum(PropertyType), street: z.string().optional(), city: z.string().optional(), phone: z.string().optional(), email: z.string().optional() }).parse(req.body);
  return central.createProperty(b);
}));
centralRouter.patch("/properties/:id", h((req) => {
  const b = z.object({
    name: z.string().optional(), identifier: z.string().optional(), type: z.nativeEnum(PropertyType).optional(), street: z.string().optional(), city: z.string().optional(), country: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), ico: z.string().optional(), dic: z.string().optional(), iban: z.string().optional(), vatPayer: z.boolean().optional(), active: z.boolean().optional(), infoText: z.string().optional(),
    operatorName: z.string().optional(), operatorAddress: z.string().optional(), operatorRegistration: z.string().optional(), operatorAccount: z.string().optional(), operatorIco: z.string().optional(), operatorDic: z.string().optional(),
    inventoryUnit: z.nativeEnum(InventoryUnit).optional(), cityTaxEnabled: z.boolean().optional(), cityTaxPerPersonNight: z.number().optional(), cityTaxFreeAge: z.number().int().min(0).max(26).optional(),
    allowLongTerm: z.boolean().optional(), selfCheckin: z.boolean().optional(), breakfastIncluded: z.boolean().optional(), dailyCleaning: z.boolean().optional(), offeredServices: z.array(z.nativeEnum(ServiceType)).optional(),
    onlineCheckinHours: z.number().int().min(0).optional(),
    freeCancelDays: z.number().int().min(0).max(365).optional(), cancelFeePct: z.number().int().min(0).max(100).optional(), depositPct: z.number().int().min(0).max(100).optional(),
    reminderHours: z.number().int().min(0).max(720).optional(), noShowHours: z.number().int().min(0).max(168).optional(),
  }).parse(req.body);
  return central.updateProperty(req.params.id, b);
}));

centralRouter.get("/whatsapp/status", h(async () => whatsappStatus()));

// E-mailové notifikace — ověření SMTP + testovací zpráva (diagnostika).
centralRouter.get("/mail/status", h(async () => ({ configured: mailer.isMailConfigured(), ...(await mailer.verifyMail()) })));
centralRouter.post("/mail/test", h(async (req) => mailer.sendTestMail(z.object({ to: z.string().email() }).parse(req.body).to)));

centralRouter.get("/users", h(() => central.listUsers()));
centralRouter.post("/users", h((req) => {
  const b = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(4), role: z.nativeEnum(UserRole), propertyIds: z.array(z.string().uuid()).optional() }).parse(req.body);
  return central.createUser(b);
}));
centralRouter.patch("/users/:id/properties", h((req) => {
  const b = z.object({ propertyIds: z.array(z.string().uuid()) }).parse(req.body);
  return central.setUserProperties(req.params.id, b.propertyIds);
}));
centralRouter.patch("/users/:id", h((req) => {
  const b = z.object({ name: z.string().min(1).optional(), role: z.nativeEnum(UserRole).optional(), password: z.string().min(4).optional() }).parse(req.body);
  return central.updateUser(req.params.id, b);
}));
centralRouter.delete("/users/:id", h(async (req, res) => {
  if (req.params.id === res.locals.user.id) throw new Error("Nelze smazat vlastní účet.");
  await central.deleteUser(req.params.id);
  return { ok: true };
}));

// Vybavení centrálně — napříč provozovnami + centrální sklad, přesun kamkoliv.
centralRouter.get("/equipment", h((req) => {
  const q = z.object({ propertyId: z.string().uuid().optional(), scope: z.enum(["central"]).optional() }).parse(req.query);
  const where = q.scope === "central" ? { propertyId: null } : q.propertyId ? { propertyId: q.propertyId } : {};
  return equip.listEquipment(where);
}));
centralRouter.post("/equipment", h((req) => {
  const b = z.object({ ...equipCreate.shape, propertyId: z.string().uuid().nullable().optional(), roomId: z.string().uuid().nullable().optional(), quantity: z.number().int().positive().max(500).optional() }).parse(req.body);
  return equip.createEquipmentBatch({ ...b, acquiredAt: toD(b.acquiredAt) ?? undefined, manufacturedAt: toD(b.manufacturedAt) ?? undefined }, b.quantity ?? 1);
}));
centralRouter.patch("/equipment/:id", h((req) => equip.updateEquipment(req.params.id, patchToInput(equipPatch.parse(req.body)))));
centralRouter.post("/equipment/bulk-move", h((req) => { const b = z.object({ ids: z.array(z.string().uuid()), propertyId: z.string().uuid().nullable(), roomId: z.string().uuid().nullable(), note: z.string().optional() }).parse(req.body); return equip.bulkMove(b.ids, { propertyId: b.propertyId, roomId: b.roomId }, b.note); }));
centralRouter.post("/equipment/bulk-retire", h((req) => { const b = z.object({ ids: z.array(z.string().uuid()), retiredReason: z.string().optional() }).parse(req.body); return equip.bulkRetire(b.ids, b.retiredReason ?? "—"); }));
centralRouter.post("/equipment/bulk-delete", h((req) => { const b = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body); return equip.bulkDelete(b.ids); }));
// Číselník kategorií (super_admin)
centralRouter.get("/equipment-categories", h(() => equip.listCategories()));
centralRouter.post("/equipment-categories", h((req) => { const b = z.object({ name: z.string().min(1) }).parse(req.body); return equip.createCategory(b.name); }));
centralRouter.delete("/equipment-categories/:id", h(async (req) => { await equip.deleteCategory(req.params.id); return { ok: true }; }));
centralRouter.post("/equipment/:id/move", h((req) => { const b = z.object({ propertyId: z.string().uuid().nullable(), roomId: z.string().uuid().nullable(), note: z.string().optional() }).parse(req.body); return equip.moveEquipment(req.params.id, { propertyId: b.propertyId, roomId: b.roomId }, b.note); }));
centralRouter.delete("/equipment/:id", h(async (req) => { await equip.deleteEquipment(req.params.id); return { ok: true }; }));
centralRouter.get("/equipment/:id/moves", h((req) => equip.listMoves(req.params.id)));

app.use("/central", centralRouter);

// Sdílená brána: ověř přístup uživatele k provozovně (x-property-id).
const propertyScope = asyncWrap(async (req, res, next) => {
  const raw = req.header("x-property-id") || String(req.query.property || "");
  if (!raw) return res.status(400).json({ error: "missing_property" });
  const prop = await prisma.property.findFirst({ where: { OR: [{ id: raw }, { identifier: raw }] } });
  if (!prop) return res.status(404).json({ error: "property_not_found" });
  if (!central.canAccessProperty(res.locals.user, prop.id)) return res.status(403).json({ error: "forbidden" });
  res.locals.propertyId = prop.id;
  next();
});
const pid = (res: Response): string => res.locals.propertyId;

// ── Admin (auth + scoping na provozovnu) ─────────────────────
const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.use(propertyScope);

adminRouter.get("/dashboard", h((req, res) => admin.dashboard(pid(res), req.query.date ? new Date(String(req.query.date)) : new Date())));
adminRouter.get("/occupancy", h((_req, res) => admin.occupancy(pid(res))));
adminRouter.get("/room-board", h((_req, res) => admin.roomBoard(pid(res))));
adminRouter.get("/rooms/:id/detail", h((req, res) => admin.roomDetail(pid(res), req.params.id)));
adminRouter.get("/rooms/:id/unassigned", h((req, res) => admin.unassignedForRoom(pid(res), req.params.id)));
adminRouter.get("/reservations/:id/room-candidates", h((req, res) => admin.roomMoveCandidates(pid(res), req.params.id)));
adminRouter.post("/rooms/:id/request", h(async (req, res) => {
  const room = await prisma.room.findFirst({ where: { id: req.params.id, propertyId: pid(res) }, select: { id: true } });
  if (!room) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const b = z.object({ type: z.nativeEnum(ServiceType), description: z.string().optional() }).parse(req.body);
  return service.createRequest({ propertyId: pid(res), roomId: req.params.id, type: b.type, description: b.description, fromGuest: false });
}));

// Hosté na pokoji (spolubydlící) — vč. adresy a dokladu, editace
const guestBody = z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), address: z.string().optional(), documentType: z.nativeEnum(DocumentType).nullable().optional(), documentNumber: z.string().optional() });
adminRouter.get("/reservations/:id/guests", h((req, res) => admin.listReservationGuests(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/guests", h((req, res) => admin.addReservationGuest(pid(res), req.params.id, guestBody.parse(req.body))));
adminRouter.patch("/reservation-guests/:id", h((req, res) => admin.updateReservationGuest(pid(res), req.params.id, guestBody.partial().parse(req.body))));
adminRouter.delete("/reservation-guests/:id", h((req, res) => admin.removeReservationGuest(pid(res), req.params.id)));

// Ceník služeb (číselník)
adminRouter.get("/service-items", h((_req, res) => admin.listServiceItems(pid(res))));
adminRouter.post("/service-items", h((req, res) => {
  const b = z.object({ name: z.string().min(1), category: z.nativeEnum(ChargeCategory), price: z.number().nonnegative(), vatRate: z.number().nonnegative().optional() }).parse(req.body);
  return admin.createServiceItem(pid(res), b);
}));
adminRouter.patch("/service-items/:id", h((req, res) => {
  const b = z.object({ name: z.string().optional(), category: z.nativeEnum(ChargeCategory).optional(), price: z.number().nonnegative().optional(), vatRate: z.number().nonnegative().optional() }).parse(req.body);
  return admin.updateServiceItem(pid(res), req.params.id, b);
}));
adminRouter.delete("/service-items/:id", h((req, res) => admin.deleteServiceItem(pid(res), req.params.id)));

adminRouter.get("/reservations", h((req, res) => admin.listReservations(pid(res), { status: req.query.status as string | undefined, q: req.query.q as string | undefined })));
adminRouter.post("/reservations", h((req, res) => {
  const b = z.object({ roomTypeId: z.string().uuid(), from: dateStr, to: dateStr, adults: z.number().int().positive(), children: z.number().int().nonnegative().optional(), childAges: z.array(z.number().int().min(0).max(25)).optional(), guest: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), language: z.string().optional() }), billingCompany: z.string().optional(), billingIco: z.string().optional(), billingDic: z.string().optional() }).parse(req.body);
  return admin.createReservation({ propertyId: pid(res), ...b, from: new Date(b.from), to: new Date(b.to) });
}));
adminRouter.get("/reservations/:id", h((req, res) => admin.getReservation(pid(res), req.params.id)));
adminRouter.patch("/reservations/:id", h((req, res) => admin.updateReservationNote(pid(res), req.params.id, z.object({ note: z.string() }).parse(req.body).note)));
adminRouter.patch("/reservations/:id/primary-guest", h((req, res) => admin.setPrimaryGuest(pid(res), req.params.id, z.object({ guestId: z.string().uuid() }).parse(req.body).guestId)));
adminRouter.post("/reservations/:id/dnd", h((req, res) => admin.setDoNotDisturb(pid(res), req.params.id, z.object({ on: z.boolean() }).parse(req.body).on)));
adminRouter.post("/reservations/:id/registration", h((req, res) => {
  const b = z.object({ primary: z.boolean().optional(), fullName: z.string().min(2), dateOfBirth: dateStr, nationality: z.string().min(2), documentType: z.nativeEnum(DocumentType).optional(), documentNumber: z.string().optional(), homeAddress: z.string().optional() }).parse(req.body);
  return admin.addRegistration(pid(res), req.params.id, { ...b, dateOfBirth: new Date(b.dateOfBirth) });
}));
adminRouter.delete("/registrations/:id", h((req, res) => admin.deleteRegistration(pid(res), req.params.id)));
adminRouter.get("/reservations/:id/folio", h((req, res) => admin.adminFolio(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/checkin", h((req, res) => admin.adminCheckIn(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/checkout", h(async (req, res) => {
  const result = await admin.adminCheckOut(pid(res), req.params.id);
  const document = await billing.issueReservationDocument(pid(res), req.params.id, "receipt" as BillingDocType).catch(() => null); // účtenka za pobyt
  return { ...result, document };
}));
adminRouter.post("/reservations/:id/payments", h(async (req, res) => {
  const b = z.object({ type: z.nativeEnum(PaymentType), amount: z.number(), method: z.nativeEnum(PaymentMethod).optional(), description: z.string().optional(), invoiceNumber: z.string().optional() }).parse(req.body);
  const payment = await admin.adminAddPayment(pid(res), req.params.id, b);
  await cash.recordPayment(pid(res), { paymentId: payment.id, amount: payment.amount, method: payment.method, note: payment.description ?? undefined }); // naváže na směnu (hotovost i karta)
  return payment;
}));

// Účet pokoje — připsané položky (minibar, wellness, služby…).
adminRouter.get("/reservations/:id/charges", h((req, res) => admin.adminListCharges(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/charges", h((req, res) => {
  const b = z.object({ category: z.nativeEnum(ChargeCategory), description: z.string().optional(), quantity: z.number().positive().optional(), unitPrice: z.number().nonnegative(), vatRate: z.number().nonnegative().optional() }).parse(req.body);
  return admin.adminAddCharge(pid(res), req.params.id, b);
}));
adminRouter.delete("/charges/:id", h((req, res) => admin.adminDeleteCharge(pid(res), req.params.id)));
adminRouter.get("/reservations/:id/invoice", h((req, res) => admin.buildInvoice(pid(res), req.params.id)));
adminRouter.get("/reservations/:id/receipt", h((req, res) => admin.buildStayReceipt(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/cancel", h((req, res) => admin.cancelReservation(pid(res), req.params.id)));
adminRouter.get("/calendar", h((req, res) => {
  const q = z.object({ from: dateStr.optional(), days: z.coerce.number().int().min(1).max(60).optional() }).parse(req.query);
  return occupancyCalendar(pid(res), q.from ? new Date(q.from) : new Date(), q.days ?? 21);
}));
adminRouter.get("/tapechart", h((req, res) => {
  const q = z.object({ from: dateStr.optional(), days: z.coerce.number().int().min(1).max(60).optional() }).parse(req.query);
  return tapeChart(pid(res), q.from ? new Date(q.from) : new Date(), q.days ?? 21);
}));
adminRouter.post("/reservations/:id/assign", h((req, res) => admin.assignUnit(pid(res), req.params.id, z.object({ unitId: z.string().uuid() }).parse(req.body).unitId)));
adminRouter.get("/ubyport", h((req, res) => {
  const q = z.object({ from: dateStr, to: dateStr, all: z.coerce.boolean().optional() }).parse(req.query);
  return admin.ubyportData(pid(res), new Date(q.from), new Date(q.to), !!q.all);
}));
adminRouter.get("/ical/feeds", h(async (_req, res) => {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: pid(res) }, select: { identifier: true } });
  const base = (process.env.PUBLIC_GUEST_URL || "").replace(/\/$/, "");
  const tok = icalToken(p.identifier);
  const url = (rt?: string) => `${base}/api/ical/${encodeURIComponent(p.identifier)}/${tok}.ics${rt ? `?roomType=${rt}` : ""}`;
  const types = await prisma.roomType.findMany({ where: { propertyId: pid(res) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return { all: url(), perType: types.map((t) => ({ name: t.name, url: url(t.id) })) };
}));
adminRouter.get("/ical/import-feeds", h((_req, res) => listIcalFeeds(pid(res))));
adminRouter.post("/ical/import-feeds", h((req, res) => {
  const b = z.object({ roomTypeId: z.string().uuid(), url: z.string().url(), label: z.string().optional() }).parse(req.body);
  return addIcalFeed(pid(res), b.roomTypeId, b.url, b.label);
}));
adminRouter.delete("/ical/import-feeds/:id", h((req, res) => deleteIcalFeed(pid(res), req.params.id)));
adminRouter.post("/ical/sync", h((_req, res) => syncProperty(pid(res))));
// CRM hostů + hodnocení (scopováno na vybranou provozovnu)
adminRouter.get("/guests", h((req, res) => guests.searchGuests([pid(res)], String(req.query.q ?? ""))));
adminRouter.get("/guests/:id", h((req, res) => guests.guestProfile(req.params.id, [pid(res)])));
adminRouter.patch("/guests/:id", h((req, res) => guests.updateGuestCrm(req.params.id, [pid(res)],
  z.object({ firstName: z.string().optional(), lastName: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), language: z.string().optional(), address: z.string().optional(), documentType: z.string().optional(), documentNumber: z.string().optional(), vip: z.boolean().optional(), preferences: z.string().optional(), marketingConsent: z.boolean().optional() }).parse(req.body))));
adminRouter.post("/guests/:id/merge", h((req, res) => guests.mergeGuests(req.params.id, z.object({ sourceId: z.string().uuid() }).parse(req.body).sourceId, [pid(res)])));
adminRouter.delete("/guests/:id", h((req, res) => guests.deleteGuest(req.params.id)));
adminRouter.get("/reviews", h((_req, res) => guests.listReviews(pid(res))));
// Skupinové / vícepokojové rezervace
const groupRoom = z.object({ roomTypeId: z.string().uuid(), adults: z.number().int().positive(), children: z.number().int().nonnegative().optional(), childAges: z.array(z.number().int().min(0).max(25)).optional(), firstName: z.string().optional(), lastName: z.string().optional() });
adminRouter.get("/groups", h((_req, res) => groups.listGroups(pid(res))));
adminRouter.get("/groups/:id", h((req, res) => groups.getGroup(pid(res), req.params.id)));
adminRouter.post("/groups", h((req, res) => {
  const b = z.object({
    name: z.string().min(1), note: z.string().optional(), from: dateStr, to: dateStr,
    organizer: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), language: z.string().optional() }),
    rooms: z.array(groupRoom).min(1),
  }).parse(req.body);
  return groups.createGroup(pid(res), { ...b, from: new Date(b.from), to: new Date(b.to) });
}));
adminRouter.post("/groups/:id/checkin", h((req, res) => groups.checkInGroup(pid(res), req.params.id)));
adminRouter.post("/groups/:id/checkout", h((req, res) => groups.checkOutGroup(pid(res), req.params.id)));
adminRouter.post("/groups/:id/cancel", h((req, res) => groups.cancelGroup(pid(res), req.params.id)));
adminRouter.post("/groups/:id/email", h((req, res) => groups.emailGroupSummary(pid(res), req.params.id)));
adminRouter.get("/reservations/:id/emails", h((req, res) => admin.adminListEmails(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/emails/resend", h((req, res) => admin.adminResendEmail(pid(res), req.params.id, z.object({ type: z.string() }).parse(req.body).type)));

adminRouter.get("/rooms", h((_req, res) => admin.listRooms(pid(res))));
adminRouter.post("/rooms", h((req, res) => { const b = z.object({ roomTypeId: z.string().uuid(), number: z.string().min(1), floor: z.number().int(), lockType: z.nativeEnum(LockType).optional() }).parse(req.body); return admin.createRoom(pid(res), b); }));
adminRouter.patch("/rooms/:id", h((req) => { const b = z.object({ number: z.string().optional(), floor: z.number().int().optional(), status: z.nativeEnum(RoomStatus).optional(), lockType: z.nativeEnum(LockType).optional(), notes: z.string().optional() }).parse(req.body); return admin.updateRoom("", req.params.id, b); }));
adminRouter.post("/rooms/:id/clean", h((req) => admin.markRoomClean(req.params.id)));
adminRouter.delete("/rooms/:id", h(async (req) => { await admin.deleteRoom(req.params.id); return { ok: true }; }));

adminRouter.get("/beds", h((_req, res) => admin.listBeds(pid(res))));
adminRouter.post("/beds", h((req, res) => { const b = z.object({ roomId: z.string().uuid(), label: z.string().min(1) }).parse(req.body); return admin.createBed(pid(res), b); }));
adminRouter.delete("/beds/:id", h(async (req) => { await admin.deleteBed(req.params.id); return { ok: true }; }));

adminRouter.get("/room-types", h((_req, res) => admin.listRoomTypes(pid(res))));
adminRouter.post("/room-types", h((req, res) => { const b = z.object({ name: z.string().min(1), description: z.string().optional(), capacityAdults: z.number().int().positive(), capacityChildren: z.number().int().nonnegative().optional(), basePrice: z.number().nonnegative(), weeklyPrice: z.number().nonnegative().optional(), monthlyPrice: z.number().nonnegative().optional(), amenities: z.array(z.string()).optional() }).parse(req.body); return admin.createRoomType(pid(res), b); }));
adminRouter.patch("/room-types/:id", h((req) => { const b = z.object({ name: z.string().optional(), description: z.string().optional(), capacityAdults: z.number().int().optional(), capacityChildren: z.number().int().optional(), basePrice: z.number().optional(), weeklyPrice: z.number().optional(), monthlyPrice: z.number().optional(), amenities: z.array(z.string()).optional() }).parse(req.body); return admin.updateRoomType(req.params.id, b); }));

adminRouter.get("/rate-plans", h((req) => { const q = z.object({ roomTypeId: z.string().uuid(), from: dateStr, to: dateStr }).parse(req.query); return admin.listRatePlans(q.roomTypeId, new Date(q.from), new Date(q.to)); }));
adminRouter.post("/rate-plans", h((req) => { const b = z.object({ roomTypeId: z.string().uuid(), date: dateStr, price: z.number().nonnegative() }).parse(req.body); return admin.upsertRatePlan(b.roomTypeId, new Date(b.date), b.price); }));

// Revenue / pricing agent — návrh dynamických cen + jejich schválení (zápis do RatePlan).
adminRouter.get("/pricing/suggestions", h((req, res) => {
  const q = z.object({ roomTypeId: z.string().uuid(), horizon: z.coerce.number().int().positive().max(60).optional() }).parse(req.query);
  return suggestRates(pid(res), q.roomTypeId, q.horizon ?? 14);
}));
adminRouter.post("/pricing/apply", h((req, res) => {
  const b = z.object({ roomTypeId: z.string().uuid(), items: z.array(z.object({ date: dateStr, price: z.number().nonnegative() })).min(1) }).parse(req.body);
  return applyRates(pid(res), b.roomTypeId, b.items);
}));

adminRouter.get("/registrations", h((req, res) => { const q = z.object({ from: dateStr, to: dateStr }).parse(req.query); return admin.listRegistrations(pid(res), new Date(q.from), new Date(q.to)); }));

// Úhrady (seznam) + doklad o zaplacení za jednotlivou platbu.
adminRouter.get("/payments", h((req, res) => {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse({ from: req.query.from || undefined, to: req.query.to || undefined });
  return admin.listPayments(pid(res), q.from ? new Date(q.from) : undefined, q.to ? new Date(q.to) : undefined);
}));
adminRouter.get("/payments/:id/receipt", h((req, res) => admin.buildPaymentReceipt(pid(res), req.params.id)));

// Doklady — seznam, detail, vystavení (faktura/účtenka, zálohová), storno.
adminRouter.get("/documents", h((req, res) => {
  const q = z.object({ type: z.nativeEnum(BillingDocType).optional(), from: dateStr.optional(), to: dateStr.optional() }).parse({ type: req.query.type || undefined, from: req.query.from || undefined, to: req.query.to || undefined });
  return billing.listDocuments(pid(res), { type: q.type, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined });
}));
adminRouter.get("/documents/export.csv", asyncWrap(async (req, res) => {
  const q = z.object({ type: z.nativeEnum(BillingDocType).optional(), from: dateStr.optional(), to: dateStr.optional() }).parse({ type: req.query.type || undefined, from: req.query.from || undefined, to: req.query.to || undefined });
  const csv = await billing.exportDocumentsCsv(pid(res), { type: q.type, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="doklady.csv"`);
  res.send(csv);
}));
adminRouter.get("/documents/:id", h((req, res) => billing.getDocument(pid(res), req.params.id)));
adminRouter.post("/documents/:id/cancel", h((req, res) => billing.cancelDocument(pid(res), req.params.id)));
adminRouter.post("/documents/:id/pay", h((req, res) => {
  const b = z.object({ method: z.enum(["cash", "card_terminal", "prepaid", "invoice"]) }).parse(req.body);
  return billing.payDocument(pid(res), req.params.id, b.method as PaymentMethod);
}));
adminRouter.post("/documents/:id/credit-note", h((req, res) => {
  const b = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
  return billing.createCreditNote(pid(res), req.params.id, b.reason);
}));
adminRouter.post("/documents/:id/advance-tax", h((req, res) => billing.issueAdvanceTaxDoc(pid(res), req.params.id)));
adminRouter.post("/documents/bulk-invoice", h((req, res) => {
  const b = z.object({ reservationIds: z.array(z.string().uuid()).min(1) }).parse(req.body);
  return billing.issueBulkInvoice(pid(res), b.reservationIds);
}));
adminRouter.post("/reservations/:id/period-invoice", h((req, res) => {
  const b = z.object({ from: dateStr, to: dateStr }).parse(req.body);
  return billing.issuePeriodInvoice(pid(res), req.params.id, new Date(b.from), new Date(b.to));
}));
adminRouter.post("/reservations/:id/documents", h((req, res) => {
  const b = z.object({ type: z.enum(["invoice", "receipt"]).default("invoice") }).parse(req.body ?? {});
  return billing.issueReservationDocument(pid(res), req.params.id, b.type as BillingDocType);
}));
adminRouter.post("/reservations/:id/proforma", h((req, res) => {
  const b = z.object({ amount: z.number().positive(), dueInDays: z.number().int().positive().optional() }).parse(req.body);
  return billing.issueProforma(pid(res), req.params.id, b.amount, b.dueInDays);
}));

// Pokladna — stav, otevření směny, příjem/výdej, uzávěrka, historie.
adminRouter.get("/cashregister", h((_req, res) => cash.getState(pid(res))));
adminRouter.get("/cashregister/sessions", h((_req, res) => cash.listSessions(pid(res))));
adminRouter.post("/cashregister/open", h((req, res) => {
  const b = z.object({ openingFloat: z.number().nonnegative() }).parse(req.body);
  return cash.openSession(pid(res), res.locals.user.id, b.openingFloat);
}));
adminRouter.post("/cashregister/movement", h((req, res) => {
  const b = z.object({ kind: z.enum(["income", "expense"]), amount: z.number().positive(), note: z.string().optional() }).parse(req.body);
  return cash.addMovement(pid(res), { kind: b.kind as import("@prisma/client").CashMovementKind, amount: b.amount, note: b.note });
}));
adminRouter.post("/cashregister/close", h((req, res) => {
  const b = z.object({ countedCash: z.number().nonnegative(), note: z.string().optional() }).parse(req.body);
  return cash.closeSession(pid(res), res.locals.user.id, b.countedCash, b.note);
}));

// Přehled servisních požadavků (manažer/super_admin).
adminRouter.get("/requests", h((req, res) => {
  const q = z.object({ status: z.nativeEnum(ServiceStatus).optional(), domain: z.nativeEnum(ServiceDomain).optional() }).parse(req.query);
  return service.listRequests({ propertyId: pid(res), ...(q.status ? { status: q.status } : {}), ...(q.domain ? { domain: q.domain } : {}) });
}));

// Kontrolní agent — akční nálezy (compliance / billing / inventář), READ-ONLY.
adminRouter.get("/checks", h((_req, res) => runChecks(pid(res))));

// Orchestrátor — ranní briefing (noční audit provozovny, READ-ONLY).
adminRouter.get("/briefing", h((_req, res) => runNightAudit(pid(res))));
adminRouter.post("/briefing/brief", h(async (req, res) => {
  const lang = z.object({ lang: z.string().optional() }).parse(req.body ?? {}).lang || "cs";
  const audit = await runNightAudit(pid(res));
  return { brief: await briefManager(audit, lang) };
}));

// Housekeeping dispečer — prioritizovaný plán úklidu (manažer).
adminRouter.get("/housekeeping/plan", h((_req, res) => buildHousekeepingPlan(pid(res))));
// Volitelné AI shrnutí směny (Claude/Haiku) — jen na vyžádání kvůli nákladům.
adminRouter.post("/housekeeping/brief", h(async (req, res) => {
  const lang = z.object({ lang: z.string().optional() }).parse(req.body ?? {}).lang || "cs";
  const plan = await buildHousekeepingPlan(pid(res));
  return { brief: await briefHousekeeping(plan, lang) };
}));

// Údržba triage — prioritizovaná fronta údržby (manažer).
adminRouter.get("/maintenance/plan", h((_req, res) => buildMaintenancePlan(pid(res))));
adminRouter.post("/maintenance/brief", h(async (req, res) => {
  const lang = z.object({ lang: z.string().optional() }).parse(req.body ?? {}).lang || "cs";
  const plan = await buildMaintenancePlan(pid(res));
  return { brief: await briefMaintenance(plan, lang) };
}));

// Vybavení (DHIM) — jen v rámci vlastní provozovny (pokoje + sklad provozovny).
const optDate = dateStr.optional();
const nullDate = dateStr.nullable().optional();
const toD = (s?: string | null) => (s == null ? (s === null ? null : undefined) : new Date(s));

const equipCreate = z.object({
  name: z.string().min(1), code: z.string().optional(), categoryId: z.string().uuid().nullable().optional(),
  serialNumber: z.string().optional(), condition: z.nativeEnum(EquipmentCondition).optional(), note: z.string().optional(),
  acquiredAt: optDate, manufacturedAt: optDate,
});
const equipPatch = z.object({
  name: z.string().optional(), code: z.string().optional(), categoryId: z.string().uuid().nullable().optional(),
  serialNumber: z.string().optional(), condition: z.nativeEnum(EquipmentCondition).optional(), note: z.string().optional(),
  acquiredAt: nullDate, manufacturedAt: nullDate, retiredAt: nullDate, retiredReason: z.string().nullable().optional(),
});
const patchToInput = (b: z.infer<typeof equipPatch>) => ({
  name: b.name, code: b.code, categoryId: b.categoryId, serialNumber: b.serialNumber, condition: b.condition, note: b.note,
  acquiredAt: toD(b.acquiredAt), manufacturedAt: toD(b.manufacturedAt), retiredAt: toD(b.retiredAt), retiredReason: b.retiredReason,
});

adminRouter.get("/equipment-categories", h(() => equip.listCategories()));
adminRouter.get("/equipment", h((_req, res) => equip.listEquipment(equip.ownOrCentral(pid(res)))));
adminRouter.post("/equipment", h(async (req, res) => {
  const b = z.object({ ...equipCreate.shape, roomId: z.string().uuid().nullable().optional(), central: z.boolean().optional(), quantity: z.number().int().positive().max(500).optional() }).parse(req.body);
  if (b.roomId) { const room = await prisma.room.findUnique({ where: { id: b.roomId } }); if (!room || room.propertyId !== pid(res)) throw new Error("Pokoj nepatří do této provozovny."); }
  const input = { ...b, acquiredAt: toD(b.acquiredAt) ?? undefined, manufacturedAt: toD(b.manufacturedAt) ?? undefined, propertyId: b.central ? null : pid(res), roomId: b.central ? null : (b.roomId ?? null) };
  return equip.createEquipmentBatch(input, b.quantity ?? 1);
}));
adminRouter.patch("/equipment/:id", h(async (req, res) => { await equip.assertInProperty(pid(res), req.params.id); return equip.updateEquipment(req.params.id, patchToInput(equipPatch.parse(req.body))); }));
adminRouter.post("/equipment/bulk-move", h((req, res) => { const b = z.object({ ids: z.array(z.string().uuid()), roomId: z.string().uuid().nullable().optional(), central: z.boolean().optional(), note: z.string().optional() }).parse(req.body); const target = b.central ? { propertyId: null, roomId: null } : { propertyId: pid(res), roomId: b.roomId ?? null }; return equip.bulkMove(b.ids, target, b.note, pid(res), true); }));
adminRouter.post("/equipment/bulk-retire", h((req, res) => { const b = z.object({ ids: z.array(z.string().uuid()), retiredReason: z.string().optional() }).parse(req.body); return equip.bulkRetire(b.ids, b.retiredReason ?? "—", pid(res)); }));
adminRouter.post("/equipment/bulk-delete", h((req, res) => { const b = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body); return equip.bulkDelete(b.ids, pid(res)); }));
adminRouter.post("/equipment/:id/move", h(async (req, res) => { await equip.assertInPropertyOrCentral(pid(res), req.params.id); const b = z.object({ roomId: z.string().uuid().nullable().optional(), central: z.boolean().optional(), note: z.string().optional() }).parse(req.body); const target = b.central ? { propertyId: null, roomId: null } : { propertyId: pid(res), roomId: b.roomId ?? null }; return equip.moveEquipment(req.params.id, target, b.note); }));
adminRouter.delete("/equipment/:id", h(async (req, res) => { await equip.assertInProperty(pid(res), req.params.id); await equip.deleteEquipment(req.params.id); return { ok: true }; }));
adminRouter.get("/equipment/:id/moves", h(async (req, res) => { await equip.assertInProperty(pid(res), req.params.id); return equip.listMoves(req.params.id); }));

app.use("/admin", adminRouter);

// ── Přivolání člověka: zvoneček pro manažery (napříč hotely, bez scope na provozovnu) ──
const callsRouter = express.Router();
callsRouter.use(requireAuth);
const requireManagerial = (_req: Request, res: Response, next: NextFunction) => {
  const r = res.locals.user.role;
  if (r !== UserRole.manager && r !== UserRole.super_admin) return res.status(403).json({ error: "forbidden" });
  next();
};
callsRouter.get("/pending", requireManagerial, h(async () => callsStore.listPending()));
callsRouter.post("/:id/claim", requireManagerial, h(async (req, res) => callsStore.claimCall(req.params.id, res.locals.user.id, res.locals.user.name)));
app.use("/calls", callsRouter);

// ── Host (portál podle rezervačního kódu, bez přihlášení) ────
app.get("/guest/:code", h(async (req) => {
  const r = await service.loadReservationByCode(req.params.code);
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const requests = await service.listRequestsForReservation(r.id);
  const inHouse = r.status === "checked_in";
  return {
    reservation: {
      code: r.code, propertyName: r.property.name,
      guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
      unit: r.room ? `pokoj ${r.room.number}` : r.bed ? `lůžko ${r.bed.label}` : null,
      checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, status: r.status,
      adults: r.adults, children: r.children,
    },
    lang: r.primaryGuest.language,
    onlineCheckin: onlineCheckinInfo(r, r.property),
    // Požadavky (úklid apod.) až po ubytování; před příjezdem jen „Jiné".
    canRequestAll: inHouse,
    // Služby, které tato provozovna hostům nabízí (maintenance/other jsou vždy k dispozici).
    services: r.property.offeredServices,
    doNotDisturb: r.doNotDisturb,
    requests,
  };
}));
app.post("/guest/:code/language", h(async (req) => {
  const r = await service.loadReservationByCode(req.params.code);
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const b = z.object({ lang: z.string().min(2).max(5) }).parse(req.body);
  await prisma.guest.update({ where: { id: r.primaryGuestId }, data: { language: b.lang } });
  return { ok: true };
}));
app.post("/guest/:code/checkin", h(async (req) => {
  const r = await service.loadReservationByCode(req.params.code);
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const person = z.object({
    fullName: z.string().min(2), dateOfBirth: dateStr, nationality: z.string().min(2),
    documentType: z.nativeEnum(DocumentType).optional(), documentNumber: z.string().optional(), homeAddress: z.string().optional(),
  });
  const b = z.object({ persons: z.array(person).min(1) }).parse(req.body);
  await completeOnlineCheckin(r.id, b.persons.map((p) => ({ ...p, dateOfBirth: new Date(p.dateOfBirth) })));
  return { ok: true };
}));
// Host si přepne „Nerušit" (Do Not Disturb) — jen po ubytování.
app.post("/guest/:code/dnd", h(async (req) => {
  const r = await service.loadReservationByCode(req.params.code);
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const on = z.object({ on: z.boolean() }).parse(req.body).on;
  if (r.status !== "checked_in") throw new Error("Nerušit lze nastavit až po ubytování.");
  await prisma.reservation.update({ where: { id: r.id }, data: { doNotDisturb: on, dndSince: on ? new Date() : null } });
  return { doNotDisturb: on };
}));
app.post("/guest/:code/requests", h(async (req) => {
  const r = await service.loadReservationByCode(req.params.code);
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const b = z.object({ type: z.nativeEnum(ServiceType), description: z.string().optional() }).parse(req.body);
  // Před ubytováním (host ještě nedorazil) povolíme jen obecný požadavek „Jiné".
  if (r.status !== "checked_in" && b.type !== ServiceType.other)
    throw new Error("Tento typ požadavku bude dostupný po vašem příjezdu. Nyní můžete poslat jen obecný požadavek (Jiné).");
  // Volitelné služby (úklid/praní/žehlení/minibar) lze žádat jen pokud je provozovna nabízí; údržba a „Jiné" vždy.
  const optional: ServiceType[] = [ServiceType.cleaning, ServiceType.laundry, ServiceType.ironing, ServiceType.minibar];
  if (optional.includes(b.type) && !r.property.offeredServices.includes(b.type))
    throw new Error("Tuto službu provozovna momentálně nenabízí.");
  return service.createRequest({ propertyId: r.propertyId, reservationId: r.id, roomId: r.roomId, bedId: r.bedId, type: b.type, description: b.description, fromGuest: true });
}));
// Hodnocení pobytu (NPS) — odkaz z check-out e-mailu, bez přihlášení.
app.get("/guest/:code/feedback", h(async (req) => {
  const ctx = await guests.feedbackContext(req.params.code);
  if (!ctx) throw Object.assign(new Error("not_found"), { code: "P2025" });
  return ctx;
}));
app.post("/guest/:code/feedback", h(async (req) => {
  const b = z.object({ nps: z.number().int().min(0).max(10), comment: z.string().max(2000).optional() }).parse(req.body);
  return guests.saveReview(req.params.code, b.nps, b.comment);
}));

// ── Portál personálu (uklízečka / údržbář / manažer) ─────────
const staffRouter = express.Router();
staffRouter.use(requireAuth, propertyScope);
const staffDomain = (role: UserRole): ServiceDomain | undefined =>
  role === UserRole.housekeeping ? ServiceDomain.housekeeping : role === UserRole.maintenance ? ServiceDomain.maintenance : undefined;

staffRouter.get("/requests", h((req, res) => {
  const q = z.object({ status: z.nativeEnum(ServiceStatus).optional() }).parse(req.query);
  const d = staffDomain(res.locals.user.role);
  return service.listRequests({ propertyId: pid(res), ...(d ? { domain: d } : {}), ...(q.status ? { status: q.status } : {}) });
}));
staffRouter.post("/requests", h((req, res) => {
  const b = z.object({ type: z.nativeEnum(ServiceType), description: z.string().optional(), roomId: z.string().uuid().nullable().optional() }).parse(req.body);
  return service.createRequest({ propertyId: pid(res), roomId: b.roomId ?? null, type: b.type, description: b.description, fromGuest: false });
}));
staffRouter.post("/requests/:id/status", h(async (req, res) => {
  const owned = await prisma.serviceRequest.findFirst({ where: { id: req.params.id, propertyId: pid(res) }, select: { id: true } });
  if (!owned) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const b = z.object({ status: z.nativeEnum(ServiceStatus), note: z.string().optional() }).parse(req.body);
  return service.updateStatus(req.params.id, b.status, b.note, res.locals.user.id);
}));
// Fotky závady (data URL base64) k požadavku
staffRouter.post("/requests/:id/photos", h(async (req, res) => {
  const owned = await prisma.serviceRequest.findFirst({ where: { id: req.params.id, propertyId: pid(res) }, select: { id: true } });
  if (!owned) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const b = z.object({ images: z.array(z.string()).min(1).max(5) }).parse(req.body);
  return service.addRequestImages(req.params.id, b.images);
}));
// Ceník služeb + naúčtování praní/žehlení/minibaru na účet hosta (z požadavku)
staffRouter.get("/service-items", h((_req, res) => admin.listServiceItems(pid(res))));
staffRouter.post("/requests/:id/charge", h(async (req, res) => {
  const b = z.object({ serviceItemId: z.string().uuid(), quantity: z.number().positive(), markDone: z.boolean().optional() }).parse(req.body);
  const charge = await admin.chargeFromRequest(pid(res), req.params.id, b.serviceItemId, b.quantity);
  if (b.markDone) await service.updateStatus(req.params.id, ServiceStatus.done, undefined, res.locals.user.id); // volitelně označit hotové
  return charge;
}));
// Pokoje + přepnutí stavu (úklid odbavuje z telefonu)
staffRouter.get("/rooms", h((_req, res) =>
  prisma.room.findMany({ where: { propertyId: pid(res) }, select: { id: true, number: true, status: true, roomType: { select: { name: true } } }, orderBy: { number: "asc" } })));
staffRouter.post("/rooms/:id/status", h(async (req, res) => {
  const owned = await prisma.room.findFirst({ where: { id: req.params.id, propertyId: pid(res) }, select: { id: true } });
  if (!owned) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const b = z.object({ status: z.nativeEnum(RoomStatus) }).parse(req.body);
  return prisma.room.update({ where: { id: req.params.id }, data: { status: b.status }, select: { id: true, number: true, status: true } });
}));

// „Nerušit" — uklízečka označí, že host si nepřeje úklid (visačka na dveřích).
staffRouter.post("/reservations/:id/dnd", h((req, res) => admin.setDoNotDisturb(pid(res), req.params.id, z.object({ on: z.boolean() }).parse(req.body).on)));

// Prioritizovaný plán úklidu pro uklízečku (housekeeping dispečer).
staffRouter.get("/plan", h((_req, res) => buildHousekeepingPlan(pid(res))));
staffRouter.post("/plan/brief", h(async (req, res) => {
  const lang = z.object({ lang: z.string().optional() }).parse(req.body ?? {}).lang || "cs";
  const plan = await buildHousekeepingPlan(pid(res));
  return { brief: await briefHousekeeping(plan, lang) };
}));

// Prioritizovaná fronta údržby pro údržbáře (údržba triage).
staffRouter.get("/maintenance/plan", h((_req, res) => buildMaintenancePlan(pid(res))));
staffRouter.post("/maintenance/plan/brief", h(async (req, res) => {
  const lang = z.object({ lang: z.string().optional() }).parse(req.body ?? {}).lang || "cs";
  const plan = await buildMaintenancePlan(pid(res));
  return { brief: await briefMaintenance(plan, lang) };
}));
app.use("/staff", staffRouter);

// ── Centrální error handling ─────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: "validation", issues: err.issues });
  if (err && typeof err === "object" && (err as { code?: string }).code === "P2025") return res.status(404).json({ error: "not_found" });
  const message = err instanceof Error ? err.message : "neznámá chyba";
  return res.status(400).json({ error: "bad_request", message });
});

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  const server = app.listen(port, () => console.log(`🛎️  Hotelový systém API běží na http://localhost:${port}`));
  initWhatsApp(); // připojení k WhatsAppu (session se drží v .wwebjs_auth)
  startIcalScheduler(); // periodická synchronizace iCal feedů (OTA → blokace)
  startPolicyScheduler(); // automatika: no-show + připomínky před příjezdem

  // Graceful shutdown — při zastavení služby (NSSM posílá Ctrl-C → SIGINT/SIGBREAK,
  // resp. SIGTERM) korektně zavřeme headless Chrome, aby se WhatsApp session uložila
  // a profil neuzamkl. Bez toho se po restartu vyžaduje nové naskenování QR.
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`⏹  ${signal} — ukončuji, zavírám WhatsApp/Chrome…`);
    const t = setTimeout(() => { console.error("Shutdown timeout — force exit."); process.exit(0); }, 20000);
    try { server.close(); } catch { /* */ }
    try { stopIcalScheduler(); } catch { /* */ }
    try { stopPolicyScheduler(); } catch { /* */ }
    try { await destroyWhatsApp(); } catch { /* */ }
    clearTimeout(t);
    console.log("✅ Ukončeno čistě.");
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(sig, () => { void gracefulShutdown(sig); });
  }
}
