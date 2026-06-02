// AI recepční — Claude s tool use, omezený jen na ubytování dané provozovny.
// Nástroje volají skutečné funkce systému (dostupnost, rezervace, vyhledání).
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";
import { getAvailability } from "./availability";
import { createWalkInHold, findReservationByCode } from "./reservations";

const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
const client = new Anthropic(); // čte ANTHROPIC_API_KEY z env

export type ChatMsg = { role: "user" | "assistant"; content: string };

const money = (d: { toFixed: (n: number) => string }) => `${d.toFixed(0)} Kč`;
const TYPE_CS: Record<string, string> = { hotel: "hotel", penzion: "penzion", ubytovna: "ubytovna" };

// Instrukce „odpovídej v jazyce X" pro každý podporovaný jazyk kiosku.
const REPLY_LANG: Record<string, string> = {
  cs: "Odpovídej vždy česky.",
  en: "Always reply in English.",
  de: "Antworte immer auf Deutsch.",
  ru: "Всегда отвечай на русском языке.",
  uk: "Завжди відповідай українською мовою.",
  pl: "Zawsze odpowiadaj po polsku.",
  sk: "Vždy odpovedaj po slovensky.",
  it: "Rispondi sempre in italiano.",
  fr: "Réponds toujours en français.",
  es: "Responde siempre en español.",
  zh: "始终用中文回答。",
};

// ── Systémový prompt + znalostní báze provozovny ─────────────
function buildSystem(p: Awaited<ReturnType<typeof prisma.property.findUniqueOrThrow>>, lang: string) {
  const today = new Date().toISOString().slice(0, 10);
  const kb = [
    `Provozovna: ${p.name} (${TYPE_CS[p.type] ?? p.type})${p.city ? ", " + p.city : ""}.`,
    p.street ? `Adresa: ${p.street}, ${p.city ?? ""}.` : "",
    `Snídaně v ceně: ${p.breakfastIncluded ? "ano" : "ne"}.`,
    `Samoobslužný check-in: ${p.selfCheckin ? "ano" : "ne"}.`,
    p.cityTaxEnabled ? `Účtuje se pobytový poplatek ${p.cityTaxPerPersonNight.toFixed(0)} Kč/osoba/noc; děti do ${p.cityTaxFreeAge} let neplatí.` : `Pobytový poplatek se neúčtuje.`,
    p.allowLongTerm ? `Umožňuje dlouhodobé pobyty (týdenní/měsíční ceny).` : "",
    p.infoText ? `Další informace:\n${p.infoText}` : "",
  ].filter(Boolean).join("\n");

  const langLine = REPLY_LANG[lang] ?? REPLY_LANG.en;

  const text = `Jsi AI recepční provozovny „${p.name}". Pomáháš hostům s ubytováním.

ROZSAH (důležité):
- Odpovídáš VÝHRADNĚ na témata této provozovny: dostupnost pokojů/lůžek, ceny, rezervace, check-in/out, služby a praktické informace pro hosty.
- Na cokoliv mimo ubytování (počasí, zprávy, obecné dotazy, programování, jiné firmy…) zdvořile odmítni a nabídni pomoc s ubytováním. Nevymýšlej si.
- Nikdy si nevymýšlej ceny ani dostupnost — vždy použij nástroje. Před vytvořením rezervace si nech od hosta potvrdit termín, typ a cenu.
- Zeptej se i na počet dětí a jejich věk; věk každého dítěte předej do book_room jako childAges (např. [5, 16]). Děti do věkové hranice provozovny neplatí pobytový poplatek, takže věk ovlivní cenu. Bez dětí pošli prázdné pole.
- Buď stručná, vlídná a konkrétní. ${langLine}

FORMÁT ODPOVĚDI (důležité): Tvoje odpovědi se hostovi PŘEDČÍTAJÍ nahlas a zároveň zobrazují na dotykovém kiosku. Piš proto jako mluvená řeč:
- ŽÁDNÝ Markdown — nepoužívej hvězdičky (**tučné**), mřížky (#), odrážky ani zpětníky. Zvýrazňuj jen slovy.
- ŽÁDNÉ emoji ani symboly.
- Data a časy říkej přirozeně slovy (např. „v pátek 6. června", „od dvou hodin"), NIKDY ne ve tvaru 2026-06-06 nebo YYYY-MM-DD.
- Místo seznamů piš plynulé krátké věty. Ceny a čísla řekni normálně (např. „čtrnáct set korun za noc").

DNEŠNÍ DATUM: ${today}. Relativní termíny („pátek", „o víkendu") si interně převeď na konkrétní datum ve tvaru YYYY-MM-DD POUZE pro volání nástrojů — hostovi ho takhle nikdy nepiš.

ZNALOSTNÍ BÁZE:
${kb}`;

  return [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];
}

