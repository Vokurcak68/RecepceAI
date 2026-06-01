# Nasazení ReceptionAI na produkční server (Windows 11 + IIS + PostgreSQL)

> **Tento dokument je psaný pro Claude Code, který běží na cílovém serveru.**
> Claude: čti odshora, na **rozhodovacích bodech** (🟦 ROZHODNUTÍ) se zeptej uživatele,
> jinak postupuj a po každé fázi ověř kontrolním krokem. Příkazy jsou PowerShell
> (spouštěj `pwsh`), pokud není uvedeno jinak. „Projektový kořen" = složka, kam byl
> adresář zkopírován (dále `$ROOT`).

---

## 0. Cílová architektura (co kam patří)

```
                  Internet (venkovní DNS: *.tvojedomena.cz  →  veřejná IP serveru)
                                   │  443/80
                          ┌────────▼─────────┐
                          │       IIS        │   (TLS termination + statika + reverse proxy)
                          │  ARR + URLRewrite│
                          └───┬───────┬──────┘
       kiosk.tvojedomena.cz  │       │  admin.tvojedomena.cz / host.tvojedomena.cz
        (dist kiosku)        │       │   (dist admin / guest)
                             │       │
       všechny weby: /api/*  ▼       ▼  Rewrite  →  strip „/api"
                          ┌───────────────────┐
                          │  Node API :4000   │   (Windows služba přes NSSM, jen localhost)
                          │  Express+Prisma   │
                          └─────────┬─────────┘
                                    │ 5432
                          ┌─────────▼─────────┐
                          │  PostgreSQL       │   (už nainstalovaný na serveru)
                          └───────────────────┘
```

Klíčové fakty z kódu (neměň, jen využij):
- **Backend nemá `/api` prefix.** Routy jsou `/auth`, `/admin`, `/central`, `/calls`,
  `/call/*`, `/staff`, `/ai`, `/health`. Port `PORT` (výchozí **4000**).
- **Frontendy volají relativně `/api/...`**; ve vývoji Vite proxy `/api` odřízne a
  pošle na `:4000`. **V produkci musí IIS dělat totéž** (rewrite `^api/(.*)` →
  `http://localhost:4000/{R:1}`).
- **Call‑bell = polling** (`setInterval` 3–4 s) → žádné WebSockety, reverse proxy je triviální.
- Node běží přes `tsx` (skript `npm run start` = `tsx src/server.ts`) — není potřeba TS build backendu.
- Frontendy se **buildují staticky** (`npm run build` → `dist/`).

---

## 1. Předpoklady na serveru (ověř / doinstaluj)

```powershell
node -v        # musí být v22.x (projekt testován na 22.16). Když chybí/nižší → nainstaluj LTS 22 z https://nodejs.org (MSI)
npm -v
psql --version # PostgreSQL klient; ověř že služba běží:  Get-Service *postgres*
```

IIS s potřebnými moduly:
```powershell
# IIS + potřebné featury (PowerShell jako správce)
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, IIS-HttpRedirect, IIS-StaticContent -All
```
Dále nainstaluj (instalátory MSI, nejsou součástí Windows):
- **URL Rewrite Module 2.1** — https://www.iis.net/downloads/microsoft/url-rewrite
- **Application Request Routing (ARR) 3.0** — https://www.iis.net/downloads/microsoft/application-request-routing
- **NSSM** (běh Node jako služba) — https://nssm.cc/download (rozbal `nssm.exe` např. do `C:\tools\nssm\`)
- **Google Chrome** — jen pokud se bude používat WhatsApp notifikace (whatsapp-web.js spouští headless Chrome)

Po instalaci ARR zapni proxy na úrovni serveru:
- IIS Manager → uzel serveru → **Application Request Routing Cache** → *Server Proxy Settings* → ☑ **Enable proxy** → Apply.
  (Bez tohohle rewrite na absolutní `http://localhost:4000` nefunguje.)

**🟦 ROZHODNUTÍ 1 — doménová jména.** Zeptej se uživatele na hostnames (doporučená
3 subdomény, ať se nemusí měnit Vite `base`):
- kiosek: `kiosk.tvojedomena.cz`
- admin:  `admin.tvojedomena.cz`
- host (guest portál): `host.tvojedomena.cz`
Pokud chce vše na jedné doméně v podadresářích (`/admin`, `/host`), je potřeba navíc
nastavit `base` v každém `vite.config.ts` a rebuildnout — viz §8 Alternativy.

