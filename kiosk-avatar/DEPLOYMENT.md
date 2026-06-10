# Nasazení kiosku (provozní příručka)

Praktický postup, jak rozjet hostovský kiosek na dotykovém PC. Pokrývá síť,
HTTPS certifikát, hlasy pro AI, fullscreen „neprůstřelný" režim a řešení potíží.

> Hodnoty v závorkách jsou z referenčního nasazení — `192.168.0.54` (server),
> proxy `10.26.170.76:3128`, provozovna `HOTEL-PRAHA-01`. Nahraď svými.

---

## 1. Architektura — co běží kde

| Role | Co tam běží | Pozn. |
|------|-------------|-------|
| **Server PC** | API (`:4000`) + kiosek dev server (`:5173`, HTTPS) + PostgreSQL | Může to být i stejné PC jako kiosek |
| **Kiosek PC** | jen prohlížeč (Edge/Chrome) na `https://SERVER:5173` | Tady musí být mikrofon, reproduktory a hlasové balíčky |

Kiosek volá API přes Vite proxy (`/api` → `:4000`), takže kioskové PC nepotřebuje
přímý přístup na `:4000` — stačí mu dosáhnout na `:5173`.

---

## 2. Server PC — spuštění

```powershell
# 1) závislosti (jednorázově)
npm install
npm install --prefix kiosk

# 2) .env (zkopíruj z .env.example a doplň)
#    DATABASE_URL, ANTHROPIC_API_KEY (pro AI recepční), STAFF_WHATSAPP…

# 3) databáze
npm run db:deploy
npm run db:seed        # jen pro demo data

# 4) spuštění
npm run dev            # API na :4000
npm run dev --prefix kiosk   # kiosek na https://localhost:5173
```

API i kiosek musí běžet trvale (viz autostart níže nebo služba).

### HTTPS certifikát (mikrofon vyžaduje zabezpečený kontext)

Kiosek běží přes HTTPS. Certifikát v `kiosk/certs/` musí mít v **SAN** IP serveru —
bez toho prohlížeč přístup přes IP odmítne. **Když se změní IP serveru**, přegeneruj
(openssl je součástí Gitu), viz `kiosk/certs/README.md`:

```powershell
& "C:\Program Files\Git\usr\bin\openssl.exe" req -x509 -newkey rsa:2048 -nodes `
  -keyout key.pem -out cert.pem -days 825 -subj "/CN=ReceptionAI Kiosk" `
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<NOVA_IP>"
```

Vite je na cert nasměrovaný v `kiosk/vite.config.ts` a poslouchá na všech
rozhraních (`server.host: true`).

---

## 3. Síťový přístup z kioskového PC

Pokud kiosek běží na **jiném PC** než server, projdi tyto vrstvy (typicky to vázne
na jedné z nich):

1. **Firewall na serveru** — povol příchozí TCP 5173 (PowerShell *jako správce*):
   ```powershell
   New-NetFirewallRule -DisplayName "ReceptionAI Kiosk 5173" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173
   ```