// ── Nástroje ─────────────────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description: "Zjistí volné pokoje/lůžka v této provozovně pro daný termín a počet hostů. Vrací typy jednotek s počtem volných a celkovou cenou pobytu. Použij vždy, když host řeší dostupnost nebo cenu.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Datum příjezdu YYYY-MM-DD" },
        to: { type: "string", description: "Datum odjezdu YYYY-MM-DD" },
        guests: { type: "integer", description: "Počet hostů (dospělých)" },
      },
      required: ["from", "to", "guests"],
    },
    cache_control: { type: "ephemeral" },
  },
  {
    name: "book_room",
    description: "Vytvoří rezervaci (dočasnou blokaci) na konkrétní typ jednotky. Použij až po potvrzení hostem. roomTypeId vezmi z výsledku check_availability. Vrací rezervační kód a cenu.",
    input_schema: {
      type: "object",
      properties: {
        roomTypeId: { type: "string", description: "ID typu jednotky z check_availability" },
        from: { type: "string", description: "Příjezd YYYY-MM-DD" },
        to: { type: "string", description: "Odjezd YYYY-MM-DD" },
        adults: { type: "integer", description: "Počet dospělých" },
        childAges: { type: "array", items: { type: "integer" }, description: "Věk každého dítěte (roky). Prázdné pole, pokud bez dětí. Ovlivňuje pobytový poplatek." },
        guestFirstName: { type: "string" },
        guestLastName: { type: "string" },
      },
      required: ["roomTypeId", "from", "to", "adults", "guestFirstName", "guestLastName"],
    },
  },
  {
    name: "find_reservation",
    description: "Najde existující rezervaci podle rezervačního kódu (např. RC-XXXXXX). Vrací termín, jednotku a stav.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
];

async function executeTool(propertyId: string, name: string, input: Record<string, unknown>) {
  if (name === "check_availability") {
    const list = await getAvailability(propertyId, new Date(String(input.from)), new Date(String(input.to)), Number(input.guests));
    if (!list.length) return { available: false, message: "Pro zvolený termín není nic volné." };
    return {
      available: true,
      options: list.map((o) => ({ roomTypeId: o.roomTypeId, name: o.name, jednotka: o.unit === "bed" ? "lůžko" : "pokoj", volných: o.freeUnits, cenaCelkem: money(o.total) })),
    };
  }
  if (name === "book_room") {
    const r = await createWalkInHold({
      propertyId, roomTypeId: String(input.roomTypeId), from: new Date(String(input.from)), to: new Date(String(input.to)),
      adults: Number(input.adults), childAges: Array.isArray(input.childAges) ? (input.childAges as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : [],
      guest: { firstName: String(input.guestFirstName), lastName: String(input.guestLastName) },
    });
    return { kod: r.code, jednotka: r.room?.number ?? r.bed?.label ?? r.roomType?.name, cenaCelkem: money(r.totalAmount), stav: "blokace (platba na recepci/kiosku)" };
  }
  if (name === "find_reservation") {
    const r = await findReservationByCode(propertyId, String(input.code));
    if (!r) return { found: false };
    return { found: true, host: `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName}`, termin: `${r.checkInDate.toISOString().slice(0, 10)} → ${r.checkOutDate.toISOString().slice(0, 10)}`, jednotka: r.room?.number ?? r.bed?.label ?? r.roomType?.name, stav: r.status };
  }
  return { error: "neznámý nástroj" };
}

// ── Konverzační smyčka s tool use ────────────────────────────
export async function chat(propertyId: string, lang: string, history: ChatMsg[]) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Chybí ANTHROPIC_API_KEY v .env.");
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const system = buildSystem(property, lang);

  const messages: Anthropic.MessageParam[] = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));

  for (let i = 0; i < 6; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages });

    if (resp.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: resp.content as Anthropic.ContentBlockParam[] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === "tool_use") {
          let out: unknown;
          let isErr = false;
          try { out = await executeTool(propertyId, block.name, block.input as Record<string, unknown>); }
          catch (e) { out = { error: e instanceof Error ? e.message : String(e) }; isErr = true; }
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), is_error: isErr });
        }
      }
      messages.push({ role: "user", content: results });
    } else {
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { reply: text || "…" };
    }
  }
  return { reply: "Omlouvám se, tohle teď neumím zpracovat. Zkuste to prosím jinak." };
}
