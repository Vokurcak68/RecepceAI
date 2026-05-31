// Admin API klient (multi-tenant). Token uživatele + zvolená provozovna.
export function setToken(t: string) { localStorage.setItem("adminToken", t); }
function token() { return localStorage.getItem("adminToken") ?? ""; }

export function setProperty(id: string) { localStorage.setItem("propertyId", id); }
export function getProperty() { return localStorage.getItem("propertyId") ?? ""; }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json", "x-admin-token": token(), "x-property-id": getProperty() },
    ...init,
  });
  if (!r.ok) {
    if (r.status === 401 && path !== "/auth/login") { localStorage.removeItem("adminToken"); location.reload(); }
    let msg = `Chyba ${r.status}`;
    try { const b = await r.json(); msg = b.message || b.error || msg; } catch { /* */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export type Money = string;
export type PropertyType = "hotel" | "penzion" | "ubytovna";
export type Property = {
  id: string; identifier: string; name: string; type: PropertyType;
  street: string | null; city: string | null; phone: string | null; email: string | null; active: boolean; infoText: string | null;
  inventoryUnit: "room" | "bed"; cityTaxEnabled: boolean; cityTaxPerPersonNight: Money;
  allowLongTerm: boolean; selfCheckin: boolean; breakfastIncluded: boolean;
  _count?: { rooms: number; beds: number; reservations: number };
};
export type UserRole = "super_admin" | "manager" | "housekeeping" | "maintenance";
export type User = { id: string; email: string; name: string; role: UserRole; properties?: { property: Property }[] };
export type Guest = { firstName: string; lastName: string; email: string | null; phone: string | null };
export type RoomType = { id: string; name: string; description: string | null; capacityAdults: number; capacityChildren: number; basePrice: Money; weeklyPrice: Money | null; monthlyPrice: Money | null; amenities: string[]; _count?: { rooms: number } };
export type Bed = { id: string; label: string; status: string; room?: { number: string; roomType?: RoomType } };
export type Room = { id: string; number: string; floor: number; status: string; lockType: string; roomType?: RoomType; beds?: Bed[] };
export type Reservation = {
  id: string; code: string; status: string; checkInDate: string; checkOutDate: string;
  nights: number; adults: number; totalAmount: Money; cityTax: Money; billingCycle?: string;
  primaryGuest?: Guest; roomType?: RoomType; room?: Room | null; bed?: Bed | null;
};
export type RegistrationEntry = { id: string; fullName: string; dateOfBirth: string; nationality: string; documentType: string; documentNumber: string; homeAddress: string; stayFrom: string; stayTo: string };
export type Payment = { id: string; type: string; amount: Money; method: string; status: string; description: string | null; invoiceNumber: string | null; createdAt: string };
export type Folio = { charges: Money; paid: Money; balance: Money };
export type ReservationDetail = Reservation & {
  billingCompany: string | null; billingIco: string | null; billingDic: string | null;
  payments: Payment[]; registrationEntries: RegistrationEntry[]; property?: Property;
};
export type Invoice = {
  number: string; property: Property; reservation: { code: string; checkInDate: string; checkOutDate: string; nights: number };
  guest: Guest; billing: { company: string | null; ico: string | null; dic: string | null };
  lines: { label: string; amount: Money }[]; total: Money; paid: Money; balance: Money;
};
export type Dashboard = {
  date: string;
  counts: { arrivals: number; inHouse: number; departures: number; dirtyRooms: number; activeHolds: number };
  arrivals: Reservation[]; inHouse: Reservation[]; departures: Reservation[]; dirtyRooms: Room[];
};
export type LoginResult = { token: string; user: User; properties: Property[] };

export const api = {
  // auth
  login: (email: string, password: string) => req<LoginResult>(`/auth/login`, { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => req<{ user: User; properties: Property[] }>(`/auth/me`),

  // central (super_admin)
  centralProperties: () => req<Property[]>(`/central/properties`),
  createProperty: (b: unknown) => req<Property>(`/central/properties`, { method: "POST", body: JSON.stringify(b) }),
  updateProperty: (id: string, b: unknown) => req<Property>(`/central/properties/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  whatsappStatus: () => req<{ state: string; qr: string | null; error?: string }>(`/central/whatsapp/status`),
  users: () => req<User[]>(`/central/users`),
  createUser: (b: unknown) => req<User>(`/central/users`, { method: "POST", body: JSON.stringify(b) }),
  setUserProperties: (id: string, propertyIds: string[]) => req<User>(`/central/users/${id}/properties`, { method: "PATCH", body: JSON.stringify({ propertyIds }) }),
  updateUser: (id: string, b: unknown) => req<User>(`/central/users/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteUser: (id: string) => req(`/central/users/${id}`, { method: "DELETE" }),

  // property-scoped admin
  dashboard: (date?: string) => req<Dashboard>(`/admin/dashboard${date ? `?date=${date}` : ""}`),
  reservations: (q = "", status = "") => req<Reservation[]>(`/admin/reservations?q=${encodeURIComponent(q)}&status=${status}`),
  createReservation: (b: unknown) => req<Reservation>(`/admin/reservations`, { method: "POST", body: JSON.stringify(b) }),
  cancel: (id: string) => req(`/admin/reservations/${id}/cancel`, { method: "POST" }),
  reservation: (id: string) => req<ReservationDetail>(`/admin/reservations/${id}`),
  resFolio: (id: string) => req<Folio>(`/admin/reservations/${id}/folio`),
  checkin: (id: string) => req(`/admin/reservations/${id}/checkin`, { method: "POST" }),
  checkout: (id: string) => req(`/admin/reservations/${id}/checkout`, { method: "POST" }),
  addPayment: (id: string, b: unknown) => req(`/admin/reservations/${id}/payments`, { method: "POST", body: JSON.stringify(b) }),
  invoice: (id: string) => req<Invoice>(`/admin/reservations/${id}/invoice`),

  rooms: () => req<Room[]>(`/admin/rooms`),
  createRoom: (b: unknown) => req<Room>(`/admin/rooms`, { method: "POST", body: JSON.stringify(b) }),
  updateRoom: (id: string, b: unknown) => req<Room>(`/admin/rooms/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  cleanRoom: (id: string) => req(`/admin/rooms/${id}/clean`, { method: "POST" }),
  deleteRoom: (id: string) => req(`/admin/rooms/${id}`, { method: "DELETE" }),

  beds: () => req<Bed[]>(`/admin/beds`),
  createBed: (b: unknown) => req<Bed>(`/admin/beds`, { method: "POST", body: JSON.stringify(b) }),
  deleteBed: (id: string) => req(`/admin/beds/${id}`, { method: "DELETE" }),

  roomTypes: () => req<RoomType[]>(`/admin/room-types`),
  createRoomType: (b: unknown) => req<RoomType>(`/admin/room-types`, { method: "POST", body: JSON.stringify(b) }),
  updateRoomType: (id: string, b: unknown) => req<RoomType>(`/admin/room-types/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  setRate: (b: unknown) => req(`/admin/rate-plans`, { method: "POST", body: JSON.stringify(b) }),

  registrations: (from: string, to: string) => req<RegistrationEntry[]>(`/admin/registrations?from=${from}&to=${to}`),

  // servisní požadavky
  adminRequests: (q = "") => req<ServiceRequest[]>(`/admin/requests${q}`),
  staffRequests: (status = "") => req<ServiceRequest[]>(`/staff/requests${status ? `?status=${status}` : ""}`),
  staffCreateRequest: (b: unknown) => req<ServiceRequest>(`/staff/requests`, { method: "POST", body: JSON.stringify(b) }),
  staffSetStatus: (id: string, b: unknown) => req(`/staff/requests/${id}/status`, { method: "POST", body: JSON.stringify(b) }),

  // kontrolní agent (fáze 4) — compliance / billing / inventář
  checks: () => req<ChecksResult>(`/admin/checks`),

  // orchestrátor — ranní briefing
  briefing: () => req<NightAudit>(`/admin/briefing`),
  briefingBrief: (lang = "cs") => req<{ brief: string }>(`/admin/briefing/brief`, { method: "POST", body: JSON.stringify({ lang }) }),

  // revenue / pricing agent
  pricingSuggestions: (roomTypeId: string, horizon = 14) => req<PricingSuggestion>(`/admin/pricing/suggestions?roomTypeId=${roomTypeId}&horizon=${horizon}`),
  pricingApply: (roomTypeId: string, items: { date: string; price: number }[]) => req<{ applied: number }>(`/admin/pricing/apply`, { method: "POST", body: JSON.stringify({ roomTypeId, items }) }),

  // housekeeping dispečer (prioritizovaný plán úklidu)
  housekeepingPlan: () => req<HousekeepingPlan>(`/admin/housekeeping/plan`),
  housekeepingBrief: (lang = "cs") => req<{ brief: string }>(`/admin/housekeeping/brief`, { method: "POST", body: JSON.stringify({ lang }) }),
  staffPlan: () => req<HousekeepingPlan>(`/staff/plan`),
  staffBrief: (lang = "cs") => req<{ brief: string }>(`/staff/plan/brief`, { method: "POST", body: JSON.stringify({ lang }) }),

  // vybavení — provozovna
  equipCategories: () => req<EquipCategory[]>(`/admin/equipment-categories`),
  equipment: () => req<Equipment[]>(`/admin/equipment`),
  createEquipment: (b: unknown) => req<Equipment>(`/admin/equipment`, { method: "POST", body: JSON.stringify(b) }),
  updateEquipment: (id: string, b: unknown) => req<Equipment>(`/admin/equipment/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  moveEquipment: (id: string, b: unknown) => req<Equipment>(`/admin/equipment/${id}/move`, { method: "POST", body: JSON.stringify(b) }),
  deleteEquipment: (id: string) => req(`/admin/equipment/${id}`, { method: "DELETE" }),
  equipMoves: (id: string) => req<EquipMove[]>(`/admin/equipment/${id}/moves`),

  // vybavení — centrála
  centralEquipCategories: () => req<EquipCategory[]>(`/central/equipment-categories`),
  createCategory: (name: string) => req<EquipCategory>(`/central/equipment-categories`, { method: "POST", body: JSON.stringify({ name }) }),
  deleteCategory: (id: string) => req(`/central/equipment-categories/${id}`, { method: "DELETE" }),
  centralEquipment: (q = "") => req<Equipment[]>(`/central/equipment${q}`),
  centralCreateEquipment: (b: unknown) => req<Equipment>(`/central/equipment`, { method: "POST", body: JSON.stringify(b) }),
  centralUpdateEquipment: (id: string, b: unknown) => req<Equipment>(`/central/equipment/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  centralMoveEquipment: (id: string, b: unknown) => req<Equipment>(`/central/equipment/${id}/move`, { method: "POST", body: JSON.stringify(b) }),
  centralDeleteEquipment: (id: string) => req(`/central/equipment/${id}`, { method: "DELETE" }),
  centralEquipMoves: (id: string) => req<EquipMove[]>(`/central/equipment/${id}/moves`),
};

export type EquipCategory = { id: string; name: string };
export type Equipment = {
  id: string; name: string; code: string | null; serialNumber: string | null;
  condition: "ok" | "damaged" | "retired"; note: string | null;
  categoryId: string | null; category?: EquipCategory | null;
  acquiredAt: string | null; manufacturedAt: string | null; retiredAt: string | null; retiredReason: string | null;
  propertyId: string | null; roomId: string | null;
  property?: { name: string } | null; room?: { number: string; roomType?: { name: string } } | null;
};
export type EquipMove = { id: string; fromLabel: string; toLabel: string; note: string | null; createdAt: string };

export const CONDITION_LABEL: Record<string, string> = { ok: "OK", damaged: "poškozeno", retired: "vyřazeno" };

export type ServiceRequest = {
  id: string; type: string; domain: string; status: string; description: string | null; fromGuest: boolean;
  note: string | null; resolvedAt: string | null; createdAt: string;
  reservation?: { primaryGuest?: { firstName: string; lastName: string } } | null;
  room?: { number: string } | null; resolvedBy?: { id: string; name: string } | null;
};
export const SERVICE_LABEL: Record<string, string> = { cleaning: "Úklid", maintenance: "Údržba", laundry: "Praní", ironing: "Žehlení", minibar: "Minibar", other: "Jiné" };
export const SERVICE_ICON: Record<string, string> = { cleaning: "🧹", maintenance: "🔧", laundry: "🧺", ironing: "👔", minibar: "🥤", other: "📌" };

export type Priority = "urgent" | "high" | "normal";
export type PlanItem = {
  id: string; type: string; status: string; priority: Priority; reason: string;
  roomNumber: string | null; bedLabel: string | null; roomTypeName: string | null;
  guestName: string | null; fromGuest: boolean; description: string | null; ageMinutes: number; createdAt: string;
};
export type HousekeepingPlan = {
  generatedAt: string;
  counts: { total: number; urgent: number; high: number; normal: number };
  items: PlanItem[];
};
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgentní", high: "Přednostní", normal: "Běžné" };

export type OccDay = { date: string; total: number; occupied: number; free: number; pct: number };
export type NightAudit = {
  propertyId: string; propertyName: string; date: string;
  occupancy: { today: OccDay; tomorrow: OccDay };
  arrivals: { total: number; unassigned: number };
  departures: number;
  housekeeping: { urgent: number; total: number };
  unsettled: { count: number; totalBalance: string; items: { code: string; guest: string; balance: string }[] };
  registrationMissing: { count: number; codes: string[] };
  holds: { active: number; expiring: number };
  registrationsToPurge: number;
  flags: string[];
};

export type DaySuggestion = {
  date: string; weekday: string; weekend: boolean; leadDays: number;
  totalUnits: number; bookedUnits: number; freeUnits: number; occupancyPct: number;
  basePrice: string; currentPrice: string; suggestedPrice: string;
  factor: number; reason: string; changed: boolean; direction: "up" | "down" | "same";
};
export type PricingSuggestion = {
  roomTypeId: string; roomTypeName: string; unit: "room" | "bed"; basePrice: string;
  horizonDays: number; days: DaySuggestion[]; counts: { changed: number; up: number; down: number };
};

export type Severity = "high" | "medium" | "low";
export type Finding = { severity: Severity; category: "compliance" | "billing" | "inventory"; title: string; detail: string; ref: string | null };
export type ChecksResult = {
  generatedAt: string;
  counts: { high: number; medium: number; low: number; total: number };
  byCategory: { compliance: Finding[]; billing: Finding[]; inventory: Finding[] };
};
export const SEVERITY_LABEL: Record<Severity, string> = { high: "Vysoká", medium: "Střední", low: "Nízká" };
export const CHECK_CAT_LABEL: Record<string, string> = { compliance: "🛂 Compliance / ubyhost", billing: "💳 Pohledávky", inventory: "🧰 Inventář" };

export function money(m: Money | number | null): string {
  if (m == null) return "—";
  const n = typeof m === "number" ? m : parseFloat(m);
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(n) + " Kč";
}
export const d = (iso: string) => iso.slice(0, 10);
export const TYPE_LABEL: Record<PropertyType, string> = { hotel: "Hotel", penzion: "Penzion", ubytovna: "Ubytovna" };
