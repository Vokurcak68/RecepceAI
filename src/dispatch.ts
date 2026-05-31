// Housekeeping dispečer — priorizace fronty úklidu.
//
// Cíl: uklízečka i manažer okamžitě vidí, CO uklidit první. Jádro je čistě
// rule-based (deterministické, bez nákladů na AI). Klíčový signál je provozní:
// „pokoj, který dnes potřebuje uklidit, protože do něj někdo přijíždí".
//
// Volitelně lze nad hotovým plánem vygenerovat krátké mluvené shrnutí směny
// přes Claude (Haiku) — ale jen na výslovné vyžádání (kvůli nákladům na API).
import { ReservationStatus, RoomStatus, ServiceDomain, ServiceStatus, ServiceType, InventoryUnit } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly } from "./dates";

export type Priority = "urgent" | "high" | "normal";

/** Pořadí priorit pro řazení (menší = dřív). */
const RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };

/** Otevřený požadavek starší než tohle (min) povýšíme na „high" — ať nezůstane viset. */
const STALE_MINUTES = 6 * 60;

export type PlanItem = {
  id: string;
  type: ServiceType;
  status: ServiceStatus;
  priority: Priority;
  reason: string;
  roomNumber: string | null;
  bedLabel: string | null;
  roomTypeName: string | null;
  guestName: string | null;
  fromGuest: boolean;
  description: string | null;
  ageMinutes: number;
  createdAt: Date;
};

export type HousekeepingPlan = {
  generatedAt: Date;
  counts: { total: number; urgent: number; high: number; normal: number };
  items: PlanItem[];
};

/**
 * Sestaví prioritizovaný plán úklidu pro provozovnu.
 *
 * Pravidla priority (od nejsilnějšího signálu):
 *  1. URGENT — konkrétní pokoj je přiřazen rezervaci s dnešním příjezdem.
 *  2. URGENT — typ pokoje má dnes víc příjezdů než volných uklizených pokojů
 *     (deficit): nejstarší „dirty" pokoje toho typu se MUSÍ stihnout dnes.
 *  3. HIGH   — požadavek nahlásil host (čeká na pokoji), nebo visí > 6 h.
 *  4. NORMAL — běžný úklid po odhlášení bez tlaku na dnešní příjezd.
 */
