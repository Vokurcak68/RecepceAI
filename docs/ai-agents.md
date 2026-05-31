# AI agenti řídící procesy hotelu — design & roadmapa

Návrhový dokument pro postupné nasazení AI asistentů, kteří řídí provozní procesy
napříč provozovnami ReceptionAI. Slouží jako vodítko pro další vývoj — co je hotové,
co následuje a podle jakých principů to stavět.

> Stav: **Fáze 1–4 hotové** (housekeeping dispečer, orchestrátor + ranní briefing,
> revenue/pricing agent, kontrolní agent compliance/billing/inventář) **+ údržba
> triage**. Concierge (odchozí komunikace s hostem) záměrně odložen — viz fáze 4.

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
| **Orchestrátor / briefing** *(hotové)* | napříč (audit) | cron 1×/den + na vyžádání | noční audit + ranní briefing manažerovi |
| **Revenue / pricing** *(hotové)* | `RatePlan`, occupancy z `Reservation` | na vyžádání (i cron) | navrhuje ceny dle obsazenosti, lead-time, víkendu |
| **Compliance / ubyhost** *(hotové)* | `RegistrationEntry` | na vyžádání (i denně) | hlídá ubytované bez evidence, skartace po lhůtě |
| **Billing / pohledávky** *(hotové)* | `Payment`, `holdExpiresAt`, `BillingCycle` | na vyžádání (i denně) | nevyrovnané účty, expirující holdy, měsíční fakturace |
| **Inventář / DHIM** *(hotové)* | `EquipmentItem` | na vyžádání | poškozené/vyřazené vybavení v pokojích |
| **Údržba triage** *(hotové)* | `ServiceRequest(maintenance)`, `EquipmentItem` | host/personál nahlásí závadu | klasifikuje urgenci z popisu, zohlední obsazenost, napojí poškozené vybavení |
| **Concierge / komunikace** *(odloženo)* | `Property.infoText`, `Guest` | před/po pobytu | předpříjezdové info, upsell, recenze, FAQ |

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

## 4. Fáze 2 — Orchestrátor + ranní briefing ✅ HOTOVO

**Cíl:** 1× denně projít data a dát manažerovi přehled + upozornit na úkoly.

### Co je implementováno

- **`src/orchestrator.ts`**
  - `runNightAudit(propertyId): Promise<NightAudit>` — **READ-ONLY** audit:
    - obsazenost dnes/zítra (jednotky obsazené blokujícími rezervacemi / celkem),
    - dnešní příjezdy a kolik z nich je bez přiřazené jednotky,
    - dnešní odjezdy,
    - fronta úklidu (urgentní/celkem) přes `buildHousekeepingPlan`,
    - nevyrovnané účty ubytovaných (`computeFolio` nad `checked_in`) + celková částka,
    - ubytovaní bez evidence (`RegistrationEntry` = 0 → ohlašovací povinnost),
    - holdy aktivní / po expiraci, evidence po lhůtě uchování (ke skartaci),
    - `flags[]` — krátká provozní upozornění (to nejdůležitější nahoře).
  - `briefManager(audit, lang)` — volitelné mluvené AI shrnutí (Haiku), jen na klik.
- **Endpointy** (`src/server.ts`)
  - `GET  /admin/briefing` — noční audit (manažer)
  - `POST /admin/briefing/brief` — AI ranní briefing
- **Admin UI** (`admin/src/App.tsx`) — karta **`BriefingCard`** nahoře na dashboardu:
  obsazenost dnes/zítra, příjezdy/odjezdy, seznam `flags` (✅/⚠️), tlačítko
  „✨ AI shrnutí".

### Záměrné rozhodnutí: audit je READ-ONLY

Audit **nic nemaže ani nemění** — jen čte a počítá. Úklidové/maintenance akce
(uvolnění expirovaných holdů, skartace) zůstávají na samostatných, již existujících
endpointech `POST /maintenance/release-holds` a `POST /maintenance/purge-registrations`.
Briefing je tedy bezpečné kdykoli otevřít/refreshnout; jen **reportuje počty** „k
uvolnění / ke skartaci". Pozn.: tyto dvě maintenance funkce jsou **globální** (napříč
provozovnami), proto je nevoláme z per-property auditu.

