# AI agenti řídící procesy hotelu — design & roadmapa

Návrhový dokument pro postupné nasazení AI asistentů, kteří řídí provozní procesy
napříč provozovnami ReceptionAI. Slouží jako vodítko pro další vývoj — co je hotové,
co následuje a podle jakých principů to stavět.

> Stav: **Fáze 1 (housekeeping dispečer) hotová.** Fáze 2–4 navržené, neimplementované.

---

## 1. Princip: tým specialistů + orchestrátor

Ne jeden vševědoucí „AI ředitel" (drahý, pomalý, nespolehlivý), ale **tým úzce
zaměřených agentů**, každý s vlastní doménou a pár nástroji — přesně podle vzoru,
který už běží v `src/ai.ts` (tool-use smyčka nad reálnými funkcemi systému). Nad
nimi stojí **orchestrátor**, který agenty spouští (událostně i plánovaně) a eskaluje
na člověka.

```
                 ┌─────────────────────────────┐
                 │   ORCHESTRÁTOR / NIGHT AUDIT │  ← cron + události
                 │  (denní briefing, eskalace)  │
                 └──────────────┬──────────────┘
        ┌──────────┬────────────┼────────────┬──────────────┐
   ┌────▼───┐ ┌────▼────┐  ┌────▼────┐  ┌────▼─────┐  ┌──────▼─────┐
   │Recepční│ │Housekeep│  │ Údržba  │  │ Revenue  │  │ Compliance │
   │(kiosk) │ │ dispečer│  │ triage  │  │ pricing  │  │ ubyhost    │
   └────────┘ └─────────┘  └─────────┘  └──────────┘  └────────────┘
        │          │            │             │              │
        └──────────┴── reálné funkce v src/*.ts (Prisma) ────┘
```

### Návrhové zásady (platí pro každého agenta)

1. **Rule-based jádro zdarma.** Co jde spočítat deterministicky (fronty, priority,
   deficity, termíny), počítej kódem — bez LLM. Je to levné, rychlé, testovatelné
   a vysvětlitelné.
2. **LLM jen tam, kde přidává hodnotu, a jen na vyžádání.** Claude (model
   `claude-haiku-4-5`, env `AI_MODEL`) se hodí na převod dat do mluvené řeči
   (briefing), klasifikaci volného textu a komunikaci s hostem. Spouštěj ho na klik
   nebo 1×/den cronem, ne v reálném čase. Prompt caching na system+tools.
3. **Agent navrhuje, člověk schvaluje nevratné kroky.** Mazání, účtování, storna a
   odeslání hostovi vyžadují potvrzení v adminu. Stejná logika jako guardrail u
   WhatsAppu (viz níže).
4. **Vše scopované `propertyId`.** Multi-tenance se nikdy neobchází.
5. **Náklady na API jsou hlídané.** `ANTHROPIC_API_KEY` spotřebovává výhradně AI
   recepční (`src/ai.ts`) a volitelná AI shrnutí dispečera (`src/dispatch.ts`).
   WhatsApp je **jen odchozí** notifikace personálu (Jitsi hovor), žádné příchozí
   AI odpovědi — to je záměr, ne opomenutí.

---

## 2. Mapa agentů na datový model

Datový model: `prisma/schema.prisma`. Klíčové entity scopované na `Property`.

| Agent | Doména (model) | Spouštěč | Co dělá |
|-------|----------------|----------|---------|
| **Recepční** *(hotové)* | `Reservation`, `Guest`, availability | host na kiosku | dostupnost, rezervace, vyhledání; mluví 11 jazyky |
| **Housekeeping dispečer** *(hotové)* | `Room.status`, `ServiceRequest(housekeeping)` | checkout → pokoj `dirty` | priorizuje frontu úklidu dle dnešních příjezdů |
| **Údržba triage** | `ServiceRequest(maintenance)`, `EquipmentItem` | host/personál nahlásí závadu | klasifikuje urgenci, spojí s vybavením, eskaluje |
| **Revenue / pricing** | `RatePlan`, occupancy z `Reservation` | denně (cron) | dynamické ceny dle obsazenosti a lead-time |
| **Compliance / ubyhost** | `RegistrationEntry` | check-in, denně | hlídá chybějící doklady cizinců, skartace |
| **Billing / pohledávky** | `Payment`, `holdExpiresAt`, `BillingCycle` | denně | upomínky, expirující holdy, měsíční fakturace |
| **Concierge / komunikace** | `Property.infoText`, `Guest` | před/po pobytu | předpříjezdové info, upsell, recenze, FAQ |
| **Inventář / DHIM** | `EquipmentItem`, `EquipmentMove` | změna stavu | audit přesunů, upozornění na poškozené/vyřazené |

