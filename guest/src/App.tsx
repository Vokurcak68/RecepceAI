import { useEffect, useState, type CSSProperties } from "react";

type Reservation = { code: string; propertyName: string; guestName: string; unit: string | null; checkInDate: string; checkOutDate: string; status: string };
type Request = { id: string; type: string; status: string; description: string | null; createdAt: string };
type OnlineCheckin = { enabled: boolean; available: boolean; done: boolean; opensAt: string };
type Data = { reservation: Reservation; onlineCheckin: OnlineCheckin; canRequestAll: boolean; requests: Request[] };

const inputStyle: CSSProperties = { width: "100%", padding: "11px 12px", marginTop: 8, borderRadius: 8, border: "1px solid #cfd6dd", fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" };

const TYPES: { id: string; label: string; icon: string }[] = [
  { id: "cleaning", label: "Úklid", icon: "🧹" },
  { id: "maintenance", label: "Údržba", icon: "🔧" },
  { id: "laundry", label: "Praní", icon: "🧺" },
  { id: "ironing", label: "Žehlení", icon: "👔" },
  { id: "minibar", label: "Minibar", icon: "🥤" },
  { id: "other", label: "Jiné", icon: "📌" },
];
const LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));
const ICON: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.id, t.icon]));
const STATUS: Record<string, string> = { open: "přijato", in_progress: "řeší se", done: "hotovo", cancelled: "zrušeno" };
const d = (s: string) => s.slice(0, 10);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Chyba ${r.status}`);
  return r.json();
}

const CODE_KEY = "guest_code";

export function App() {
  const [code, setCode] = useState(() => (new URLSearchParams(location.search).get("code") || localStorage.getItem(CODE_KEY) || "").toUpperCase());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");
  const [desc, setDesc] = useState("");
  const [sent, setSent] = useState(false);
  const [ci, setCi] = useState({ fullName: "", dateOfBirth: "", nationality: "Česká republika", documentType: "id_card", documentNumber: "", homeAddress: "" });
  const [ciBusy, setCiBusy] = useState(false);
  const [ciErr, setCiErr] = useState("");

  // Tiché načtení (polling na pozadí) bez busy/error blikání a bez mazání dat při výpadku.
  const refresh = async (c: string) => {
    try { setData(await api<Data>(`/guest/${encodeURIComponent(c.trim())}`)); } catch { /* ponech současná data */ }
  };
  const load = async (c: string) => {
    const norm = c.trim().toUpperCase();
    setError(""); setBusy(true);
    try {
      setData(await api<Data>(`/guest/${encodeURIComponent(norm)}`));
      localStorage.setItem(CODE_KEY, norm); // zapamatuj kód → přežije ruční refresh
    } catch {
      setError("Rezervace nenalezena. Zkontrolujte kód.");
      setData(null);
      localStorage.removeItem(CODE_KEY); // neplatný/expirovaný kód neukládej
    } finally { setBusy(false); }
  };
  useEffect(() => { if (code) load(code); }, []); // eslint-disable-line

  // Periodická aktualizace „Moje požadavky" (stavy mění personál), jen když jsme přihlášení.
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => refresh(code), 15000);
    return () => clearInterval(t);
  }, [data, code]); // eslint-disable-line

  // Předvyplň jméno z rezervace, jakmile je online check-in dostupný.
  useEffect(() => {
    if (data?.onlineCheckin?.available && !ci.fullName) setCi((c) => ({ ...c, fullName: data.reservation.guestName }));
  }, [data]); // eslint-disable-line

  const ciValid = ci.fullName.trim().length > 1 && ci.dateOfBirth && ci.nationality.trim() && ci.documentNumber.trim() && ci.homeAddress.trim().length > 2;
  const submitCheckin = async () => {
    if (!ciValid) return;
    setCiBusy(true); setCiErr("");
    try {
      await api(`/guest/${encodeURIComponent(code.trim())}/checkin`, { method: "POST", body: JSON.stringify(ci) });
      await load(code);
    } catch (e) { setCiErr(e instanceof Error ? e.message : "Nepodařilo se odeslat."); }
    finally { setCiBusy(false); }
  };

  const send = async () => {
    if (!picked) return;
    setBusy(true); setError("");
    try {
      await api(`/guest/${encodeURIComponent(code.trim())}/requests`, { method: "POST", body: JSON.stringify({ type: picked, description: desc || undefined }) });
      setPicked(""); setDesc(""); setSent(true); setTimeout(() => setSent(false), 2500);
      await load(code);
    } catch (e) { setError(e instanceof Error ? e.message : "Nepodařilo se odeslat."); }
    finally { setBusy(false); }
  };

  if (!data) {
    return (
      <div className="wrap">
        <div className="card center">
          <div className="logo">🛎️</div>
          <h1>Požadavky hosta</h1>
          <p className="muted">Zadejte svůj rezervační kód (najdete ho v potvrzení nebo na pokoji).</p>
          {error && <div className="error">{error}</div>}
          <input className="big-input" placeholder="RC-XXXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && load(code)} />
          <button className="btn block" disabled={busy || !code} onClick={() => load(code)}>{busy ? "Načítám…" : "Pokračovat"}</button>
        </div>
      </div>
    );
  }

  const r = data.reservation;
  const oc = data.onlineCheckin;
  const reqTypes = data.canRequestAll ? TYPES : TYPES.filter((t) => t.id === "other");
  return (
    <div className="wrap">
      <div className="header">
        <div className="logo-sm">🛎️ {r.propertyName}</div>
        <div className="muted">{r.guestName}{r.unit ? ` · ${r.unit}` : ""} · {d(r.checkInDate)}–{d(r.checkOutDate)}</div>
      </div>

      {oc?.done && (
        <div className="card"><div className="ok-msg" style={{ margin: 0 }}>✓ Online check-in dokončen. Na recepci už jen vyzvednete klíč.</div></div>
      )}

      {oc?.available && (
        <div className="card">
          <h2>Online check-in</h2>
          <p className="muted">Vyplňte prosím údaje k ubytování — na recepci pak bude odbavení rychlejší.</p>
          <input style={inputStyle} placeholder="Jméno a příjmení" value={ci.fullName} onChange={(e) => setCi({ ...ci, fullName: e.target.value })} />
          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Datum narození</div>
          <input style={{ ...inputStyle, marginTop: 4 }} type="date" value={ci.dateOfBirth} onChange={(e) => setCi({ ...ci, dateOfBirth: e.target.value })} />
          <input style={inputStyle} placeholder="Státní příslušnost" value={ci.nationality} onChange={(e) => setCi({ ...ci, nationality: e.target.value })} />
          <select style={inputStyle} value={ci.documentType} onChange={(e) => setCi({ ...ci, documentType: e.target.value })}>
            <option value="id_card">Občanský průkaz</option>
            <option value="passport">Cestovní pas</option>
          </select>
          <input style={inputStyle} placeholder="Číslo dokladu" value={ci.documentNumber} onChange={(e) => setCi({ ...ci, documentNumber: e.target.value })} />
          <input style={inputStyle} placeholder="Adresa trvalého bydliště" value={ci.homeAddress} onChange={(e) => setCi({ ...ci, homeAddress: e.target.value })} />
          {ciErr && <div className="error">{ciErr}</div>}
          <button className="btn block" style={{ marginTop: 16 }} disabled={ciBusy || !ciValid} onClick={submitCheckin}>{ciBusy ? "Odesílám…" : "Dokončit check-in"}</button>
        </div>
      )}

      <div className="card">
        <h2>Nový požadavek</h2>
        {!data.canRequestAll && <p className="muted">Před příjezdem můžete poslat jen obecný požadavek či dotaz. Úklid, údržbu apod. zadáte po ubytování.</p>}
        <div className="types">
          {reqTypes.map((t) => (
            <button key={t.id} className={`type ${picked === t.id ? "on" : ""}`} onClick={() => setPicked(t.id)}>
              <span className="ico">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
        <textarea className="desc" placeholder="Upřesnění (nepovinné) — např. počet kusů, detail závady…" value={desc} onChange={(e) => setDesc(e.target.value)} />
        {error && <div className="error">{error}</div>}
        {sent && <div className="ok-msg">✓ Odesláno, personál se o to postará.</div>}
        <button className="btn block" disabled={busy || !picked} onClick={send}>Odeslat požadavek</button>
      </div>

      <div className="card">
        <h2>Moje požadavky</h2>
        {data.requests.length === 0 ? <p className="muted">Zatím žádné.</p> : data.requests.map((q) => (
          <div key={q.id} className="req">
            <div className="req-l"><span className="ico">{ICON[q.type]}</span><div><b>{LABEL[q.type]}</b>{q.description && <div className="muted">{q.description}</div>}</div></div>
            <span className={`st st-${q.status}`}>{STATUS[q.status] ?? q.status}</span>
          </div>
        ))}
      </div>

      <button className="btn ghost block" onClick={() => { setData(null); setCode(""); localStorage.removeItem(CODE_KEY); }}>Odhlásit</button>
    </div>
  );
}
