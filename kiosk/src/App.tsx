import { useEffect, useMemo, useRef, useState } from "react";
import { api, money, loadProperty, type Reservation, type Available, type Folio, type PropertyInfo, type ChatMsg } from "./api";
import { makeT, LANGS, type Lang } from "./i18n";
import { Avatar, useSpeech, stripMarkdown, AVATAR_VARIANTS, type AvatarVariant } from "./Avatar";
import { StaffCall } from "./StaffCall";
import { useRecognition, matchIntent, recognitionSupported } from "./speech";

// Telefonní číslo personálu pro „zazvonění" přes WhatsApp (mezinárodní formát bez +).
const STAFF_WHATSAPP = "420724239572";

// Zvolený styl avatara (galerie na #avatars ho uloží do localStorage).
const AVATAR: AvatarVariant =
  (localStorage.getItem("avatarVariant") as AvatarVariant) || "orb";

type Screen =
  | "idle" | "home" | "escalate" | "assistant"
  | "ci_identify" | "ci_pick" | "ci_confirm" | "ci_registration" | "ci_payment" | "ci_key"
  | "wi_search" | "wi_offer" | "wi_guest" | "wi_registration" | "wi_payment" | "wi_key"
  | "co_identify" | "co_pick" | "co_folio" | "co_done";

