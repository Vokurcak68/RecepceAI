// Seed multi-tenant systému: 3 provozovny (hotel, penzion, ubytovna),
// uživatelé s rolemi, inventář a pár testovacích rezervací.
import { PrismaClient, Prisma, PropertyType, InventoryUnit, UserRole, ReservationStatus, DocumentType } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}
function day(offset: number): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
}
const D = (n: number) => new Prisma.Decimal(n);

async function main() {
  // Čistý start (pořadí kvůli FK).
  await prisma.serviceRequest.deleteMany();
  await prisma.equipmentMove.deleteMany();
  await prisma.equipmentItem.deleteMany();
  await prisma.equipmentCategory.deleteMany();
  await prisma.registrationEntry.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.reservationGuest.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.ratePlan.deleteMany();
  await prisma.bed.deleteMany();
  await prisma.room.deleteMany();
  await prisma.guest.deleteMany();
  await prisma.roomType.deleteMany();
  await prisma.userProperty.deleteMany();
  await prisma.user.deleteMany();
  await prisma.property.deleteMany();

  // ── Provozovny ───────────────────────────────────────────
  const hotel = await prisma.property.create({
    data: {
      identifier: "HOTEL-PRAHA-01", name: "Hotel Praha", type: PropertyType.hotel, city: "Praha",
      inventoryUnit: InventoryUnit.room, cityTaxEnabled: true, cityTaxPerPersonNight: D(50), allowLongTerm: false, selfCheckin: false, breakfastIncluded: true,
      infoText: [
        "Wi-Fi: síť „HotelPraha-Host\", heslo „vitejte2024\" (bez uvozovek).",
        "Check-in od 14:00, check-out do 11:00. Recepce je v provozu nonstop.",
        "Snídaně formou bufetu 7:00–10:00 v restauraci v přízemí, pro hotelové hosty v ceně.",
        "Parkování v podzemní garáži 250 Kč/noc, nutná rezervace na recepci (omezená kapacita).",
        "Domácí mazlíčci po dohodě, poplatek 200 Kč/noc.",
        "Snídani lze zabalit s sebou (balíček), stačí říct den předem na recepci.",
        "V okolí: stanice metra A „Můstek\" 5 min pěšky, Staroměstské náměstí 10 min.",
      ].join("\n"),
    },
  });
  const penzion = await prisma.property.create({
    data: {
      identifier: "PENZION-SUMAVA-01", name: "Penzion Šumava", type: PropertyType.penzion, city: "Železná Ruda",
      inventoryUnit: InventoryUnit.room, cityTaxEnabled: true, cityTaxPerPersonNight: D(30), allowLongTerm: false, selfCheckin: true, breakfastIncluded: true,
      infoText: [
        "Wi-Fi: síť „Penzion-Sumava\", heslo „sumava123\".",
        "Samoobslužný check-in: kód od pokoje a vstupních dveří dostanete SMS v den příjezdu po 14:00. Check-out do 10:00, klíče/kód není třeba vracet.",
        "Snídaně 8:00–9:30 ve společné jídelně, v ceně. Při dřívějším odjezdu připravíme balíček.",
        "Parkování zdarma na vlastním pozemku před penzionem.",
        "Lyžařský areál Belveder 1,5 km, vlek Nad Nádražím 800 m. Sušárna a lyžárna v přízemí.",
        "Společná kuchyňka k dispozici 7:00–22:00. Prosíme o klid mezi 22:00 a 7:00.",
        "Domácí mazlíčci vítáni zdarma.",
      ].join("\n"),
    },
  });
  const ubytovna = await prisma.property.create({
    data: {
      identifier: "UBYTOVNA-BRNO-01", name: "Ubytovna Brno", type: PropertyType.ubytovna, city: "Brno",
      inventoryUnit: InventoryUnit.bed, cityTaxEnabled: false, cityTaxPerPersonNight: D(0), allowLongTerm: true, selfCheckin: true, breakfastIncluded: false,
      infoText: [
        "Wi-Fi: síť „Ubytovna-Brno\", heslo „brno2024\" (zdarma na všech pokojích).",
        "Ubytování po lůžkách ve sdílených 4lůžkových pokojích. Cena 300 Kč/noc, týdně 1 800 Kč, měsíčně 6 500 Kč.",
        "Samoobslužný check-in nonstop přes kódový zámek — kód obdržíte po úhradě. Check-out do 10:00.",
        "Sdílená kuchyňka a sociální zařízení na patře. Snídaně není v ceně, v okolí několik obchodů a bister.",
        "Pobytový poplatek se neúčtuje.",
        "Parkování zdarma na ulici před budovou. Tramvaj zastávka „Tržní\" 3 min pěšky, hlavní nádraží 10 min tramvají.",
        "Prádelna se sušičkou v suterénu (na žetony z automatu). Klid na pokojích po 22:00.",
      ].join("\n"),
    },
  });

  // ── Uživatelé ────────────────────────────────────────────
  await prisma.user.create({
    data: { email: "super@recepce.cz", name: "Centrální admin", role: UserRole.super_admin, passwordHash: hashPassword("heslo123") },
  });
  await prisma.user.create({
    data: {
      email: "hotel@recepce.cz", name: "Správce hotelu", role: UserRole.manager, passwordHash: hashPassword("heslo123"),
      properties: { create: [{ propertyId: hotel.id }] },
    },
  });
  await prisma.user.create({
    data: { email: "uklid@recepce.cz", name: "Jana (úklid)", role: UserRole.housekeeping, passwordHash: hashPassword("heslo123"), properties: { create: [{ propertyId: hotel.id }] } },
  });
  await prisma.user.create({
    data: { email: "udrzba@recepce.cz", name: "Petr (údržba)", role: UserRole.maintenance, passwordHash: hashPassword("heslo123"), properties: { create: [{ propertyId: hotel.id }] } },
  });

  // ── HOTEL: typy + pokoje ─────────────────────────────────
  const hSingle = await prisma.roomType.create({ data: { propertyId: hotel.id, name: "Jednolůžkový", capacityAdults: 1, basePrice: D(900), amenities: ["wifi", "TV"], photos: [] } });
  const hDouble = await prisma.roomType.create({ data: { propertyId: hotel.id, name: "Dvoulůžkový standard", capacityAdults: 2, capacityChildren: 1, basePrice: D(1400), amenities: ["wifi", "TV", "balkon", "minibar"], photos: [] } });
  const hFamily = await prisma.roomType.create({ data: { propertyId: hotel.id, name: "Rodinný apartmán", capacityAdults: 4, capacityChildren: 2, basePrice: D(2200), amenities: ["wifi", "TV", "kuchyňka"], photos: [] } });
  await prisma.room.createMany({ data: [
    { propertyId: hotel.id, roomTypeId: hSingle.id, number: "101", floor: 1, lockType: "smart_code" },
    { propertyId: hotel.id, roomTypeId: hSingle.id, number: "102", floor: 1, lockType: "smart_code" },
    { propertyId: hotel.id, roomTypeId: hDouble.id, number: "201", floor: 2, lockType: "physical_key" },
    { propertyId: hotel.id, roomTypeId: hDouble.id, number: "202", floor: 2, lockType: "physical_key" },
    { propertyId: hotel.id, roomTypeId: hDouble.id, number: "203", floor: 2, lockType: "physical_key" },
    { propertyId: hotel.id, roomTypeId: hFamily.id, number: "301", floor: 3, lockType: "smart_code" },
  ] });
  const room201 = await prisma.room.findFirstOrThrow({ where: { propertyId: hotel.id, number: "201" } });
  await prisma.ratePlan.create({ data: { roomTypeId: hDouble.id, date: day(2), price: D(1700) } });

  // Číselník kategorií vybavení.
  const catNames = ["Elektro", "Nábytek", "Ložní prádlo", "Vybavení koupelny", "Kuchyňské spotřebiče"];
  const cats: Record<string, string> = {};
  for (const name of catNames) cats[name] = (await prisma.equipmentCategory.create({ data: { name } })).id;

  // Ukázkové vybavení (pokoj / sklad provozovny / centrální sklad).
  await prisma.equipmentItem.createMany({ data: [
    { propertyId: hotel.id, roomId: room201.id, name: 'Televize Samsung 43"', code: "INV-000001", categoryId: cats["Elektro"], serialNumber: "TV-201", acquiredAt: new Date(Date.UTC(2024, 2, 15)), manufacturedAt: new Date(Date.UTC(2023, 10, 1)) },
    { propertyId: hotel.id, roomId: room201.id, name: "Minibar", code: "INV-000002", categoryId: cats["Kuchyňské spotřebiče"], acquiredAt: new Date(Date.UTC(2022, 5, 1)) },
    { propertyId: hotel.id, roomId: null, name: "Žehlička s prknem", code: "INV-000003", categoryId: cats["Elektro"] },
    { propertyId: null, roomId: null, name: "Náhradní matrace", code: "INV-000004", categoryId: cats["Nábytek"] },
  ] });

  // ── PENZION: typy + pokoje ───────────────────────────────
  const pDouble = await prisma.roomType.create({ data: { propertyId: penzion.id, name: "Pokoj 2 lůžka", capacityAdults: 2, capacityChildren: 2, basePrice: D(1100), amenities: ["wifi", "snídaně"], photos: [] } });
  await prisma.room.createMany({ data: [
    { propertyId: penzion.id, roomTypeId: pDouble.id, number: "1", floor: 1, lockType: "smart_code" },
    { propertyId: penzion.id, roomTypeId: pDouble.id, number: "2", floor: 1, lockType: "smart_code" },
    { propertyId: penzion.id, roomTypeId: pDouble.id, number: "3", floor: 2, lockType: "smart_code" },
  ] });

  // ── UBYTOVNA: typ lůžka + pokoje s lůžky ─────────────────
  const uBed = await prisma.roomType.create({
    data: { propertyId: ubytovna.id, name: "Lůžko ve 4lůžkovém pokoji", capacityAdults: 1, basePrice: D(300), weeklyPrice: D(1800), monthlyPrice: D(6500), amenities: ["wifi", "sdílená kuchyňka"], photos: [] },
  });
  for (const num of ["A1", "A2"]) {
    const room = await prisma.room.create({ data: { propertyId: ubytovna.id, roomTypeId: uBed.id, number: num, floor: 1, lockType: "smart_code" } });
    await prisma.bed.createMany({ data: [1, 2, 3, 4].map((i) => ({ propertyId: ubytovna.id, roomId: room.id, label: `${num}-${i}` })) });
  }

  // ── Hosté + demo rezervace (HOTEL) ───────────────────────
  const novak = await prisma.guest.create({ data: { firstName: "Jan", lastName: "Novák", email: "jan.novak@example.com", phone: "+420777123456", language: "cs" } });
  const smith = await prisma.guest.create({ data: { firstName: "John", lastName: "Smith", email: "john.smith@example.com", language: "en" } });

  const res1 = await prisma.reservation.create({
    data: {
      code: "RC-DEMO01", propertyId: hotel.id, primaryGuestId: novak.id, roomTypeId: hDouble.id,
      checkInDate: day(0), checkOutDate: day(2), nights: 2, adults: 2, status: ReservationStatus.confirmed, source: "manual",
      totalAmount: D(1400 + 1700 + 50 * 2 * 2), cityTax: D(50 * 2 * 2),
      reservationGuests: { create: { guestId: novak.id, isPrimary: true } },
    },
  });
  await prisma.payment.create({ data: { reservationId: res1.id, type: "deposit", amount: D(1000), method: "prepaid", status: "succeeded", description: "Záloha přes web" } });

  const res2 = await prisma.reservation.create({
    data: {
      code: "RC-DEMO02", propertyId: hotel.id, primaryGuestId: smith.id, roomTypeId: hDouble.id, roomId: room201.id,
      checkInDate: day(-1), checkOutDate: day(0), nights: 1, adults: 1, status: ReservationStatus.checked_in, source: "booking_com",
      totalAmount: D(1400 + 50), cityTax: D(50),
      reservationGuests: { create: { guestId: smith.id, isPrimary: true } },
    },
  });
  await prisma.payment.createMany({ data: [
    { reservationId: res2.id, type: "balance", amount: D(1400), method: "prepaid", status: "succeeded" },
    { reservationId: res2.id, type: "city_tax", amount: D(50), method: "prepaid", status: "succeeded" },
    { reservationId: res2.id, type: "extra", amount: D(120), method: "card_terminal", status: "succeeded", description: "Minibar" },
  ] });
  await prisma.registrationEntry.create({
    data: {
      reservationId: res2.id, guestId: smith.id, fullName: "John Smith", dateOfBirth: new Date(Date.UTC(1985, 3, 12)),
      nationality: "GB", documentType: DocumentType.passport, documentNumber: "GBR123456789", homeAddress: "10 Downing Street, London",
      stayFrom: day(-1), stayTo: day(0), retentionUntil: day(365 * 6),
    },
  });

  // Ukázkové servisní požadavky (host v pokoji 201).
  await prisma.serviceRequest.createMany({ data: [
    { propertyId: hotel.id, reservationId: res2.id, roomId: room201.id, type: "laundry", domain: "housekeeping", description: "Vyprat 2 košile", fromGuest: true },
    { propertyId: hotel.id, reservationId: res2.id, roomId: room201.id, type: "maintenance", domain: "maintenance", description: "Kape kohoutek v koupelně", fromGuest: true },
    { propertyId: hotel.id, reservationId: res2.id, roomId: room201.id, type: "minibar", domain: "housekeeping", description: "Doplnit vodu a colu", fromGuest: true },
  ] });

  console.log("✅ Seed hotov:");
  console.log("   Provozovny: HOTEL-PRAHA-01 (hotel), PENZION-SUMAVA-01 (penzion), UBYTOVNA-BRNO-01 (ubytovna/lůžka)");
  console.log("   Uživatelé: super@recepce.cz (super_admin), hotel@recepce.cz (manager hotelu) — heslo: heslo123");
  console.log("   Demo rezervace v hotelu: RC-DEMO01 (check-in), RC-DEMO02 (check-out)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
