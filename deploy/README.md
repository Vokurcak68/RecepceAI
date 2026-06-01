# deploy/ — produkční nasazení (Windows + IIS)

Pomocné soubory k runbooku [`../docs/SERVER-MIGRATION.md`](../docs/SERVER-MIGRATION.md).
Plný kontext, rozhodovací body a ověřování jsou tam — tohle je jen rychlé „spusť a hotovo".

| Soubor | K čemu |
|--------|--------|
| `web.config` | Šablona pro IIS weby: reverse proxy `/api` → node:4000 + SPA fallback. Kopíruje se do každé `dist`. |
| `install-service.ps1` | Backend Node API jako Windows služba přes NSSM (auto-start, restart, logy). |
| `build-frontends.ps1` | Build admin/kiosk/guest do `dist` (admin s `VITE_GUEST_URL`). |
| `setup-iis.ps1` | Založí 3 IIS weby na subdoménách + rozkopíruje `web.config`. |

## Pořadí (PowerShell jako správce)

```powershell
cd <ROOT>            # projektový kořen

# 0) předpoklady: Node 22, IIS, URL Rewrite, ARR(+Enable proxy), NSSM, (Chrome). Viz runbook §1.

# 1) čistá instalace závislostí
Get-ChildItem -Recurse -Directory -Filter node_modules | Remove-Item -Recurse -Force
npm install; npm install --prefix admin; npm install --prefix kiosk; npm install --prefix guest

# 2) databáze (.env s DATABASE_URL musí existovat) — viz runbook §3
npm run db:generate; npm run db:deploy   # ; npm run db:seed (jen demo data)

# 3) backend jako služba
.\deploy\install-service.ps1 -Nssm "C:\tools\nssm\nssm.exe"

# 4) build frontendů
.\deploy\build-frontends.ps1 -GuestUrl "https://host.tvojedomena.cz"

# 5) IIS weby + web.config
.\deploy\setup-iis.ps1 -KioskHost kiosk.tvojedomena.cz -AdminHost admin.tvojedomena.cz -GuestHost host.tvojedomena.cz

# 6) DNS A-záznamy + firewall 80/443 + HTTPS:
New-NetFirewallRule -DisplayName "HTTP 80"  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80
New-NetFirewallRule -DisplayName "HTTPS 443" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443
.\wacs.exe   # win-acme: vyber 3 weby → Let's Encrypt cert + auto-renew
```

## Aktualizace po `git pull`
```powershell
npm install                                   # když se měnily závislosti
npm run db:deploy                             # nové migrace
.\deploy\build-frontends.ps1 -GuestUrl "https://host.tvojedomena.cz"
.\deploy\setup-iis.ps1 -KioskHost kiosk.tvojedomena.cz -AdminHost admin.tvojedomena.cz -GuestHost host.tvojedomena.cz
.\deploy\install-service.ps1 -RestartOnly
```

> Tajné soubory (`.env`, `jaas-key.pem`, `.wwebjs_auth/`) nejsou v gitu — musí být na serveru ručně.
> Port 4000 ven neotevírat (běží jen za IIS proxy na localhostu).
