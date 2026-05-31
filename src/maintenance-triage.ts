// Agent „údržba triage" — priorizace fronty údržby (maintenance ServiceRequest).
//
// Rule-based (bez LLM): z popisu závady odvodí kategorii a její závažnost
// (bezpečnost / blokující provoz / drobné), zkombinuje s tím, zda je pokoj
// obsazený nebo do něj dnes někdo přijíždí, a napojí poškozené vybavení v pokoji.
//
// Volitelné AI shrnutí směny (Haiku) jen na vyžádání. READ-ONLY.
import { ReservationStatus, ServiceDomain, ServiceStatus, EquipmentCondition } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly } from "./dates";

export type MaintPriority = "urgent" | "high" | "normal";
const RANK: Record<MaintPriority, number> = { urgent: 0, high: 1, normal: 2 };
const STALE_MINUTES = 8 * 60; // otevřeno přes 8 h → povýšit

// Skupiny závad podle klíčových slov v popisu. base = výchozí závažnost.
// safety  = bezpečnost/zabezpečení → vždy urgentní.
// blocking= znemožňuje užívání pokoje → urgentní když je obsazený, jinak přednostní.
// minor   = drobnost → běžné (pokud nehlásí host / neleží dlouho).
const GROUPS: { label: string; base: "safety" | "blocking" | "minor"; words: string[] }[] = [
  { label: "požár/plyn", base: "safety", words: ["plyn", "kouř", "hoří", "oheň", "požár", "čoud"] },
  { label: "elektřina", base: "safety", words: ["elektr", "zkrat", "jiskř", "jiskr", "zásuvka nefunguje", "vypadl proud"] },
  { label: "únik vody", base: "safety", words: ["teče voda", "teče z", "únik vody", "zaplav", "vytopen", "prasklé potrubí", "praskla trubka", "prasklý radiátor", "kape ze stropu"] },
  { label: "zabezpečení", base: "safety", words: ["zámek", "nejde zamknout", "nejde zavřít", "nejde odemknout", "vloupán", "rozbité okno", "sejf", "trezor"] },
  { label: "topení", base: "blocking", words: ["topení", "netopí", "radiátor", "je zima", "nefunguje topení"] },
  { label: "voda/sanita", base: "blocking", words: ["teplá voda", "nejde voda", "sprcha", "bojler", "wc ", "toalet", "splachov", "ucpan", "odpad", "umyvadlo", "kohoutek"] },
  { label: "klimatizace", base: "blocking", words: ["klimatizac", "nejde chladit", "horko v pokoji"] },
  { label: "výtah", base: "blocking", words: ["výtah"] },
];

function classify(description: string | null): { label: string; base: "safety" | "blocking" | "minor" } {
  const text = (description ?? "").toLowerCase();
  for (const g of GROUPS) if (g.words.some((w) => text.includes(w))) return { label: g.label, base: g.base };
  return { label: "jiné", base: "minor" };
}

export type MaintItem = {
  id: string;
  status: ServiceStatus;
  priority: MaintPriority;
  category: string;
  reason: string;
  roomNumber: string | null;
  roomTypeName: string | null;
  guestName: string | null;
  fromGuest: boolean;
  occupied: boolean;        // pokoj má teď hosta nebo dnešní příjezd
  damagedEquipment: number; // počet poškozených kusů v pokoji
  description: string | null;
  ageMinutes: number;
  createdAt: Date;
};

export type MaintenancePlan = {
  generatedAt: Date;
  counts: { total: number; urgent: number; high: number; normal: number };
  items: MaintItem[];
};