### TODO pro fázi 2

- **Cron spouštění** (zatím nenasazeno — jako autostart kiosku, je to deployment krok):
  denní úloha (OS scheduler / `node-cron`) zavolá `GET /admin/briefing` +
  `POST /maintenance/release-holds` + `…/purge-registrations` a výsledek pošle
  (WhatsApp personálu / e-mail). Pozor na guardrail nákladů u AI shrnutí.
- **Doručení briefingu** mimo admin (push/WhatsApp/e-mail).

**Náklady:** AI shrnutí = 1 LLM volání na klik (nebo 1×/den z cronu). Audit sám zdarma.

---

## 5. Fáze 3 — Revenue / pricing agent ✅ HOTOVO

**Cíl:** návrh dynamických cen do `RatePlan` bez ručního klikání — vždy ke schválení.

### Co je implementováno

- **`src/pricing-agent.ts`** (rule-based, bez LLM)
  - `suggestRates(propertyId, roomTypeId, horizonDays=14)`:
    - pro každý den horizontu spočítá obsazenost typu (blokující rezervace typu
      překrývající noc / celkový počet jednotek typu) — překryvy se počítají
      v paměti z jednoho dotazu,
    - faktor z `basePrice` dle pravidel (viz níže), zaokrouhlený na desetikoruny,
    - vrací per-den `currentPrice` (RatePlan nebo basePrice) vs `suggestedPrice`,
      `occupancyPct`, `reason`, `direction` (up/down/same), `changed`.
  - `applyRates(propertyId, roomTypeId, items[])` — zapíše schválené ceny přes
    existující `upsertRatePlan`. **Explicitní akce manažera, nikdy ne automaticky.**
- **Endpointy** (`src/server.ts`)
  - `GET  /admin/pricing/suggestions?roomTypeId=…&horizon=…`
  - `POST /admin/pricing/apply` `{ roomTypeId, items: [{date, price}] }`
- **Admin UI** (`admin/src/App.tsx`) — panel **„✨ Návrh cen (revenue agent)"**
  v záložce „Typy & ceny": výběr typu + horizont → tabulka současná vs. navržená
  cena (barevně ▲/▼), obsazenost, důvod; předvybrané jen změny; tlačítko
  „Schválit vybrané (N)" → zápis do ceníku.

### Cenová pravidla (`priceRule`, faktor z `basePrice`)

| Podmínka | Úprava |
|----------|--------|
| obsazenost ≥ 80 % | +20 % |
| obsazenost 60–79 % | +10 % |
| obsazenost ≤ 15 % | −10 % |
| obsazenost ≤ 30 % **a** lead-time ≤ 7 dní | −15 % (last-minute doprodej) |
| noc z pátku/soboty | +10 % (víkend) |

Faktor je clampovaný na **0,7–1,6×** basePrice, výsledek zaokrouhlen na 10 Kč.
Pravidla se sčítají (např. nízká obsazenost + víkend). Důvod se skládá ze slovních
částí pro transparentnost.

### TODO pro fázi 3

- **Cron auto-návrh** (volitelně): 1×/den přegenerovat návrhy a poslat manažerovi
  (zápis ale vždy nechat na potvrzení).
- **Sezónnost / svátky** jako další faktor (teď jen obsazenost + víkend + lead-time).
- **Dlouhodobé sazby** (`weeklyPrice`/`monthlyPrice`) agent neřeší — jen nočné `RatePlan`.

---

## 6. Fáze 4 — Kontrolní agent (compliance / billing / inventář) ✅ HOTOVO

**Cíl:** akční drill-down k ranímu briefingu. Briefing dává počty, kontrolní agent
konkrétní položky (kdo / co / kde) napříč třemi doménami. Rule-based, READ-ONLY,
bez LLM a bez odchozí komunikace.

### Co je implementováno

- **`src/checks.ts`**
  - `complianceFindings(propertyId)` — ubytovaní (`checked_in`) bez záznamu v
    `RegistrationEntry` (high, ohlašovací povinnost); počet záznamů po lhůtě
    uchování ke skartaci (low).
  - `billingFindings(propertyId)` — nevyrovnané účty ubytovaných přes `computeFolio`
    (high, s dlužnou částkou); rezervace v držbě po expiraci (medium); počet
    dlouhodobých pobytů s měsíční fakturací ke kontrole (low).
  - `inventoryFindings(propertyId)` — poškozené vybavení s umístěním (medium);
    vyřazené kusy stále v pokoji (low).
  - `runChecks(propertyId)` — agreguje, řadí dle závažnosti, vrací počty + nálezy
    po kategoriích. Strop `MAX_PER_KIND` proti zahlcení UI.
