// Admin API klient (multi-tenant). Token uživatele + zvolená provozovna.
export function setToken(t: string) { localStorage.setItem("adminToken", t); }
function token() { return localStorage.getItem("adminToken") ?? ""; }

export function setProperty(id: string) { localStorage.setItem("propertyId", id); }
export function getProperty() { return localStorage.getItem("propertyId") ?? ""; }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json", "x-admin-token": token(), "x-property-id": getProperty() },
    cache: "no-store", // API je dynamické, nikdy necachovat (proxy/prohlížeč)
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
  street: string | null; city: string | null; country: string | null; phone: string | null; email: string | null; ico: string | null; dic: string | null; iban: string | null; vatPayer: boolean; active: boolean; infoText: string | null;
  inventoryUnit: "room" | "bed"; cityTaxEnabled: boolean; cityTaxPerPersonNight: Money; cityTaxFreeAge: number;
  allowLongTerm: boolean; selfCheckin: boolean; breakfastIncluded: boolean; onlineCheckinHours: number;
  freeCancelDays: number; cancelFeePct: number; depositPct: number; reminderHours: number; noShowHours: number;
  _count?: { rooms: number; beds: number; reservations: number };
};
export type UserRole = "super_admin" | "manager" | "housekeeping" | "maintenance";
export type User = { id: string; email: string; name: string; role: UserRole; properties?: { property: Property }[] };
export type Guest = { firstName: string; lastName: string; email: string | null; phone: string | null; vip?: boolean; preferences?: string | null };
export type GuestReview = { nps: number; comment: string | null; createdAt: string };
export type GuestListItem = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; vip: boolean; preferences: string | null; stays: number; lastStay: string | null };
export type GuestStay = { id: string; code: string; propertyName: string; roomType: string | null; checkInDate: string; checkOutDate: string; status: string; totalAmount: Money; review: GuestReview | null };
export type GuestProfile = { guest: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; language: string | null; address: string | null; documentType: string | null; documentNumber: string | null; vip: boolean; preferences: string | null; marketingConsent: boolean; createdAt: string }; stays: GuestStay[] };
export type GuestPatch = { firstName?: string; lastName?: string; email?: string; phone?: string; language?: string; address?: string; documentType?: string; documentNumber?: string; vip?: boolean; preferences?: string; marketingConsent?: boolean };
export type ReviewItem = { id: string; nps: number; comment: string | null; createdAt: string; code: string; checkOutDate: string; guestName: string };
export type GroupListItem = { id: string; code: string; name: string; note: string | null; createdAt: string; rooms: number; total: number; from: string | null; to: string | null };
export type GroupMember = { id: string; code: string; status: string; guestName: string; unit: string; roomType: string | null; checkInDate: string; checkOutDate: string; totalAmount: Money; balance: Money };
export type GroupDetail = { id: string; code: string; name: string; note: string | null; createdAt: string; organizer: { firstName: string; lastName: string; email: string | null } | null; members: GroupMember[]; totals: { charges: Money; paid: Money; balance: Money }; emails: EmailLog[] };
export type GroupRoomInput = { roomTypeId: string; adults: number; children?: number; childAges?: number[]; firstName?: string; lastName?: string };
export type BulkResult = { code: string; ok: boolean; error?: string };
export type ReviewsData = { summary: { count: number; avg: number | null; nps: number | null; promoters: number; passives: number; detractors: number }; reviews: ReviewItem[] };
export type RoomType = { id: string; name: string; description: string | null; capacityAdults: number; capacityChildren: number; basePrice: Money; weeklyPrice: Money | null; monthlyPrice: Money | null; amenities: string[]; _count?: { rooms: number } };
export type Bed = { id: string; label: string; status: string; room?: { number: string; roomType?: RoomType } };
export type Room = { id: string; number: string; floor: number; status: string; lockType: string; roomType?: RoomType; beds?: Bed[] };
export type Reservation = {
  id: string; code: string; status: string; checkInDate: string; checkOutDate: string;
  nights: number; adults: number; children?: number; childAges?: number[]; totalAmount: Money; cityTax: Money; billingCycle?: string;
  primaryGuest?: Guest; roomType?: RoomType; room?: Room | null; bed?: Bed | null;
};
export type RegistrationEntry = { id: string; fullName: string; dateOfBirth: string; nationality: string; documentType: string; documentNumber: string; homeAddress: string; stayFrom: string; stayTo: string };
export type Payment = { id: string; type: string; amount: Money; method: string; status: string; description: string | null; invoiceNumber: string | null; createdAt: string };
export type Charge = { id: string; category: string; description: string | null; quantity: Money; unitPrice: Money; amount: Money; vatRate: Money; createdAt: string };
export type OccupancyRow = { id: string; code: string; unit: string; roomType: string | null; guestName: string; guests: number; checkInDate: string; checkOutDate: string; charges: number; balance: Money; note: string | null };
export type ResGuest = { id: string; isPrimary: boolean; guest: { firstName: string; lastName: string; email: string | null; phone: string | null; address: string | null; documentType: string | null; documentNumber: string | null } };
export type ServiceItem = { id: string; name: string; category: string; price: Money; vatRate: Money; active: boolean };
export const DOCTYPE_LABEL: Record<string, string> = { id_card: "OP", passport: "Pas" };
export type CalType = { roomTypeId: string; name: string; total: number; cells: { booked: number; free: number }[] };
export type OccupancyCalendar = { from: string; days: number; unit: "room" | "bed"; dates: string[]; types: CalType[] };
export type TapeUnit = { id: string; label: string; roomTypeId: string };
export type TapeRes = { id: string; code: string; guestName: string; status: string; roomTypeId: string; unitId: string | null; checkInDate: string; checkOutDate: string };
export type TapeChart = { from: string; days: number; unit: "room" | "bed"; dates: string[]; types: { roomTypeId: string; name: string }[]; units: TapeUnit[]; reservations: TapeRes[] };
export type UbyEntry = { jmeno: string; datumNarozeni: string; narodnost: string; druhDokladu: string; cisloDokladu: string; vizum: string; adresa: string; ucelPobytu: string; pobytOd: string; pobytDo: string };
export type UbyportData = { ubytovatel: { nazev: string; ulice: string; mesto: string; ico: string; dic: string }; pocet: number; entries: UbyEntry[] };
export type IcalImportFeed = { id: string; url: string; label: string | null; roomTypeId: string; roomType?: { name: string }; lastSyncedAt: string | null; lastError: string | null };
export type EmailLog = { id: string; type: string; recipient: string; subject: string; status: string; error: string | null; createdAt: string };
export const EMAIL_TYPE_LABEL: Record<string, string> = { created: "Potvrzení rezervace", checkin: "Uvítání (check-in)", checkout: "Poděkování (check-out)", cancellation: "Zrušení rezervace", group_summary: "Souhrn skupiny" };

