// Prisma.Decimal a Date převést na JSON-friendly hodnoty.
// Peníze posíláme jako string (přesnost), data jako ISO "YYYY-MM-DD" nebo plné ISO.
import { Prisma } from "@prisma/client";

export function serialize<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out;
  }
  return value;
}
