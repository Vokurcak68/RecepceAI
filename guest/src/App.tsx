import { useEffect, useState, type CSSProperties } from "react";
import "flag-icons/css/flag-icons.min.css";
import { makeT, detectLang, LANGS, type Lang } from "./i18n";

type Reservation = { code: string; propertyName: string; guestName: string; unit: string | null; checkInDate: string; checkOutDate: string; status: string; adults?: number; children?: number };
type Person = { fullName: string; dateOfBirth: string; nationality: string; documentType: string; documentNumber: string; homeAddress: string };
const emptyPerson = (): Person => ({ fullName: "", dateOfBirth: "", nationality: "Česká republika", documentType: "id_card", documentNumber: "", homeAddress: "" });
type Request = { id: string; type: string; status: string; description: string | null; createdAt: string };
type OnlineCheckin = { enabled: boolean; available: boolean; done: boolean; opensAt: string };
type Data = { reservation: Reservation; lang?: string | null; onlineCheckin: OnlineCheckin; canRequestAll: boolean; requests: Request[] };

const inputStyle: CSSProperties = { width: "100%", minWidth: 0, height: 44, padding: "0 12px", marginTop: 8, borderRadius: 8, border: "1px solid #cfd6dd", fontSize: 15, boxSizing: "border-box", fontFamily: "inherit", background: "#fff" };
const dateStyle: CSSProperties = { ...inputStyle, marginTop: 4, appearance: "none", WebkitAppearance: "none" };

