# Předání paměti pro Claude na serveru

> **Claude na serveru: tohle je export trvalé paměti z vývojového PC.** Slij to do
> své paměti (`<tvůj home>\.claude\projects\<encoded-cwd>\memory\`) — **slučuj, nepřepisuj**:
> co už máš z běhu na serveru, ponech a jen doplň/aktualizuj. Každou sekci níže ulož
> jako jeden `.md` soubor s frontmatter blokem (viz `name`/`description`/`metadata.type`
> u každé) a přidej řádek do `MEMORY.md`. U položek označených **⚠️ DEV-ONLY** ulož jen
> upravenou „serverovou" verzi (originál popisuje firemní síť/IP vývojového PC, na
> produkční server nepatří). Po uložení tenhle soubor můžeš ignorovat.
>
> Doporučené pořadí důležitosti pro server: architektura → billing → ai-agents →
> ai-assistant → avatar → feedback(CSS). Síť/proxy/LAN/GitHub-credentials jsou
> vývojové; na serveru je nahrazuje `docs/SERVER-MIGRATION.md`.

---

## 1) receptionai-architecture  · type: project  · ✅ plně platí

ReceptionAI = **multi-tenant** hotelový systém (centrální evidence + N provozoven typu hotel/penzion/ubytovna pod identifikátorem, např. `HOTEL-PRAHA-01`). Typ provozovny mění chování: jednotka pokoj vs **lůžko** (ubytovna), pobytový poplatek zap/vyp, dlouhodobé týdenní/měsíční ceny, self check-in. Vše scopováno přes `propertyId`. Uživatelé mají role (super_admin vidí vše, manager jen přiřazené provozovny). Login emailem: `super@recepce.cz` / `hotel@recepce.cz`, heslo `heslo123` (seed). Kiosek běží pod provozovnou přes `?property=IDENTIFIER` (default HOTEL-PRAHA-01). Klíčové soubory: `src/central.ts`, `src/auth.ts` (scrypt+token), scoping v `availability.ts`/`reservations.ts`/`admin.ts`.

Části (spouští se zvlášť):
- **API + jádro** (`src/`, Express + Prisma + Postgres) → port **4000** (`npm run dev` / prod `npm run start`)
- **Kiosek** (`kiosk/`, dotykové UI + hlas + 3D avatar) → **5173** HTTPS (`?property=IDENTIFIER`)
- **Admin** (`admin/`) → **5174**; obsahuje i **portál personálu** (role housekeeping/maintenance → zjednodušená fronta StaffPortal). Login `uklid@recepce.cz`/`udrzba@recepce.cz`, heslo `heslo123`.
- **Portál hosta** (`guest/`) → **5175**; bez loginu, přes rezervační kód `?code=RC-…`.

Frontendy volají API přes Vite proxy `/api` → `:4000` (relativní cesta; backend nemá `/api` prefix). Servisní požadavky `ServiceRequest` (`src/service.ts`), check-out automaticky tvoří úklidový tiket. Migrace verzované — prod `npm run db:deploy`. DB PostgreSQL `receptionai` (heslo v `.env`), `npm run db:seed` = testovací data (RC-DEMO01 check-in, RC-DEMO02 check-out).

> **Serverová poznámka:** v produkci běží frontendy jako statický build za IIS, který
> dělá reverse proxy `/api` → `localhost:4000` (viz `docs/SERVER-MIGRATION.md`). Port
> 3000-konflikt z vývojového PC (Next.js „Oresi") na serveru neřeš.

---

## 2) receptionai-billing  · type: project  · ✅ plně platí

Fakturační + pokladní modul (návrh v `docs/billing-design.md`).

**Doklady** (`src/billing.ts`): `Document`+`DocumentLine`+`DocumentReservation`+`DocumentCounter`; enum `BillingDocType` (proforma/advance_tax/invoice/receipt/credit_note). Číselné řady atomicky přes `DocumentCounter` (FA-/ZF-/DDZ-/UCT-/OD- + rok + NNNN). `createDocument` ukládá SNÍMEK dodavatele i odběratele, DPH per řádek dle `Property.vatPayer` (ubytování 12 %, služby 21 %, pobytový poplatek 0 %; ceny koncové/gross, DPH se zpětně rozloží). Generátory: `issueReservationDocument`, `issueProforma`, `issueAdvanceTaxDoc`, `createCreditNote`, `issueBulkInvoice`. `payDocument(method)` naváže platbu na doklad+rezervaci. Endpointy `/admin/documents*`, `/reservations/:id/documents|proforma`. UI: záložka **Doklady** + `DocumentOverlay` (tisk, Zaplatit hotově/kartou, Dobropis, Daňový doklad k záloze). Check-out vystaví účtenku.

**Pokladna** (`src/cashregister.ts`): `CashRegister`+`CashRegisterSession`+`CashMovement`. Směna: otevření → příjem/výdej (PPD/VPD) → uzávěrka (rozdíl). `recordPayment`: **hotovost** do šuplíku (CashMovement), **karta** jen „tržby kartou" (terminál NEnapojen, jen evidence). UI: záložka **Pokladna**.

**Účet pokoje (folio)**: model `Charge` (minibar/wellness/service/restaurant/parking/other) = NÁKLADY, oddělené od plateb. `computeFolio` (v `reservations.ts`): náklady = ubytování (totalAmount) + Charge; zaplaceno = jen platby. Doklad (`linesFromReservation`) se skládá z Charge. Endpointy `/admin/reservations/:id/charges` + `DELETE /admin/charges/:id`.

**Obsazení**: `admin.occupancy()` → záložka „Obsazení". **Spolubydlící**: `ReservationGuest`. **Property**: `ico`/`dic`/`iban`/`vatPayer` editace v Centrále → Provozovny.

**Vybavení / centrální sklad** (přidáno 2026-06-01): `EquipmentItem` umístění = (propertyId, roomId); `(null,null)` = centrální sklad = sdílený fond. Provozovna vidí ve svém seznamu vlastní + centrální kusy (`ownOrCentral`), může centrální „Převzít" (move). Centrální kusy se nezapočítávají do statistik provozovny (mají vlastní kartu). Server guard `assertInPropertyOrCentral`.

**Zbývá:** advance settlement, periodická fakturace dlouhodobých, QR na proformě, export do účetnictví.

---

## 3) receptionai-ai-agents-roadmap  · type: project  · ✅ plně platí (cron = až na serveru!)

Tým úzce zaměřených agentů + orchestrátor, navázaný na tool-use vzor v `src/ai.ts`. Princip: rule-based jádro zdarma, Claude (Haiku) jen na vyžádání; nevratné kroky navrhne, člověk schválí. **Velín:** admin záložka „🤖 AI agenti" (`AgentsView`). Design: `docs/ai-agents.md`.

- **Fáze 1 Housekeeping dispečer** — `src/dispatch.ts` `buildHousekeepingPlan()` prioritizuje frontu úklidu (urgent/high/normal). AI shrnutí `briefHousekeeping()`. Endpointy `/admin/housekeeping/plan|brief`, `/staff/plan|brief`.
- **Fáze 2 Orchestrátor + ranní briefing** — `src/orchestrator.ts` `runNightAudit()` READ-ONLY (obsazenost, příjezdy/odjezdy, nepřiřazené, fronta úklidu, nevyrovnané účty, ubyhost, holdy, skartace) → flags[]. `briefManager()`. Endpointy `/admin/briefing|/brief`. UI: `BriefingCard` na dashboardu.
- **Fáze 3 Revenue/pricing agent** — `src/pricing-agent.ts` `suggestRates()` rule-based faktor dle obsazenosti/last-minute/víkend, clamp 0,7–1,6×. `applyRates()` přes `upsertRatePlan`. Endpointy `/admin/pricing/suggestions|apply`. UI: panel v „Typy & ceny".
- **Fáze 4 Kontrolní agent** — `src/checks.ts` `runChecks()` READ-ONLY nálezy: compliance/billing/inventář. Endpoint `/admin/checks`. UI: záložka „Kontroly".
- **Údržba triage** — `src/maintenance-triage.ts` `buildMaintenancePlan()`: z popisu závady klíčová slova → kategorie+závažnost, kombinace s obsazeností. `briefMaintenance()`. Endpointy `/admin/maintenance/plan|brief`, `/staff/maintenance/*`.
- **Concierge (odchozí komunikace s hostem) ZÁMĚRNĚ ODLOŽEN** (náklady na API + souhlas hosta + WhatsApp jen pro personál).

> **Serverová poznámka:** „cron spouštění agentů/briefingu" bylo TODO odložené *na deployment*
> — teď jsme na serveru, takže je to reálný úkol (Windows Scheduled Task volající příslušné
> endpointy, např. ranní briefing). Audit/checks jsou READ-ONLY, bezpečné spouštět periodicky.

---

## 4) receptionai-ai-assistant  · type: project  · ✅ plně platí

AI asistent kiosku: `src/ai.ts` (Anthropic SDK, model dle `AI_MODEL`, default `claude-haiku-4-5`). Tool-use smyčka s nástroji **check_availability / book_room / find_reservation** (volají skutečné funkce scopované na provozovnu). Systémový prompt = znalostní báze provozovny (+ `Property.infoText` editovatelný v adminu) + **guardrail: jen ubytování dané provozovny**. Endpoint **POST /ai/chat** (veřejný, scoped přes `x-property-id`), `{lang, messages}` → `{reply}`.

**AI je JEN v kiosku (hlas/text).** `ANTHROPIC_API_KEY` spotřebovává výhradně `src/ai.ts`. WhatsApp (`src/whatsapp.ts`) s AI **nesouvisí** — jen ODESLÁNÍ notifikace personálu při volání člověka (`POST /call/notify`, `STAFF_WHATSAPP`). Žádné příchozí zprávy. *(Pozn.: příchozí AI auto-odpovědi na WhatsApp uživatel ZAMÍTL kvůli nákladům — nezavádět.)*

**Videohovor (Jitsi/JaaS):** kiosek `StaffCall.tsx` vkládá Jitsi iframe. Veřejný `meet.jit.si` má 5min limit. Řešení **JaaS (8x8)**: `src/jaas.ts` `mintJaasToken()` podepíše RS256 JWT node `crypto`em; `GET /call/token` → `{jwt}` nebo `{jwt:null}`. Env: `JAAS_APP_ID`/`JAAS_KID`/`JAAS_KEY_FILE` (privátní `*.pem` gitignored) v kořenovém `.env`, `VITE_JITSI_DOMAIN=8x8.vc`+`VITE_JITSI_APP_ID` v kiosku.

**Zvoneček přivolání člověka:** `POST /call/notify` vytvoří záznam v in-memory frontě (`src/calls.ts`, TTL 10 min). Manažeři napříč VŠEMI hotely vidí v adminu `CallBell`, který polluje `GET /calls/pending` à 4 s. `addCall` **dedupuje podle `joinUrl`**. Zhasnutí: kiosek volá `POST /call/resolve` při `participantJoined` i zavření okna. Endpointy `/calls/*` = requireAuth + role manager/super_admin, BEZ scope (odbavit může kdokoliv).

**Vícejazyčnost (11 jazyků):** CS, EN, DE, RU, UK, PL, SK, IT, FR, ES, ZH (`kiosk/src/i18n.ts`). Přepínač = **SVG vlajky** (`flag-icons`). **Provoz:** předčítání (TTS) potřebuje na kioskovém PC nainstalovaný hlasový balíček Windows (Nastavení → Čas a jazyk → Řeč); typicky chybí UK a SK.

> **Serverová poznámka:** `ANTHROPIC_API_KEY` a JaaS klíč jsou v `.env`/`jaas-key.pem`
> (nejsou v gitu — musí být ručně na serveru). Anthropic API i 8x8 musí být ze serveru
> dostupné. In-memory fronta zvonečku žije v procesu API → restart služby ji vyprázdní (OK).

---

## 5) receptionai-avatar-3d  · type: project  · ✅ platí

Avatar recepční v kiosku (`kiosk/src/RpmAvatar.tsx`, `Avatar.tsx`) = 3D scéna přes react-three-fiber/Three.js. Výchozí `rpm`, funguje **offline** jako procedurální 3D hlava (lip-sync přes scale úst řízený `useSpeech`, mrkání, idle). `GlbModel` načte `kiosk/public/avatar.glb` pokud existuje (morph targety `jawOpen`/`viseme_aa`/`eyeBlink*`).

**Ready Player Me NEPOUŽÍVAT** — Netflix ho 31. 1. 2026 vypnul (CDN `models.readyplayer.me` mrtvé). Náhrada **Avaturn (avaturn.me)** — export GLB s ARKit blendshapes + visemes, drop-in jako `kiosk/public/avatar.glb`.

---

## 6) feedback-css-debugging  · type: feedback  · ✅ platí (pracovní styl)

U vizuálních/CSS problémů (výška inputů, overflow, layout) **NIKDY neodbývat „je to cache prohlížeče"**. **Why:** headless screenshot ukazoval 34 px, ale uživatel na svém Chromu (Windows) viděl input pořád vysoký — headless ≠ reálný prohlížeč (nativní rendering form-controlů, zoom, DPI). **How to apply:** (1) vyžádat F12 → prvek → **Computed** `height`/`padding`/`line-height`; (2) u `<select>`/`<input>` na Windows nastav explicitní `height` + `box-sizing`, ne jen padding; (3) nehádat příčinu bez reálných computed čísel.

---

## 7) receptionai-github  · type: reference  · ⚠️ DEV-ONLY (ulož jen repo URL)

Repo: **https://github.com/Vokurcak68/RecepceAI** (větev `main`). `.gitignore` chrání tajnosti: `.env`, `.wwebjs_auth/`+`.wwebjs_cache/`, `kiosk/certs/*.pem`, `jaas*.pem`/`*.pem`, `node_modules/`, `dist/`. **Před každým `git add` ověř, že do stagingu nejde žádný secret.**

> **Serverová verze k uložení:** ponech jen repo URL + pravidlo „necommitovat secrets".
> Autentizace pushe je **per-stroj** — na serveru si nastav vlastní credentials (PAT v git
> credential helperu / `gh auth login`); původní zmínka o Credential Manageru vývojového PC
> na server nepatří.

---

## 8) receptionai-kiosk-lan-access  · type: reference  · ⚠️ DEV-ONLY (na serveru NEUKLÁDAT)

Originál popisuje zpřístupnění kiosku přes Vite dev HTTPS (5173) z firemní LAN/OpenVPN
vývojového PC: `server.host:true`, self-signed cert se SAN v `kiosk/certs`, firemní proxy
`10.26.170.76:3128` + `ProxyOverride 192.168.0.*`, Windows firewall pro 5173, host IP
`192.168.0.54`. **Tohle je čistě vývojové prostředí.** Na produkčním serveru to NEPLATÍ —
kiosek běží jako statický build za IIS s reálným HTTPS (Let's Encrypt) a venkovní DNS.
**Neukládej do serverové paměti**; místo toho platí `docs/SERVER-MIGRATION.md`.

---

## 9) dev-network-proxy-blocks-external  · type: reference  · ⚠️ DEV-ONLY (na serveru NEUKLÁDAT)

Na vývojovém PC (uživatel vokurcak68) šel shell přes firemní proxy `10.26.170.76:3128`,
která blokovala stahování z CDN. **To je vlastnost té konkrétní sítě, ne projektu.** Na
serveru ověř konektivitu samostatně; tuhle položku do serverové paměti neukládej.

---

## Bezpečnostní mantinely (platí všude — zachovat)

- **WhatsApp = jen odchozí notifikace personálu** (Jitsi odkaz). Žádné příchozí AI. Uživatel to výslovně zamítl kvůli nákladům.
- **`ANTHROPIC_API_KEY` = jen hlasový asistent v kiosku** (`/ai/chat`). Nepoužívat pro nic jiného.
- **Nikdy necommitovat secrets:** `.env`, `jaas-key.pem`/`*.pem`, `.wwebjs_auth/`.
- **Concierge (odchozí komunikace s hostem) odložen** (náklady + souhlas hosta).
