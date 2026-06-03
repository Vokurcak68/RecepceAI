# ReceptionAI — podklad pro prezentační (marketingový) web

> Tento dokument je **zadání pro postavení prezentačního webu** produktu ReceptionAI.
> Je samostatný — kdo staví web, nemusí znát zdrojový kód aplikace. Web je
> **oddělený projekt** (vlastní repo), nesdílí kód s aplikací.

---

## 1. Co je ReceptionAI (elevator pitch)

**Chytrá cloudová recepce (PMS) pro hotely, penziony a ubytovny.** Samoobslužný
kiosek s AI asistentem a 3D avatarem, online check-in, správa rezervací a
obsazenosti, fakturace a pokladna, vícejazyčné e-maily hostům, CRM s hodnocením
a napojení na Airbnb/Booking. Multi-tenant — jedna instalace zvládne víc
provozoven s vlastními rolemi a daty.

**One-liner:** „Recepce, která nikdy nespí — samoobsluha, AI a kompletní správa
ubytování na jednom místě, v 11 jazycích."

---

## 2. Cílová skupina

- Malé a střední **hotely, penziony, ubytovny** (i vícepobočkové sítě — multi-tenant).
- Provozovatelé, kteří chtějí **odlehčit recepci** nebo provozovat **samoobsluhu / bez nočního personálu**.
- **Ubytovny** s dlouhodobými pobyty a **firemní fakturací**.
- Provozovny s **mezinárodní klientelou** (jazyková bariéra, evidence cizinců).

---

## 3. Problémy, které řeší (pain → řešení)

| Problém | Řešení v ReceptionAI |
|---|---|
| Drahá / nepřetržitá recepce | Samoobslužný **kiosek** + **online check-in** + self check-in |
| Přebookování | **Kalendář obsazení**, **plán pokojů (tape chart)**, hlídání volných jednotek, **import OTA kalendářů** |
| Jazyková bariéra | **11 jazyků** napříč kioskem, portálem hosta, e-maily i AI |
| Administrativa cizinců | **UBYPORT** export, evidenční kniha, GDPR retence |
| Ztráta vztahu se zákazníkem | **CRM**, **hodnocení (NPS)**, rozpoznání vracejících se hostů |
| Roztříštěné nástroje | Rezervace, fakturace, pokladna, úklid, údržba — **v jednom** |

---

## 4. Klíčové funkce (pro sekci „Funkce" — karty s ikonami)

- 🤖 **AI asistent na kiosku** — chat s rozumějícím asistentem, **3D avatar**, 11 jazyků, **videohovor na recepci** a zvonek pro přivolání personálu.
- 🛎️ **Samoobslužný check-in** — online z domova i na kiosku; všechny ubytované osoby, registrační údaje.
- 📅 **Kalendář obsazení + plán pokojů** — přehled obsazenosti, ochrana před přebookováním.
- 🔄 **Napojení na Airbnb/Booking (iCal)** — export obsazenosti i **import rezervací** s automatickou synchronizací.
- 💰 **Fakturace & pokladna** — doklady, číselné řady, DPH, folio, zálohové faktury a faktury za období, QR platby.
- ✉️ **Vícejazyčné e-maily hostům** — potvrzení / check-in / check-out / storno, s **brandingem provozovny**.
- ⭐ **CRM + hodnocení (NPS)** — profily hostů, preference, VIP, historie pobytů, žádost o hodnocení po pobytu.
- 🧹 **Dispečink úklidu a údržby** — fronty, požadavky hostů přímo z portálu.
- 🧠 **AI agenti** — noční audit a ranní briefing, návrhy cen, kontroly; rozhodují z dat, **nevratné kroky jen navrhují ke schválení**.
- 🏨 **Multi-tenant** — víc provozoven, role (správce/manažer/úklid/údržba), oddělená data.
- 👶 **Chytrý pobytový poplatek** — podle věku dětí, denní/týdenní/měsíční ceny.

---

## 5. Jak to funguje (sekce „Jak to funguje", 3–4 kroky)

