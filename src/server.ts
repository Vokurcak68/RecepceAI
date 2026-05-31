// HTTP vrstva multi-tenant systému.
//  - /auth/*      přihlášení uživatele (role)
//  - /central/*   centrální správa (super_admin): provozovny, uživatelé
//  - /admin/*     provozovnu-scopovaný admin (auth + přístup k provozovně)
//  - veřejné      kiosek: availability / rezervace (scopováno přes x-property-id)
import express, { type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { DocumentType, PaymentType, PaymentMethod, RoomStatus, LockType, PropertyType, UserRole, InventoryUnit, EquipmentCondition, ServiceType, ServiceStatus, ServiceDomain } from "@prisma/client";
import { prisma } from "./prisma";
import {
  getAvailability, createWalkInHold, confirmReservation, findReservationByCode, findReservationsByLastName,
  checkIn, addRegistrationEntry, addPayment, computeFolio, checkOut, releaseExpiredHolds, purgeExpiredRegistrations,
} from "./index";
import { serialize } from "./serialize";
import * as admin from "./admin";
import * as central from "./central";
import * as equip from "./equipment";
import * as service from "./service";
import { buildHousekeepingPlan, briefHousekeeping } from "./dispatch";
import { runNightAudit, briefManager } from "./orchestrator";
import { initWhatsApp, whatsappStatus, sendWhatsApp } from "./whatsapp";
import { chat as aiChat, type ChatMsg } from "./ai";
import { createToken, readToken, verifyPassword } from "./auth";

export const app = express();
app.use(express.json());

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
  adults: z.number().int().positive(), children: z.number().int().nonnegative().optional(),
  guest: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), language: z.string().optional() }),
});
app.post("/reservations/walkin", h(async (req) => {
  const propertyId = await resolvePropertyId(req);
  const b = walkInBody.parse(req.body);
  return createWalkInHold({ propertyId, roomTypeId: b.roomTypeId, from: new Date(b.from), to: new Date(b.to), adults: b.adults, children: b.children, guest: b.guest });
}));

// ── Veřejné (kiosek): operace nad rezervací (id-based) ───────
app.post("/reservations/:id/confirm", h((req) => confirmReservation(req.params.id)));
app.post("/reservations/:id/checkin", h((req) => checkIn(req.params.id)));
app.get("/reservations/:id/folio", h((req) => computeFolio(req.params.id)));
app.post("/reservations/:id/checkout", h((req) => checkOut(req.params.id)));

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

// ── Přivolání člověka: pošli personálu WhatsApp s odkazem na hovor (kiosek) ──
app.post("/call/notify", h(async (req) => {
  const b = z.object({ joinUrl: z.string().url(), propertyName: z.string().optional() }).parse(req.body);
  const staff = process.env.STAFF_WHATSAPP || "420724239572";
  await sendWhatsApp(staff, `🛎️ Host volá z recepce${b.propertyName ? " " + b.propertyName : ""}. Připojte se k videohovoru: ${b.joinUrl}`);
  return { sent: true };
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
    name: z.string().optional(), identifier: z.string().optional(), street: z.string().optional(), city: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), active: z.boolean().optional(), infoText: z.string().optional(),
    inventoryUnit: z.nativeEnum(InventoryUnit).optional(), cityTaxEnabled: z.boolean().optional(), cityTaxPerPersonNight: z.number().optional(),
    allowLongTerm: z.boolean().optional(), selfCheckin: z.boolean().optional(), breakfastIncluded: z.boolean().optional(),
  }).parse(req.body);
  return central.updateProperty(req.params.id, b);
}));

centralRouter.get("/whatsapp/status", h(async () => whatsappStatus()));

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