---

## 2. Soubory: co přenést a co ne

Adresář byl zkopírovaný z vývojového PC. **Smaž přenesené `node_modules` a buildy**
(mají nativní binárky vázané na původní stroj — Prisma engine, Chromium) a nainstaluj čistě:

```powershell
cd $ROOT
Get-ChildItem -Recurse -Directory -Filter node_modules | Remove-Item -Recurse -Force
Get-ChildItem -Recurse -Directory -Filter dist | Remove-Item -Recurse -Force
```

**Citlivé soubory, které NEjsou v gitu a MUSÍ na serveru existovat** (přišly s kopií
celého adresáře — ověř, že tu jsou; pokud ne, vyžádej je od uživatele):
- `.env` (v kořeni) — DATABASE_URL, ANTHROPIC_API_KEY, ADMIN_SECRET, JAAS_*, STAFF_WHATSAPP…
- `jaas-key.pem` — privátní klíč pro podpis JaaS JWT (pokud se používá videohovor bez limitu)
- `.wwebjs_auth/` — WhatsApp session (často ji bude nutné na novém stroji znovu spárovat QR kódem)

> ⚠️ Tyhle soubory **nikdy necommituj ani neposílej do chatu**. Jen ověř jejich existenci.

Nainstaluj závislosti (kořen + 3 frontendy):
```powershell
cd $ROOT
npm install
npm install --prefix admin
npm install --prefix kiosk
npm install --prefix guest
```

---

## 3. Databáze PostgreSQL

**🟦 ROZHODNUTÍ 2 — data.** Zeptej se: *Chce uživatel přenést i stávající data*
*(provozovny, rezervace, doklady, nastavení billingu), nebo začít načisto?*

### Varianta A — čistě (jen schéma + demo seed)
```powershell
# v .env nastav DATABASE_URL na lokální Postgres serveru, např.:
#   postgresql://receptionai:HESLO@localhost:5432/receptionai?schema=public
# 1) vytvoř DB + uživatele (uprav heslo):
psql -U postgres -c "CREATE USER receptionai WITH PASSWORD 'ZMEN_ME';"
psql -U postgres -c "CREATE DATABASE receptionai OWNER receptionai;"
# 2) schéma + Prisma client
cd $ROOT
npm run db:generate     # vygeneruje Prisma client pro tento stroj
npm run db:deploy       # aplikuje migrace (prisma migrate deploy) — žádné mazání dat
npm run db:seed         # JEN pokud chce demo data
```

### Varianta B — s přenosem dat z vývojového PC
Na **vývojovém PC** (zdroj) vyexportuj:
```powershell
# uprav jméno DB dle DATABASE_URL na zdroji (typicky receptionai)
& "$env:ProgramFiles\PostgreSQL\<verze>\bin\pg_dump.exe" -U postgres -Fc receptionai -f receptionai.dump
```
Přenes `receptionai.dump` na server (do `$ROOT`) a tam:
```powershell
psql -U postgres -c "CREATE USER receptionai WITH PASSWORD 'ZMEN_ME';"
psql -U postgres -c "CREATE DATABASE receptionai OWNER receptionai;"
& "$env:ProgramFiles\PostgreSQL\<verze>\bin\pg_restore.exe" -U postgres -d receptionai --no-owner receptionai.dump
cd $ROOT
npm run db:generate
npm run db:deploy        # doplní případné novější migrace nad importovaným schématem
```
Ověření:
```powershell
psql -U receptionai -d receptionai -c "SELECT name FROM \"Property\";"   # vypíše provozovny
```

---

## 4. Backend jako Windows služba (NSSM)

Node API musí běžet trvale a po restartu serveru (i bez přihlášeného uživatele).
Posloucháme **jen na localhostu** — ven ho pouští IIS přes proxy.

```powershell
# cesty uprav podle reálu
$nssm = "C:\tools\nssm\nssm.exe"
$node = (Get-Command node).Source
$tsx  = "$ROOT\node_modules\tsx\dist\cli.mjs"

& $nssm install ReceptionAI-API $node "$tsx src\server.ts"
& $nssm set ReceptionAI-API AppDirectory $ROOT
& $nssm set ReceptionAI-API AppStdout "$ROOT\logs\api.out.log"
& $nssm set ReceptionAI-API AppStderr "$ROOT\logs\api.err.log"
& $nssm set ReceptionAI-API Start SERVICE_AUTO_START
New-Item -ItemType Directory -Force "$ROOT\logs" | Out-Null
& $nssm start ReceptionAI-API
```
.env se načítá automaticky (Prisma/dotenv) z `$ROOT\.env`, protože `AppDirectory` = `$ROOT`.

