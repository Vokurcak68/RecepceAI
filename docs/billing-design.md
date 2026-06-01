# Úhrady, doklady a pokladna — návrh

Spec pro přepracování plateb do plnohodnotného fakturačního a pokladního modulu.
Rozhodnutí zadavatele: **plátcovství DPH je přepínatelné per provozovna**,
**karty se jen evidují** (samostatný terminál, žádná integrace), staví se
**doklady i pokladna společně**. EET je zrušená (od 1. 1. 2023) — neřešíme.

> Stav: **IMPLEMENTOVÁNO** (2026-06-01). Hotovo: plátcovství DPH per provozovna,
> číselné řady, doklady (zálohová/daňový doklad k záloze/faktura/účtenka/dobropis)
> s DPH, úhrada dokladu (hotově/kartou) navázaná na pokladnu, pokladna (směny,
> příjem/výdej, denní uzávěrka, tržby kartou), check-out → účtenka (recepce i
> kiosek), hromadná faktura. Soubory: `src/billing.ts`, `src/cashregister.ts`,
> admin záložky Doklady/Pokladna/Úhrady.
> **Zbývá doladit:** odečet zálohy v konečné faktuře (advance settlement),
> periodická fakturace dlouhodobých (napojit na billing agenta), QR platba na
> proformě, export do účetnictví.

---

## 1. Typy dokladů a kdy se vystaví

| Typ (`DocumentType`) | Kdy | Plátce DPH | Neplátce |
|----------------------|-----|------------|----------|
| `proforma` — zálohová faktura | host platí zálohu předem | výzva k platbě (ne daňový) | výzva k platbě |
| `advance_tax` — daňový doklad k záloze | po přijetí zálohy | **ano**, do 15 dní | nevystavuje se |
| `invoice` — faktura / daňový doklad | po poskytnutí služby (check-out, konec periody) | konečná, zúčtuje zálohy, rozpis DPH | konečná faktura bez DPH |
| `receipt` — účtenka / doklad o zaplacení | platba na místě (do 10 000 Kč vč. DPH = zjednodušený daňový doklad) | s rozpisem DPH | potvrzení o úhradě |
| `credit_note` — opravný doklad (dobropis) | vratka / storno | mínusový daňový doklad | mínusové potvrzení |

**Pojmenování dle plátcovství** řeší příznak `vatPayer` na provozovně (snímek se
uloží na doklad). Sazby DPH (ubytování 12 %, služby/stravování dle druhu) se uloží
per řádek dokladu.

---

## 2. Životní cyklus

```
REZERVACE
  ├─ bez zálohy ............ nic; platí se na místě / po pobytu
  ├─ částečná záloha ....... proforma na část → po platbě (plátce) advance_tax
  └─ plná platba předem .... proforma 100%   → po platbě (plátce) advance_tax
        │
   POBYT — položky: ubytování, pobytový poplatek, služby, minibar, parkování…
        │
   CHECK-OUT → KONEČNÉ VYÚČTOVÁNÍ (invoice nebo receipt)
        ├─ součet položek − zaplacené zálohy = zůstatek
        ├─ zůstatek 0  → vystaví konečný doklad (zaplaceno)
        ├─ zůstatek >0 → doplatí (hotově/kartou) → receipt/PPD → konečný doklad
        └─ zůstatek >0 bez platby → invoice se splatností = POHLEDÁVKA
```

Doklad lze vystavit i **kdykoliv dříve/později** (platba předem i po skončení) a
**hromadně** za víc rezervací (firma, skupina).

---

## 3. Scénáře → co se stane

| Situace | Řešení |
|---------|--------|
| Částečná / plná / žádná záloha | proforma na zvolenou částku (i 0 = bez zálohy) |
| Doklad po check-outu se všemi úhradami | invoice zúčtuje všechny zálohy + položky pokoje |
| Doplatky služby / minibar | položky na rezervaci během pobytu → do vyúčtování |
| Check-out na kiosku, zůstatek = 0 | self-checkout vystaví `receipt`, pošle e-mailem/QR |
| Check-out na kiosku, zůstatek > 0 | doplatek kartou na kiosku (jen evidence) nebo přivolá recepci |
| Nemá zaplaceno | doplatí na místě, nebo `invoice` se splatností (pohledávka) |
| Dlouhodobý pobyt, periodická fakturace | `BillingCycle=monthly` → na konci periody `invoice` za období (lze cronem / billing agentem) |
| Platba dopředu i po skončení | dopředu = proforma/advance_tax; po = invoice/receipt |
| Hromadná faktura | jeden `invoice` s vazbou na víc rezervací |
| Vratka / storno | `credit_note` |

---

## 4. Pokladna (hotovost + karty)

- **`CashRegister`** — pokladna provozovny (může jich být víc: recepce, bar).
- **`CashRegisterSession`** — směna: otevření (počáteční hotovost) → pohyby →
  **uzávěrka** (spočítaná vs očekávaná hotovost, rozdíl, kdo zavřel).