export async function buildHousekeepingPlan(propertyId: string): Promise<HousekeepingPlan> {
  const now = new Date();
  const today = toDateOnly(now);

  const [property, requests, arrivals, cleanRooms] = await Promise.all([
    prisma.property.findUniqueOrThrow({ where: { id: propertyId } }),
    prisma.serviceRequest.findMany({
      where: { propertyId, domain: ServiceDomain.housekeeping, status: { in: [ServiceStatus.open, ServiceStatus.in_progress] } },
      include: { room: { include: { roomType: true } }, reservation: { include: { primaryGuest: true } } },
      orderBy: { createdAt: "asc" }, // nejstarší první → spravedlivé řazení uvnitř priority
    }),
    prisma.reservation.findMany({
      where: { propertyId, checkInDate: today, status: { in: [ReservationStatus.confirmed, ReservationStatus.pending] } },
      select: { roomId: true, roomTypeId: true },
    }),
    prisma.room.findMany({ where: { propertyId, status: RoomStatus.clean }, select: { roomTypeId: true } }),
  ]);

  // ServiceRequest.bedId je jen string (bez relace) → labely lůžek dohledáme zvlášť.
  const bedIds = requests.map((r) => r.bedId).filter((x): x is string => !!x);
  const bedLabels = new Map<string, string>();
  if (bedIds.length) {
    const beds = await prisma.bed.findMany({ where: { id: { in: bedIds } }, select: { id: true, label: true } });
    for (const b of beds) bedLabels.set(b.id, b.label);
  }

  // Pokoje přímo přiřazené dnešnímu příjezdu → musí být uklizené dnes.
  const arrivalRoomIds = new Set(arrivals.map((a) => a.roomId).filter((x): x is string => !!x));

  // Deficit pokojů na dnešní příjezdy podle typu (jen pokojové provozovny).
  // deficit(typ) = příjezdy(typ) − volné uklizené pokoje(typ). Kolik „dirty" se musí stihnout.
  const deficitByType = new Map<string, number>();
  if (property.inventoryUnit === InventoryUnit.room) {
    const arrByType = new Map<string, number>();
    for (const a of arrivals) arrByType.set(a.roomTypeId, (arrByType.get(a.roomTypeId) ?? 0) + 1);
    const cleanByType = new Map<string, number>();
    for (const r of cleanRooms) cleanByType.set(r.roomTypeId, (cleanByType.get(r.roomTypeId) ?? 0) + 1);
    for (const [type, arr] of arrByType) {
      const def = arr - (cleanByType.get(type) ?? 0);
      if (def > 0) deficitByType.set(type, def);
    }
  }

  // Kolik úklidů daného typu jsme už označili urgentními kvůli deficitu (čerpáme nejstarší).
  const deficitUsed = new Map<string, number>();

  const items: PlanItem[] = requests.map((r) => {
    const ageMinutes = Math.max(0, Math.round((now.getTime() - r.createdAt.getTime()) / 60_000));
    const roomTypeId = r.room?.roomTypeId ?? null;
    const guestName = r.reservation?.primaryGuest
      ? `${r.reservation.primaryGuest.firstName} ${r.reservation.primaryGuest.lastName}`
      : null;

    let priority: Priority = "normal";
    let reason = "Běžný úklid po odhlášení.";

    const isCleaning = r.type === ServiceType.cleaning;

    if (isCleaning && r.roomId && arrivalRoomIds.has(r.roomId)) {
      priority = "urgent";
      reason = "Do tohoto pokoje dnes přijíždí host — musí být uklizený před příjezdem.";
    } else if (isCleaning && roomTypeId && (deficitByType.get(roomTypeId) ?? 0) > (deficitUsed.get(roomTypeId) ?? 0)) {
      deficitUsed.set(roomTypeId, (deficitUsed.get(roomTypeId) ?? 0) + 1);
      priority = "urgent";
      reason = `Typ „${r.room?.roomType?.name ?? "?"}" je dnes vytížený — tento pokoj je potřeba pro dnešní příjezd.`;
    } else if (r.fromGuest) {
      priority = "high";
      reason = "Požadavek nahlásil host — čeká na vyřízení na pokoji.";
    } else if (ageMinutes >= STALE_MINUTES) {
      priority = "high";
      reason = `Otevřeno přes ${Math.floor(ageMinutes / 60)} h — vyřídit přednostně.`;
    }

    return {
      id: r.id,
      type: r.type,
      status: r.status,
      priority,
      reason,
      roomNumber: r.room?.number ?? null,
      bedLabel: r.bedId ? (bedLabels.get(r.bedId) ?? null) : null,
      roomTypeName: r.room?.roomType?.name ?? null,
      guestName,
      fromGuest: r.fromGuest,
      description: r.description,
      ageMinutes,
      createdAt: r.createdAt,
    };
  });

  // Řazení: priorita → rozdělaný před otevřeným → nejstarší první.
  items.sort((a, b) =>
    RANK[a.priority] - RANK[b.priority] ||
    (a.status === ServiceStatus.in_progress ? 0 : 1) - (b.status === ServiceStatus.in_progress ? 0 : 1) ||
    a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const counts = {
    total: items.length,
    urgent: items.filter((i) => i.priority === "urgent").length,
    high: items.filter((i) => i.priority === "high").length,
    normal: items.filter((i) => i.priority === "normal").length,
  };

  return { generatedAt: now, counts, items };
}

// ── Volitelné: mluvené shrnutí směny přes Claude (Haiku) ──────
// Spouští se JEN na vyžádání (manažer klikne). Nízké náklady, krátký výstup.
// Vrací prostý text bez markdownu (lze i předčíst).
let _client: import("@anthropic-ai/sdk").default | null = null;
async function anthropic() {
  if (!_client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _client = new Anthropic(); // čte ANTHROPIC_API_KEY z env
  }
  return _client;
}

export async function briefHousekeeping(plan: HousekeepingPlan, lang = "cs"): Promise<string> {
  if (plan.items.length === 0) return "Fronta úklidu je prázdná — nic k řešení.";
  const model = process.env.AI_MODEL || "claude-haiku-4-5";
  const lines = plan.items.map((i, n) => {
    const loc = i.roomNumber ? `pokoj ${i.roomNumber}` : i.bedLabel ? "lůžko" : "—";
    const who = i.guestName ? `, host ${i.guestName}` : "";
    return `${n + 1}. [${i.priority}] ${i.type} — ${loc}${who} (${i.reason})`;
  }).join("\n");

  const client = await anthropic();
  const msg = await client.messages.create({
    model,
    max_tokens: 350,
    system: [{
      type: "text",
      text:
        "Jsi dispečer úklidu v hotelu. Z prioritizovaného seznamu napiš uklízečce KRÁTKÉ, " +
        "věcné shrnutí směny (3–5 vět) jako mluvenou řeč. Nejdřív řekni, čím začít a proč " +
        "(urgentní = dnešní příjezdy), pak zbytek. ŽÁDNÝ markdown, žádné odrážky, žádné emoji, " +
        "data slovy. Odpovídej v jazyce dle pokynu.",
      cache_control: { type: "ephemeral" },
    }],
    messages: [{
      role: "user",
      content: `Jazyk odpovědi: ${lang}.\nPrioritizovaná fronta úklidu (urgent → normal):\n${lines}`,
    }],
  });
  return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}