Ověření backendu:
```powershell
Invoke-RestMethod http://localhost:4000/health    # → @{ ok = True }
Get-Content "$ROOT\logs\api.err.log" -Tail 20      # žádné fatální chyby
```
> Restart po změně `.env`: `& $nssm restart ReceptionAI-API` (tsx nehlídá změny .env).

**WhatsApp:** pokud `WHATSAPP_ENABLED` není `false`, služba se při startu pokusí
připojit k WhatsAppu a do logu vypíše QR (text). Na novém stroji bude nejspíš nutné
**znovu spárovat**: otevři `api.err/out.log`, naskenuj QR v mobilu (WhatsApp →
Propojená zařízení). Pokud WhatsApp zatím nechceš, dej do `.env` `WHATSAPP_ENABLED=false`
a restartuj službu.

---

## 5. Build frontendů

Guest URL se do admin buildu vkládá přes `VITE_GUEST_URL` (jinak ukazuje na localhost).
Dosadit reálnou doménu hosta z ROZHODNUTÍ 1:

```powershell
cd $ROOT
npm run build --prefix kiosk
npm run build --prefix guest
$env:VITE_GUEST_URL = "https://host.tvojedomena.cz"; npm run build --prefix admin
```
Výstupy: `admin\dist`, `kiosk\dist`, `guest\dist`.

> Pozn.: kiosek ve vývoji řešil HTTPS self‑signed certifikátem v `kiosk/certs`.
> V produkci HTTPS zajišťuje IIS (reálný cert), takže `kiosk/certs` se nepoužije a
> nevadí. Mikrofon v kiosku bude fungovat, protože poběží přes `https://` doménu.

---

## 6. IIS — 3 weby + reverse proxy + HTTPS

Pro každý frontend založ web mířící na jeho `dist` a se stejnou `web.config`
(viz níže). Příklad pro **kiosk**:

```powershell
Import-Module WebAdministration
New-WebSite -Name "ReceptionAI-Kiosk" -PhysicalPath "$ROOT\kiosk\dist" -HostHeader "kiosk.tvojedomena.cz" -Port 80
New-WebSite -Name "ReceptionAI-Admin" -PhysicalPath "$ROOT\admin\dist" -HostHeader "admin.tvojedomena.cz" -Port 80
New-WebSite -Name "ReceptionAI-Guest" -PhysicalPath "$ROOT\guest\dist" -HostHeader "host.tvojedomena.cz" -Port 80
```

Do **každé** dist složky vlož `web.config` (kiosk\dist, admin\dist, guest\dist).
Tenhle soubor dělá dvě věci: reverse proxy `/api` → node a SPA fallback na `index.html`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="api-proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://localhost:4000/{R:1}" />
        </rule>
        <rule name="spa-fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```
> ⚠️ `web.config` patří **do `dist`**, který se přepisuje při každém `npm run build`.
> Buď ho tam doplň po každém buildu, nebo ho ulož mimo a kopíruj skriptem. (Doporučení:
> drž šablonu v `deploy\web.config` a po buildu `Copy-Item deploy\web.config <app>\dist\`.)

### HTTPS certifikát (Let's Encrypt přes win-acme)
Venkovní DNS musí mít **A záznamy** pro všechny 3 hostnames → veřejná IP serveru,
a na firewallu/routeru přesměrované **80 + 443** na server.

```powershell
# stáhni win-acme (https://www.win-acme.com), rozbal a spusť:
.\wacs.exe
# → N (new cert) → vyber IIS bindings pro všechny 3 weby (nebo jeden SAN cert)
#   → HTTP-01 validace přes :80 → win-acme sám vytvoří HTTPS binding (443) a nastaví auto‑renew (scheduled task)
```
win-acme přidá 443 bindingy s certem. Volitelně přesměruj HTTP→HTTPS (IIS HttpRedirect
nebo rewrite rule).

Firewall serveru:
```powershell
New-NetFirewallRule -DisplayName "HTTP 80"  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80
New-NetFirewallRule -DisplayName "HTTPS 443" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443
# Port 4000 ZÁMĚRNĚ neotevírat — API je jen za proxy na localhostu.
```

---

## 7. Ověření celé sestavy (smoke test)

```powershell
# 1) API přímo (lokálně)
Invoke-RestMethod http://localhost:4000/health

# 2) Přes IIS proxy (z venku přes doménu)
Invoke-RestMethod https://admin.tvojedomena.cz/api/health    # musí vrátit ok=True (prošlo přes IIS→node)
```
Pak v prohlížeči:
- `https://admin.tvojedomena.cz` → přihlášení (uživatelé ze seedu: `hotel@recepce.cz` / `heslo123`,
  super `super@recepce.cz` / `heslo123` — pokud nešla varianta A se seedem; u varianty B platí původní hesla).
