// Přivolání člověka z kiosku — in-memory fronta čekajících hovorů.
//
// Když host na kiosku stiskne „Potřebuji člověka", vznikne tu záznam (vedle WhatsApp
// notifikace). Manažeři napříč všemi hotely ho vidí jako zvoneček v adminu a kdokoliv
// se může připojit k videohovoru (Jitsi joinUrl). Po odbavení (claim) záznam zmizí.
//
// Stav je v paměti procesu (jako WhatsApp session) — po restartu serveru se vyčistí,
// to je v pořádku: hovor je živá událost s krátkou platností.

export type PendingCall = {
  id: string;
  propertyId: string | null;
  propertyName: string;
  joinUrl: string;
  createdAt: number;       // epoch ms
  claimedBy: string | null;
  claimedByName: string | null;
};

const calls: PendingCall[] = [];
const TTL_MS = 10 * 60 * 1000; // hovor „vyprší" po 10 min
let seq = 0;

function prune() {
  const now = Date.now();
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.claimedBy || now - c.createdAt > TTL_MS) calls.splice(i, 1);
  }
}

export function addCall(input: { propertyId?: string | null; propertyName: string; joinUrl: string }): PendingCall {
  prune();
  // Deduplikace: stejná Jitsi místnost = stejný hovor (re-ring, dvojklik, StrictMode).
  const existing = calls.find((c) => !c.claimedBy && c.joinUrl === input.joinUrl);
  if (existing) return existing;
  const call: PendingCall = {
    id: `call-${Date.now()}-${seq++}`,
    propertyId: input.propertyId ?? null,
    propertyName: input.propertyName,
    joinUrl: input.joinUrl,
    createdAt: Date.now(),
    claimedBy: null,
    claimedByName: null,
  };
  calls.push(call);
  return call;
}

export function listPending(): PendingCall[] {
  prune();
  return calls.filter((c) => !c.claimedBy);
}

/** Odbavení hovoru — vrací false, pokud už neexistuje nebo si ho vzal někdo jiný. */
export function claimCall(id: string, userId: string, userName: string): { ok: boolean; alreadyClaimedBy?: string | null } {
  prune();
  const c = calls.find((x) => x.id === id);
  if (!c) return { ok: false };
  if (c.claimedBy) return { ok: false, alreadyClaimedBy: c.claimedByName };
  c.claimedBy = userId;
  c.claimedByName = userName;
  return { ok: true };
}

/** Vyřešení hovoru z kiosku (někdo se připojil / hovor skončil) → zvoneček zhasne. */
export function resolveCall(id: string): boolean {
  prune();
  const c = calls.find((x) => x.id === id);
  if (!c) return false;
  if (!c.claimedBy) { c.claimedBy = "kiosk"; c.claimedByName = "(vyřízeno z kiosku)"; }
  return true;
}