- **`CashMovement`** — příjem/výdej (PPD/VPD), vazba na platbu/doklad.
- **Hotovost** vstupuje do šuplíku (mění stav pokladny). **Karta** se eviduje jako
  úhrada, ale do šuplíku nejde (vyúčtuje banka). Fakturou/převodem taky ne.
- **Denní uzávěrka**: tržby hotovost / karta / fakturou, počáteční a koncový stav.

---

## 5. Datový model (nové/změněné)

```prisma
// Property: + plátcovství DPH
vatPayer Boolean @default(false)

enum DocumentType { proforma advance_tax invoice receipt credit_note }
enum DocumentStatus { draft issued paid cancelled }

model Document {
  id String @id @default(uuid())
  property Property @relation(fields:[propertyId], references:[id])
  propertyId String
  type DocumentType
  number String @unique          // řada per typ/rok (FA-2026-0001, ZF-…, UCT-…, PPD-…)
  status DocumentStatus @default(issued)
  issuedAt DateTime @default(now())
  taxDate  DateTime?             // DUZP
  dueDate  DateTime?             // splatnost (proforma/invoice)
  // snímek dodavatele (neměnný v čase)
  supplierName String; supplierAddress String?; supplierIco String?; supplierDic String?
  vatPayer Boolean               // vystaveno jako plátce DPH?
  // odběratel
  customerName String; customerAddress String?; customerIco String?; customerDic String?
  subtotal Decimal @db.Decimal(10,2)
  vatTotal Decimal @db.Decimal(10,2) @default(0)
  total    Decimal @db.Decimal(10,2)
  paidTotal Decimal @db.Decimal(10,2) @default(0)
  note String?
  lines DocumentLine[]
  payments Payment[]             // platby přiřazené dokladu
  reservations DocumentReservation[]  // M:N (hromadná faktura)
  createdAt DateTime @default(now())
}

model DocumentLine {
  id String @id @default(uuid())
  document Document @relation(fields:[documentId], references:[id], onDelete: Cascade)
  documentId String
  label String
  qty Decimal @db.Decimal(10,2) @default(1)
  unitPrice Decimal @db.Decimal(10,2)
  vatRate Decimal @db.Decimal(5,2) @default(0)   // 0 / 12 / 21
  lineTotal Decimal @db.Decimal(10,2)
}

model DocumentReservation { documentId; reservationId; @@id([documentId, reservationId]) }

// číselné řady (atomický čítač per řada/rok)
model DocumentCounter { id; key String @unique; value Int @default(0) }  // key = "invoice-2026"

// pokladna
model CashRegister { id; property; propertyId; name; sessions CashRegisterSession[] }
model CashRegisterSession {
  id; register; registerId; openedAt; openedById; openingFloat Decimal
  closedAt DateTime?; closedById String?; countedCash Decimal?; note String?
  movements CashMovement[]
}
model CashMovement {
  id; session; sessionId; kind String     // income | expense
  amount Decimal; paymentId String?; documentId String?; note String?; createdAt
}

// Payment: + vazba na doklad a pokladní směnu
documentId String?     // ke kterému dokladu platba patří
cashSessionId String?  // přes kterou pokladní směnu (jen hotovost)
```

**Číslování:** atomický `DocumentCounter` (upsert + increment v transakci), formát
`<PREFIX>-<ROK>-<NNNN>` (FA faktura, ZF zálohová, DDZ daňový doklad k záloze,
UCT účtenka, OD opravný, PPD příjmový pokladní).

---

## 6. Fázování (doklady + pokladna společně)

1. **Schéma + migrace** — výše uvedené modely + `vatPayer`.
2. **Číselné řady** (`DocumentCounter`) + servis `issueDocument()`.
3. **Generátory dokladů** — proforma, advance_tax, invoice (zúčtování záloh),
   receipt, credit_note; výpočet DPH per řádek.
4. **Pokladna** — otevření směny, příjem/výdej, denní uzávěrka.
5. **Admin UI** — Doklady (seznam + vystavení + tisk), Pokladna (směna + uzávěrka),
   napojení v detailu rezervace a v záložce Úhrady.
6. **Check-out / kiosk** — vyúčtování při check-outu, self-checkout doklad,
   pohledávky.
7. **Periodická + hromadná fakturace** — dlouhodobí, firmy (napojení na billing
   agenta z `docs/ai-agents.md`).

---

## 7. Otevřené detaily k doladění
- Sazby DPH: ubytování 12 %, stravování 12 %, ostatní 21 % — potvrdit a nechat
  editovatelné.
- Zaokrouhlení hotovosti (na koruny) vs karta.
- Šablona/branding dokladu, QR platba (SPAYD) na proformě.
- Export do účetnictví (ISDOC/CSV) — později.
