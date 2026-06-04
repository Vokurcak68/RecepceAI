// Načtení firmy z ARES (registr ekonomických subjektů) podle IČO + ověření DPH ve VIES.
// Veřejná REST API, bez klíče. Node 22 má globální fetch.

export type AresResult = {
  ico: string;
  name: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country: string;
  vatPayer: boolean; // dle VIES (nebo přítomnosti DIČ, když VIES nedostupné)
  viesValid: boolean | null; // true/false z VIES, null = neověřeno (DIČ chybí / VIES nedostupné)
  account: string | null; // první zveřejněný bankovní účet z registru plátců DPH (MFČR/ADIS)
  accounts: string[]; // všechny zveřejněné účty
  found: boolean;
};

const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");

/** Sestaví ulici z ARES adresy (název ulice + čísla, fallback na textovou adresu). */
function streetFromSidlo(s: Record<string, unknown> | undefined): string | null {
  if (!s) return null;
  const ulice = (s.nazevUlice as string) || (s.nazevCastiObce as string) || "";
  const cd = s.cisloDomovni != null ? String(s.cisloDomovni) : "";
  const co = s.cisloOrientacni != null ? `/${s.cisloOrientacni}${(s.cisloOrientacniPismeno as string) ?? ""}` : "";
  const built = `${ulice} ${cd}${co}`.trim();
  if (built) return built;
  const txt = s.textovaAdresa as string | undefined;
  return txt ? txt.split(",")[0].trim() : null;
}

/** Ověří DIČ ve VIES (EU). Vrací valid true/false, nebo null při chybě/nedostupnosti. */
export async function checkVies(dic: string | null | undefined): Promise<boolean | null> {
  if (!dic) return null;
  const m = dic.replace(/\s/g, "").match(/^([A-Z]{2})(.+)$/i);
  if (!m) return null;
  const countryCode = m[1].toUpperCase();
  const vatNumber = m[2];
  try {
    const ctrl = AbortSignal.timeout(7000);
    const r = await fetch("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryCode, vatNumber }), signal: ctrl,
    });
    if (!r.ok) return null;
    const j = await r.json() as { valid?: boolean };
    return typeof j.valid === "boolean" ? j.valid : null;
  } catch { return null; }
}

/** Zveřejněné bankovní účty plátce z registru DPH (MFČR/ADIS, SOAP). Vrací formátované účty. */
export async function adisAccounts(dic: string | null | undefined): Promise<string[]> {
  if (!dic) return [];
  const num = dic.replace(/\s/g, "").replace(/^CZ/i, "");
  if (!/^\d+$/.test(num)) return [];
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="http://adis.mfcr.cz/rozhraniCRPDPH/">
  <soapenv:Body><urn:StatusNespolehlivyPlatceRequest><urn:dic>${num}</urn:dic></urn:StatusNespolehlivyPlatceRequest></soapenv:Body>
</soapenv:Envelope>`;
  try {
    const r = await fetch("https://adisrws.mfcr.cz/adistc/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHPort", {
      method: "POST", headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: "" }, body: envelope, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const attr = (s: string, name: string) => s.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
    const accounts: string[] = [];
    for (const m of xml.matchAll(/<[^>]*standardniUcet\b([^>]*)\/?>/g)) {
      const a = m[1];
      const cislo = attr(a, "cislo"); const kod = attr(a, "kodBanky"); const pre = attr(a, "predcisli");
      if (cislo && kod) accounts.push(`${pre ? pre + "-" : ""}${cislo}/${kod}`);
    }
    for (const m of xml.matchAll(/<[^>]*nestandardniUcet\b([^>]*)\/?>/g)) {
      const iban = attr(m[1], "IBAN") || attr(m[1], "iban");
      if (iban) accounts.push(iban);
    }
    return [...new Set(accounts)];
  } catch { return []; }
}

/** Načte subjekt z ARES dle IČO a doplní ověření DPH z VIES. */
export async function lookupAres(icoRaw: string): Promise<AresResult> {
  const ico = onlyDigits(icoRaw).padStart(8, "0");
  if (ico.length !== 8) throw new Error("Neplatné IČO (očekává se 8 číslic).");

  const tag = (msg: string) => Object.assign(new Error(msg), { aresUserError: true });
  let data: Record<string, unknown> | null = null;
  try {
    const r = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404) throw tag("Firma s tímto IČO nebyla v ARES nalezena.");
    if (r.status === 400) throw tag("Neplatné IČO.");
    if (!r.ok) throw tag(`ARES vrátil chybu ${r.status}.`);
    data = await r.json() as Record<string, unknown>;
  } catch (e) {
    if (e && typeof e === "object" && (e as { aresUserError?: boolean }).aresUserError) throw e;
    throw new Error("ARES je momentálně nedostupný, zkus to prosím znovu nebo vyplň ručně.");
  }

  const sidlo = data.sidlo as Record<string, unknown> | undefined;
  const dic = (data.dic as string) || null;
  const [viesValid, accounts] = await Promise.all([checkVies(dic), adisAccounts(dic)]);
  return {
    account: accounts[0] ?? null,
    accounts,
    ico,
    name: (data.obchodniJmeno as string) || null,
    dic,
    street: streetFromSidlo(sidlo),
    city: (sidlo?.nazevObce as string) || null,
    zip: sidlo?.psc != null ? String(sidlo.psc).replace(/(\d{3})(\d{2})/, "$1 $2") : null,
    country: (sidlo?.kodStatu as string) || "CZ",
    // plátce DPH: primárně dle VIES; když VIES nedostupné, ber přítomnost DIČ jako indikaci
    vatPayer: viesValid === true || (viesValid === null && !!dic),
    viesValid,
    found: true,
  };
}