1. **Host dorazí / rezervuje** — na kiosku nebo přes portál: vybere termín, vyplní údaje, udělá online check-in.
2. **AI a samoobsluha** — asistent poradí ve 11 jazycích, v případě potřeby přivolá personál nebo spustí videohovor.
3. **Recepce / manažer spravuje** — admin: obsazení, platby, doklady, úklid, údržba — vše na jednom místě.
4. **Po odjezdu** — host dostane e-mail s žádostí o hodnocení; data se ukládají do CRM pro příští návštěvu.

---

## 6. Tón a branding

- **Tón:** profesionální, důvěryhodný, moderní; „chytrá recepce bez fronty". Primárně **česky**, ale komunikuj, že produkt je vícejazyčný.
- **Vizuál:** čistý, prémiový, hotelový. Hodně vzduchu, kvalitní typografie.
- **Brand barvy** (převzato z aplikace — použij je i na webu):
  - tmavě modrá (primární): **`#1f2d3d`** / text **`#243240`**
  - zlatá / okrová (akcent, CTA): **`#c8a35b`**
  - světlé pozadí: **`#eef1f4`** / **`#f6f8fa`**
- **Brand prvek:** zvonek 🛎️.

---

## 7. Navrhovaná struktura webu

**Hlavní stránka (one-page s kotvami) + pár podstránek:**

1. **Hero** — claim, podtitulek, dvě CTA („Domluvit ukázku", „Vyzkoušet demo"), vizuál kiosku / 3D avatara.
2. **Problém → řešení** — 3 stručné body.
3. **Klíčové funkce** — grid karet s ikonami (viz §4).
4. **Jak to funguje** — 3–4 kroky (viz §5).
5. **Pro koho** — 3 segmenty: Hotely / Penziony / Ubytovny.
6. **AI asistent & samoobsluha** — výrazná highlight sekce (screenshot / animace avatara).
7. **Vícejazyčnost** — vlajky 11 jazyků (cs, en, de, ru, uk, pl, sk, it, fr, es, zh).
8. **Integrace** — Airbnb, Booking (iCal), e-mail (SMTP), WhatsApp.
9. **Ceník** — *placeholder, doplnit po schválení* (modely: za provozovnu / měsíčně).
10. **FAQ**.
11. **Reference / proč my**.
12. **Kontakt** — poptávkový formulář + patička.

**Volitelné podstránky:** Funkce detailně, Pro hotely / Pro ubytovny, O nás, GDPR / Zásady ochrany údajů.

---

## 8. Doporučený tech stack (statický marketing web)

- **Astro + Tailwind CSS** — rychlé, výborné SEO, snadný hosting (doporučeno pro čistě prezentační web). Alternativa: Next.js, pokud bude potřeba blog/CMS.
- **Hosting:** Netlify / Vercel / Cloudflare Pages (zdarma, deploy přímo z GitHubu) — sedí k „nové repo + remote session".
- **Formulář:** Netlify Forms / Formspree, nebo napojení na stávající SMTP.
- **SEO:** meta tagy, OG image, sitemap, rychlé načítání.
- **i18n:** web primárně CZ (případně EN mutace).

---

## 9. Co web NESMÍ obsahovat

- Žádné **secrets, API klíče, interní URL** (admin/kiosk endpointy), hesla.
- Žádné **screenshoty s reálnými daty hostů** (GDPR) — používej smyšlená demo data.
- **Ceník** zveřejnit jen po výslovném schválení majitele.

---

## 10. Necitlivá fakta

- Produkt běží na subdoménách `*.recepceai.cz` (kiosek / admin / portál hosta).
- Pro marketingový web zvol **samostatnou doménu** (např. `recepceai.cz` jako landing, nebo `www.`).
- Záběr funkcí: rezervace, kiosek+AI, online check-in, obsazenost, fakturace+pokladna, e-maily 11 jazyků, CRM+hodnocení, iCal, úklid/údržba, evidence cizinců.

---

## 11. První prompt pro novou / remote session (copy-paste)

> „Postav prezentační web pro produkt **ReceptionAI** podle `PREZENTACE-BRIEF.md`.
> Použij **Astro + Tailwind CSS**, brand barvy tmavě modrá `#1f2d3d` a zlatá `#c8a35b`.
> Začni strukturou z §7 — nejdřív hero sekce a grid funkcí, pak postupně další sekce.
> Statický web pro nasazení na Netlify/Vercel. Texty česky, tón profesionální a moderní.
> Žádná reálná data hostů ani secrets. Ceník nech jako placeholder."