export async function buildMaintenancePlan(propertyId: string): Promise<MaintenancePlan> {
  const now = new Date();
  const today = toDateOnly(now);

  const [requests, inHouse, arrivals, damaged] = await Promise.all([
    prisma.serviceRequest.findMany({
      where: { propertyId, domain: ServiceDomain.maintenance, status: { in: [ServiceStatus.open, ServiceStatus.in_progress] } },
      include: { room: { include: { roomType: true } }, reservation: { include: { primaryGuest: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reservation.findMany({ where: { propertyId, status: ReservationStatus.checked_in, roomId: { not: null } }, select: { roomId: true } }),
    prisma.reservation.findMany({ where: { propertyId, checkInDate: today, status: { in: [ReservationStatus.confirmed, ReservationStatus.pending] }, roomId: { not: null } }, select: { roomId: true } }),
    prisma.equipmentItem.findMany({ where: { propertyId, condition: EquipmentCondition.damaged, roomId: { not: null } }, select: { roomId: true } }),
  ]);

  const occupiedRooms = new Set<string>([...inHouse, ...arrivals].map((r) => r.roomId!).filter(Boolean));
  const damagedByRoom = new Map<string, number>();
  for (const e of damaged) damagedByRoom.set(e.roomId!, (damagedByRoom.get(e.roomId!) ?? 0) + 1);

  const items: MaintItem[] = requests.map((r) => {
    const ageMinutes = Math.max(0, Math.round((now.getTime() - r.createdAt.getTime()) / 60_000));
    const { label, base } = classify(r.description);
    const occupied = !!(r.roomId && occupiedRooms.has(r.roomId));

    let priority: MaintPriority = "normal";
    let reason: string;
    if (base === "safety") {
      priority = "urgent";
      reason = `Bezpečnostní závada (${label}) — řešit okamžitě.`;
    } else if (base === "blocking" && occupied) {
      priority = "urgent";
      reason = `${label} v obsazeném pokoji — host nemůže pokoj plně užívat.`;
    } else if (base === "blocking") {
      priority = "high";
      reason = `${label} — znemožňuje užívání pokoje, vyřešit před dalším příjezdem.`;
    } else if (r.fromGuest) {
      priority = "high";
      reason = "Závadu nahlásil host — čeká na vyřízení.";
    } else if (ageMinutes >= STALE_MINUTES) {
      priority = "high";
      reason = `Otevřeno přes ${Math.floor(ageMinutes / 60)} h — vyřídit přednostně.`;
    } else {
      reason = "Drobná údržba bez tlaku na termín.";
    }
    // Host čeká vždy aspoň „high".
    if (r.fromGuest && priority === "normal") { priority = "high"; reason = "Závadu nahlásil host — čeká na vyřízení."; }

    return {
      id: r.id, status: r.status, priority, category: label, reason,
      roomNumber: r.room?.number ?? null, roomTypeName: r.room?.roomType?.name ?? null,
      guestName: r.reservation?.primaryGuest ? `${r.reservation.primaryGuest.firstName} ${r.reservation.primaryGuest.lastName}` : null,
      fromGuest: r.fromGuest, occupied, damagedEquipment: r.roomId ? (damagedByRoom.get(r.roomId) ?? 0) : 0,
      description: r.description, ageMinutes, createdAt: r.createdAt,
    };
  });

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

// ── Volitelné: mluvené AI shrnutí směny údržby (Haiku) ────────
let _client: import("@anthropic-ai/sdk").default | null = null;
async function anthropic() {
  if (!_client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _client = new Anthropic();
  }
  return _client;
}

export async function briefMaintenance(plan: MaintenancePlan, lang = "cs"): Promise<string> {
  if (plan.items.length === 0) return "Fronta údržby je prázdná — nic k řešení.";
  const model = process.env.AI_MODEL || "claude-haiku-4-5";
  const lines = plan.items.map((i, n) => {
    const loc = i.roomNumber ? `pokoj ${i.roomNumber}` : "—";
    return `${n + 1}. [${i.priority}] ${i.category} — ${loc}${i.occupied ? " (obsazeno)" : ""}: ${i.description ?? ""}`;
  }).join("\n");

  const client = await anthropic();
  const msg = await client.messages.create({
    model,
    max_tokens: 350,
    system: [{
      type: "text",
      text:
        "Jsi dispečer údržby v hotelu. Z prioritizovaného seznamu napiš údržbáři KRÁTKÉ " +
        "shrnutí směny (3–5 vět) jako mluvenou řeč. Nejdřív čím začít a proč (urgentní = " +
        "bezpečnost nebo závada v obsazeném pokoji), pak zbytek. ŽÁDNÝ markdown, žádné " +
        "odrážky, žádné emoji. Odpovídej v jazyce dle pokynu.",
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: `Jazyk odpovědi: ${lang}.\nFronta údržby (urgent → normal):\n${lines}` }],
  });
  return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}
