# ReceptionAI 🛎️

Multi-tenant hotelový recepční systém — centrální evidence + N provozoven (hotel / penzion / ubytovna) pod jedním identifikátorem. Typ provozovny mění chování (pokoj vs. lůžko, pobytový poplatek, dlouhodobé pobyty, samoobslužný check-in). Vše je scopované přes `propertyId`, uživatelé mají role (super_admin vidí vše, manager jen přiřazené provozovny).

Součástí je dotykový **kiosek pro hosty** s 3D avatarem, hlasovým ovládáním a **AI recepční** (Claude tool use), který umí ověřit dostupnost, založit rezervaci i odpovědět na praktické dotazy z znalostní báze provozovny.

## Architektura

Systém má čtyři části, každá se spouští zvlášť:

| Část | Adresář | Port | Popis |
|------|---------|------|-------|
| **API + jádro** | `src/` | **4000** | Express + Prisma + PostgreSQL |
| **Kiosek pro hosty** | `kiosk/` | **5173** | Dotykové UI, hlas (STT/TTS), 3D avatar, AI recepční. HTTPS (kvůli mikrofonu) |
| **Admin / centrála** | `admin/` | **5174** | Správa provozoven, rezervací, inventáře + portál personálu (úklid/údržba) |
| **Portál hosta** | `guest/` | **5175** | Mobilní web bez loginu, přístup přes rezervační kód; servisní požadavky |

Kiosek/admin/guest volají API přes Vite proxy (`/api` → `:4000`). Kiosek běží pod konkrétní provozovnou přes `?property=IDENTIFIER` (výchozí `HOTEL-PRAHA-01`).

## Technologie

- **Backend:** Node.js + TypeScript, Express, Prisma ORM, PostgreSQL, Zod, Anthropic SDK (Claude)
- **Frontend:** React + Vite + TypeScript
- **Další:** whatsapp-web.js (notifikace personálu), Jitsi (videohovor s recepčním)

## Předpoklady

- Node.js 20+
- PostgreSQL (lokálně nebo přes Docker)
- Volitelně: Anthropic API klíč (pro AI recepční), Chrome (pro WhatsApp notifikace)

```bash
# PostgreSQL přes Docker (volitelné)
docker run --name receptionai-db -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres
```

## Instalace a spuštění

### 1. Závislosti

```bash
npm install
npm install --prefix kiosk
npm install --prefix admin
npm install --prefix guest
```

### 2. Konfigurace prostředí

Zkopíruj `.env.example` → `.env` a doplň hodnoty:

```bash
cp .env.example .env
```

| Proměnná | Popis |
|----------|-------|
| `DATABASE_URL` | připojení k PostgreSQL |
| `ANTHROPIC_API_KEY` | klíč pro AI recepční (bez něj asistent neodpovídá) |
| `AI_MODEL` | volitelné, výchozí `claude-haiku-4-5` |
| `WHATSAPP_ENABLED` | `false` vypne připojení k WhatsAppu |
| `STAFF_WHATSAPP` | číslo personálu pro alert při volání z kiosku |

### 3. Databáze

```bash
npm run db:deploy   # aplikuje migrace (produkce); pro vývoj: npm run db:migrate
npm run db:seed     # naplní testovací data (3 provozovny, uživatelé, rezervace)
```

### 4. Spuštění

```bash
npm run dev                  # API na :4000
npm run dev --prefix kiosk   # kiosek na https://localhost:5173
npm run dev --prefix admin   # admin na :5174
npm run dev --prefix guest   # portál hosta na :5175
```

Kiosek otevři jako `https://localhost:5173/?property=HOTEL-PRAHA-01`.

## Testovací data (po seedu)

**Provozovny:** `HOTEL-PRAHA-01` (hotel), `PENZION-SUMAVA-01` (penzion), `UBYTOVNA-BRNO-01` (ubytovna/lůžka)

**Přihlášení do adminu** (heslo `heslo123`):

| E-mail | Role |
|--------|------|
| `super@recepce.cz` | super_admin (vidí vše) |
| `hotel@recepce.cz` | manager hotelu |
| `uklid@recepce.cz` | úklid (portál personálu) |
| `udrzba@recepce.cz` | údržba (portál personálu) |

**Demo rezervace v hotelu:** `RC-DEMO01` (připravená na check-in), `RC-DEMO02` (na check-out).

## AI recepční

`src/ai.ts` používá Anthropic SDK s tool-use smyčkou (nástroje `check_availability` / `book_room` / `find_reservation` volají skutečné funkce systému). Systémový prompt obsahuje znalostní bázi provozovny — fakta + volný text `Property.infoText` (editovatelný v adminu: Centrála → Provozovny → Upravit). Asistent odpovídá výhradně na témata dané provozovny. Endpoint `POST /ai/chat` (scopováno přes `x-property-id`).

## WhatsApp

`src/whatsapp.ts` (whatsapp-web.js, propojené zařízení) slouží **jen k odeslání** notifikace personálu, když host na kiosku zvolí „Potřebuji člověka" — pošle odkaz na Jitsi videohovor. QR propojení se dělá v adminu: Centrála → WhatsApp.

## Struktura projektu

```
src/          API + doménová logika (auth, availability, reservations, central, ai, whatsapp…)
prisma/       schema.prisma, migrace, seed.ts
kiosk/        React kiosek pro hosty
admin/        React admin + portál personálu
guest/        React portál hosta (mobil)
```

## Skripty (root)

| Příkaz | Akce |
|--------|------|
| `npm run dev` | API s hot-reloadem |
| `npm run build` | TypeScript build |
| `npm run db:migrate` | nová migrace (vývoj) |
| `npm run db:deploy` | aplikovat migrace (produkce) |
| `npm run db:seed` | testovací data |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | reset databáze |