### Tři režimy spouštění

1. **Interaktivní** — host/personál se ptá, agent koná (dnešní kiosk).
2. **Událostní** — operace v systému spustí agenta (checkout → úklidový tiket).
3. **Plánovaný (cron)** — orchestrátor 1×/den udělá noční audit a ranní briefing.

---

## 3. Fáze 1 — Housekeeping dispečer ✅ HOTOVO

**Cíl:** uklízečka i manažer okamžitě vidí, **co uklidit první**.

### Co je implementováno

- **`src/dispatch.ts`**
  - `buildHousekeepingPlan(propertyId): Promise<HousekeepingPlan>` — rule-based
    priorizace otevřených + rozdělaných housekeeping `ServiceRequest`ů.
  - `briefHousekeeping(plan, lang)` — volitelné mluvené shrnutí směny (Haiku),
    spouští se jen na vyžádání. Lazy-init Anthropic klienta.
- **Endpointy** (`src/server.ts`)
  - `GET  /admin/housekeeping/plan` — plán pro manažera
  - `POST /admin/housekeeping/brief` — AI shrnutí (manažer)
  - `GET  /staff/plan` — plán pro uklízečku
  - `POST /staff/plan/brief` — AI shrnutí (uklízečka)
- **Admin UI** (`admin/src/App.tsx`)
  - záložka **„🧹 Dispečink úklidu"** (`HousekeepingView`) — souhrn počtů,
    prioritní tabulka, akce Začít/Hotovo, tlačítko „✨ AI shrnutí směny".
  - portál personálu má režim **„Plán"** (`PlanCards`, default pro housekeeping).
  - štítky priorit `.prio-urgent/.high/.normal` v `admin/src/styles.css`.

### Pravidla priority (od nejsilnějšího signálu)

1. **URGENT** — konkrétní pokoj je přiřazen rezervaci s **dnešním příjezdem**.
2. **URGENT** — typ pokoje má dnes víc příjezdů než volných uklizených pokojů
   (`deficit = příjezdy(typ) − čisté pokoje(typ)`); nejstarší `dirty` pokoje toho
   typu se musí stihnout dnes. *(Jen pokojové provozovny `inventoryUnit=room`; pro
   lůžkové ubytovny se deficit zatím nepočítá — viz Otevřené body.)*
3. **HIGH** — požadavek nahlásil host (`fromGuest`), nebo visí > 6 h (`STALE_MINUTES`).
4. **NORMAL** — běžný úklid po odhlášení bez tlaku na dnešní příjezd.

Řazení: priorita → rozdělané před otevřenými → nejstarší první.

> **Pozn.:** Dispečer tikety **nevytváří** — to dělá `checkOut()` v
> `src/reservations.ts` (po odhlášení: pokoj `dirty` + cleaning `ServiceRequest`).
> Dispečer existující frontu jen inteligentně řadí a vysvětluje proč.

### Jak to ručně ověřit

```powershell
# přihlášení manažera
$login = Invoke-RestMethod -Uri http://localhost:4000/auth/login -Method Post `
  -ContentType 'application/json' -Body '{"email":"hotel@recepce.cz","password":"heslo123"}'