2. **Proxy v prohlížeči (firemní síť)** — když má kioskové PC systémovou proxy,
   přidej IP serveru do výjimek (jinak „Stránka nenalezena"):
   ```powershell
   $p='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'; Set-ItemProperty $p ProxyOverride ('192.168.0.*;'+(Get-ItemProperty $p).ProxyOverride)
   ```
   Pak restart prohlížeče.
3. **VPN routing** (když je kiosek vzdálený přes OpenVPN) — klient musí mít routu
   na LAN serveru; ověř `ping 192.168.0.54`. Když ping neprojde, řeší se to na
   OpenVPN serveru (push route + NAT), ne v kiosku.
4. **Certifikát** — při prvním otevření klikni *Pokročilé → Pokračovat*, nebo cert
   naimportuj mezi důvěryhodné kořeny:
   `Import-Certificate -FilePath cert.pem -CertStoreLocation Cert:\CurrentUser\Root`

**Diagnostika z kioskového PC:**
```powershell
Test-NetConnection 192.168.0.54 -Port 5173   # TcpTestSucceeded musí být True
```
`PingSucceeded=True` ale `TcpTestSucceeded=False` → chybí firewall pravidlo (krok 1).

---

## 4. Hlasy pro předčítání (TTS) — na kioskovém PC

AI odpovídá ve všech jazycích, ale **předčítání** používá hlasy nainstalované ve
Windows. Bez hlasu daného jazyka se text jen zobrazí (nepředčítá). Hlasy pro
**CS, EN, DE, RU, IT, FR, ES, ZH** bývají k dispozici; **PL a UK** se obvykle musí
doinstalovat.

**Nastavení → Čas a jazyk → Jazyk a oblast → Přidat jazyk** → vyber jazyk (např.
„Polski", „Українська") → zaškrtni **„Převod textu na řeč"** → Nainstalovat →
**restartovat PC**.

Ověření v prohlížeči (F12 → konzole):
```js
speechSynthesis.getVoices().filter(v => /^(pl|uk)/i.test(v.lang)).map(v => v.name + " — " + v.lang)
```
Měly by se vypsat hlasy (např. `Microsoft Paulina — pl-PL`). Restart prohlížeče je
po instalaci nutný.

---

## 5. Fullscreen „neprůstřelný" režim

Cíl: po zapnutí PC se sám spustí kiosek na celou obrazovku, nejde z něj uniknout
ani ho zmenšit.

### Doporučeno: Assigned Access (nativní režim kiosku, Windows 11 Pro)
Vyhrazený účet, automatické přihlášení, Edge v kiosk režimu na zadané URL,
auto-restart prohlížeče, blokuje Alt+Tab / Win / přístup na plochu.

1. **Nastavení → Účty → Ostatní uživatelé → Nastavit kiosk** (Assigned Access)
2. Vytvoř/zvol vyhrazený účet, vyber **Microsoft Edge** jako kiosk aplikaci
3. Režim: **„jako digitální cedule nebo interaktivní displej"**
4. URL: `https://192.168.0.54:5173/?property=HOTEL-PRAHA-01`
5. (Volitelně) restart prohlížeče po nečinnosti

> Účet se pak používá jen jako kiosek; na běžnou práci měj jiný účet.

### Lehčí varianta: prohlížeč v `--kiosk` + autostart
Naplánovaná úloha při přihlášení spustí:
```
msedge.exe --kiosk "https://192.168.0.54:5173/?property=HOTEL-PRAHA-01" --edge-kiosk-type=fullscreen --no-first-run
```
(jde z něj uniknout klávesami, pokud je navíc nezablokuješ).

---

## 6. Řešení potíží

| Příznak | Příčina / řešení |
|---------|------------------|
| „Stránka nenalezena" z kioskového PC | Proxy (krok 3.2) nebo firewall (3.1) |
| „Vaše připojení není soukromé" | Self-signed cert → *Pokročilé → Pokračovat*, nebo import certu |
| Připojí se lokálně, ne ze sítě | Vite `host: true` (je nastaveno) + firewall |
| Cert chyba „COMMON_NAME_INVALID" na IP | Cert nemá IP v SAN → přegeneruj (sekce 2) |
| AI nereaguje | Chybí/prázdný `ANTHROPIC_API_KEY` v `.env`, pak restart API |
| AI píše, ale nemluví | Chybí hlasový balíček jazyka (sekce 4) |
| Mikrofon nefunguje | Musí být HTTPS (je) + povolit mikrofon v prohlížeči (zámek v adresním řádku) |
| Avatar volá personál nefunguje | WhatsApp nepropojen — admin → Centrála → WhatsApp (QR) |

---

Viz též `README.md` (přehled projektu) a `kiosk/certs/README.md` (certifikát).