- `https://kiosk.tvojedomena.cz` → kiosek naběhne, mikrofon povolen (HTTPS doména).
- `https://host.tvojedomena.cz` → portál hosta.
- Otestuj **call‑bell**: v kiosku „Potřebuji člověka" → v adminu cinkne zvoneček (polling do pár s).

Kontrola po rebootu serveru: `Get-Service ReceptionAI-API` musí být *Running*; weby naběhnou samy (IIS).

---

## 8. Alternativy a poznámky

- **Jedna doména místo 3 subdomén:** nastav `base: "/admin/"` (resp. `/host/`) v
  `admin/vite.config.ts` a `guest/vite.config.ts`, kiosk nech na `/`, rebuild, a v IIS
  udělej jeden web s aplikacemi/podadresáři + stejné rewrite. Subdomény jsou ale méně práce.
- **pm2 místo NSSM:** `npm i -g pm2 pm2-windows-startup`, `pm2 start "npm run start" --name api`,
  `pm2 save`, `pm2-startup install`. NSSM je ale na Windows spolehlivější jako služba.
- **Build backendu (volitelné):** `npm run build` (tsc) vyprodukuje JS; pak by služba mohla
  běžet `node dist/server.js` místo tsx. Není nutné — tsx v produkci funguje a je jednodušší.
- **Aktualizace nasazení (po `git pull`):** `npm install` (když se měnily deps) →
  `npm run db:deploy` (nové migrace) → rebuild dotčených frontendů → `& $nssm restart ReceptionAI-API`.
- **Bezpečnostní mantinely (neměň bez vědomí uživatele):** WhatsApp = jen odchozí notifikace
  personálu (žádné příchozí AI). `ANTHROPIC_API_KEY` = jen hlasový asistent v kiosku.
  Tajné soubory (`.env`, `*.pem`, `.wwebjs_auth/`) nikdy necommituj.

---

## 8b. Hotové skripty (deploy/)

Místo ručního opisování příkazů můžeš použít připravené skripty — viz
[`../deploy/README.md`](../deploy/README.md):
- `deploy\install-service.ps1` — NSSM služba backendu (+ `-RestartOnly`)
- `deploy\build-frontends.ps1 -GuestUrl …` — build admin/kiosk/guest
- `deploy\setup-iis.ps1 -KioskHost … -AdminHost … -GuestHost …` — IIS weby + web.config
- `deploy\web.config` — šablona (reverse proxy + SPA fallback)

Rozhodovací body (domény, data) a ověřování v §1–§7 platí dál — skripty jen ušetří psaní.

---

## 9. Rychlý checklist pro Claude na serveru

1. [ ] Node 22, IIS, URL Rewrite, ARR (+Enable proxy), NSSM, (Chrome) nainstalováno
2. [ ] ROZHODNUTÍ 1: doménová jména potvrzena
3. [ ] node_modules/dist smazány, `npm install` ×4 hotovo
4. [ ] `.env` / `jaas-key.pem` ověřeny na místě
5. [ ] ROZHODNUTÍ 2: data (A čistě / B přenos) → DB vytvořena, `db:deploy` ok
6. [ ] NSSM služba `ReceptionAI-API` běží, `/health` ok
7. [ ] (WhatsApp) případně re-link QR, nebo `WHATSAPP_ENABLED=false`
8. [ ] frontendy zbuildovány (admin s `VITE_GUEST_URL`)
9. [ ] 3 IIS weby + `web.config` (proxy+SPA) v každém dist
10. [ ] DNS A‑záznamy + 80/443 na server; win-acme cert + auto‑renew
11. [ ] firewall 80/443 povolen, 4000 zavřený
12. [ ] smoke test §7 prošel (admin/kiosk/host + call‑bell + reboot)
```