$hdr = @{ 'x-admin-token'=$login.token; 'x-property-id'='HOTEL-PRAHA-01' }
Invoke-RestMethod -Uri http://localhost:4000/admin/housekeeping/plan -Headers $hdr
```

### Otevřené body / TODO pro fázi 1

- **Lůžkové ubytovny (`inventoryUnit=bed`)** — deficit se počítá jen pro pokoje;
  u lůžek dostane úklid high/normal (dnešní příjezdy na konkrétní lůžko řešit přes
  `Bed.status` a přiřazení při check-inu).
- **Přiřazení konkrétní uklízečce** — zatím fronta sdílená; přidat `assignedToId`
  na `ServiceRequest` a rozdělování dle vytížení.
- **Auto-refresh** plánu v UI (teď ruční „↻ Obnovit").

---

## 4. Fáze 2 — Orchestrátor + ranní briefing (navrženo)

**Cíl:** 1× denně (cron) projít data a dát manažerovi přehled + spustit rutiny.

- **Nový soubor `src/orchestrator.ts`**: `runNightAudit(propertyId)`:
  - obsazenost dnes/zítra, dnešní příjezdy bez přiřazeného pokoje,
  - `dirtyRooms` blokující dnešní příjezdy (volá `buildHousekeepingPlan`),
  - expirující holdy → `releaseExpiredHolds()` *(už existuje)*,
  - nevyrovnané účty (`computeFolio` nad in-house), expirující `deposit_hold`,
  - chybějící `RegistrationEntry` u cizinců (ubyhost),
  - skartace `purgeExpiredRegistrations()` *(už existuje)*.
- **AI vrstva:** `briefManager(audit, lang)` (Haiku) → mluvené shrnutí
  („Dnes sedm příjezdů, tři pokoje ještě špinavé, dva nedoplatky…").
- **Endpoint:** `GET /admin/briefing` (manažer) — vrátí audit + (na klik) AI shrnutí.
- **Spouštění:** denní cron (OS scheduler / `node-cron`) volající interní endpoint;
  výsledek uložit nebo poslat (e-mail/WhatsApp personálu — pozor na guardrail nákladů).
- **UI:** karta „Ranní briefing" na dashboardu (`DashboardView`).

**Náklady:** 1 LLM volání/den/provozovna. Zanedbatelné.

---

## 5. Fáze 3 — Revenue / pricing agent (navrženo)

**Cíl:** dynamické ceny do `RatePlan` bez ručního klikání.

- **`src/pricing-agent.ts`**: `suggestRates(propertyId, roomTypeId, horizonDays)`:
  - vstup: `basePrice` typu, obsazenost na N dní dopředu (volné jednotky vs.
    rezervace), lead-time, den v týdnu, sezóna.
  - rule-based model: obsazenost > 80 % → +X %, < 30 % a blízko termínu → −Y %,
    víkend → příplatek. (Žádné LLM nutné — je to čistá matematika.)
  - výstup: návrh `RatePlan` na každý den horizontu **k odsouhlasení**, ne automaticky.
- **Endpointy:** `GET /admin/pricing/suggestions`, `POST /admin/pricing/apply`
  (zapíše přes existující `upsertRatePlan`). Aplikace = explicitní akce manažera.
- **UI:** v záložce „Typy & ceny" tlačítko „Návrh cen" → tabulka starých vs. nových
  cen s hromadným potvrzením.

**Pozor:** ceny jsou citlivé — agent vždy jen navrhuje, nikdy nepřepisuje sám.

---

## 6. Fáze 4 — Compliance, billing, concierge, inventář (navrženo)

- **Compliance / ubyhost** — denní kontrola úplnosti `RegistrationEntry` (cizinci bez
  dokladu/víza), příprava hlášení cizinecké policii, skartace dle `retentionUntil`.
- **Billing / pohledávky** — upomínky nedoplatků (`computeFolio`), expirující
  `deposit_hold`, automatická příprava měsíční faktury u `BillingCycle=monthly`
  (ubytovny) přes existující `buildInvoice`.
- **Concierge / komunikace** — předpříjezdové info a post-stay recenze; čerpá z
  `Property.infoText`. Odchozí kanál = pozor na náklady a souhlas hosta.
- **Inventář / DHIM** — audit `EquipmentMove`, upozornění na `damaged`/`retired`,
  návrh doobjednání. Rule-based, bez LLM.

---

## 7. Mapa souborů

| Vrstva | Soubor | Pozn. |
|--------|--------|-------|
| AI recepční (kiosk) | `src/ai.ts` | tool-use, 11 jazyků, prompt caching |
| Housekeeping dispečer | `src/dispatch.ts` | **fáze 1** |
| Rezervační jádro | `src/reservations.ts` | checkout → úklidový tiket |
| Servisní fronty | `src/service.ts` | `ServiceRequest`, domény |
| Admin operace | `src/admin.ts` | dashboard, folio, faktury, ceny |
| HTTP vrstva | `src/server.ts` | routy `/admin/*`, `/staff/*`, `/ai/*` |
| Schéma | `prisma/schema.prisma` | enumy, modely |
| Admin UI | `admin/src/App.tsx`, `api.ts`, `styles.css` | záložky, klient |
| Orchestrátor | `src/orchestrator.ts` | **fáze 2 (TODO)** |
| Pricing agent | `src/pricing-agent.ts` | **fáze 3 (TODO)** |

---

## 8. Doporučené pořadí prací

1. ✅ Housekeeping dispečer.
2. Orchestrátor + ranní briefing (zhodnotí data, co už máš; 1 LLM volání/den).
3. Revenue pricing (měřitelný dopad na tržby; bez LLM).
4. Compliance → billing → concierge → inventář.

Viz též `README.md` (přehled projektu) a `kiosk/DEPLOYMENT.md` (nasazení).
