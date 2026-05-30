// Pomocné funkce pro práci s daty pobytu.
// Pracujeme v "datech" (bez času) — příjezd/odjezd je celý den.

/** Normalizuje na půlnoc UTC, ať porovnání dnů nezávisí na čase/timezone. */
export function toDateOnly(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Počet nocí mezi příjezdem a odjezdem. */
export function nightsBetween(from: Date, to: Date): number {
  const ms = toDateOnly(to).getTime() - toDateOnly(from).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Vrátí pole jednotlivých nocí [from, to) jako data (jedna položka = jedna noc). */
export function eachNight(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = toDateOnly(from);
  const end = toDateOnly(to);
  while (cur < end) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Přičte k datu počet dní. */
export function addDays(d: Date, days: number): Date {
  const r = toDateOnly(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}
