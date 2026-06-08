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
  operatorName: string | null; operatorAddress: string | null; operatorRegistration: string | null; operatorAccount: string | null; operatorIco: string | null; operatorDic: string | null;
  kioskKeyInfo: string | null; kioskWifi: string | null; energyFeePerNight: Money;
  inventoryUnit: "room" | "bed"; cityTaxEnabled: boolean; cityTaxPerPersonNight: Money; cityTaxFreeAge: number;
  allowLongTerm: boolean; selfCheckin: boolean; breakfastIncluded: boolean; onlineCheckinHours: number; dailyCleaning: boolean; offeredServices: string[];
  freeCancelDays: number; cancelFeePct: number; depositPct: number; reminderHours: number; noShowHours: number;
  _count?: { rooms: number; beds: number; reservations: number };
};
export type UserRole = "super_admin" | "manager" | "housekeeping" | "maintenance";
export type User = { id: string; email: string; name: string; role: UserRole; properties?: { property: Property }[] };
export type Guest = { id?: string; firstName: string; lastName: string; email: string | null; phone: string | null; vip?: boolean; preferences?: string | null; address?: string | null; documentType?: string | null; documentNumber?: string | null; dateOfBirth?: string | null; nationality?: string | null };
export type GuestReview = { nps: number; comment: string | null; createdAt: string };
export type GuestListItem = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; vip: boolean; preferences: string | null; stays: number; lastStay: string | null; hasDocument?: boolean; documentType?: string | null };
export type GuestStay = { id: string; code: string; propertyName: string; roomType: string | null; checkInDate: string; checkOutDate: string; status: string; totalAmount: Money; review: GuestReview | null };
export type GuestProfile = { guest: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; language: string | null; address: string | null; documentType: string | null; documentNumber: string | null; dateOfBirth: string | null; nationality: string | null; vip: boolean; preferences: string | null; marketingConsent: boolean; createdAt: string }; stays: GuestStay[] };
export type GuestPatch = { firstName?: string; lastName?: string; email?: string; phone?: string; language?: string; address?: string; documentType?: string; documentNumber?: string; dateOfBirth?: string; nationality?: string; vip?: boolean; preferences?: string; marketingConsent?: boolean };
export type ReviewItem = { id: string; nps: number; comment: string | null; createdAt: string; code: string; checkOutDate: string; guestName: string };
export type GroupBilling = "collective" | "individual";
export type GroupListItem = { id: string; code: string; name: string; note: string | null; billing: GroupBilling; createdAt: string; rooms: number; total: number; from: string | null; to: string | null };
export type GroupMember = { id: string; code: string; status: string; guestId: string; guestEmail: string | null; guestName: string; unit: string; roomType: string | null; checkInDate: string; checkOutDate: string; totalAmount: Money; balance: Money };
export type GroupDetail = { id: string; code: string; name: string; note: string | null; billing: GroupBilling; createdAt: string; organizer: { firstName: string; lastName: string; email: string | null } | null; members: GroupMember[]; totals: { charges: Money; paid: Money; balance: Money }; emails: EmailLog[] };
export type GroupRoomInput = { roomTypeId: string; adults: number; children?: number; childAges?: number[]; firstName?: string; lastName?: string };
export type BulkResult = { code: string; ok: boolean; error?: string };
export type ReviewsData = { summary: { count: number; avg: number | null; nps: number | null; promoters: number; passives: number; detractors: number }; reviews: ReviewItem[] };
export type RoomType = { id: string; name: string; description: string | null; capacityAdults: number; capacityChildren: number; maxExtraBeds: number; extraBedPrice: Money; basePrice: Money; weeklyPrice: Money | null; monthlyPrice: Money | null; amenities: string[]; _count?: { rooms: number } };
export type Bed = { id: string; label: string; status: string; room?: { number: string; roomType?: RoomType } };
export type Room = { id: string; number: string; floor: number; status: string; lockType: string; roomType?: RoomType; beds?: Bed[] };
export type Reservation = {
  id: string; code: string; status: string; checkInDate: string; checkOutDate: string;
  nights: number; adults: number; children?: number; childAges?: number[]; totalAmount: Money; cityTax: Money; billingCycle?: string;
  primaryGuest?: Guest; roomType?: RoomType; room?: Room | null; bed?: Bed | null; createdAt?: string;
};
export type RegistrationEntry = { id: string; fullName: string; dateOfBirth: string; nationality: string; documentType: string; documentNumber: string; homeAddress: string; stayFrom: string; stayTo: string };
export type Payment = { id: string; type: string; amount: Money; method: string; status: string; description: string | null; invoiceNumber: string | null; createdAt: string };
export type Charge = { id: string; category: string; description: string | null; quantity: Money; unitPrice: Money; amount: Money; vatRate: Money; createdAt: string };
export type OccupancyRow = { id: string; code: string; unit: string; roomType: string | null; guestName: string; guests: number; checkInDate: string; checkOutDate: string; charges: number; balance: Money; note: string | null };
export type ResGuest = { id: string; isPrimary: boolean; personRateId?: string | null; personRate?: { id: string; name: string; pricePerNight: Money } | null; guest: { id?: string; firstName: string; lastName: string; email: string | null; phone: string | null; address: string | null; documentType: string | null; documentNumber: string | null; dateOfBirth?: string | null; nationality?: string | null } };
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
export const CHARGE_LABEL: Record<string, string> = { minibar: "Minibar", laundry: "Praní", ironing: "Žehlení", wellness: "Wellness", service: "Služba", restaurant: "Restaurace", parking: "Parkování", discount: "Sleva", other: "Ostatní" };

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
  supplierName: string; supplierAddress: string | null; supplierIco: string | null; supplierDic: string | null; supplierRegistration: string | null; supplierAccount: string | null; vatPayer: boolean;
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
  primaryGuestLastReg?: { fullName: string; dateOfBirth: string; nationality: string; documentType: string; documentNumber: string; homeAddress: string } | null;
  energyFeeExempt?: boolean;
  bedRateId?: string | null; bedRate?: { id: string; name: string; pricePerNight: Money } | null;
  payUntil?: string | null; paidTo?: string | null; vip?: boolean;
  companyId?: string | null; company?: { id: string; name: string } | null;
  personRateId?: string | null; personRate?: { id: string; name: string; pricePerNight: Money } | null;
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
  roomBoard: () => req<RoomBoardItem[]>(`/admin/room-board?_=${Date.now()}`),
  saveRoomLayout: (rooms: RoomLayout[]) => req<{ saved: number }>(`/admin/rooms/layout`, { method: "PATCH", body: JSON.stringify({ rooms }) }),
  roomDetail: (id: string) => req<RoomDetail>(`/admin/rooms/${id}/detail?_=${Date.now()}`),
  setDnd: (reservationId: string, on: boolean) => req(`/admin/reservations/${reservationId}/dnd`, { method: "POST", body: JSON.stringify({ on }) }),
  roomCandidates: (reservationId: string) => req<RoomCandidate[]>(`/admin/reservations/${reservationId}/room-candidates`),
  unitCandidates: (reservationId: string) => req<{ unit: "room" | "bed"; candidates: UnitCandidate[] }>(`/admin/reservations/${reservationId}/unit-candidates`),
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
  issueProforma: (resId: string, amount: number, dueInDays?: number, email?: boolean, withReservation?: boolean) => req<Doc>(`/admin/reservations/${resId}/proforma`, { method: "POST", body: JSON.stringify({ amount, dueInDays, email, withReservation }) }),
  setReservationAccommodation: (id: string, amount: number) => req(`/admin/reservations/${id}/accommodation`, { method: "POST", body: JSON.stringify({ amount }) }),
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
  addRegistration: (id: string, b: { primary?: boolean; fullName: string; dateOfBirth: string; nationality: string; documentType?: string; documentNumber?: string; homeAddress?: string }) => req(`/admin/reservations/${id}/registration`, { method: "POST", body: JSON.stringify(b) }),
  deleteRegistration: (id: string) => req(`/admin/registrations/${id}`, { method: "DELETE" }),
  searchGuests: (q: string) => req<GuestListItem[]>(`/admin/guests?q=${encodeURIComponent(q)}`),
  createGuestRecord: (b: { firstName: string; lastName: string; email?: string; phone?: string; address?: string; documentType?: string; documentNumber?: string; dateOfBirth?: string; nationality?: string }) => req<{ id: string; firstName: string; lastName: string }>(`/admin/guests`, { method: "POST", body: JSON.stringify(b) }),
  guestProfile: (id: string) => req<GuestProfile>(`/admin/guests/${id}`),
  updateGuest: (id: string, b: GuestPatch) => req(`/admin/guests/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  mergeGuests: (targetId: string, sourceId: string) => req(`/admin/guests/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceId }) }),
  deleteGuest: (id: string) => req(`/admin/guests/${id}`, { method: "DELETE" }),
  reviews: () => req<ReviewsData>(`/admin/reviews`),
  groups: () => req<GroupListItem[]>(`/admin/groups`),
  group: (id: string) => req<GroupDetail>(`/admin/groups/${id}`),
  createGroup: (b: { name: string; note?: string; from: string; to: string; billing?: GroupBilling; organizer: { firstName: string; lastName: string; email?: string; phone?: string; language?: string }; rooms: GroupRoomInput[] }) => req<GroupDetail>(`/admin/groups`, { method: "POST", body: JSON.stringify(b) }),
  setGroupBilling: (id: string, billing: GroupBilling) => req<GroupDetail>(`/admin/groups/${id}/billing`, { method: "PATCH", body: JSON.stringify({ billing }) }),
  groupCheckin: (id: string) => req<BulkResult[]>(`/admin/groups/${id}/checkin`, { method: "POST" }),
  groupCheckout: (id: string) => req<BulkResult[]>(`/admin/groups/${id}/checkout`, { method: "POST" }),
  groupCancel: (id: string) => req<{ ok: boolean; count: number }>(`/admin/groups/${id}/cancel`, { method: "POST" }),
  groupEmail: (id: string) => req<{ ok: boolean }>(`/admin/groups/${id}/email`, { method: "POST" }),
  assignUnit: (id: string, unitId: string, reprice?: "recompute" | "keep") => req(`/admin/reservations/${id}/assign`, { method: "POST", body: JSON.stringify({ unitId, ...(reprice ? { reprice } : {}) }) }),
  reservationEmails: (id: string) => req<EmailLog[]>(`/admin/reservations/${id}/emails`),
  resendEmail: (id: string, type: string) => req<EmailLog[]>(`/admin/reservations/${id}/emails/resend`, { method: "POST", body: JSON.stringify({ type }) }),
  addResGuest: (id: string, b: unknown) => req<ResGuest>(`/admin/reservations/${id}/guests`, { method: "POST", body: JSON.stringify(b) }),
  updateResGuest: (rgId: string, b: unknown) => req<ResGuest>(`/admin/reservation-guests/${rgId}`, { method: "PATCH", body: JSON.stringify(b) }),
  setResGuestRate: (rgId: string, personRateId: string | null) => req<ResGuest>(`/admin/reservation-guests/${rgId}/rate`, { method: "PATCH", body: JSON.stringify({ personRateId }) }),
  setReservationEnergyExempt: (id: string, exempt: boolean) => req<{ id: string; energyFeeExempt: boolean }>(`/admin/reservations/${id}/energy-exempt`, { method: "PATCH", body: JSON.stringify({ exempt }) }),
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

  // firmy (centrální adresář odběratelů)
  companies: (q = "") => req<Company[]>(`/admin/companies${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  companyLookup: (ico: string) => req<AresResult>(`/admin/companies/lookup?ico=${encodeURIComponent(ico)}`),
  company: (id: string) => req<CompanyDetail>(`/admin/companies/${id}`),
  createCompany: (b: unknown) => req<Company>(`/admin/companies`, { method: "POST", body: JSON.stringify(b) }),
  updateCompany: (id: string, b: unknown) => req<Company>(`/admin/companies/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteCompany: (id: string) => req(`/admin/companies/${id}`, { method: "DELETE" }),
  companyReservations: (id: string) => req<CompanyResItem[]>(`/admin/companies/${id}/reservations`),
  companyInvoice: (id: string, reservationIds: string[]) => req<Doc>(`/admin/companies/${id}/invoice`, { method: "POST", body: JSON.stringify({ reservationIds }) }),
  setReservationCompany: (id: string, companyId: string | null) => req(`/admin/reservations/${id}/company`, { method: "POST", body: JSON.stringify({ companyId }) }),

  // lůžková obsazenost (firemní ubytovny)
  bedBoard: () => req<BedBoardItem[]>(`/admin/beds/board?_=${Date.now()}`),
  bedReservations: (bedId: string) => req<BedReservationsData>(`/admin/beds/${bedId}/reservations?_=${Date.now()}`),

  // číselník typů osob
  personRates: (all = false) => req<PersonRate[]>(`/admin/person-rates${all ? "?all=1" : ""}`),
  createPersonRate: (b: unknown) => req<PersonRate>(`/admin/person-rates`, { method: "POST", body: JSON.stringify(b) }),
  updatePersonRate: (id: string, b: unknown) => req<PersonRate>(`/admin/person-rates/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deletePersonRate: (id: string) => req(`/admin/person-rates/${id}`, { method: "DELETE" }),
  bedRates: (all = false) => req<BedRate[]>(`/admin/bed-rates${all ? "?all=1" : ""}`),
  createBedRate: (b: unknown) => req<BedRate>(`/admin/bed-rates`, { method: "POST", body: JSON.stringify(b) }),
  updateBedRate: (id: string, b: unknown) => req<BedRate>(`/admin/bed-rates/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteBedRate: (id: string) => req(`/admin/bed-rates/${id}`, { method: "DELETE" }),
  setReservationBedRate: (id: string, bedRateId: string | null) => req(`/admin/reservations/${id}/bed-rate`, { method: "PATCH", body: JSON.stringify({ bedRateId }) }),
  setReservationBooking: (id: string, b: { payUntil?: string | null; paidTo?: string | null; vip?: boolean }) => req(`/admin/reservations/${id}/booking`, { method: "PATCH", body: JSON.stringify(b) }),
  reservationOccupations: (id: string) => req<OccupationItem[]>(`/admin/reservations/${id}/occupations?_=${Date.now()}`),
  createOccupation: (id: string, b: unknown) => req<OccupationItem>(`/admin/reservations/${id}/occupations`, { method: "POST", body: JSON.stringify(b) }),
  updateOccupation: (occId: string, b: unknown) => req<OccupationItem>(`/admin/occupations/${occId}`, { method: "PATCH", body: JSON.stringify(b) }),
  endOccupation: (occId: string, toDate?: string) => req(`/admin/occupations/${occId}/end`, { method: "POST", body: JSON.stringify(toDate ? { toDate } : {}) }),
  deleteOccupation: (occId: string) => req(`/admin/occupations/${occId}`, { method: "DELETE" }),
  setReservationPersonRate: (id: string, personRateId: string | null, applyPrice = true) => req(`/admin/reservations/${id}/person-rate`, { method: "POST", body: JSON.stringify({ personRateId, applyPrice }) }),

  // report příchodů/odchodů
  movements: (from: string, to: string) => req<MovementsReport>(`/admin/reports/movements?from=${from}&to=${to}&_=${Date.now()}`),

  // domovská Recepce (dnešek)
  reception: () => req<ReceptionToday>(`/admin/reception?_=${Date.now()}`),

  // průvodce novou rezervací
  availabilityFor: (from: string, to: string, guests = 1) => req<AvailUnit[]>(`/admin/availability?from=${from}&to=${to}&guests=${guests}&_=${Date.now()}`),
  freeBedsPerRoom: (from: string, to: string) => req<FreeBedsRoom[]>(`/admin/beds/free-per-room?from=${from}&to=${to}&_=${Date.now()}`),
  freeBedsOfType: (roomTypeId: string, from: string, to: string) => req<{ id: string; label: string; free: boolean }[]>(`/admin/beds/free-of-type?roomTypeId=${roomTypeId}&from=${from}&to=${to}&_=${Date.now()}`),

  // vratné kauce
  reservationDeposits: (id: string) => req<Deposit[]>(`/admin/reservations/${id}/deposits?_=${Date.now()}`),
  companyDeposits: (id: string) => req<Deposit[]>(`/admin/companies/${id}/deposits?_=${Date.now()}`),
  createDeposit: (b: unknown) => req<Deposit>(`/admin/deposits`, { method: "POST", body: JSON.stringify(b) }),
  returnDeposit: (id: string, b: { returnedAmount?: number; note?: string }) => req<Deposit>(`/admin/deposits/${id}/return`, { method: "POST", body: JSON.stringify(b) }),
  forfeitDeposit: (id: string, note?: string) => req<Deposit>(`/admin/deposits/${id}/forfeit`, { method: "POST", body: JSON.stringify(note ? { note } : {}) }),
  deleteDeposit: (id: string) => req(`/admin/deposits/${id}`, { method: "DELETE" }),

  // servisní požadavky
  adminRequests: (q = "") => req<ServiceRequest[]>(`/admin/requests${q}`),
  staffRequests: (status = "") => req<ServiceRequest[]>(`/staff/requests?${status ? `status=${status}&` : ""}_=${Date.now()}`),
  staffCreateRequest: (b: unknown) => req<ServiceRequest>(`/staff/requests`, { method: "POST", body: JSON.stringify(b) }),
  staffSetStatus: (id: string, b: unknown) => req(`/staff/requests/${id}/status`, { method: "POST", body: JSON.stringify(b) }),
  staffRequestPhotos: (id: string, images: string[]) => req<ServiceRequest>(`/staff/requests/${id}/photos`, { method: "POST", body: JSON.stringify({ images }) }),
  staffSetDnd: (reservationId: string, on: boolean) => req(`/staff/reservations/${reservationId}/dnd`, { method: "POST", body: JSON.stringify({ on }) }),
  staffServiceItems: () => req<ServiceItem[]>(`/staff/service-items`),
  staffChargeRequest: (id: string, b: { serviceItemId: string; quantity: number; markDone?: boolean }) => req(`/staff/requests/${id}/charge`, { method: "POST", body: JSON.stringify(b) }),
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
  staffPlan: () => req<HousekeepingPlan>(`/staff/plan?_=${Date.now()}`),
  staffBrief: (lang = "cs") => req<{ brief: string }>(`/staff/plan/brief`, { method: "POST", body: JSON.stringify({ lang }) }),

  // údržba triage (prioritizovaná fronta údržby)
  maintenancePlan: () => req<MaintenancePlan>(`/admin/maintenance/plan`),
  maintenanceBrief: (lang = "cs") => req<{ brief: string }>(`/admin/maintenance/brief`, { method: "POST", body: JSON.stringify({ lang }) }),
  staffMaintPlan: () => req<MaintenancePlan>(`/staff/maintenance/plan?_=${Date.now()}`),
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
export type RoomBoardItem = { id: string; number: string; floor: number; roomType: string | null; status: string; posX: number | null; posY: number | null; w: number | null; h: number | null; occupant: { reservationId: string; name: string; checkInDate: string; checkOutDate: string; departsToday: boolean; balance: Money; dnd?: boolean } | null; arrival: { reservationId: string; name: string } | null; openHousekeeping: number; openMaintenance: number };
export type RoomResItem = { id: string; code: string; guestName: string; status: string; checkInDate: string; checkOutDate: string; balance: Money };
export type RoomReqItem = { id: string; type: string; domain: string; status: string; description: string | null; note?: string | null; imageUrls?: string[]; resolvedAt?: string | null; resolvedByName?: string | null; createdAt: string };
export type RoomDetail = { room: { id: string; number: string; floor: number; status: string; lockType: string; notes: string; roomType: { id: string; name: string } }; occupantId: string | null; occupantBalance: string | null; occupantDnd?: boolean; reservations: RoomResItem[]; requests: RoomReqItem[] };
export type RoomCandidate = { id: string; number: string; floor: number; free: boolean; current: boolean };
export type UnitCandidate = { id: string; label: string; free: boolean; current: boolean; pricePerNight?: number | null; typeName?: string | null };
export type Company = { id: string; name: string; ico: string | null; dic: string | null; account: string | null; street: string | null; city: string | null; zip: string | null; country: string | null; email: string | null; phone: string | null; note: string | null; vatPayer: boolean; active: boolean };
export type AresResult = { ico: string; name: string | null; dic: string | null; street: string | null; city: string | null; zip: string | null; country: string; vatPayer: boolean; viesValid: boolean | null; account: string | null; accounts: string[]; found: boolean };
export type CompanyResItem = { id: string; code: string; guestName: string; checkInDate: string; checkOutDate: string; status: string; balance: Money; propertyId?: string; propertyName?: string };
export type CompanyDetail = Company & { reservations: CompanyResItem[]; totalBalance: Money };
export type BedCurrentRes = { reservationId: string; code: string; guestName: string; companyName: string | null; fromDate: string; toDate: string; status: string };
export type BedResItem = { id: string; code: string; guestName: string; companyName: string | null; fromDate: string; toDate: string; status: string; totalAmount: Money };
export type BedReservationsData = { bed: { id: string; label: string; roomNumber: string; roomTypeId: string }; items: BedResItem[] };
export type PersonRate = { id: string; name: string; ageFrom: number | null; ageTo: number | null; pricePerNight: Money; sortOrder: number; active: boolean };
export type BedRate = { id: string; name: string; pricePerNight: Money; sortOrder: number; active: boolean };
export type OccupationItem = { id: string; reservationId: string; bedId: string; occupantId: string; occupantName: string; occupantPhone: string | null; fromDate: string; toDate: string; status: "active" | "ended"; note: string | null; nights: number };
export type BedBoardItem = { bedId: string; label: string; roomId: string; roomNumber: string; floor: number; roomTypeId: string; status: string; roomPosX: number | null; roomPosY: number | null; roomW: number | null; roomH: number | null; current: BedCurrentRes | null; upcoming: number; nextFrom: string | null };
export type RoomLayout = { id: string; posX: number; posY: number; w: number; h: number };
export type Deposit = { id: string; amount: Money; method: string; status: "held" | "returned" | "forfeited"; takenAt: string; returnedAt: string | null; returnedAmount: Money | null; note: string | null; reservationId: string | null; companyId: string | null };
export const DEPOSIT_STATUS_LABEL: Record<string, string> = { held: "držena", returned: "vrácena", forfeited: "zadržena" };
export type MoveItem = { date: string; kind: "reservation" | "occupancy"; name: string; where: string; code: string | null; companyName: string | null };
export type MovementsReport = { from: string; to: string; arrivals: MoveItem[]; departures: MoveItem[] };
export type RecArrival = { id: string; code: string; guestName: string; where: string; assigned: boolean };
export type RecRow = { id: string; code: string; guestName: string; where: string; balance: Money };
export type ReceptionToday = { date: string; freeUnits: number; unitLabel: string; dirtyRooms: number; inHouseCount: number; arrivals: RecArrival[]; departures: RecRow[]; unpaid: RecRow[] };
export type AvailUnit = { roomTypeId: string; name: string; description: string | null; amenities: string[]; unit: "room" | "bed"; freeUnits: number; capacityAdults: number; capacityChildren: number; maxExtraBeds: number; extraBedsNeeded: number; extraBedPrice: Money; roomTotal: Money; cityTax: Money; total: Money };
export type FreeBedsRoom = { roomId: string; roomNumber: string; floor: number; totalBeds: number; freeBeds: number };
export type UnassignedRes = { id: string; code: string; guestName: string; checkInDate: string; checkOutDate: string };
export const ROOM_STATUS_LABEL: Record<string, string> = { clean: "Uklizeno", dirty: "K úklidu", to_inspect: "Zkontrolovat", inspected: "Zkontrolováno", out_of_service: "Mimo provoz" };
export const SERVICE_LABEL: Record<string, string> = { cleaning: "Úklid", maintenance: "Údržba", laundry: "Praní", ironing: "Žehlení", minibar: "Minibar", other: "Jiné" };
export const SERVICE_ICON: Record<string, string> = { cleaning: "🧹", maintenance: "🔧", laundry: "🧺", ironing: "👔", minibar: "🥤", other: "📌" };

export type Priority = "urgent" | "high" | "normal";
export type PlanItem = {
  id: string; type: string; status: string; priority: Priority; reason: string;
  roomNumber: string | null; bedLabel: string | null; roomTypeName: string | null;
  guestName: string | null; fromGuest: boolean; description: string | null; imageUrls?: string[]; dnd?: boolean; reservationId?: string | null; ageMinutes: number; createdAt: string;
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