const TYPES: { id: string; icon: string; key: string }[] = [
  { id: "cleaning", icon: "🧹", key: "tCleaning" },
  { id: "maintenance", icon: "🔧", key: "tMaintenance" },
  { id: "laundry", icon: "🧺", key: "tLaundry" },
  { id: "ironing", icon: "👔", key: "tIroning" },
  { id: "minibar", icon: "🥤", key: "tMinibar" },
  { id: "other", icon: "📌", key: "tOther" },
];
const ICON: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.id, t.icon]));
const TYPE_KEY: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.id, t.key]));
const STATUS_KEY: Record<string, string> = { open: "sOpen", in_progress: "sInProgress", done: "sDone", cancelled: "sCancelled" };
const d = (s: string) => s.slice(0, 10);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Chyba ${r.status}`);
  return r.json();
}

const CODE_KEY = "guest_code";
const LANG_KEY = "guest_lang";

export function App() {
  const [code, setCode] = useState(() => (new URLSearchParams(location.search).get("code") || localStorage.getItem(CODE_KEY) || "").toUpperCase());
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");
  const [desc, setDesc] = useState("");
  const [sent, setSent] = useState(false);
  const [persons, setPersons] = useState<Person[]>([emptyPerson()]);
  const [ciBusy, setCiBusy] = useState(false);
  const [ciErr, setCiErr] = useState("");

  const t = makeT(lang);
  const rateMode = new URLSearchParams(location.search).has("rate");

  const refresh = async (c: string) => {
    try { setData(await api<Data>(`/guest/${encodeURIComponent(c.trim())}`)); } catch { /* ponech současná data */ }
  };
  const load = async (c: string) => {
    const norm = c.trim().toUpperCase();
    setError(""); setBusy(true);
    try {
      const dt = await api<Data>(`/guest/${encodeURIComponent(norm)}`);
      setData(dt);
      localStorage.setItem(CODE_KEY, norm);
      // Výchozí jazyk dle hosta z rezervace, pokud si ho host ještě sám nezvolil.
      if (dt.lang && !localStorage.getItem(LANG_KEY)) setLang(dt.lang as Lang);
    } catch {
      setError(t("notFound")); setData(null); localStorage.removeItem(CODE_KEY);
    } finally { setBusy(false); }
  };
  useEffect(() => { if (code && !rateMode) load(code); }, []); // eslint-disable-line

  useEffect(() => {
    if (!data) return;
    const iv = setInterval(() => refresh(code), 15000);
    return () => clearInterval(iv);
  }, [data, code]); // eslint-disable-line

  // Změna jazyka: ulož lokálně i k hostovi (pro budoucí e-maily).
  const changeLang = (l: Lang) => {
    setLang(l); localStorage.setItem(LANG_KEY, l);
    if (data) api(`/guest/${encodeURIComponent(code.trim())}/language`, { method: "POST", body: JSON.stringify({ lang: l }) }).catch(() => {});
  };

  // Inicializace osob dle počtu na rezervaci (dospělí + děti), 1. = primární host.
  useEffect(() => {
    if (data?.onlineCheckin?.available && persons.length === 1 && !persons[0].fullName) {
      const total = Math.max(1, (data.reservation.adults ?? 1) + (data.reservation.children ?? 0));
      setPersons(Array.from({ length: total }, (_, i) => (i === 0 ? { ...emptyPerson(), fullName: data.reservation.guestName } : emptyPerson())));
    }
  }, [data]); // eslint-disable-line

  const updPerson = (i: number, patch: Partial<Person>) => setPersons((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const personsValid = persons.length > 0 && persons.every((p) => p.fullName.trim().length > 1 && !!p.dateOfBirth && !!p.nationality.trim());
  const submitCheckin = async () => {
    if (!personsValid) return;
    setCiBusy(true); setCiErr("");
    try {
      await api(`/guest/${encodeURIComponent(code.trim())}/checkin`, { method: "POST", body: JSON.stringify({ persons }) });
      await load(code);
    } catch (e) { setCiErr(e instanceof Error ? e.message : t("reqFail")); }
    finally { setCiBusy(false); }
  };

  const send = async () => {
    if (!picked) return;
    setBusy(true); setError("");
    try {
      await api(`/guest/${encodeURIComponent(code.trim())}/requests`, { method: "POST", body: JSON.stringify({ type: picked, description: desc || undefined }) });
      setPicked(""); setDesc(""); setSent(true); setTimeout(() => setSent(false), 2500);
      await load(code);
    } catch (e) { setError(e instanceof Error ? e.message : t("reqFail")); }
    finally { setBusy(false); }
  };

  const LangSwitch = () => (
    <div className="langs">
      {LANGS.map((l) => (
        <button key={l.code} className={`langbtn ${lang === l.code ? "on" : ""}`} title={l.label} onClick={() => changeLang(l.code)}>
          <span className={`fi fi-${l.cc}`} />
        </button>
      ))}
    </div>
  );

  if (rateMode && code) return <RatingApp code={code} />;

  if (!data) {
    return (
      <div className="wrap">
        <div className="card center">
          <LangSwitch />
          <div className="logo">🛎️</div>
          <h1>{t("appTitle")}</h1>
          <p className="muted">{t("loginHint")}</p>
          {error && <div className="error">{error}</div>}
          <input className="big-input" placeholder="RC-XXXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && load(code)} />
          <button className="btn block" disabled={busy || !code} onClick={() => load(code)}>{busy ? t("loading") : t("cont")}</button>
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
        <LangSwitch />
      </div>

      {oc?.done && (
        <div className="card"><div className="ok-msg" style={{ margin: 0 }}>{t("ocDone")}</div></div>
      )}

      {oc?.available && (
        <div className="card">
          <h2>{t("ocTitle")}</h2>
          <p className="muted">{t("ocHint")}</p>
          {persons.map((p, i) => (
            <div key={i} style={{ paddingTop: i ? 14 : 0, marginTop: i ? 14 : 0, borderTop: i ? "1px solid #e2e8f4" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b style={{ fontSize: 14 }}>{t("ocPerson")} {i + 1}{i === 0 ? "" : ""}</b>
                {i > 0 && <button className="linkx" style={{ color: "var(--danger)" }} onClick={() => setPersons((ps) => ps.filter((_, idx) => idx !== i))}>✕</button>}
              </div>
              <input style={inputStyle} placeholder={t("ocName")} value={p.fullName} onChange={(e) => updPerson(i, { fullName: e.target.value })} />
              <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>{t("ocDob")}</div>
              <input style={dateStyle} type="date" value={p.dateOfBirth} onChange={(e) => updPerson(i, { dateOfBirth: e.target.value })} />
              <input style={inputStyle} placeholder={t("ocNat")} value={p.nationality} onChange={(e) => updPerson(i, { nationality: e.target.value })} />
              <select style={inputStyle} value={p.documentType} onChange={(e) => updPerson(i, { documentType: e.target.value })}>
                <option value="id_card">{t("ocDocId")}</option>
                <option value="passport">{t("ocDocPassport")}</option>
              </select>
              <input style={inputStyle} placeholder={t("ocDocNum")} value={p.documentNumber} onChange={(e) => updPerson(i, { documentNumber: e.target.value })} />
              <input style={inputStyle} placeholder={t("ocAddress")} value={p.homeAddress} onChange={(e) => updPerson(i, { homeAddress: e.target.value })} />
            </div>
          ))}
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setPersons((ps) => [...ps, emptyPerson()])}>+ {t("ocPerson")}</button>
          {ciErr && <div className="error" style={{ marginTop: 12 }}>{ciErr}</div>}
          <button className="btn block" style={{ marginTop: 12 }} disabled={ciBusy || !personsValid} onClick={submitCheckin}>{ciBusy ? t("ocSending") : t("ocSubmit")}</button>
        </div>
      )}

      <div className="card">
        <h2>{t("reqTitle")}</h2>
        {!data.canRequestAll && <p className="muted">{t("reqNoteBefore")}</p>}
        <div className="types">
          {reqTypes.map((tp) => (
            <button key={tp.id} className={`type ${picked === tp.id ? "on" : ""}`} onClick={() => setPicked(tp.id)}>
              <span className="ico">{tp.icon}</span>{t(tp.key)}
            </button>
          ))}
        </div>
        <textarea className="desc" placeholder={t("reqDescPh")} value={desc} onChange={(e) => setDesc(e.target.value)} />
        {error && <div className="error">{error}</div>}
        {sent && <div className="ok-msg">{t("reqSent")}</div>}
        <button className="btn block" disabled={busy || !picked} onClick={send}>{t("reqSubmit")}</button>
      </div>

      <div className="card">
        <h2>{t("myTitle")}</h2>
        {data.requests.length === 0 ? <p className="muted">{t("myEmpty")}</p> : data.requests.map((q) => (
          <div key={q.id} className="req">
            <div className="req-l"><span className="ico">{ICON[q.type]}</span><div><b>{t(TYPE_KEY[q.type] ?? "tOther")}</b>{q.description && <div className="muted">{q.description}</div>}</div></div>
            <span className={`st st-${q.status}`}>{t(STATUS_KEY[q.status] ?? "sOpen")}</span>
          </div>
        ))}
      </div>

      <button className="btn ghost block" onClick={() => { setData(null); setCode(""); localStorage.removeItem(CODE_KEY); }}>{t("logout")}</button>
    </div>
  );
}

// ── Hodnocení pobytu (NPS) — samostatná stránka z odkazu v check-out e-mailu ──
type RateCtx = { propertyName: string; guestName: string; lang?: string | null; eligible: boolean; already: { nps: number; comment: string | null } | null };
function RatingApp({ code }: { code: string }) {
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const [ctx, setCtx] = useState<RateCtx | null>(null);
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const t = makeT(lang);

  useEffect(() => {
    api<RateCtx>(`/guest/${encodeURIComponent(code)}/feedback`)
      .then((c) => { setCtx(c); if (c.lang && !localStorage.getItem(LANG_KEY)) setLang(c.lang as Lang); if (c.already) { setNps(c.already.nps); setComment(c.already.comment ?? ""); } })
      .catch(() => setErr(t("notFound")));
  }, []); // eslint-disable-line

  const changeLang = (l: Lang) => { setLang(l); localStorage.setItem(LANG_KEY, l); };
  const submit = async () => {
    if (nps == null) return;
    setBusy(true); setErr("");
    try { await api(`/guest/${encodeURIComponent(code)}/feedback`, { method: "POST", body: JSON.stringify({ nps, comment: comment || undefined }) }); setDone(true); }
    catch (e) { setErr(e instanceof Error ? e.message : t("reqFail")); }
    finally { setBusy(false); }
  };

  const LangSwitch = () => (
    <div className="langs">
      {LANGS.map((l) => (
        <button key={l.code} className={`langbtn ${lang === l.code ? "on" : ""}`} title={l.label} onClick={() => changeLang(l.code)}>
          <span className={`fi fi-${l.cc}`} />
        </button>
      ))}
    </div>
  );

  const npsColor = (n: number) => (n <= 6 ? "#d65b4a" : n <= 8 ? "#d6a44a" : "#3a9d6a");

  return (
    <div className="wrap">
      <div className="card center">
        <LangSwitch />
        <div className="logo">🛎️</div>
        {ctx && <div className="muted" style={{ marginTop: -4 }}>{ctx.propertyName}</div>}
        {done || (ctx?.already && nps != null && !err) ? null : <h1 style={{ marginBottom: 4 }}>{t("rateTitle")}</h1>}
        {err && <div className="error">{err}</div>}

        {done ? (
          <div className="ok-msg" style={{ fontSize: 16, padding: "20px 12px" }}>{t("rateThanks")}</div>
        ) : !ctx ? (
          !err && <p className="muted">{t("loading")}</p>
        ) : !ctx.eligible ? (
          <p className="muted">{t("rateClosed")}</p>
        ) : (
          <>
            {ctx.already && <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{t("rateAlready")}</div>}
            <p className="muted" style={{ marginTop: 8 }}>{t("rateQ")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", margin: "10px 0 4px" }}>
              {Array.from({ length: 11 }, (_, n) => (
                <button key={n} onClick={() => setNps(n)}
                  style={{ width: 40, height: 44, borderRadius: 9, fontSize: 16, fontWeight: 700, cursor: "pointer",
                    border: nps === n ? `2px solid ${npsColor(n)}` : "1px solid #cfd6dd",
                    background: nps === n ? npsColor(n) : "#fff", color: nps === n ? "#fff" : "#243240" }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8a97a3", padding: "0 2px 6px" }}>
              <span>{t("rateLow")}</span><span>{t("rateHigh")}</span>
            </div>
            <textarea className="desc" placeholder={t("rateCommentPh")} value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="btn block" disabled={busy || nps == null} onClick={submit}>{busy ? t("rateSending") : t("rateSubmit")}</button>
          </>
        )}
      </div>
    </div>
  );
}