- **Endpoint** (`src/server.ts`): `GET /admin/checks`
- **Admin UI** (`admin/src/App.tsx`): záložka **„✅ Kontroly"** (`ChecksView`) —
  souhrn počtů dle závažnosti + panely po kategoriích s barevnými štítky
  (vysoká/střední/nízká) a odkazem (kód rezervace / kus).

### Záměrně odložené: Concierge (odchozí komunikace s hostem)

Předpříjezdové zprávy, upsell a žádosti o recenzi **nebudují** se v této fázi:
- **Náklady** — generování textů přes LLM a hromadné odesílání jde proti hlídání
  API nákladů (`ANTHROPIC_API_KEY` jen recepční + dispečer/audit shrnutí).
- **Souhlas a kanál** — odchozí marketing vyžaduje `marketingConsent` a doručovací
  kanál; WhatsApp je dle pravidla **jen pro personál** (Jitsi), ne pro hosty.

Až bude poptávka, lze udělat **read-only návrh** „kterým hostům se ozvat" + draft
textu ke schválení (bez auto-odeslání), nikdy ne automatické rozesílání.

### TODO pro fázi 4

- **Cron** — `GET /admin/checks` 1×/den do briefingu / notifikace.

## 7. Údržba triage ✅ HOTOVO

**Cíl:** údržbář i manažer vidí prioritizovanou frontu údržby — analogie
housekeeping dispečera, ale pro `ServiceRequest(domain=maintenance)`.

- **`src/maintenance-triage.ts`** (rule-based, READ-ONLY)
  - `buildMaintenancePlan(propertyId)` — z popisu závady odvodí **kategorii**
    (klíčová slova → požár/plyn, elektřina, únik vody, zabezpečení, topení,
    voda/sanita, klimatizace, výtah, jiné) a její **závažnost** (safety / blocking /
    minor), zkombinuje s tím, zda je pokoj **obsazený** (host in-house nebo dnešní
    příjezd), a přidá počet **poškozeného vybavení** v pokoji.
  - Priorita: safety → vždy urgent; blocking v obsazeném pokoji → urgent, jinak
    high; host nahlásil / staré → high; jinak normal.
  - `briefMaintenance(plan, lang)` — volitelné AI shrnutí směny (Haiku, na klik).
- **Endpointy**: `GET/POST /admin/maintenance/plan|brief` (manažer),
  `GET/POST /staff/maintenance/plan|brief` (údržbář).
- **Admin UI**: záložka **„🔧 Dispečink údržby"** (`MaintenanceView`); portál
  údržbáře má režim **„🔧 Plán"** (`MaintCards`).
- **Pozn.**: klíčová slova jsou záměrně konkrétní (např. „prasklé potrubí", ne baré
  „prask") — při testu se ukázalo, že široký match chytal „prasklou žárovku" jako
  únik vody.

---

## 8. Mapa souborů

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
| Orchestrátor / briefing | `src/orchestrator.ts` | **fáze 2** |
| Pricing agent | `src/pricing-agent.ts` | **fáze 3** |
| Kontrolní agent | `src/checks.ts` | **fáze 4** |
| Údržba triage | `src/maintenance-triage.ts` | **fáze 4+** |

---

## 9. Doporučené pořadí prací

1. ✅ Housekeeping dispečer.
2. ✅ Orchestrátor + ranní briefing.
3. ✅ Revenue pricing.
4. ✅ Kontrolní agent (compliance + billing + inventář) + ✅ údržba triage.
   Concierge odložen.

**Další možné kroky:** cron spouštění briefingu/kontrol/plánů, doručení mimo admin
(WhatsApp personálu / e-mail), volitelné AI dotřídění nejednoznačných popisů závad.

Viz též `README.md` (přehled projektu) a `kiosk/DEPLOYMENT.md` (nasazení).