adminRouter.get("/reservations", h((req, res) => admin.listReservations(pid(res), { status: req.query.status as string | undefined, q: req.query.q as string | undefined })));
adminRouter.post("/reservations", h((req, res) => {
  const b = z.object({ roomTypeId: z.string().uuid(), from: dateStr, to: dateStr, adults: z.number().int().positive(), children: z.number().int().nonnegative().optional(), guest: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional() }), billingCompany: z.string().optional(), billingIco: z.string().optional(), billingDic: z.string().optional() }).parse(req.body);
  return admin.createReservation({ propertyId: pid(res), ...b, from: new Date(b.from), to: new Date(b.to) });
}));
adminRouter.get("/reservations/:id", h((req, res) => admin.getReservation(pid(res), req.params.id)));
adminRouter.get("/reservations/:id/folio", h((req, res) => admin.adminFolio(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/checkin", h((req, res) => admin.adminCheckIn(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/checkout", h((req, res) => admin.adminCheckOut(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/payments", h((req, res) => {
  const b = z.object({ type: z.nativeEnum(PaymentType), amount: z.number(), method: z.nativeEnum(PaymentMethod).optional(), description: z.string().optional(), invoiceNumber: z.string().optional() }).parse(req.body);
  return admin.adminAddPayment(pid(res), req.params.id, b);
}));
adminRouter.get("/reservations/:id/invoice", h((req, res) => admin.buildInvoice(pid(res), req.params.id)));
adminRouter.post("/reservations/:id/cancel", h((req, res) => admin.cancelReservation(pid(res), req.params.id)));

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

adminRouter.get("/registrations", h((req, res) => { const q = z.object({ from: dateStr, to: dateStr }).parse(req.query); return admin.listRegistrations(pid(res), new Date(q.from), new Date(q.to)); }));

// Přehled servisních požadavků (manažer/super_admin).
adminRouter.get("/requests", h((req, res) => {
  const q = z.object({ status: z.nativeEnum(ServiceStatus).optional(), domain: z.nativeEnum(ServiceDomain).optional() }).parse(req.query);
  return service.listRequests({ propertyId: pid(res), ...(q.status ? { status: q.status } : {}), ...(q.domain ? { domain: q.domain } : {}) });
}));

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
adminRouter.get("/equipment", h((_req, res) => equip.listEquipment({ propertyId: pid(res) })));
adminRouter.post("/equipment", h(async (req, res) => {
  const b = z.object({ ...equipCreate.shape, roomId: z.string().uuid().nullable().optional(), quantity: z.number().int().positive().max(500).optional() }).parse(req.body);
  if (b.roomId) { const room = await prisma.room.findUnique({ where: { id: b.roomId } }); if (!room || room.propertyId !== pid(res)) throw new Error("Pokoj nepatří do této provozovny."); }
  const input = { ...b, acquiredAt: toD(b.acquiredAt) ?? undefined, manufacturedAt: toD(b.manufacturedAt) ?? undefined, propertyId: pid(res), roomId: b.roomId ?? null };
  return equip.createEquipmentBatch(input, b.quantity ?? 1);
}));
adminRouter.patch("/equipment/:id", h(async (req, res) => { await equip.assertInProperty(pid(res), req.params.id); return equip.updateEquipment(req.params.id, patchToInput(equipPatch.parse(req.body))); }));
adminRouter.post("/equipment/bulk-move", h((req, res) => { const b = z.object({ ids: z.array(z.string().uuid()), roomId: z.string().uuid().nullable(), note: z.string().optional() }).parse(req.body); return equip.bulkMove(b.ids, { propertyId: pid(res), roomId: b.roomId }, b.note, pid(res)); }));
adminRouter.post("/equipment/bulk-retire", h((req, res) => { const b = z.object({ ids: z.array(z.string().uuid()), retiredReason: z.string().optional() }).parse(req.body); return equip.bulkRetire(b.ids, b.retiredReason ?? "—", pid(res)); }));
adminRouter.post("/equipment/bulk-delete", h((req, res) => { const b = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body); return equip.bulkDelete(b.ids, pid(res)); }));
adminRouter.post("/equipment/:id/move", h(async (req, res) => { await equip.assertInProperty(pid(res), req.params.id); const b = z.object({ roomId: z.string().uuid().nullable(), note: z.string().optional() }).parse(req.body); return equip.moveEquipment(req.params.id, { propertyId: pid(res), roomId: b.roomId }, b.note); }));
adminRouter.delete("/equipment/:id", h(async (req, res) => { await equip.assertInProperty(pid(res), req.params.id); await equip.deleteEquipment(req.params.id); return { ok: true }; }));
adminRouter.get("/equipment/:id/moves", h(async (req, res) => { await equip.assertInProperty(pid(res), req.params.id); return equip.listMoves(req.params.id); }));

app.use("/admin", adminRouter);

// ── Host (portál podle rezervačního kódu, bez přihlášení) ────
app.get("/guest/:code", h(async (req) => {
  const r = await service.loadReservationByCode(req.params.code);
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const requests = await service.listRequestsForReservation(r.id);
  return {
    reservation: {
      code: r.code, propertyName: r.property.name,
      guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
      unit: r.room ? `pokoj ${r.room.number}` : r.bed ? `lůžko ${r.bed.label}` : null,
      checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, status: r.status,
    },
    requests,
  };
}));
app.post("/guest/:code/requests", h(async (req) => {
  const r = await service.loadReservationByCode(req.params.code);
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const b = z.object({ type: z.nativeEnum(ServiceType), description: z.string().optional() }).parse(req.body);
  return service.createRequest({ propertyId: r.propertyId, reservationId: r.id, roomId: r.roomId, bedId: r.bedId, type: b.type, description: b.description, fromGuest: true });
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

// Prioritizovaný plán úklidu pro uklízečku (housekeeping dispečer).
staffRouter.get("/plan", h((_req, res) => buildHousekeepingPlan(pid(res))));
staffRouter.post("/plan/brief", h(async (req, res) => {
  const lang = z.object({ lang: z.string().optional() }).parse(req.body ?? {}).lang || "cs";
  const plan = await buildHousekeepingPlan(pid(res));
  return { brief: await briefHousekeeping(plan, lang) };
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
  app.listen(port, () => console.log(`🛎️  Hotelový systém API běží na http://localhost:${port}`));
  initWhatsApp(); // připojení k WhatsAppu (session se drží v .wwebjs_auth)
}
