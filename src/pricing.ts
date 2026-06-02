// Výpočet ceny pobytu — závislý na typu/nastavení provozovny.
//  - Pobytový poplatek jen když property.cityTaxEnabled (a max 60 nocí, ČR).
//  - Dlouhodobé pobyty (property.allowLongTerm): týdenní/měsíční sazba.
//  - Cena je za jednotku (pokoj nebo lůžko) — to řeší dostupnost, ne cena.
import { Prisma, BillingCycle } from "@prisma/client";
import { prisma } from "./prisma";
import { eachNight, nightsBetween, toDateOnly } from "./dates";

const round2 = (d: Prisma.Decimal) => new Prisma.Decimal(d.toFixed(2));

export type StayPrice = {
  roomTotal: Prisma.Decimal;
  cityTax: Prisma.Decimal;
  total: Prisma.Decimal;
  billingCycle: BillingCycle;
};

export async function getStayPrice(
  roomTypeId: string,
  from: Date,
  to: Date,
  guests: number,
  childAges?: number[],
): Promise<StayPrice> {
  const roomType = await prisma.roomType.findUniqueOrThrow({
    where: { id: roomTypeId },
    include: { property: true },
  });
  const property = roomType.property;
  const nights = nightsBetween(from, to);
  const nightsList = eachNight(from, to);

  // Dlouhodobá sazba má přednost, pokud to provozovna umožňuje.
  let roomTotal: Prisma.Decimal;
  let billingCycle: BillingCycle = BillingCycle.per_stay;

  if (property.allowLongTerm && nights >= 28 && roomType.monthlyPrice) {
    roomTotal = round2(roomType.monthlyPrice.div(30).mul(nights));
    billingCycle = BillingCycle.monthly;
  } else if (property.allowLongTerm && nights >= 7 && roomType.weeklyPrice) {
    roomTotal = round2(roomType.weeklyPrice.div(7).mul(nights));
  } else {
    // Nočně: RatePlan na daný den, jinak basePrice.
    const ratePlans = await prisma.ratePlan.findMany({
      where: { roomTypeId, date: { in: nightsList.map(toDateOnly) } },
    });
    const byDay = new Map(ratePlans.map((r) => [toDateOnly(r.date).getTime(), r.price]));
    roomTotal = new Prisma.Decimal(0);
    for (const n of nightsList) roomTotal = roomTotal.add(byDay.get(n.getTime()) ?? roomType.basePrice);
  }

  // Pobytový poplatek — jen pokud zapnutý; ČR: max 60 po sobě jdoucích nocí.
  // Platí dospělí + děti s věkem >= cityTaxFreeAge (mladší jsou osvobozené).
  let cityTax = new Prisma.Decimal(0);
  if (property.cityTaxEnabled) {
    const taxableNights = Math.min(nights, 60);
    const payingChildren = (childAges ?? []).filter((a) => a >= property.cityTaxFreeAge).length;
    const payers = guests + payingChildren;
    cityTax = property.cityTaxPerPersonNight.mul(payers).mul(taxableNights);
  }

  return { roomTotal, cityTax, total: roomTotal.add(cityTax), billingCycle };
}