// Počeštění všech stavů (rezervace, požadavky, doklady, platby, pokoje).
export const STATUS_LABEL: Record<string, string> = {
  // rezervace
  pending: "Čeká", hold: "Blokace", confirmed: "Potvrzeno", checked_in: "Ubytován", checked_out: "Odhlášen", cancelled: "Zrušeno", no_show: "Nedorazil",
  // servisní požadavky
  open: "Otevřeno", in_progress: "Probíhá", done: "Hotovo",
  // doklady
  draft: "Koncept", issued: "Vystaveno", paid: "Zaplaceno",
  // platby
  succeeded: "Úspěšná", failed: "Neúspěšná",
  // pokoje / lůžka
  clean: "Uklizeno", dirty: "K úklidu", out_of_service: "Mimo provoz",
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
export const CHARGE_LABEL: Record<string, string> = { minibar: "Minibar", wellness: "Wellness", service: "Služba", restaurant: "Restaurace", parking: "Parkování", other: "Ostatní" };

export type PaymentRow = Payment & { reservation?: { id: string; code: string; primaryGuest?: { firstName: string; lastName: string } } };
export type PaymentsList = { payments: PaymentRow[]; totals: { total: Money; count: number; byMethod: Record<string, Money> } };
export type ReceiptLine = { date: string; type: string; method: string; description: string | null; amount: Money };
export type Receipt = {
  kind: "payment" | "stay";
  number: string; issuedAt: string;
  property: Property; guest: Guest;
  reservation: { code: string; checkInDate: string; checkOutDate: string; roomType: string | null; nights: number };
  billing: { company: string | null; ico: string | null; dic: string | null };
  lines: ReceiptLine[]; totalPaid: Money; charges?: Money; balance?: Money;
};
export const PAY_TYPE_LABEL: Record<string, string> = { deposit: "Záloha", balance: "Doplatek", city_tax: "Pobytový poplatek", extra: "Položka", deposit_hold: "Blokace", refund: "Vratka" };
export const PAY_METHOD_LABEL: Record<string, string> = { card_terminal: "Karta", prepaid: "Předplaceno", cash: "Hotově", invoice: "Fakturou" };

export type DocLine = { id: string; label: string; qty: Money; unitPrice: Money; vatRate: Money; lineTotal: Money };
export type Doc = {
  id: string; type: string; number: string; status: string; issuedAt: string; taxDate: string | null; dueDate: string | null;
  supplierName: string; supplierAddress: string | null; supplierIco: string | null; supplierDic: string | null; vatPayer: boolean;
  customerName: string; customerAddress: string | null; customerIco: string | null; customerDic: string | null;
  subtotal: Money; vatTotal: Money; total: Money; paidTotal: Money; note: string | null;
  lines?: DocLine[]; reservations?: { reservation: { code: string } }[]; qrPayment?: string | null;
};
export const DOC_TYPE_LABEL: Record<string, string> = { proforma: "Zálohová faktura", advance_tax: "Daňový doklad k záloze", invoice: "Faktura", receipt: "Účtenka", credit_note: "Opravný doklad" };
export const DOC_STATUS_LABEL: Record<string, string> = { draft: "Koncept", issued: "Vystaveno", paid: "Zaplaceno", cancelled: "Storno" };

export type CashMovement = { id: string; kind: "income" | "expense"; amount: Money; note: string | null; paymentId: string | null; createdAt: string };
export type CashSummary = { openingFloat: Money; income: Money; expense: Money; expected: Money; counted: Money | null; difference: Money | null; card: Money };
export type CashSession = {
  id: string; openedAt: string; openedByName: string; openingFloat: Money;
  closedAt: string | null; closedByName: string | null; countedCash: Money | null; note: string | null;
  movements: CashMovement[]; summary: CashSummary;
};
export type CashState = { register: { id: string; name: string }; session: CashSession | null };
export type Folio = { charges: Money; paid: Money; balance: Money };
export type ReservationDetail = Reservation & {
  billingCompany: string | null; billingIco: string | null; billingDic: string | null; note: string | null;
  onlineCheckinAt: string | null;
  payments: Payment[]; registrationEntries: RegistrationEntry[]; property?: Property;
  previousStays?: number; review?: GuestReview | null; group?: { id: string; code: string; name: string } | null;
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

export type PendingCall = {
  id: string; propertyId: string | null; propertyName: string; joinUrl: string;
  createdAt: number; claimedBy: string | null; claimedByName: string | null;
};

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
  saveReservationNote: (id: string, note: string) => req(`/admin/reservations/${id}`, { method: "PATCH", body: JSON.stringify({ note }) }),
  resFolio: (id: string) => req<Folio>(`/admin/reservations/${id}/folio`),
  checkin: (id: string) => req(`/admin/reservations/${id}/checkin`, { method: "POST" }),
  checkout: (id: string) => req<{ document: Doc | null }>(`/admin/reservations/${id}/checkout`, { method: "POST" }),
  addPayment: (id: string, b: unknown) => req(`/admin/reservations/${id}/payments`, { method: "POST", body: JSON.stringify(b) }),
  invoice: (id: string) => req<Invoice>(`/admin/reservations/${id}/invoice`),

  rooms: () => req<Room[]>(`/admin/rooms`),
  roomBoard: () => req<RoomBoardItem[]>(`/admin/room-board`),
  roomDetail: (id: string) => req<RoomDetail>(`/admin/rooms/${id}/detail`),
  roomCandidates: (reservationId: string) => req<RoomCandidate[]>(`/admin/reservations/${reservationId}/room-candidates`),
  roomUnassigned: (id: string) => req<UnassignedRes[]>(`/admin/rooms/${id}/unassigned`),
  createRoomRequest: (id: string, b: { type: string; description?: string }) => req(`/admin/rooms/${id}/request`, { method: "POST", body: JSON.stringify(b) }),
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

  // úhrady + doklady o zaplacení
  payments: (from = "", to = "") => req<PaymentsList>(`/admin/payments?from=${from}&to=${to}`),
  paymentReceipt: (id: string) => req<Receipt>(`/admin/payments/${id}/receipt`),
  stayReceipt: (id: string) => req<Receipt>(`/admin/reservations/${id}/receipt`),

  // pokladna
  cashState: () => req<CashState>(`/admin/cashregister`),
  cashSessions: () => req<CashSession[]>(`/admin/cashregister/sessions`),
  cashOpen: (openingFloat: number) => req<unknown>(`/admin/cashregister/open`, { method: "POST", body: JSON.stringify({ openingFloat }) }),
  cashMovement: (kind: "income" | "expense", amount: number, note?: string) => req<unknown>(`/admin/cashregister/movement`, { method: "POST", body: JSON.stringify({ kind, amount, note }) }),
  cashClose: (countedCash: number, note?: string) => req<unknown>(`/admin/cashregister/close`, { method: "POST", body: JSON.stringify({ countedCash, note }) }),

  // doklady (faktury, zálohové, účtenky)
  documents: (q = "") => req<Doc[]>(`/admin/documents${q}`),
  document: (id: string) => req<Doc>(`/admin/documents/${id}`),
  issueDocument: (resId: string, type: "invoice" | "receipt") => req<Doc>(`/admin/reservations/${resId}/documents`, { method: "POST", body: JSON.stringify({ type }) }),
  issueProforma: (resId: string, amount: number, dueInDays?: number) => req<Doc>(`/admin/reservations/${resId}/proforma`, { method: "POST", body: JSON.stringify({ amount, dueInDays }) }),
  cancelDocument: (id: string) => req(`/admin/documents/${id}/cancel`, { method: "POST" }),
  payDocument: (id: string, method: "cash" | "card_terminal") => req<Doc>(`/admin/documents/${id}/pay`, { method: "POST", body: JSON.stringify({ method }) }),
  creditNote: (id: string, reason?: string) => req<Doc>(`/admin/documents/${id}/credit-note`, { method: "POST", body: JSON.stringify({ reason }) }),
  advanceTaxDoc: (id: string) => req<Doc>(`/admin/documents/${id}/advance-tax`, { method: "POST" }),
  bulkInvoice: (reservationIds: string[]) => req<Doc>(`/admin/documents/bulk-invoice`, { method: "POST", body: JSON.stringify({ reservationIds }) }),
  periodInvoice: (resId: string, from: string, to: string) => req<Doc>(`/admin/reservations/${resId}/period-invoice`, { method: "POST", body: JSON.stringify({ from, to }) }),
  documentsCsv: async (q = "") => { const r = await fetch(`/api/admin/documents/export.csv${q}`, { headers: { "x-admin-token": token(), "x-property-id": getProperty() } }); if (!r.ok) throw new Error("Export selhal"); return r.text(); },

  // obsazení + hosté na pokoji
  occupancy: () => req<OccupancyRow[]>(`/admin/occupancy`),
  resGuests: (id: string) => req<ResGuest[]>(`/admin/reservations/${id}/guests`),
  calendar: (from?: string, days = 21) => req<OccupancyCalendar>(`/admin/calendar?days=${days}${from ? `&from=${from}` : ""}`),
  tapechart: (from?: string, days = 14) => req<TapeChart>(`/admin/tapechart?days=${days}${from ? `&from=${from}` : ""}`),
  ubyport: (from: string, to: string, all = false) => req<UbyportData>(`/admin/ubyport?from=${from}&to=${to}${all ? "&all=1" : ""}`),
  icalFeeds: () => req<{ all: string; perType: { name: string; url: string }[] }>(`/admin/ical/feeds`),
  icalImportFeeds: () => req<IcalImportFeed[]>(`/admin/ical/import-feeds`),
  addIcalImportFeed: (b: { roomTypeId: string; url: string; label?: string }) => req(`/admin/ical/import-feeds`, { method: "POST", body: JSON.stringify(b) }),
  deleteIcalImportFeed: (id: string) => req(`/admin/ical/import-feeds/${id}`, { method: "DELETE" }),
  icalSync: () => req<{ id: string; ok: boolean; count?: number; error?: string }[]>(`/admin/ical/sync`, { method: "POST" }),
  setReservationPrimaryGuest: (id: string, guestId: string) => req<ReservationDetail>(`/admin/reservations/${id}/primary-guest`, { method: "PATCH", body: JSON.stringify({ guestId }) }),
  searchGuests: (q: string) => req<GuestListItem[]>(`/admin/guests?q=${encodeURIComponent(q)}`),
  guestProfile: (id: string) => req<GuestProfile>(`/admin/guests/${id}`),
  updateGuest: (id: string, b: GuestPatch) => req(`/admin/guests/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  mergeGuests: (targetId: string, sourceId: string) => req(`/admin/guests/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceId }) }),
  deleteGuest: (id: string) => req(`/admin/guests/${id}`, { method: "DELETE" }),
  reviews: () => req<ReviewsData>(`/admin/reviews`),
  groups: () => req<GroupListItem[]>(`/admin/groups`),
  group: (id: string) => req<GroupDetail>(`/admin/groups/${id}`),
  createGroup: (b: { name: string; note?: string; from: string; to: string; organizer: { firstName: string; lastName: string; email?: string; phone?: string; language?: string }; rooms: GroupRoomInput[] }) => req<GroupDetail>(`/admin/groups`, { method: "POST", body: JSON.stringify(b) }),
  groupCheckin: (id: string) => req<BulkResult[]>(`/admin/groups/${id}/checkin`, { method: "POST" }),
  groupCheckout: (id: string) => req<BulkResult[]>(`/admin/groups/${id}/checkout`, { method: "POST" }),
  groupCancel: (id: string) => req<{ ok: boolean; count: number }>(`/admin/groups/${id}/cancel`, { method: "POST" }),
  groupEmail: (id: string) => req<{ ok: boolean }>(`/admin/groups/${id}/email`, { method: "POST" }),
  assignUnit: (id: string, unitId: string) => req(`/admin/reservations/${id}/assign`, { method: "POST", body: JSON.stringify({ unitId }) }),
  reservationEmails: (id: string) => req<EmailLog[]>(`/admin/reservations/${id}/emails`),
  resendEmail: (id: string, type: string) => req<EmailLog[]>(`/admin/reservations/${id}/emails/resend`, { method: "POST", body: JSON.stringify({ type }) }),
  addResGuest: (id: string, b: unknown) => req<ResGuest>(`/admin/reservations/${id}/guests`, { method: "POST", body: JSON.stringify(b) }),
  updateResGuest: (rgId: string, b: unknown) => req<ResGuest>(`/admin/reservation-guests/${rgId}`, { method: "PATCH", body: JSON.stringify(b) }),
  removeResGuest: (id: string) => req(`/admin/reservation-guests/${id}`, { method: "DELETE" }),

  // ceník služeb (číselník)
  serviceItems: () => req<ServiceItem[]>(`/admin/service-items`),
  createServiceItem: (b: unknown) => req<ServiceItem>(`/admin/service-items`, { method: "POST", body: JSON.stringify(b) }),
  updateServiceItem: (id: string, b: unknown) => req<ServiceItem>(`/admin/service-items/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteServiceItem: (id: string) => req(`/admin/service-items/${id}`, { method: "DELETE" }),

  // účet pokoje — připsané položky (konzumace/služby)
  charges: (id: string) => req<Charge[]>(`/admin/reservations/${id}/charges`),
  addCharge: (id: string, b: unknown) => req<Charge>(`/admin/reservations/${id}/charges`, { method: "POST", body: JSON.stringify(b) }),
  deleteCharge: (id: string) => req(`/admin/charges/${id}`, { method: "DELETE" }),

  // servisní požadavky
  adminRequests: (q = "") => req<ServiceRequest[]>(`/admin/requests${q}`),
  staffRequests: (status = "") => req<ServiceRequest[]>(`/staff/requests${status ? `?status=${status}` : ""}`),
  staffCreateRequest: (b: unknown) => req<ServiceRequest>(`/staff/requests`, { method: "POST", body: JSON.stringify(b) }),
  staffSetStatus: (id: string, b: unknown) => req(`/staff/requests/${id}/status`, { method: "POST", body: JSON.stringify(b) }),
  staffRequestPhotos: (id: string, images: string[]) => req<ServiceRequest>(`/staff/requests/${id}/photos`, { method: "POST", body: JSON.stringify({ images }) }),
  staffRooms: () => req<StaffRoom[]>(`/staff/rooms`),
  staffSetRoomStatus: (id: string, status: string) => req<StaffRoom>(`/staff/rooms/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),

  // přivolání člověka z kiosku — zvoneček pro manažery
  callsPending: () => req<PendingCall[]>(`/calls/pending?_=${Date.now()}`), // cache-bust: proxy jinak servíruje starý stav ~1 min
  claimCall: (id: string) => req<{ ok: boolean; alreadyClaimedBy?: string | null }>(`/calls/${id}/claim`, { method: "POST" }),

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

  // údržba triage (prioritizovaná fronta údržby)
  maintenancePlan: () => req<MaintenancePlan>(`/admin/maintenance/plan`),
  maintenanceBrief: (lang = "cs") => req<{ brief: string }>(`/admin/maintenance/brief`, { method: "POST", body: JSON.stringify({ lang }) }),
  staffMaintPlan: () => req<MaintenancePlan>(`/staff/maintenance/plan`),
  staffMaintBrief: (lang = "cs") => req<{ brief: string }>(`/staff/maintenance/plan/brief`, { method: "POST", body: JSON.stringify({ lang }) }),

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
  note: string | null; resolvedAt: string | null; createdAt: string; imageUrls?: string[];
  reservation?: { primaryGuest?: { firstName: string; lastName: string } } | null;
  room?: { number: string } | null; resolvedBy?: { id: string; name: string } | null;
};
export type StaffRoom = { id: string; number: string; status: string; roomType?: { name: string } | null };
export type RoomBoardItem = { id: string; number: string; floor: number; roomType: string | null; status: string; occupant: { reservationId: string; name: string; checkInDate: string; checkOutDate: string; departsToday: boolean; balance: Money } | null; arrival: { reservationId: string; name: string } | null; openHousekeeping: number; openMaintenance: number };
export type RoomResItem = { id: string; code: string; guestName: string; status: string; checkInDate: string; checkOutDate: string; balance: Money };
export type RoomReqItem = { id: string; type: string; domain: string; status: string; description: string | null; createdAt: string };
export type RoomDetail = { room: { id: string; number: string; floor: number; status: string; lockType: string; notes: string; roomType: { id: string; name: string } }; occupantId: string | null; occupantBalance: string | null; reservations: RoomResItem[]; requests: RoomReqItem[] };
export type RoomCandidate = { id: string; number: string; floor: number; free: boolean; current: boolean };
export type UnassignedRes = { id: string; code: string; guestName: string; checkInDate: string; checkOutDate: string };
export const ROOM_STATUS_LABEL: Record<string, string> = { clean: "Čisto", dirty: "Špinavo", inspected: "Zkontrolováno", out_of_service: "Mimo provoz" };
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

export type MaintItem = {
  id: string; status: string; priority: Priority; category: string; reason: string;
  roomNumber: string | null; roomTypeName: string | null; guestName: string | null;
  fromGuest: boolean; occupied: boolean; damagedEquipment: number;
  description: string | null; ageMinutes: number; createdAt: string;
};
export type MaintenancePlan = {
  generatedAt: string;
  counts: { total: number; urgent: number; high: number; normal: number };
  items: MaintItem[];
};

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
