// Tenký klient nad kiosek API. Volá /api/* (Vite proxy → :4000).

export type Money = string; // "3000.00"

export type RoomType = {
  id: string;
  name: string;
  description: string | null;
  amenities: string[];
  photos: string[];
};

export type Guest = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  language: string | null;
};

export type Room = {
  id: string;
  number: string;
  floor: number;
  lockType: "physical_key" | "smart_code";
};

export type Reservation = {
  id: string;
  code: string;
  primaryGuestId: string;
  roomTypeId: string;
  roomId: string | null;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  adults: number;
  children: number;
  status: string;
  totalAmount: Money;
  cityTax: Money;
  primaryGuest?: Guest;
  room?: Room | null;
  roomType?: RoomType;
};

export type Available = {
  roomTypeId: string;
  name: string;
  description: string | null;
  amenities: string[];
  photos: string[];
  unit: "room" | "bed";
  freeUnits: number;
  roomTotal: Money;
  cityTax: Money;
  total: Money;
};

export type Folio = { charges: Money; paid: Money; balance: Money };

export type PropertyInfo = {
  id: string; identifier: string; name: string; type: "hotel" | "penzion" | "ubytovna";
  inventoryUnit: "room" | "bed"; cityTaxEnabled: boolean; selfCheckin: boolean; breakfastIncluded: boolean; allowLongTerm: boolean;
};

// Provozovna, pod kterou kiosek běží (nastaví se po loadProperty).
let PROPERTY_ID = "";
export const propertyId = () => PROPERTY_ID;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json", ...(PROPERTY_ID ? { "x-property-id": PROPERTY_ID } : {}) },
    ...init,
  });
  if (!r.ok) {
    let msg = `Chyba ${r.status}`;
    try {
      const body = await r.json();
      msg = body.message || body.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

/** Načte provozovnu dle identifikátoru a nastaví ji pro všechny další volání. */
export async function loadProperty(identifier: string): Promise<PropertyInfo> {
  const p = await req<PropertyInfo>(`/properties/${encodeURIComponent(identifier)}`);
  PROPERTY_ID = p.id;
  return p;
}

export type ChatMsg = { role: "user" | "assistant"; content: string };

export const api = {
  notifyStaff: (joinUrl: string, propertyName: string) =>
    req<{ sent: boolean }>(`/call/notify`, { method: "POST", body: JSON.stringify({ joinUrl, propertyName }) }),
  aiChat: (messages: ChatMsg[], lang: string) =>
    req<{ reply: string }>(`/ai/chat`, { method: "POST", body: JSON.stringify({ messages, lang }) }),
  availability: (from: string, to: string, guests: number) =>
    req<Available[]>(`/availability?from=${from}&to=${to}&guests=${guests}`),

  lookupByCode: (code: string) =>
    req<Reservation[]>(`/reservations/lookup?code=${encodeURIComponent(code)}`),

  lookupByLastName: (lastName: string) =>
    req<Reservation[]>(`/reservations/lookup?lastName=${encodeURIComponent(lastName)}`),

  walkin: (body: unknown) =>
    req<Reservation>(`/reservations/walkin`, { method: "POST", body: JSON.stringify(body) }),

  confirm: (id: string) => req<Reservation>(`/reservations/${id}/confirm`, { method: "POST" }),

  checkin: (id: string) => req<Reservation>(`/reservations/${id}/checkin`, { method: "POST" }),

  registration: (id: string, body: unknown) =>
    req(`/reservations/${id}/registration`, { method: "POST", body: JSON.stringify(body) }),

  payment: (id: string, body: unknown) =>
    req(`/reservations/${id}/payments`, { method: "POST", body: JSON.stringify(body) }),

  folio: (id: string) => req<Folio>(`/reservations/${id}/folio`),

  checkout: (id: string) =>
    req<{ folio: Folio }>(`/reservations/${id}/checkout`, { method: "POST" }),
};

/** "3000.00" → "3 000 Kč" */
export function money(m: Money | number): string {
  const n = typeof m === "number" ? m : parseFloat(m);
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(n) + " Kč";
}