const todayISO = () => new Date().toISOString().slice(0, 10);
const plusDaysISO = (iso: string, d: number) => {
  const dt = new Date(iso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
};

export function App() {
  const [lang, setLang] = useState<Lang>("cs");
  const [screen, setScreen] = useState<Screen>("idle");
  const [line, setLine] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [call, setCall] = useState<string | null>(null);

  // flow data
  const [results, setResults] = useState<Reservation[]>([]);
  const [res, setRes] = useState<Reservation | null>(null);
  const [folio, setFolio] = useState<Folio | null>(null);

  // walk-in
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(plusDaysISO(todayISO(), 1));
  const [guests, setGuests] = useState(2);
  const [children, setChildren] = useState(0);
  const [childAges, setChildAges] = useState<number[]>([]);
  const setChildrenCount = (n: number) => { const c = Math.max(0, Math.min(6, n)); setChildren(c); setChildAges((prev) => Array.from({ length: c }, (_, i) => prev[i] ?? 8)); };
  const [offers, setOffers] = useState<Available[]>([]);
  const [picked, setPicked] = useState<Available | null>(null);

  // forms
  const [lookup, setLookup] = useState("");
  const [g, setG] = useState({ firstName: "", lastName: "", email: "", phone: "", dob: "" });
  const [reg, setReg] = useState({
    fullName: "", dob: "", nationality: "CZ",
    documentType: "id_card", documentNumber: "", homeAddress: "", gdpr: false,
  });

  const t = useMemo(() => makeT(lang), [lang]);
  const { speak, speaking } = useSpeech(lang);

  // Hlasové ovládání úvodního rozcestníku (poslech + vyhodnocení záměru).
  const recRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const { listening, start: startListen, stop: stopListen, supported: recSupported } = useRecognition(lang, (text) => {
    if (screen === "assistant") { sendChat(text); return; }
    const intent = matchIntent(text, lang);
    if (intent === "walkin") { setFrom(todayISO()); setTo(plusDaysISO(todayISO(), 1)); go("wi_search", "searchStayTitle"); }
    else if (intent === "reservation") go("ci_identify", "identifyTitle");
    else if (intent === "checkout") go("co_identify", "coIdentifyTitle");
    else if (intent === "human") startHumanCall();
    else { setHeard(text); openAssistant(text); } // nerozpoznaný záměr → předej AI asistentovi
  });
  recRef.current = { start: startListen, stop: stopListen };
  const [heard, setHeard] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatRef = useRef<ChatMsg[]>([]);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const setMsgs = (m: ChatMsg[]) => { chatRef.current = m; setChatMessages(m); };

  // Provozovna, pod kterou kiosek běží (z URL ?property=IDENTIFIER).
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [propErr, setPropErr] = useState("");
  const [showGallery] = useState(() => window.location.hash === "#avatars");

  useEffect(() => {
    if (showGallery) return;
    const id = new URLSearchParams(window.location.search).get("property");
    if (!id) { setPropErr("Není zadána provozovna. Otevři kiosek s parametrem ?property=IDENTIFIKATOR."); return; }
    loadProperty(id).then(setProperty).catch((e) => setPropErr(e instanceof Error ? e.message : String(e)));
  }, []); // eslint-disable-line

  // Na úvodním rozcestníku poslouchej (až avatar domluví, ať neslyší sám sebe).
  useEffect(() => {
    if (screen === "home" && recSupported && !speaking && !listening) {
      const id = setTimeout(() => startListen(), 400);
      return () => clearTimeout(id);
    }
    if (screen !== "home" && listening) stopListen();
  }, [screen, speaking]); // eslint-disable-line

  // Změna jazyka na úvodu → pozdrav znovu v novém jazyce (potvrdí i hlas).
  useEffect(() => {
    if (screen === "home") { setLine(t("welcome")); speak(t("welcome")); }
  }, [lang]); // eslint-disable-line

  useEffect(() => { chatBoxRef.current?.scrollTo({ top: chatBoxRef.current.scrollHeight }); }, [chatMessages, chatBusy]);

  // Po nečinnosti zpět na úvodní „Dotkněte se pro start" (mimo idle a probíhající hovor).
  // Časovač se resetuje při jakékoli interakci.
  useEffect(() => {
    if (screen === "idle" || call) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => idle(), 120000); };
    const evs: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    reset();
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(timer); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [screen, call]); // eslint-disable-line

  if (showGallery) return <AvatarGallery lang={lang} />;
  if (propErr) return (
    <div className="kiosk"><div className="content">
      <div className="screen-title">Kiosek není nastaven</div>
      <div className="error">{propErr}</div>
      <div className="muted">Zadej provozovnu v URL, např. <b>?property=HOTEL-PRAHA-01</b></div>
    </div></div>
  );
  if (!property) return <div className="kiosk"><div className="content"><div className="spinner">Načítám…</div></div></div>;

  /** Přechod na obrazovku + mluvená věta avatara. */
  function go(s: Screen, sayKey?: Parameters<typeof t>[0], extra?: string) {
    setError("");
    setScreen(s);
    const text = (sayKey ? t(sayKey) : "") + (extra ? " " + extra : "");
    setLine(text);
    if (text.trim()) speak(text);
  }

  function resetAll() {
    setResults([]); setRes(null); setFolio(null); setOffers([]); setPicked(null);
    setLookup(""); setError("");
    setG({ firstName: "", lastName: "", email: "", phone: "", dob: "" });
    setReg({ fullName: "", dob: "", nationality: "CZ", documentType: "id_card", documentNumber: "", homeAddress: "", gdpr: false });
  }

  // Probuzení z idle (dotyk na „Dotkněte se pro start") — uvítá i hlasem.
  function wake() { resetAll(); setScreen("home"); const w = t("welcome"); setLine(w); speak(w); }
  // Návrat na úvodní rozcestník (z podobrazovek) — uvítací větu zobrazí, ale UŽ NEPŘEDČÍTÁ.
  function home() { resetAll(); setScreen("home"); setLine(t("welcome")); }
  function startHumanCall() {
    const room = `recepce-${property?.identifier ?? "kiosek"}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
    setCall(room);
    speak(t("escalateTitle"));
  }
  function idle() { resetAll(); setScreen("idle"); setLine(""); }

  function openAssistant(initial?: string) {
    stopListen(); setMsgs([]); setChatInput("");
    go("assistant", "assistantTitle");
    if (initial && initial.trim()) sendChat(initial.trim());
  }
  async function sendChat(text: string) {
    const t0 = text.trim();
    if (!t0 || chatBusy) return;
    const next: ChatMsg[] = [...chatRef.current, { role: "user", content: t0 }];
    setMsgs(next); setChatInput(""); setChatBusy(true);
    try {
      const { reply } = await api.aiChat(next, lang);
      setMsgs([...next, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "chyba";
      setMsgs([...next, { role: "assistant", content: `Omlouvám se, asistent teď není dostupný. (${msg})` }]);
    } finally { setChatBusy(false); }
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError("");
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  // ── Check-in / check-out identifikace ──────────────────────
  async function doLookup(target: "ci" | "co") {
    const q = lookup.trim();
    if (!q) return;
    const list = await run(() =>
      /[-\s]/.test(q) || /^rc/i.test(q) ? api.lookupByCode(q) : api.lookupByLastName(q),
    );
    if (!list) return;
    if (list.length === 0) { setError(t("notFound")); return; }
    if (list.length === 1) {
      setRes(list[0]);
      target === "ci" ? enterConfirm(list[0]) : enterFolio(list[0]);
    } else {
      setResults(list);
      go(target === "ci" ? "ci_pick" : "co_pick", "pickReservation");
    }
  }

  function enterConfirm(r: Reservation) {
    setRes(r);
    const desc = `${r.roomType?.name ?? ""}, ${r.nights} ${t("nights")}, ${r.adults} ${t("guests")}.`;
    go("ci_confirm", "confirmTitle", desc);
    setReg((s) => ({ ...s, fullName: `${r.primaryGuest?.firstName ?? ""} ${r.primaryGuest?.lastName ?? ""}`.trim() }));
  }

  async function enterFolio(r: Reservation) {
    setRes(r);
    const f = await run(() => api.folio(r.id));
    if (!f) return;
    setFolio(f);
    go("co_folio", "coFolioTitle");
  }

  // ── Registrace (ohlašovací povinnost) ──────────────────────
  async function submitRegistration(next: Screen) {
    if (!res || !reg.gdpr || !reg.fullName || !reg.dob || !reg.documentNumber || !reg.homeAddress) {
      setError("Vyplňte prosím povinná pole a souhlas."); return;
    }
    const ok = await run(() =>
      api.registration(res.id, {
        guestId: res.primaryGuestId,
        fullName: reg.fullName,
        dateOfBirth: reg.dob,
        nationality: reg.nationality,
        documentType: reg.documentType,
        documentNumber: reg.documentNumber,
        homeAddress: reg.homeAddress,
        stayFrom: res.checkInDate.slice(0, 10),
        stayTo: res.checkOutDate.slice(0, 10),
      }),
    );
    if (ok === undefined) return;
    // načti folio pro platební krok
    const f = await run(() => api.folio(res.id));
    if (f) setFolio(f);
    go(next, "payTitle");
  }

  // ── Platby ─────────────────────────────────────────────────
  async function payAndCheckIn(isWalkIn: boolean) {
    if (!res || !folio) return;
    const bal = parseFloat(folio.balance);
    await run(async () => {
      if (bal > 0) {
        await api.payment(res.id, { type: "balance", amount: bal, method: "card_terminal" });
      }
      if (isWalkIn) await api.confirm(res.id);
      const updated = await api.checkin(res.id);
      setRes(updated);
    });
    go(isWalkIn ? "wi_key" : "ci_key", "keyTitle");
  }

  async function finishCheckout() {
    if (!res || !folio) return;
    const bal = parseFloat(folio.balance);
    const r = await run(async () => {
      if (bal > 0) await api.payment(res.id, { type: "balance", amount: bal, method: "card_terminal" });
      return api.checkout(res.id);
    });
    if (r === undefined) return;
    go("co_done", "thanksTitle");
  }

  // ── Walk-in ────────────────────────────────────────────────
  async function searchRooms() {
    const list = await run(() => api.availability(from, to, guests));
    if (!list) return;
    if (list.length === 0) { setError(t("noRooms")); return; }
    setOffers(list);
    go("wi_offer", "offerTitle");
  }

  async function createWalkIn() {
    if (!picked || !g.firstName || !g.lastName || (!g.email.trim() && !g.phone.trim())) { setError(t("fillContact")); return; }
    const r = await run(() =>
      api.walkin({
        roomTypeId: picked.roomTypeId, from, to, adults: guests, childAges,
        guest: { firstName: g.firstName, lastName: g.lastName, email: g.email || undefined, phone: g.phone || undefined, language: lang },
        dateOfBirth: g.dob || undefined,
      }),
    );
    if (!r) return;
    setRes(r);
    setReg((s) => ({ ...s, fullName: `${g.firstName} ${g.lastName}`.trim() }));
    go("wi_registration", "regTitle");
  }

  // greet on entering home

  // ─────────────────────────────────────────────────────────
  return (
    <div className="kiosk">
      {screen === "idle" ? (
        <div className="idle" onClick={wake}>
          <Avatar speaking={false} line="" variant={AVATAR} size={180} />
          <div className="screen-title">Recepce</div>
          <div className="pulse">{t("tapToStart")}</div>
        </div>
      ) : (
        <>
          <div className="topbar">
            <div className="brand">🛎️ {property.name}</div>
            <div className="lang-switch">
              {LANGS.map((l) => (
                <button key={l.code} className={lang === l.code ? "active" : ""} onClick={() => setLang(l.code)} title={l.label} aria-label={l.label}>
                  <span className={`fi fi-${l.cc}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Avatar je vždy na stejném místě (pod topbarem) na všech obrazovkách.
              Na hustém rozcestníku je menší, ať se vejdou všechna tlačítka. */}
          {/* Větu pod avatarem ukazujeme jen na úvodu — na ostatních obrazovkách
              by duplikovala jejich vlastní nadpis (avatar ji ale stále vysloví). */}
          <Avatar speaking={speaking} line={screen === "home" ? line : ""} variant={AVATAR} size={120} />

          <div className="content">
            {screen === "home" && (
              <div className="choices">
                {recSupported && (
                  <div className={`voice-bar ${listening ? "on" : ""}`} onClick={() => (listening ? stopListen() : startListen())}>
                    {listening ? t("voiceListening") : t("voiceTalk")}
                    <span className="voice-hint">{t("voiceHint")}</span>
                  </div>
                )}
                {heard && !listening && <div className="voice-heard">„{heard}"</div>}
                <button className="btn big" onClick={() => openAssistant()}>💬 {t("assistantOpen")}</button>
                <button className="btn big secondary" onClick={() => go("ci_identify", "identifyTitle")}>{t("haveReservation")}</button>
                <button className="btn big secondary" onClick={() => { setFrom(todayISO()); setTo(plusDaysISO(todayISO(), 1)); go("wi_search", "searchStayTitle"); }}>{t("walkIn")}</button>
                <button className="btn big secondary" onClick={() => go("co_identify", "coIdentifyTitle")}>{t("checkout")}</button>
              </div>
            )}

            {/* AI ASISTENT */}
            {screen === "assistant" && (
              <div className="assistant">
                <div className="screen-hint">{t("assistantHint")}</div>
                <div className="chat" ref={chatBoxRef}>
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`bubble ${m.role}`}>{m.role === "assistant" ? stripMarkdown(m.content) : m.content}</div>
                  ))}
                  {chatBusy && <div className="bubble assistant muted">{t("thinking")}</div>}
                </div>
                <div className="chat-input">
                  {recSupported && <button className={`mic ${listening ? "on" : ""}`} onClick={() => (listening ? stopListen() : startListen())}>🎙️</button>}
                  <input className="input" placeholder={t("assistantPlaceholder")} value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat(chatInput)} autoFocus />
                  <button className="btn" disabled={chatBusy || !chatInput.trim()} onClick={() => sendChat(chatInput)}>{t("send")}</button>
                </div>
              </div>
            )}

            {/* IDENTIFY (check-in / check-out) */}
            {(screen === "ci_identify" || screen === "co_identify") && (
              <>
                <div className="screen-title">{t(screen === "ci_identify" ? "identifyTitle" : "coIdentifyTitle")}</div>
                <div className="screen-hint">{t("identifyHint")}</div>
                <div className="field">
                  <input className="input" placeholder={`${t("code")} / ${t("lastName")}`} value={lookup}
                    onChange={(e) => setLookup(e.target.value)} autoFocus />
                </div>
                <button className="btn" disabled={busy} onClick={() => doLookup(screen === "ci_identify" ? "ci" : "co")}>{t("search")}</button>
              </>
            )}

            {/* PICK from multiple */}
            {(screen === "ci_pick" || screen === "co_pick") && (
              <>
                <div className="screen-title">{t("pickReservation")}</div>
                <div className="list">
                  {results.map((r) => (
                    <div key={r.id} className="card" onClick={() => (screen === "ci_pick" ? enterConfirm(r) : enterFolio(r))}>
                      <div className="kv"><span>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}</span>
                        <span className="v">{r.checkInDate.slice(0, 10)}</span></div>
                      <div className="muted">{r.roomType?.name} · {r.code}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* CONFIRM reservation */}
            {screen === "ci_confirm" && res && (
              <div className="card">
                <h2>{t("confirmTitle")}</h2>
                <div className="kv"><span>{res.primaryGuest?.firstName} {res.primaryGuest?.lastName}</span><span className="v">{res.code}</span></div>
                <div className="kv"><span>{res.roomType?.name}</span><span className="v">{res.checkInDate.slice(0, 10)} → {res.checkOutDate.slice(0, 10)}</span></div>
                <div className="kv"><span>{res.nights} {t("nights")} · {res.adults} {t("guests")}</span><span className="v">{money(res.totalAmount)}</span></div>
                <div className="row" style={{ marginTop: 20 }}>
                  <button className="btn secondary" onClick={startHumanCall}>{t("somethingWrong")}</button>
                  <button className="btn ok" onClick={() => go("ci_registration", "regTitle")}>{t("matches")}</button>
                </div>
              </div>
            )}

            {/* REGISTRATION (check-in / walk-in) */}
            {(screen === "ci_registration" || screen === "wi_registration") && (
              <>
                <div className="screen-title">{t("regTitle")}</div>
                <div className="screen-hint">{t("regHint")}</div>
                <div className="field">
                  <label>{t("fullName")}</label>
                  <input className="input" value={reg.fullName} onChange={(e) => setReg({ ...reg, fullName: e.target.value })} />
                  <div className="row">
                    <div><label>{t("dob")}</label><input type="date" className="input" value={reg.dob} onChange={(e) => setReg({ ...reg, dob: e.target.value })} /></div>
                    <div><label>{t("nationality")}</label><input className="input" value={reg.nationality} onChange={(e) => setReg({ ...reg, nationality: e.target.value })} /></div>
                  </div>
                  <div className="row">
                    <div><label>{t("docType")}</label>
                      <select className="select" value={reg.documentType} onChange={(e) => setReg({ ...reg, documentType: e.target.value })}>
                        <option value="id_card">{t("idCard")}</option>
                        <option value="passport">{t("passport")}</option>
                      </select>
                    </div>
                    <div><label>{t("docNumber")}</label><input className="input" value={reg.documentNumber} onChange={(e) => setReg({ ...reg, documentNumber: e.target.value })} /></div>
                  </div>
                  <label>{t("address")}</label>
                  <input className="input" value={reg.homeAddress} onChange={(e) => setReg({ ...reg, homeAddress: e.target.value })} />
                  <label style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, fontSize: 17 }}>
                    <input type="checkbox" style={{ width: 26, height: 26 }} checked={reg.gdpr} onChange={(e) => setReg({ ...reg, gdpr: e.target.checked })} />
                    {t("gdpr")}
                  </label>
                </div>
                <button className="btn" disabled={busy} onClick={() => submitRegistration(screen === "ci_registration" ? "ci_payment" : "wi_payment")}>{t("continue")}</button>
              </>
            )}

            {/* PAYMENT (check-in / walk-in) */}
            {(screen === "ci_payment" || screen === "wi_payment") && folio && (
              <div className="card">
                <h2>{t("payTitle")}</h2>
                <div className="kv"><span>{t("charges")}</span><span className="v">{money(folio.charges)}</span></div>
                <div className="kv"><span>{t("alreadyPaid")}</span><span className="v">{money(folio.paid)}</span></div>
                {parseFloat(folio.balance) > 0 ? (
                  <>
                    <div className="big-amount" style={{ margin: "18px 0" }}>{t("toPay")}: {money(folio.balance)}</div>
                    <div className="screen-hint">{busy ? t("paying") : t("tapCard")}</div>
                    <button className="btn ok big" disabled={busy} onClick={() => payAndCheckIn(screen === "wi_payment")}>💳 {t("simulatePay")}</button>
                  </>
                ) : (
                  <>
                    <div className="big-amount" style={{ margin: "18px 0" }}>{t("nothingToPay")}</div>
                    <button className="btn ok big" disabled={busy} onClick={() => payAndCheckIn(screen === "wi_payment")}>{t("continue")}</button>
                  </>
                )}
              </div>
            )}

            {/* KEY (check-in / walk-in) */}
            {(screen === "ci_key" || screen === "wi_key") && res && (
              <div className="card" style={{ textAlign: "center" }}>
                <h2>{t("keyTitle")}</h2>
                <div className="muted">{t("yourRoom")}</div>
                <div className="room-num">{res.room?.number ?? "—"}</div>
                <div className="muted" style={{ marginBottom: 16 }}>{res.room?.floor}. {t("floor")}</div>
                {res.room?.lockType === "smart_code" ? (
                  <div className="kv"><span>{t("doorCode")}</span><span className="v">4 7 2 9</span></div>
                ) : (
                  <div className="kv"><span>🔑</span><span className="v">{property.kioskKeyInfo || t("takeKey")}</span></div>
                )}
                <div className="kv"><span>{t("wifi")}</span><span className="v">{property.kioskWifi || "PenzionWifi / vitejte"}</span></div>
                <button className="btn big" style={{ marginTop: 20 }} onClick={idle}>{t("enjoy")}</button>
              </div>
            )}

            {/* WALK-IN search */}
            {screen === "wi_search" && (
              <>
                <div className="screen-title">{t("searchStayTitle")}</div>
                <div className="row">
                  <DatePicker label={t("arrival")} value={from} min={todayISO()} lang={lang} onChange={(v) => { setFrom(v); if (to <= v) setTo(plusDaysISO(v, 1)); }} />
                  <DatePicker label={t("departure")} value={to} min={plusDaysISO(from, 1)} lang={lang} onChange={setTo} />
                </div>
                <div>
                  <div className="muted" style={{ textAlign: "center", marginBottom: 10 }}>{t("numGuests")}</div>
                  <div className="stepper">
                    <button onClick={() => setGuests((n) => Math.max(1, n - 1))}>−</button>
                    <span className="val">{guests}</span>
                    <button onClick={() => setGuests((n) => Math.min(8, n + 1))}>+</button>
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ textAlign: "center", margin: "14px 0 10px" }}>{t("numChildren")}</div>
                  <div className="stepper">
                    <button onClick={() => setChildrenCount(children - 1)}>−</button>
                    <span className="val">{children}</span>
                    <button onClick={() => setChildrenCount(children + 1)}>+</button>
                  </div>
                  {children > 0 && (
                    <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 12 }}>
                      {childAges.map((age, i) => (
                        <div key={i}><label className="muted" style={{ display: "block", marginBottom: 8 }}>{t("childAge")} {i + 1}</label><input type="number" min={0} max={17} className="input" style={{ width: 96 }} value={age} onChange={(e) => { const a = [...childAges]; a[i] = Math.max(0, Number(e.target.value) || 0); setChildAges(a); }} /></div>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn" disabled={busy} onClick={searchRooms}>{t("findRooms")}</button>
              </>
            )}

            {/* WALK-IN offers */}
            {screen === "wi_offer" && (
              <>
                <div className="screen-title">{t("offerTitle")}</div>
                <div className="list">
                  {offers.map((o) => (
                    <div key={o.roomTypeId} className="card" onClick={() => { setPicked(o); go("wi_guest", "guestTitle"); }}>
                      <div className="kv"><span style={{ fontSize: 23, fontWeight: 700 }}>{o.name}</span><span className="v">{money(o.total)}</span></div>
                      <div className="muted">{o.description}</div>
                      <div style={{ marginTop: 8 }}>{o.amenities.map((a) => <span key={a} className="chip">{a}</span>)}</div>
                      <div className="muted" style={{ marginTop: 8 }}>
                        {o.freeUnits} {t("free")} {o.unit === "bed" ? "lůžek" : "pokojů"}
                        {parseFloat(o.cityTax) > 0 && <> · {money(o.cityTax)} {t("charges").toLowerCase()}</>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* WALK-IN guest */}
            {screen === "wi_guest" && (
              <>
                <div className="screen-title">{t("guestTitle")}</div>
                <div className="field">
                  <div className="row">
                    <div><label>{t("firstName")}</label><input className="input" value={g.firstName} onChange={(e) => setG({ ...g, firstName: e.target.value })} /></div>
                    <div><label>{t("lastName")}</label><input className="input" value={g.lastName} onChange={(e) => setG({ ...g, lastName: e.target.value })} /></div>
                  </div>
                  <label>{t("email")}</label>
                  <input className="input" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} />
                  <label>{t("phone")}</label>
                  <input className="input" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} />
                  <div className="muted" style={{ marginTop: 6 }}>{t("contactHint")}</div>
                  <label style={{ marginTop: 10 }}>{t("dobOptional")}</label>
                  <input className="input" type="date" value={g.dob} onChange={(e) => setG({ ...g, dob: e.target.value })} />
                  <div className="muted" style={{ marginTop: 4 }}>{t("dobHint")}</div>
                </div>
                <button className="btn" disabled={busy} onClick={createWalkIn}>{t("continue")}</button>
              </>
            )}

            {/* CHECK-OUT folio */}
            {screen === "co_folio" && res && folio && (
              <div className="card">
                <h2>{t("coFolioTitle")}</h2>
                <div className="muted" style={{ marginBottom: 10 }}>{res.primaryGuest?.firstName} {res.primaryGuest?.lastName} · {t("room")} {res.room?.number}</div>
                <div className="kv"><span>{t("charges")}</span><span className="v">{money(folio.charges)}</span></div>
                <div className="kv"><span>{t("paid")}</span><span className="v">{money(folio.paid)}</span></div>
                {parseFloat(folio.balance) > 0 && <div className="kv"><span>{t("balance")}</span><span className="v" style={{ color: "var(--accent2)" }}>{money(folio.balance)}</span></div>}
                {parseFloat(folio.balance) < 0 && <div className="kv"><span>{t("refund")}</span><span className="v">{money(Math.abs(parseFloat(folio.balance)))}</span></div>}
                <button className="btn ok big" style={{ marginTop: 18 }} disabled={busy} onClick={finishCheckout}>
                  {parseFloat(folio.balance) > 0 ? `💳 ${t("toPay")} ${money(folio.balance)}` : t("finishCheckout")}
                </button>
              </div>
            )}

            {/* CHECK-OUT done */}
            {screen === "co_done" && (
              <div className="card" style={{ textAlign: "center" }}>
                <h2>{t("thanksTitle")}</h2>
                <div className="muted" style={{ margin: "10px 0 20px" }}>{t("reviewHint")}</div>
                <div className="qr-box">QR → Google recenze</div>
                <button className="btn big" style={{ marginTop: 24 }} onClick={idle}>{t("done")}</button>
              </div>
            )}


            {error && <div className="error">⚠️ {error}</div>}
            {busy && <div className="spinner">…</div>}
          </div>

          <div className="footer">
            <button className="btn ghost" onClick={() => (screen === "home" ? idle() : home())}>← {t("back")}</button>
            <button className="btn ghost" onClick={startHumanCall}>🙋 {t("needHuman")}</button>
          </div>
        </>
      )}

      {/* Přivolání člověka — zvonění + okno v rohu, kiosek zůstává ovladatelný. */}
      {call && <StaffCall room={call} propertyName={property?.name ?? ""} whatsapp={STAFF_WHATSAPP} onClose={() => setCall(null)} />}
    </div>
  );
}

// ── Velký dotykový výběr data (nativní kalendář je na kiosku moc malý) ──
const dpISO = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function DatePicker({ value, onChange, min, lang, label }: { value: string; onChange: (v: string) => void; min?: string; lang: string; label: string }) {
  const [open, setOpen] = useState(false);
  const init = value ? value.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1, 1];
  const [vy, setVy] = useState(init[0]);
  const [vm, setVm] = useState(init[1] - 1); // 0-based
  const fld = value ? new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" }).format(new Date(value + "T00:00:00")) : "—";
  const monthName = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(new Date(vy, vm, 1));
  const dows = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: "short" }).format(new Date(2024, 0, 1 + i))); // 2024-01-01 = pondělí
  const startDow = (new Date(vy, vm, 1).getDay() + 6) % 7; // pondělí = 0
  const daysInMonth = new Date(vy, vm + 1, 0).getDate();
  const cells: ({ d: number; iso: string; disabled: boolean } | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) { const iso = dpISO(vy, vm, d); cells.push({ d, iso, disabled: !!min && iso < min }); }
  const step = (dir: number) => { let m = vm + dir, y = vy; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } setVm(m); setVy(y); };
  return (
    <div>
      <label className="muted" style={{ display: "block", marginBottom: 8 }}>{label}</label>
      <button className="input dp-field" onClick={() => setOpen(true)}>{fld}</button>
      {open && (
        <div className="dp-overlay" onClick={() => setOpen(false)}>
          <div className="dp-cal" onClick={(e) => e.stopPropagation()}>
            <div className="dp-head">
              <button onClick={() => step(-1)}>‹</button>
              <div className="dp-month">{monthName}</div>
              <button onClick={() => step(1)}>›</button>
            </div>
            <div className="dp-dow">{dows.map((w, i) => <div key={i}>{w}</div>)}</div>
            <div className="dp-grid">
              {cells.map((c, i) => c === null ? <div key={i} /> : (
                <button key={i} className={`dp-day${c.iso === value ? " sel" : ""}`} disabled={c.disabled} onClick={() => { onChange(c.iso); setOpen(false); }}>{c.d}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Galerie avatarů (náhled + výběr) ─────────────────────────
function AvatarGallery({ lang }: { lang: Lang }) {
  const t = makeT(lang);
  const { speak, speaking } = useSpeech(lang);
  const [active, setActive] = useState<AvatarVariant>(AVATAR);
  const current = localStorage.getItem("avatarVariant") || "receptionist";

  const tryIt = (v: AvatarVariant) => { setActive(v); speak(t("welcome")); };
  const choose = (v: AvatarVariant) => { localStorage.setItem("avatarVariant", v); window.location.hash = ""; window.location.reload(); };

  return (
    <div className="kiosk" style={{ maxWidth: 1000 }}>
      <div className="topbar"><div className="brand">🛎️ Galerie avatarů</div>
        <a className="btn ghost" href="#" onClick={() => { window.location.hash = ""; location.reload(); }}>← Zpět na kiosek</a>
      </div>
      <div className="screen-hint" style={{ marginTop: 8 }}>Klepni na avatara pro ukázku hlasu, pak „Použít tohoto".</div>
      <div className="content" style={{ flexDirection: "row", flexWrap: "wrap", gap: 30, alignItems: "stretch" }}>
        {AVATAR_VARIANTS.map((v) => (
          <div key={v.id} className="card" style={{ maxWidth: 280, textAlign: "center", border: active === v.id ? "2px solid var(--accent)" : undefined }}>
            <div onClick={() => tryIt(v.id)} style={{ cursor: "pointer" }}>
              <Avatar speaking={speaking && active === v.id} variant={v.id} size={180} />
            </div>
            <h2 style={{ marginTop: 8 }}>{v.label} {current === v.id && <span className="chip">aktivní</span>}</h2>
            <div className="muted" style={{ minHeight: 44 }}>{v.note}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn secondary" onClick={() => tryIt(v.id)}>🔊 Ukázka</button>
              <button className="btn ok" onClick={() => choose(v.id)}>Použít tohoto</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
