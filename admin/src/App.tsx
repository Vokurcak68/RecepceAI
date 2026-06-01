import { useEffect, useState, useRef, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  api, money, d, setToken, setProperty, getProperty, TYPE_LABEL, CONDITION_LABEL, SERVICE_LABEL, SERVICE_ICON, PRIORITY_LABEL, SEVERITY_LABEL, CHECK_CAT_LABEL, PAY_TYPE_LABEL, PAY_METHOD_LABEL, DOC_TYPE_LABEL, DOC_STATUS_LABEL, CHARGE_LABEL,
  type Reservation, type Room, type Bed, type RoomType, type Dashboard, type RegistrationEntry, type Property, type User, type LoginResult,
  type ReservationDetail, type Folio, type Invoice, type Payment, type Equipment, type EquipMove, type EquipCategory, type ServiceRequest,
  type HousekeepingPlan, type PlanItem, type NightAudit, type PricingSuggestion, type DaySuggestion, type ChecksResult, type Finding,
  type MaintenancePlan, type MaintItem, type PendingCall, type PaymentRow, type PaymentsList, type Receipt, type ReceiptLine, type Doc, type DocLine,
  type CashState, type CashSession, type CashMovement, type Charge, type OccupancyRow, type ResGuest,
} from "./api";

const Badge = ({ s }: { s: string }) => <span className={`badge b-${s}`}>{s}</span>;

// Adresa portálu hosta (přepsatelné přes VITE_GUEST_URL při buildu).
const GUEST_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_GUEST_URL || "http://localhost:5175";
const guestUrl = (code: string) => `${GUEST_BASE}/?code=${encodeURIComponent(code)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

export function App() {
  const [session, setSession] = useState<LoginResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(getProperty());
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    if (!localStorage.getItem("adminToken")) { setLoading(false); return; }
    api.me()
      .then((s) => { setSession({ token: "", ...s }); pickInitial(s.properties); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function pickInitial(props: Property[]) {
    const cur = getProperty();
    if ((!cur || !props.find((p) => p.id === cur)) && props[0]) { setProperty(props[0].id); setSelId(props[0].id); }
    else setSelId(cur);
  }

  if (loading) return <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }} className="muted">Načítám…</div>;
  if (!session) return <Login onLogin={(s) => { setSession(s); pickInitial(s.properties); }} />;

  const logout = () => { localStorage.removeItem("adminToken"); localStorage.removeItem("propertyId"); setSession(null); };

  // Personál (uklízečka/údržbář) má vlastní zjednodušený portál.
  if (session.user.role === "housekeeping" || session.user.role === "maintenance") return <StaffPortal session={session} onLogout={logout} />;

  const isSuper = session.user.role === "super_admin";
  const prop = session.properties.find((p) => p.id === selId);

  const propTabs = [
    { id: "dashboard", label: "Přehled", icon: "📊" },
    { id: "agents", label: "AI agenti", icon: "🤖" },
    { id: "occupancy", label: "Obsazení", icon: "🛏️" },
    { id: "reservations", label: "Rezervace", icon: "📋" },
    { id: prop?.inventoryUnit === "bed" ? "beds" : "rooms", label: prop?.inventoryUnit === "bed" ? "Lůžka" : "Pokoje", icon: "🛏️" },
    { id: "equipment", label: "Vybavení", icon: "🧰" },
    { id: "housekeeping", label: "Dispečink úklidu", icon: "🧹" },
    { id: "maintenance", label: "Dispečink údržby", icon: "🔧" },
    { id: "checks", label: "Kontroly", icon: "✅" },
    { id: "requests", label: "Požadavky", icon: "🛎️" },
    { id: "types", label: "Typy & ceny", icon: "🏷️" },
    { id: "payments", label: "Úhrady", icon: "🧾" },
    { id: "cashregister", label: "Pokladna", icon: "💰" },
    { id: "documents", label: "Doklady", icon: "📄" },
    { id: "book", label: "Kniha hostů", icon: "📖" },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo"><span>🛎️ Recepce</span>{(session.user.role === "manager" || isSuper) && <CallBell />}</div>

        <select className="prop-switch" value={selId} onChange={(e) => { setProperty(e.target.value); setSelId(e.target.value); }}>
          {session.properties.map((p) => <option key={p.id} value={p.id}>{p.name} · {TYPE_LABEL[p.type]}</option>)}
        </select>

        <nav className="nav">
          {propTabs.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}><span>{t.icon}</span> {t.label}</button>
          ))}
          {isSuper && (
            <>
              <div className="nav-sep">CENTRÁLA</div>
              <button className={tab === "properties" ? "active" : ""} onClick={() => setTab("properties")}><span>🏢</span> Provozovny</button>
              <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><span>👤</span> Uživatelé</button>
              <button className={tab === "cequipment" ? "active" : ""} onClick={() => setTab("cequipment")}><span>🧰</span> Vybavení</button>
              <button className={tab === "whatsapp" ? "active" : ""} onClick={() => setTab("whatsapp")}><span>📲</span> WhatsApp</button>
            </>
          )}
          <button onClick={logout} style={{ marginTop: 24 }}>🚪 Odhlásit ({session.user.name})</button>
        </nav>
      </aside>

      <main className="main">
        {prop && tab === "dashboard" && <DashboardView selId={selId} />}
        {prop && tab === "agents" && <AgentsView selId={selId} onOpen={setTab} />}
        {prop && tab === "occupancy" && <OccupancyView selId={selId} prop={prop} />}
        {prop && tab === "reservations" && <ReservationsView selId={selId} prop={prop} />}
        {prop && tab === "rooms" && <RoomsView selId={selId} />}
        {prop && tab === "beds" && <BedsView selId={selId} />}
        {prop && tab === "equipment" && <EquipmentView selId={selId} />}
        {prop && tab === "housekeeping" && <HousekeepingView selId={selId} />}
        {prop && tab === "maintenance" && <MaintenanceView selId={selId} />}
        {prop && tab === "checks" && <ChecksView selId={selId} />}
        {prop && tab === "requests" && <RequestsView selId={selId} />}
        {prop && tab === "types" && <TypesView selId={selId} prop={prop} />}
        {prop && tab === "payments" && <PaymentsView selId={selId} />}
        {prop && tab === "cashregister" && <CashRegisterView selId={selId} />}
        {prop && tab === "documents" && <DocumentsView selId={selId} />}
        {prop && tab === "book" && <BookView selId={selId} />}
        {isSuper && tab === "properties" && <PropertiesView />}
        {isSuper && tab === "users" && <UsersView currentUserId={session.user.id} />}
        {isSuper && tab === "cequipment" && <CentralEquipmentView />}
        {isSuper && tab === "whatsapp" && <WhatsAppView />}
      </main>
    </div>
  );
}

// ── Login ────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: (s: LoginResult) => void }) {
  // Předvyplň posledního přihlášeného uživatele (zapamatováno mezi sezeními).
  const [email, setEmail] = useState(() => localStorage.getItem("lastEmail") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const s = await api.login(email, password);
      localStorage.setItem("lastEmail", email); // zapamatuj uživatele
      setToken(s.token);
      onLogin(s);
    } catch { setError("Nesprávný e-mail nebo heslo."); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      {/* Pravý <form> s autocomplete → prohlížeč nabídne uložení hesla. */}
      <form className="panel" style={{ width: 380, padding: 28 }} onSubmit={submit}>
        <div className="logo" style={{ padding: "0 0 8px" }}>🛎️ Hotelový systém</div>
        <div className="muted" style={{ marginBottom: 16 }}>Přihlášení správce</div>
        {error && <div className="error">{error}</div>}
        <input name="email" type="email" autoComplete="username" placeholder="E-mail" value={email} autoFocus={!email} style={{ width: "100%", marginBottom: 10 }} onChange={(e) => setEmail(e.target.value)} />
        <input name="password" type="password" autoComplete="current-password" placeholder="Heslo" value={password} autoFocus={!!email} style={{ width: "100%", marginBottom: 12 }} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn" type="submit" style={{ width: "100%" }} disabled={busy}>{busy ? "Přihlašuji…" : "Přihlásit"}</button>
      </form>
    </div>
  );
}

// ── Hook ─────────────────────────────────────────────────────
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = () => { setError(""); fn().then(setData).catch((e) => setError(e.message)); };
  useEffect(reload, deps); // eslint-disable-line
  return { data, error, reload };
}

// ── Zvoneček: přivolání člověka z kiosku (manažeři napříč hotely) ──
let _audioCtx: AudioContext | null = null;
function ringBell() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _audioCtx = _audioCtx || new Ctx();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const ping = (freq: number, at: number) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = freq;
      const t = ctx.currentTime + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.start(t); o.stop(t + 0.5);
    };
    ping(988, 0); ping(1319, 0.18); // dvojté „cink-cink"
  } catch { /* zvuk je bonus, bez něj to nevadí */ }
}

const agoCs = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `před ${s} s`;
  const m = Math.floor(s / 60);
  return `před ${m} min`;
};

function CallBell() {
  const [calls, setCalls] = useState<PendingCall[]>([]);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const list = await api.callsPending();
        if (stop) return;
        const fresh = list.filter((c) => !seen.current.has(c.id));
        seen.current = new Set(list.map((c) => c.id));
        setCalls(list);
        if (fresh.length) { ringBell(); setOpen(true); }
      } catch { /* nepřihlášený / bez práv → ignoruj */ }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, []);

  const claim = async (c: PendingCall) => {
    window.open(c.joinUrl, "_blank", "noopener");
    try { await api.claimCall(c.id); } catch { /* */ }
    seen.current.delete(c.id);
    setCalls((cs) => cs.filter((x) => x.id !== c.id));
  };
  const dismiss = async (c: PendingCall) => {
    try { await api.claimCall(c.id); } catch { /* */ }
    setCalls((cs) => cs.filter((x) => x.id !== c.id));
  };

  const n = calls.length;
  return (
    <div className="callbell-wrap">
      <button className={`callbell${n ? " ring" : ""}`} onClick={() => setOpen((o) => !o)} title="Přivolání člověka z kiosku">
        🔔{n > 0 && <span className="callbell-badge">{n}</span>}
      </button>
      {open && (
        <div className="call-panel">
          <div className="call-panel-head">Přivolání z kiosku {n > 0 && <span className="muted">· {n}</span>}<button className="linkx" onClick={() => setOpen(false)}>zavřít</button></div>
          {n === 0 ? <div className="call-empty">Žádný čekající hovor.</div> : calls.map((c) => (
            <div key={c.id} className="call-item">
              <div className="call-info">
                <div className="call-place">🛎️ {c.propertyName}</div>
                <div className="muted" style={{ fontSize: 12 }}>{agoCs(c.createdAt)}</div>
              </div>
              <div className="call-actions">
                <button className="btn sm ok" onClick={() => claim(c)}>Připojit se</button>
                <button className="btn sm ghost" onClick={() => dismiss(c)}>Odbavil jiný</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AI agenti: velín — co každý agent dělá + jeho živý stav ───
type AgentTone = "ok" | "warn" | "danger" | "idle";
type AgentStatus = { label: string; tone: AgentTone };

function AgentsView({ selId, onOpen }: { selId: string; onOpen: (tab: string) => void }) {
  const hk = useAsync<HousekeepingPlan>(() => api.housekeepingPlan(), [selId]);
  const mt = useAsync<MaintenancePlan>(() => api.maintenancePlan(), [selId]);
  const ck = useAsync<ChecksResult>(() => api.checks(), [selId]);
  const bf = useAsync<NightAudit>(() => api.briefing(), [selId]);

  // Z dat agenta odvodí jeho aktuální stav (barva + text). plural = české skloňování.
  const loading: AgentStatus = { label: "Načítám…", tone: "idle" };
  const plural = (n: number, one: string, few: string, many: string) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
  const planStatus = (p: HousekeepingPlan | MaintenancePlan | null | undefined, u: [string, string, string], f: [string, string, string], okLabel: string): AgentStatus =>
    !p ? loading : p.counts.urgent > 0 ? { label: plural(p.counts.urgent, ...u), tone: "danger" }
      : p.counts.total > 0 ? { label: plural(p.counts.total, ...f), tone: "warn" }
      : { label: okLabel, tone: "ok" };

  const agents: { icon: string; name: string; tagline: string; how: string; tab: string | null; status: AgentStatus }[] = [
    {
      icon: "🛎️", name: "AI recepční", tab: null,
      tagline: "Na kiosku odbaví hosta sama — najde volný pokoj, řekne cenu, založí rezervaci i check-in.",
      how: "Mluví a rozumí v jedenácti jazycích a drží se výhradně témat ubytování. Ceny a dostupnost si vždy ověří, nic si nevymýšlí.",
      status: { label: "Aktivní na kiosku", tone: "ok" },
    },
    {
      icon: "☀️", name: "Ranní briefing", tab: "dashboard",
      tagline: "Každé ráno projde celý provoz a shrne, co dnes čeká.",
      how: "Obsazenost, příjezdy a odjezdy, nevyrovnané účty, hosté bez evidence i pokoje k úklidu — z dat udělá jeden přehled a upozorní na to, co nepočká.",
      status: !bf.data ? loading : (bf.data.flags.length === 1 && bf.data.flags[0].startsWith("Vše v pořádku"))
        ? { label: "Vše v pořádku", tone: "ok" } : { label: plural(bf.data.flags.length, "bod k řešení", "body k řešení", "bodů k řešení"), tone: "warn" },
    },
    {
      icon: "🧹", name: "Housekeeping dispečer", tab: "housekeeping",
      tagline: "Řadí frontu úklidu podle provozu — pokoj, kam dnes někdo přijíždí, jde nahoru.",
      how: "Když je daného typu pokoje na dnešní příjezdy nedostatek, označí úklid jako urgentní, ať je co nabídnout. Host-nahlášené požadavky a staré tikety povýší.",
      status: planStatus(hk.data, ["urgentní úklid", "urgentní úklidy", "urgentních úklidů"], ["pokoj k úklidu", "pokoje k úklidu", "pokojů k úklidu"], "Vše uklizeno"),
    },
    {
      icon: "🔧", name: "Údržba triage", tab: "maintenance",
      tagline: "Z popisu závady pozná, o co jde, a podle toho určí naléhavost.",
      how: "Bezpečnostní věci (plyn, elektřina, zámek) a závady v obsazených pokojích řeší první. Napojí i poškozené vybavení v pokoji.",
      status: planStatus(mt.data, ["urgentní oprava", "urgentní opravy", "urgentních oprav"], ["oprava ve frontě", "opravy ve frontě", "oprav ve frontě"], "Nic k opravě"),
    },
    {
      icon: "✨", name: "Revenue / ceny", tab: "types",
      tagline: "Navrhne ceny na dny dopředu podle obsazenosti, blízkosti termínu a víkendů.",
      how: "Plné termíny zdraží, slabé doprodá. Ceny vždy jen navrhuje — poslední slovo máš ty, zapisují se až po schválení.",
      status: { label: "Na vyžádání", tone: "idle" },
    },
    {
      icon: "✅", name: "Kontrolní agent", tab: "checks",
      tagline: "Hlídá evidenci hostů, pohledávky a inventář najednou.",
      how: "Vypíše konkrétní věci k vyřízení seřazené podle závažnosti — od hostů bez evidence a nedoplatků po poškozené vybavení.",
      status: !ck.data ? loading : ck.data.counts.high > 0 ? { label: plural(ck.data.counts.high, "nález vysoké priority", "nálezy vysoké priority", "nálezů vysoké priority"), tone: "danger" }
        : ck.data.counts.total > 0 ? { label: plural(ck.data.counts.total, "nález", "nálezy", "nálezů"), tone: "warn" } : { label: "Bez nálezů", tone: "ok" },
    },
  ];

  return (
    <>
      <div className="h1">AI agenti <span className="muted" style={{ fontSize: 14 }}>tým, který hlídá provoz za tebe</span></div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 16, maxWidth: 760 }}>
        Každý agent má na starosti jednu oblast. Rozhoduje se podle jasných pravidel z reálných dat provozovny, počítá průběžně a zdarma — umělou inteligenci (Claude) volá jen na vyžádání u shrnutí. Nevratné kroky (ceny, mazání) vždy jen navrhne ke schválení.
      </p>
      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.name} className="agent-card">
            <div className="agent-top">
              <span className="agent-icon">{a.icon}</span>
              <span className={`dot dot-${a.status.tone}`} title={a.status.label} />
            </div>
            <div className="agent-name">{a.name}</div>
            <div className="agent-tag">{a.tagline}</div>
            <div className="agent-how">{a.how}</div>
            <div className="agent-foot">
              <span className={`agent-status st-${a.status.tone}`}>{a.status.label}</span>
              {a.tab ? <button className="btn sm ghost" onClick={() => onOpen(a.tab!)}>Otevřít →</button>
                : <span className="muted" style={{ fontSize: 13 }}>běží na kiosku</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Dashboard ────────────────────────────────────────────────
// Ranní briefing (orchestrátor — noční audit + volitelné AI shrnutí).
function BriefingCard({ selId }: { selId: string }) {
  const { data, error } = useAsync<NightAudit>(() => api.briefing(), [selId]);
  const [brief, setBrief] = useState(""); const [busy, setBusy] = useState(false);
  const aiBrief = async () => {
    setBusy(true); setBrief("");
    try { const r = await api.briefingBrief("cs"); setBrief(r.brief); }
    catch (e) { setBrief(e instanceof Error ? e.message : "Chyba AI."); }
    finally { setBusy(false); }
  };
  if (error) return <div className="error">{error}</div>;
  if (!data) return null;
  const ok = data.flags.length === 1 && data.flags[0].startsWith("Vše v pořádku");
  return (
    <div className="panel briefing">
      <div className="briefing-head">
        <h3>☀️ Ranní briefing</h3>
        <div className="briefing-occ">
          <span>Dnes <b>{data.occupancy.today.pct} %</b> <span className="muted">({data.occupancy.today.occupied}/{data.occupancy.today.total})</span></span>
          <span>Zítra <b>{data.occupancy.tomorrow.pct} %</b></span>
          <span className="muted">Příjezdy {data.arrivals.total} · Odjezdy {data.departures}</span>
          <button className="btn sm" onClick={aiBrief} disabled={busy}>{busy ? "Generuji…" : "✨ AI shrnutí"}</button>
        </div>
      </div>
      {brief && <div className="briefing-ai">{brief}</div>}
      <ul className={`briefing-flags${ok ? " ok" : ""}`}>
        {data.flags.map((f, i) => <li key={i}>{ok ? "✅" : "⚠️"} {f}</li>)}
      </ul>
    </div>
  );
}

function DashboardView({ selId }: { selId: string }) {
  const today = todayIso();
  const { data, error, reload } = useAsync<Dashboard>(() => api.dashboard(today), [selId]);
  const doCheckin = async (id: string) => { await api.checkin(id); reload(); };
  const doClean = async (id: string) => { await api.cleanRoom(id); reload(); };
  return (
    <>
      <div className="h1">Přehled <span className="muted" style={{ fontSize: 15 }}>{today}</span></div>
      {error && <div className="error">{error}</div>}
      <BriefingCard selId={selId} />
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="n">{data.counts.arrivals}</div><div className="l">Dnešní příjezdy</div></div>
            <div className="stat"><div className="n">{data.counts.inHouse}</div><div className="l">Ubytovaní</div></div>
            <div className="stat"><div className="n">{data.counts.departures}</div><div className="l">Dnešní odjezdy</div></div>
            <div className="stat warn"><div className="n">{data.counts.dirtyRooms}</div><div className="l">K úklidu</div></div>
            <div className="stat"><div className="n">{data.counts.activeHolds}</div><div className="l">Blokace</div></div>
          </div>
          <div className="grid2">
            <div className="panel"><h3>🛬 Dnešní příjezdy</h3>
              <Table cols={["Host", "Jednotka", "Kód", ""]} rows={data.arrivals} empty="Žádné"
                render={(r: Reservation) => (<tr key={r.id}><td>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}</td><td>{r.roomType?.name}</td><td className="muted">{r.code}</td><td className="right"><button className="btn sm ok" onClick={() => doCheckin(r.id)}>Check-in</button></td></tr>)} />
            </div>
            <div className="panel"><h3>🛫 Dnešní odjezdy</h3>
              <Table cols={["Host", "Jednotka", "Kód"]} rows={data.departures} empty="Žádné"
                render={(r: Reservation) => (<tr key={r.id}><td>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}</td><td>{r.room?.number ?? r.bed?.label ?? "—"}</td><td className="muted">{r.code}</td></tr>)} />
            </div>
          </div>
          <div className="grid2">
            <div className="panel"><h3>🏨 Ubytovaní</h3>
              <Table cols={["Host", "Jednotka", "Odjezd"]} rows={data.inHouse} empty="Nikdo"
                render={(r: Reservation) => (<tr key={r.id}><td>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}</td><td>{r.room?.number ?? r.bed?.label ?? "—"}</td><td>{d(r.checkOutDate)}</td></tr>)} />
            </div>
            <div className="panel"><h3>🧹 K úklidu</h3>
              <Table cols={["Pokoj", "Patro", ""]} rows={data.dirtyRooms} empty="Vše uklizeno"
                render={(r: Room) => (<tr key={r.id}><td>{r.number}</td><td>{r.floor}.</td><td className="right"><button className="btn sm ghost" onClick={() => doClean(r.id)}>Uklizeno</button></td></tr>)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Reservations ─────────────────────────────────────────────
// ── Obsazení: kdo je v jakém pokoji + zůstatek účtu ──────────
function OccupancyView({ selId, prop }: { selId: string; prop?: Property }) {
  const { data, error, reload } = useAsync<OccupancyRow[]>(() => api.occupancy(), [selId]);
  const [detailId, setDetailId] = useState<string | null>(null);
  if (detailId) return <ReservationDetailView id={detailId} prop={prop} onBack={() => { setDetailId(null); reload(); }} />;
  return (
    <>
      <div className="h1">Obsazení <span className="muted" style={{ fontSize: 14 }}>aktuálně ubytovaní hosté</span></div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <Table cols={["Jednotka", "Host", "Osob", "Pobyt", "Položky", "Zůstatek účtu", ""]} rows={data ?? []} empty="Nikdo není ubytovaný"
          render={(o: OccupancyRow) => (
            <tr key={o.id}>
              <td><b>{o.unit}</b>{o.roomType ? <span className="muted"> · {o.roomType}</span> : null}</td>
              <td>{o.guestName}</td>
              <td className="muted">{o.guests}</td>
              <td>{d(o.checkInDate)} → {d(o.checkOutDate)}</td>
              <td className="muted">{o.charges > 0 ? `${o.charges}×` : "—"}</td>
              <td><b style={{ color: parseFloat(o.balance) > 0 ? "var(--warn)" : "var(--ok)" }}>{money(o.balance)}</b></td>
              <td className="right"><button className="btn sm" onClick={() => setDetailId(o.id)}>Účet / detail</button></td>
            </tr>
          )} />
      </div>
    </>
  );
}

function ReservationsView({ selId, prop }: { selId: string; prop: Property }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, reload } = useAsync<Reservation[]>(() => api.reservations(q, status), [selId, status]);
  const types = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [guestQr, setGuestQr] = useState<Reservation[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [f, setF] = useState({ roomTypeId: "", from: todayIso(), to: tomorrowIso(), adults: 2, firstName: "", lastName: "", email: "", phone: "", billingCompany: "", billingIco: "" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkDoc, setBulkDoc] = useState<Doc | null>(null);
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const bulk = async () => { setFormErr(""); try { setBulkDoc(await api.bulkInvoice([...sel])); setSel(new Set()); } catch (e) { setFormErr(e instanceof Error ? e.message : String(e)); } };

  const cancel = async (id: string) => { if (confirm("Zrušit rezervaci?")) { await api.cancel(id); reload(); } };
  const create = async () => {
    setFormErr("");
    if (!f.roomTypeId || !f.firstName || !f.lastName) { setFormErr("Vyplň typ, jméno a příjmení."); return; }
    try {
      await api.createReservation({ roomTypeId: f.roomTypeId, from: f.from, to: f.to, adults: Number(f.adults),
        guest: { firstName: f.firstName, lastName: f.lastName, email: f.email || undefined, phone: f.phone || undefined },
        billingCompany: f.billingCompany || undefined, billingIco: f.billingIco || undefined });
      setShowForm(false); setF({ roomTypeId: "", from: todayIso(), to: tomorrowIso(), adults: 2, firstName: "", lastName: "", email: "", phone: "", billingCompany: "", billingIco: "" }); reload();
    } catch (e) { setFormErr(e instanceof Error ? e.message : String(e)); }
  };

  if (detailId) return <ReservationDetailView id={detailId} prop={prop} onBack={() => { setDetailId(null); reload(); }} />;

  return (
    <>
      <div className="h1">Rezervace <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? "Zavřít" : "+ Nová rezervace"}</button></div>
      {error && <div className="error">{error}</div>}
      {showForm && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 style={{ border: "none", padding: 0, marginBottom: 14 }}>Nová rezervace</h3>
          {formErr && <div className="error">{formErr}</div>}
          <div className="toolbar">
            <select value={f.roomTypeId} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}>
              <option value="">{prop.inventoryUnit === "bed" ? "Typ lůžka…" : "Typ pokoje…"}</option>
              {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({money(t.basePrice)}/noc)</option>)}
            </select>
            <label className="row">Příjezd <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="row">Odjezd <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <label className="row">Osob <input type="number" min={1} style={{ width: 70 }} value={f.adults} onChange={(e) => setF({ ...f, adults: Number(e.target.value) })} /></label>
          </div>
          <div className="toolbar">
            <input placeholder="Jméno" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
            <input placeholder="Příjmení" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
            <input placeholder="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input placeholder="Telefon" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
          {prop.type === "ubytovna" && (
            <div className="toolbar">
              <input placeholder="Fakturovat firmě (název)" value={f.billingCompany} onChange={(e) => setF({ ...f, billingCompany: e.target.value })} />
              <input placeholder="IČO" value={f.billingIco} onChange={(e) => setF({ ...f, billingIco: e.target.value })} />
              <button className="btn" onClick={create}>Vytvořit</button>
            </div>
          )}
          {prop.type !== "ubytovna" && <button className="btn" onClick={create}>Vytvořit rezervaci</button>}
        </div>
      )}
      <div className="toolbar">
        <input placeholder="Hledat jméno / kód…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reload()} />
        <button className="btn ghost" onClick={reload}>Hledat</button>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Všechny stavy</option>
          {["pending", "hold", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn ghost" onClick={() => setGuestQr((data ?? []).filter((r) => ["confirmed", "checked_in"].includes(r.status)))}>🏷 QR hostů</button>
        {sel.size > 0 && <button className="btn" onClick={bulk}>🧾 Hromadná faktura ({sel.size})</button>}
      </div>
      <div className="panel">
        <Table cols={["", "Kód", "Host", "Termín", "Jednotka", "Stav", "Částka", ""]} rows={data ?? []} empty="Žádné rezervace"
          render={(r: Reservation) => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
              <td className="muted">{r.code}</td>
              <td>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}</td>
              <td>{d(r.checkInDate)} → {d(r.checkOutDate)}</td>
              <td>{r.room?.number ?? r.bed?.label ?? r.roomType?.name ?? "—"}</td>
              <td><Badge s={r.status} /></td>
              <td>{money(r.totalAmount)}{r.billingCycle === "monthly" && <span className="chip">měsíčně</span>}</td>
              <td className="right">
                <button className="btn sm ghost" onClick={() => setDetailId(r.id)}>Detail</button>{" "}
                {!["cancelled", "checked_out", "no_show"].includes(r.status) && <button className="btn sm danger" onClick={() => cancel(r.id)}>Zrušit</button>}
              </td>
            </tr>
          )} />
      </div>
      {guestQr && <GuestQrLabels rows={guestQr.map((r) => ({ code: r.code, title: r.room ? `Pokoj ${r.room.number}` : r.roomType?.name ?? r.code, subtitle: `${r.primaryGuest?.firstName ?? ""} ${r.primaryGuest?.lastName ?? ""}`.trim() }))} onClose={() => setGuestQr(null)} />}
      {bulkDoc && <DocumentOverlay doc={bulkDoc} onClose={() => setBulkDoc(null)} />}
    </>
  );
}

// ── Rooms ────────────────────────────────────────────────────
function RoomsView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<Room[]>(() => api.rooms(), [selId]);
  const types = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const [form, setForm] = useState({ roomTypeId: "", number: "", floor: 1, lockType: "physical_key" });
  const setStatus = async (id: string, s: string) => { await api.updateRoom(id, { status: s }); reload(); };
  const del = async (id: string) => { if (confirm("Smazat pokoj?")) { await api.deleteRoom(id); reload(); } };
  const add = async () => { if (!form.roomTypeId || !form.number) return; await api.createRoom({ ...form, floor: Number(form.floor) }); setForm({ roomTypeId: "", number: "", floor: 1, lockType: "physical_key" }); reload(); };
  return (
    <>
      <div className="h1">Pokoje</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <select value={form.roomTypeId} onChange={(e) => setForm({ ...form, roomTypeId: e.target.value })}><option value="">Typ pokoje…</option>{(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <input placeholder="Číslo" style={{ width: 90 }} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        <input placeholder="Patro" type="number" style={{ width: 80 }} value={form.floor} onChange={(e) => setForm({ ...form, floor: Number(e.target.value) })} />
        <select value={form.lockType} onChange={(e) => setForm({ ...form, lockType: e.target.value })}><option value="physical_key">Fyzický klíč</option><option value="smart_code">Chytrý zámek</option></select>
        <button className="btn" onClick={add}>+ Přidat pokoj</button>
      </div>
      <div className="panel">
        <Table cols={["Číslo", "Typ", "Patro", "Zámek", "Stav", ""]} rows={data ?? []} empty="Žádné pokoje"
          render={(r: Room) => (<tr key={r.id}><td><b>{r.number}</b></td><td>{r.roomType?.name}</td><td>{r.floor}.</td><td className="muted">{r.lockType === "smart_code" ? "🔢 kód" : "🔑 klíč"}</td><td><select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}>{["clean", "dirty", "out_of_service"].map((s) => <option key={s} value={s}>{s}</option>)}</select></td><td className="right"><button className="btn sm danger" onClick={() => del(r.id)}>Smazat</button></td></tr>)} />
      </div>
    </>
  );
}

// ── Beds (ubytovna) ──────────────────────────────────────────
function BedsView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<Bed[]>(() => api.beds(), [selId]);
  const rooms = useAsync<Room[]>(() => api.rooms(), [selId]);
  const [form, setForm] = useState({ roomId: "", label: "" });
  const del = async (id: string) => { if (confirm("Smazat lůžko?")) { await api.deleteBed(id); reload(); } };
  const add = async () => { if (!form.roomId || !form.label) return; await api.createBed(form); setForm({ roomId: "", label: "" }); reload(); };
  return (
    <>
      <div className="h1">Lůžka</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}><option value="">Pokoj…</option>{(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.number} ({r.roomType?.name})</option>)}</select>
        <input placeholder="Označení (např. A1-5)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <button className="btn" onClick={add}>+ Přidat lůžko</button>
      </div>
      <div className="panel">
        <Table cols={["Lůžko", "Pokoj", "Typ", "Stav", ""]} rows={data ?? []} empty="Žádná lůžka"
          render={(b: Bed) => (<tr key={b.id}><td><b>{b.label}</b></td><td>{b.room?.number}</td><td>{b.room?.roomType?.name}</td><td><Badge s={b.status} /></td><td className="right"><button className="btn sm danger" onClick={() => del(b.id)}>Smazat</button></td></tr>)} />
      </div>
    </>
  );
}

// ── Room types & pricing ─────────────────────────────────────
function TypesView({ selId, prop }: { selId: string; prop: Property }) {
  const { data, error, reload } = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const [msg, setMsg] = useState("");
  const [rate, setRate] = useState({ roomTypeId: "", date: todayIso(), price: "" });
  const [nw, setNw] = useState({ name: "", capacityAdults: 2, basePrice: "", weeklyPrice: "", monthlyPrice: "" });

  const saveBase = async (id: string, v: string) => { const n = parseFloat(v); if (isNaN(n)) return; await api.updateRoomType(id, { basePrice: n }); setMsg("Cena uložena."); reload(); };
  const saveLong = async (id: string, field: "weeklyPrice" | "monthlyPrice", v: string) => { const n = parseFloat(v); await api.updateRoomType(id, { [field]: isNaN(n) ? 0 : n }); setMsg("Dlouhodobá cena uložena."); reload(); };
  const saveRate = async () => { if (!rate.roomTypeId || !rate.price) return; await api.setRate({ roomTypeId: rate.roomTypeId, date: rate.date, price: parseFloat(rate.price) }); setMsg(`Cena na ${rate.date} nastavena.`); setRate({ ...rate, price: "" }); };
  const addType = async () => { if (!nw.name || !nw.basePrice) return; await api.createRoomType({ name: nw.name, capacityAdults: Number(nw.capacityAdults), basePrice: Number(nw.basePrice), weeklyPrice: nw.weeklyPrice ? Number(nw.weeklyPrice) : undefined, monthlyPrice: nw.monthlyPrice ? Number(nw.monthlyPrice) : undefined }); setNw({ name: "", capacityAdults: 2, basePrice: "", weeklyPrice: "", monthlyPrice: "" }); reload(); };

  return (
    <>
      <div className="h1">Typy {prop.inventoryUnit === "bed" ? "lůžek" : "pokojů"} & ceny</div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="error" style={{ background: "#e6f7ee", color: "var(--ok)" }}>{msg}</div>}

      <div className="panel">
        <h3>Typy</h3>
        <Table cols={prop.allowLongTerm ? ["Název", "Kapacita", "Cena/noc", "Cena/týden", "Cena/měsíc"] : ["Název", "Kapacita", "Pokojů", "Cena/noc"]} rows={data ?? []} empty="Žádné typy"
          render={(t: RoomType) => prop.allowLongTerm ? (
            <tr key={t.id}>
              <td><b>{t.name}</b></td><td>{t.capacityAdults}+{t.capacityChildren}</td>
              <td><PriceCell v={t.basePrice} onSave={(v) => saveBase(t.id, v)} /></td>
              <td><PriceCell v={t.weeklyPrice} onSave={(v) => saveLong(t.id, "weeklyPrice", v)} /></td>
              <td><PriceCell v={t.monthlyPrice} onSave={(v) => saveLong(t.id, "monthlyPrice", v)} /></td>
            </tr>
          ) : (
            <tr key={t.id}>
              <td><b>{t.name}</b><div className="muted">{t.amenities.join(", ")}</div></td>
              <td>{t.capacityAdults}+{t.capacityChildren}</td><td>{t._count?.rooms ?? "—"}</td>
              <td><PriceCell v={t.basePrice} onSave={(v) => saveBase(t.id, v)} /></td>
            </tr>
          )} />
      </div>

      <div className="panel">
        <h3>Nový typ</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <input placeholder="Název" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
          <label className="row">Kapacita <input type="number" min={1} style={{ width: 70 }} value={nw.capacityAdults} onChange={(e) => setNw({ ...nw, capacityAdults: Number(e.target.value) })} /></label>
          <input placeholder="Cena/noc" style={{ width: 110 }} value={nw.basePrice} onChange={(e) => setNw({ ...nw, basePrice: e.target.value })} />
          {prop.allowLongTerm && <input placeholder="Cena/týden" style={{ width: 110 }} value={nw.weeklyPrice} onChange={(e) => setNw({ ...nw, weeklyPrice: e.target.value })} />}
          {prop.allowLongTerm && <input placeholder="Cena/měsíc" style={{ width: 110 }} value={nw.monthlyPrice} onChange={(e) => setNw({ ...nw, monthlyPrice: e.target.value })} />}
          <button className="btn" onClick={addType}>+ Přidat</button>
        </div>
      </div>

      <PricingPanel types={data ?? []} onApplied={(n) => { setMsg(`Zapsáno ${n} cen do ceníku.`); }} />

      <div className="panel">
        <h3>Cena na konkrétní den (sezónní)</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <select value={rate.roomTypeId} onChange={(e) => setRate({ ...rate, roomTypeId: e.target.value })}><option value="">Typ…</option>{(data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <input type="date" value={rate.date} onChange={(e) => setRate({ ...rate, date: e.target.value })} />
          <input placeholder="Cena" style={{ width: 110 }} value={rate.price} onChange={(e) => setRate({ ...rate, price: e.target.value })} />
          <button className="btn" onClick={saveRate}>Nastavit</button>
        </div>
      </div>
    </>
  );
}

function PriceCell({ v, onSave }: { v: string | null; onSave: (v: string) => void }) {
  const [val, setVal] = useState(v == null ? "" : parseFloat(v).toString());
  return <div className="row"><input style={{ width: 100 }} value={val} onChange={(e) => setVal(e.target.value)} /><button className="btn sm ghost" onClick={() => onSave(val)}>✓</button></div>;
}

// Revenue / pricing agent — návrh dynamických cen ke schválení.
function PricingPanel({ types, onApplied }: { types: RoomType[]; onApplied: (n: number) => void }) {
  const [roomTypeId, setRoomTypeId] = useState("");
  const [horizon, setHorizon] = useState(14);
  const [sug, setSug] = useState<PricingSuggestion | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  const load = async () => {
    if (!roomTypeId) return;
    setBusy(true); setErr(""); setSug(null);
    try {
      const s = await api.pricingSuggestions(roomTypeId, horizon);
      setSug(s);
      setSel(new Set(s.days.filter((d) => d.changed).map((d) => d.date))); // předvyber jen změny
    } catch (e) { setErr(e instanceof Error ? e.message : "Chyba návrhu cen."); }
    finally { setBusy(false); }
  };
  const toggle = (date: string) => { const n = new Set(sel); n.has(date) ? n.delete(date) : n.add(date); setSel(n); };
  const apply = async () => {
    if (!sug || !sel.size) return;
    const items = sug.days.filter((d) => sel.has(d.date)).map((d) => ({ date: d.date, price: parseFloat(d.suggestedPrice) }));
    setBusy(true); setErr("");
    try { const r = await api.pricingApply(sug.roomTypeId, items); onApplied(r.applied); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Chyba zápisu cen."); }
    finally { setBusy(false); }
  };

  const arrow = (d: DaySuggestion) => d.direction === "up" ? "▲" : d.direction === "down" ? "▼" : "=";
  return (
    <div className="panel">
      <h3>✨ Návrh cen (revenue agent)</h3>
      <div className="toolbar" style={{ padding: 16 }}>
        <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}><option value="">Typ…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <label className="row">Horizont <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>{[7, 14, 30].map((n) => <option key={n} value={n}>{n} dní</option>)}</select></label>
        <button className="btn" onClick={load} disabled={!roomTypeId || busy}>{busy ? "Počítám…" : "Navrhnout ceny"}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {sug && (
        <>
          <div className="toolbar" style={{ padding: "0 16px 12px" }}>
            <span className="muted">Základní cena {money(sug.basePrice)} · návrhů změn {sug.counts.changed} ({sug.counts.up}× nahoru, {sug.counts.down}× dolů) · vybráno {sel.size}</span>
            <button className="btn ok" style={{ marginLeft: "auto" }} onClick={apply} disabled={!sel.size || busy}>Schválit vybrané ({sel.size})</button>
          </div>
          <Table cols={["", "Datum", "Obsazenost", "Současná", "Návrh", "Důvod"]} rows={sug.days} empty="—"
            render={(dd: DaySuggestion) => (
              <tr key={dd.date} className={dd.changed ? `row-price-${dd.direction}` : ""}>
                <td><input type="checkbox" checked={sel.has(dd.date)} disabled={!dd.changed} onChange={() => toggle(dd.date)} /></td>
                <td>{d(dd.date)} <span className="muted">{dd.weekday}{dd.weekend ? " ·víkend" : ""}</span></td>
                <td className="muted">{dd.occupancyPct}% ({dd.bookedUnits}/{dd.totalUnits})</td>
                <td>{money(dd.currentPrice)}</td>
                <td className={`price-${dd.direction}`}>{dd.changed ? <b>{arrow(dd)} {money(dd.suggestedPrice)}</b> : <span className="muted">{money(dd.suggestedPrice)}</span>}</td>
                <td className="muted">{dd.reason}</td>
              </tr>
            )} />
        </>
      )}
    </div>
  );
}

// ── Registration book ────────────────────────────────────────
function BookView({ selId }: { selId: string }) {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const { data, error, reload } = useAsync<RegistrationEntry[]>(() => api.registrations(from, to), [selId]);
  const exportCsv = () => {
    const rows = data ?? [];
    const head = ["Jméno", "Narození", "Národnost", "Doklad", "Číslo", "Adresa", "Od", "Do"];
    const lines = rows.map((r) => [r.fullName, d(r.dateOfBirth), r.nationality, r.documentType, r.documentNumber, r.homeAddress, d(r.stayFrom), d(r.stayTo)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `kniha-hostu-${from}_${to}.csv`; a.click();
  };
  return (
    <>
      <div className="h1">Evidenční kniha</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn ghost" onClick={reload}>Načíst</button>
        <button className="btn" onClick={exportCsv}>⬇ Export CSV</button>
      </div>
      <div className="panel">
        <Table cols={["Jméno", "Narození", "Národnost", "Doklad", "Adresa", "Pobyt"]} rows={data ?? []} empty="Žádné záznamy"
          render={(r: RegistrationEntry) => (<tr key={r.id}><td>{r.fullName}</td><td>{d(r.dateOfBirth)}</td><td>{r.nationality}</td><td className="muted">{r.documentType === "passport" ? "pas" : "OP"} {r.documentNumber}</td><td className="muted">{r.homeAddress}</td><td>{d(r.stayFrom)} → {d(r.stayTo)}</td></tr>)} />
      </div>
    </>
  );
}

// ── CENTRÁLA: Provozovny ─────────────────────────────────────
type PropEdit = { name: string; identifier: string; street: string; city: string; phone: string; email: string; ico: string; dic: string; iban: string; cityTaxPerPersonNight: string; inventoryUnit: string; infoText: string };

function PropertiesView() {
  const { data, error, reload } = useAsync<Property[]>(() => api.centralProperties(), []);
  const [nw, setNw] = useState({ identifier: "", name: "", type: "hotel", city: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState<PropEdit | null>(null);
  const [msg, setMsg] = useState("");

  const add = async () => { if (!nw.identifier || !nw.name) return; await api.createProperty(nw); setNw({ identifier: "", name: "", type: "hotel", city: "" }); reload(); };
  const toggle = async (p: Property, field: "cityTaxEnabled" | "allowLongTerm" | "selfCheckin" | "breakfastIncluded" | "active") => { await api.updateProperty(p.id, { [field]: !p[field] }); reload(); };
  const startEdit = (p: Property) => {
    setEditId(p.id);
    setEf({ name: p.name, identifier: p.identifier, street: p.street ?? "", city: p.city ?? "", phone: p.phone ?? "", email: p.email ?? "", ico: p.ico ?? "", dic: p.dic ?? "", iban: p.iban ?? "", cityTaxPerPersonNight: parseFloat(p.cityTaxPerPersonNight).toString(), inventoryUnit: p.inventoryUnit, infoText: p.infoText ?? "" });
  };
  const saveEdit = async () => {
    if (!editId || !ef) return;
    await api.updateProperty(editId, { ...ef, cityTaxPerPersonNight: Number(ef.cityTaxPerPersonNight) });
    setMsg("Provozovna uložena."); setEditId(null); setEf(null); reload();
  };

  return (
    <>
      <div className="h1">Provozovny (centrála)</div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="error" style={{ background: "#e6f7ee", color: "var(--ok)" }}>{msg}</div>}

      <div className="panel">
        <h3>Nová provozovna</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <input placeholder="Identifikátor (HOTEL-XX-01)" value={nw.identifier} onChange={(e) => setNw({ ...nw, identifier: e.target.value })} />
          <input placeholder="Název" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
          <input placeholder="Město" value={nw.city} onChange={(e) => setNw({ ...nw, city: e.target.value })} />
          <select value={nw.type} onChange={(e) => setNw({ ...nw, type: e.target.value })}><option value="hotel">Hotel</option><option value="penzion">Penzion</option><option value="ubytovna">Ubytovna</option></select>
          <button className="btn" onClick={add}>+ Založit</button>
        </div>
        <div className="muted" style={{ padding: "0 16px 16px" }}>Typ nastaví výchozí chování, které lze u každé provozovny přepnout.</div>
      </div>

      {editId && ef && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 style={{ border: "none", padding: 0, marginBottom: 14 }}>Úprava provozovny</h3>
          <div className="toolbar">
            <label className="row">Název <input value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></label>
            <label className="row">Identifikátor <input value={ef.identifier} onChange={(e) => setEf({ ...ef, identifier: e.target.value })} /></label>
          </div>
          <div className="toolbar">
            <input placeholder="Ulice" value={ef.street} onChange={(e) => setEf({ ...ef, street: e.target.value })} />
            <input placeholder="Město" value={ef.city} onChange={(e) => setEf({ ...ef, city: e.target.value })} />
            <input placeholder="Telefon" value={ef.phone} onChange={(e) => setEf({ ...ef, phone: e.target.value })} />
            <input placeholder="E-mail" value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} />
          </div>
          <div className="toolbar">
            <input placeholder="IČO (na dokladech)" value={ef.ico} onChange={(e) => setEf({ ...ef, ico: e.target.value })} />
            <input placeholder="DIČ" value={ef.dic} onChange={(e) => setEf({ ...ef, dic: e.target.value })} />
            <input placeholder="IBAN (QR platba)" style={{ minWidth: 240 }} value={ef.iban} onChange={(e) => setEf({ ...ef, iban: e.target.value })} />
          </div>
          <div style={{ padding: "4px 0 10px" }}>
            <div className="muted" style={{ marginBottom: 6 }}>Informace pro AI asistenta (FAQ — wifi, snídaně, parkování, pravidla, okolí…):</div>
            <textarea style={{ width: "100%", minHeight: 100, resize: "vertical" }} value={ef.infoText} onChange={(e) => setEf({ ...ef, infoText: e.target.value })} placeholder="Např.: Wi-Fi heslo je 'vitejte'. Snídaně 7–10 v přízemí. Parkování zdarma na dvoře. Check-in od 14:00, check-out do 10:00. Domácí mazlíčci povoleni." />
          </div>
          <div className="toolbar">
            <label className="row">Pobytový poplatek / os. / noc <input style={{ width: 90 }} value={ef.cityTaxPerPersonNight} onChange={(e) => setEf({ ...ef, cityTaxPerPersonNight: e.target.value })} /> Kč</label>
            <label className="row">Jednotka <select value={ef.inventoryUnit} onChange={(e) => setEf({ ...ef, inventoryUnit: e.target.value })}><option value="room">pokoj</option><option value="bed">lůžko</option></select></label>
            <button className="btn" onClick={saveEdit}>Uložit</button>
            <button className="btn ghost" onClick={() => { setEditId(null); setEf(null); }}>Zrušit</button>
          </div>
        </div>
      )}

      <div className="panel">
        <Table cols={["Identifikátor", "Název", "Typ", "Jednotka", "Poplatek", "Dlouhodobě", "Self check-in", "Aktivní", ""]} rows={data ?? []} empty="Žádné"
          render={(p: Property) => (
            <tr key={p.id}>
              <td className="muted">{p.identifier}</td><td><b>{p.name}</b><div className="muted">{[p.street, p.city].filter(Boolean).join(", ")}</div></td>
              <td><Badge s={p.type} /></td><td>{p.inventoryUnit === "bed" ? "lůžko" : "pokoj"}</td>
              <td><Toggle on={p.cityTaxEnabled} onClick={() => toggle(p, "cityTaxEnabled")} /> {p.cityTaxEnabled && <span className="muted">{money(p.cityTaxPerPersonNight)}</span>}</td>
              <td><Toggle on={p.allowLongTerm} onClick={() => toggle(p, "allowLongTerm")} /></td>
              <td><Toggle on={p.selfCheckin} onClick={() => toggle(p, "selfCheckin")} /></td>
              <td><Toggle on={p.active} onClick={() => toggle(p, "active")} /></td>
              <td className="right"><button className="btn sm ghost" onClick={() => startEdit(p)}>Upravit</button></td>
            </tr>
          )} />
      </div>
    </>
  );
}
const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => <button className={`btn sm ${on ? "ok" : "ghost"}`} onClick={onClick}>{on ? "ANO" : "ne"}</button>;

// ── CENTRÁLA: Uživatelé ──────────────────────────────────────
function UsersView({ currentUserId }: { currentUserId: string }) {
  const { data, error, reload } = useAsync<User[]>(() => api.users(), []);
  const props = useAsync<Property[]>(() => api.centralProperties(), []);
  const [nw, setNw] = useState({ email: "", name: "", password: "", role: "manager", propertyIds: [] as string[] });
  const [editId, setEditId] = useState<string | null>(null);
  const [eProps, setEProps] = useState<string[]>([]);
  const [ePwd, setEPwd] = useState("");
  const [msg, setMsg] = useState("");

  const add = async () => { if (!nw.email || !nw.name || !nw.password) return; await api.createUser(nw); setNw({ email: "", name: "", password: "", role: "manager", propertyIds: [] }); reload(); };
  const del = async (u: User) => { if (confirm(`Smazat uživatele ${u.name}?`)) { await api.deleteUser(u.id); reload(); } };
  const startEdit = (u: User) => { setEditId(u.id); setEProps((u.properties ?? []).map((x) => x.property.id)); setEPwd(""); setMsg(""); };
  const saveAssign = async () => { if (!editId) return; await api.setUserProperties(editId, eProps); setMsg("Provozovny uloženy."); reload(); };
  const savePwd = async () => { if (!editId || ePwd.length < 4) { setMsg("Heslo min. 4 znaky."); return; } await api.updateUser(editId, { password: ePwd }); setMsg("Heslo změněno."); setEPwd(""); };

  const editing = (data ?? []).find((u) => u.id === editId);

  return (
    <>
      <div className="h1">Uživatelé (centrála)</div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="error" style={{ background: "#e6f7ee", color: "var(--ok)" }}>{msg}</div>}

      <div className="panel">
        <h3>Nový uživatel</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <input placeholder="E-mail" value={nw.email} onChange={(e) => setNw({ ...nw, email: e.target.value })} />
          <input placeholder="Jméno" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
          <input placeholder="Heslo" type="password" value={nw.password} onChange={(e) => setNw({ ...nw, password: e.target.value })} />
          <select value={nw.role} onChange={(e) => setNw({ ...nw, role: e.target.value })}><option value="manager">Správce</option><option value="housekeeping">Úklid</option><option value="maintenance">Údržba</option><option value="super_admin">Super-admin</option></select>
          <button className="btn" onClick={add}>+ Vytvořit</button>
        </div>
        {nw.role !== "super_admin" && (
          <div style={{ padding: "0 16px 16px" }}>
            <div className="muted" style={{ marginBottom: 6 }}>Přiřazené provozovny:</div>
            {(props.data ?? []).map((p) => (
              <label key={p.id} className="chip" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={nw.propertyIds.includes(p.id)} onChange={(e) => setNw({ ...nw, propertyIds: e.target.checked ? [...nw.propertyIds, p.id] : nw.propertyIds.filter((x) => x !== p.id) })} /> {p.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 style={{ border: "none", padding: 0, marginBottom: 14 }}>Úprava: {editing.name}</h3>
          {editing.role !== "super_admin" && (
            <div style={{ marginBottom: 14 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Přiřazené provozovny:</div>
              {(props.data ?? []).map((p) => (
                <label key={p.id} className="chip" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={eProps.includes(p.id)} onChange={(e) => setEProps(e.target.checked ? [...eProps, p.id] : eProps.filter((x) => x !== p.id))} /> {p.name}
                </label>
              ))}
              <button className="btn sm" style={{ marginLeft: 10 }} onClick={saveAssign}>Uložit provozovny</button>
            </div>
          )}
          <div className="toolbar">
            <input placeholder="Nové heslo" type="password" value={ePwd} onChange={(e) => setEPwd(e.target.value)} />
            <button className="btn" onClick={savePwd}>Změnit heslo</button>
            <button className="btn ghost" onClick={() => setEditId(null)}>Zavřít</button>
          </div>
        </div>
      )}

      <div className="panel">
        <Table cols={["Jméno", "E-mail", "Role", "Provozovny", ""]} rows={data ?? []} empty="Žádní"
          render={(u: User) => (
            <tr key={u.id}>
              <td><b>{u.name}</b></td><td className="muted">{u.email}</td><td><Badge s={u.role} /></td>
              <td>{u.role === "super_admin" ? "všechny" : (u.properties ?? []).map((x) => x.property.name).join(", ") || "—"}</td>
              <td className="right">
                <button className="btn sm ghost" onClick={() => startEdit(u)}>Upravit</button>{" "}
                <button className="btn sm danger" disabled={u.id === currentUserId} onClick={() => del(u)}>Smazat</button>
              </td>
            </tr>
          )} />
      </div>
    </>
  );
}

// ── Detail rezervace ─────────────────────────────────────────
function ReservationDetailView({ id, prop, onBack }: { id: string; prop?: Property; onBack: () => void }) {
  const { data, error, reload } = useAsync<ReservationDetail>(() => api.reservation(id), [id]);
  const folioA = useAsync<Folio>(() => api.resFolio(id), [id]);
  const chargesA = useAsync<Charge[]>(() => api.charges(id), [id]);
  const guestsA = useAsync<ResGuest[]>(() => api.resGuests(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState("");
  const [chg, setChg] = useState({ category: "minibar", description: "", quantity: "1", unitPrice: "" });
  const [ng, setNg] = useState({ firstName: "", lastName: "" });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [issuedDoc, setIssuedDoc] = useState<Doc | null>(null);
  const [guestQr, setGuestQr] = useState(false);
  const openReceipt = async (fn: () => Promise<Receipt>) => { try { setReceipt(await fn()); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } };
  const issueDoc = async (fn: () => Promise<Doc>) => { setBusy(true); setActErr(""); try { setIssuedDoc(await fn()); refresh(); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const askProforma = () => { const v = prompt("Částka zálohy (Kč):"); if (!v) return; const n = parseFloat(v.replace(",", ".")); if (!isNaN(n) && n > 0) issueDoc(() => api.issueProforma(id, n)); };
  const askPeriod = () => { const from = prompt("Období OD (RRRR-MM-DD):"); if (!from) return; const to = prompt("Období DO (RRRR-MM-DD):"); if (!to) return; issueDoc(() => api.periodInvoice(id, from, to)); };

  const refresh = () => { reload(); folioA.reload(); chargesA.reload(); guestsA.reload(); };
  const addGuest = () => { if (!ng.firstName || !ng.lastName) return; run(async () => { await api.addResGuest(id, { firstName: ng.firstName, lastName: ng.lastName }); setNg({ firstName: "", lastName: "" }); }); };
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setActErr(""); try { await fn(); refresh(); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const addCharge = () => { const q = parseFloat(chg.quantity.replace(",", ".")) || 1; const p = parseFloat(chg.unitPrice.replace(",", ".")); if (isNaN(p) || p < 0) return; run(async () => { await api.addCharge(id, { category: chg.category, description: chg.description || undefined, quantity: q, unitPrice: p }); setChg({ category: chg.category, description: "", quantity: "1", unitPrice: "" }); }); };

  if (error) return <><div className="h1"><button className="btn ghost" onClick={onBack}>← Zpět</button></div><div className="error">{error}</div></>;
  if (!data) return <div className="muted" style={{ padding: 20 }}>Načítám…</div>;
  const r = data; const folio = folioA.data;
  const bal = folio ? parseFloat(folio.balance) : 0;
  const canCheckIn = ["confirmed", "pending"].includes(r.status);
  const canCheckOut = r.status === "checked_in";
  const showInvoice = !!r.billingCompany || prop?.type === "ubytovna";

  return (
    <>
      <div className="h1"><span><button className="btn ghost" onClick={onBack}>← Zpět</button>&nbsp;&nbsp;Rezervace {r.code}</span> <Badge s={r.status} /></div>
      {actErr && <div className="error">{actErr}</div>}

      <div className="grid2">
        <div className="panel"><h3>Údaje</h3><div style={{ padding: 16 }}>
          <div className="kvline"><span className="muted">Host</span><b>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}</b></div>
          <div className="kvline"><span className="muted">Kontakt</span><span>{r.primaryGuest?.email ?? "—"} · {r.primaryGuest?.phone ?? "—"}</span></div>
          <div className="kvline"><span className="muted">Termín</span><span>{d(r.checkInDate)} → {d(r.checkOutDate)} ({r.nights} nocí)</span></div>
          <div className="kvline"><span className="muted">Jednotka</span><span>{r.room?.number ?? r.bed?.label ?? r.roomType?.name ?? "—"}</span></div>
          {r.billingCompany && <div className="kvline"><span className="muted">Fakturovat</span><span>{r.billingCompany}{r.billingIco ? ` (IČO ${r.billingIco})` : ""}</span></div>}
        </div></div>
        <div className="panel"><h3>Vyúčtování</h3><div style={{ padding: 16 }}>
          <div className="kvline"><span className="muted">Celkem</span><b>{folio ? money(folio.charges) : "…"}</b></div>
          <div className="kvline"><span className="muted">Zaplaceno</span><span>{folio ? money(folio.paid) : "…"}</span></div>
          <div className="kvline"><span className="muted">{bal >= 0 ? "Zbývá doplatit" : "Přeplatek"}</span><b style={{ color: bal > 0 ? "var(--warn)" : "var(--ok)" }}>{folio ? money(Math.abs(bal)) : "…"}</b></div>
        </div></div>
      </div>

      <div className="panel" style={{ padding: 16 }}>
        <h3 style={{ border: "none", padding: 0, marginBottom: 12 }}>Akce</h3>
        <div className="toolbar">
          {canCheckIn && <button className="btn ok" disabled={busy} onClick={() => run(() => api.checkin(id))}>Check-in</button>}
          {canCheckOut && <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await api.checkout(id); if (r.document) setIssuedDoc(r.document); })}>Check-out</button>}
          {bal > 0 && <button className="btn" disabled={busy} onClick={() => run(() => api.addPayment(id, { type: "balance", amount: bal, method: "card_terminal" }))}>Doplatit {money(bal)} kartou</button>}
          {bal > 0 && showInvoice && <button className="btn secondary" disabled={busy} onClick={() => run(() => api.addPayment(id, { type: "balance", amount: bal, method: "invoice", invoiceNumber: `FA-${r.code.replace("RC-", "")}` }))}>Zaplaceno fakturou</button>}
          <button className="btn ghost" disabled={busy} onClick={() => issueDoc(() => api.issueDocument(id, "invoice"))}>📄 Vystavit fakturu</button>
          <button className="btn ghost" disabled={busy} onClick={() => issueDoc(() => api.issueDocument(id, "receipt"))}>🧾 Vystavit účtenku</button>
          <button className="btn ghost" disabled={busy} onClick={askProforma}>💶 Zálohová faktura</button>
          {(prop?.allowLongTerm || r.billingCycle === "monthly") && <button className="btn ghost" disabled={busy} onClick={askPeriod}>📅 Faktura za období</button>}
          <button className="btn ghost" onClick={() => setGuestQr(true)}>🏷 QR pro hosta</button>
        </div>
      </div>

      <div className="panel"><h3>Hosté na pokoji</h3>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <input placeholder="Jméno" value={ng.firstName} onChange={(e) => setNg({ ...ng, firstName: e.target.value })} />
          <input placeholder="Příjmení" value={ng.lastName} onChange={(e) => setNg({ ...ng, lastName: e.target.value })} />
          <button className="btn" disabled={busy || !ng.firstName || !ng.lastName} onClick={addGuest}>+ Přidat osobu</button>
        </div>
        <Table cols={["Jméno", "Role", "Kontakt", ""]} rows={guestsA.data ?? []} empty="—"
          render={(g: ResGuest) => (
            <tr key={g.id}>
              <td>{g.guest.firstName} {g.guest.lastName}</td>
              <td>{g.isPrimary ? <span className="chip">hlavní host</span> : <span className="muted">spolubydlící</span>}</td>
              <td className="muted">{g.guest.email ?? g.guest.phone ?? "—"}</td>
              <td className="right">{!g.isPrimary && <button className="btn sm danger" onClick={() => run(() => api.removeResGuest(g.id))}>Odebrat</button>}</td>
            </tr>
          )} />
      </div>

      <div className="panel"><h3>Účet pokoje — náklady</h3>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <select value={chg.category} onChange={(e) => setChg({ ...chg, category: e.target.value })}>
            {Object.entries(CHARGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input placeholder="Popis (cola, masáž…)" value={chg.description} onChange={(e) => setChg({ ...chg, description: e.target.value })} />
          <input placeholder="Ks" style={{ width: 60 }} value={chg.quantity} onChange={(e) => setChg({ ...chg, quantity: e.target.value })} />
          <input placeholder="Cena/ks" style={{ width: 100 }} value={chg.unitPrice} onChange={(e) => setChg({ ...chg, unitPrice: e.target.value })} />
          <button className="btn" disabled={busy || !chg.unitPrice} onClick={addCharge}>+ Připsat na účet</button>
        </div>
        <Table cols={["Datum", "Kategorie", "Popis", "Ks", "Cena", "Celkem", ""]} rows={chargesA.data ?? []} empty="Žádné připsané položky"
          render={(c: Charge) => (
            <tr key={c.id}>
              <td className="muted">{c.createdAt.slice(0, 10)}</td>
              <td>{CHARGE_LABEL[c.category] ?? c.category}</td>
              <td>{c.description ?? "—"}</td>
              <td className="muted">{parseFloat(c.quantity)}</td>
              <td className="muted">{money(c.unitPrice)}</td>
              <td>{money(c.amount)}</td>
              <td className="right"><button className="btn sm danger" onClick={() => run(() => api.deleteCharge(c.id))}>Smazat</button></td>
            </tr>
          )} />
      </div>

      <div className="panel"><h3>Platby</h3>
        <Table cols={["Datum", "Typ", "Popis", "Způsob", "Částka", ""]} rows={r.payments} empty="Žádné platby"
          render={(p: Payment) => (<tr key={p.id}><td className="muted">{p.createdAt.slice(0, 10)}</td><td>{PAY_TYPE_LABEL[p.type] ?? p.type}</td><td>{p.description ?? "—"}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}</td><td className="muted">{PAY_METHOD_LABEL[p.method] ?? p.method}</td><td>{money(p.amount)}</td><td className="right">{p.type !== "deposit_hold" && <button className="btn sm ghost" onClick={() => openReceipt(() => api.paymentReceipt(p.id))}>🧾</button>}</td></tr>)} />
      </div>

      {r.registrationEntries.length > 0 && (
        <div className="panel"><h3>Evidenční kniha</h3>
          <Table cols={["Jméno", "Narození", "Doklad", "Pobyt"]} rows={r.registrationEntries} empty=""
            render={(e: RegistrationEntry) => (<tr key={e.id}><td>{e.fullName}</td><td>{d(e.dateOfBirth)}</td><td className="muted">{e.documentNumber}</td><td>{d(e.stayFrom)} → {d(e.stayTo)}</td></tr>)} />
        </div>
      )}

      {issuedDoc && <DocumentOverlay doc={issuedDoc} onClose={() => setIssuedDoc(null)} />}
      {receipt && <ReceiptOverlay rec={receipt} onClose={() => setReceipt(null)} />}
      {guestQr && <GuestQrLabels rows={[{ code: r.code, title: r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : r.code, subtitle: `${r.primaryGuest?.firstName ?? ""} ${r.primaryGuest?.lastName ?? ""}`.trim() }]} onClose={() => setGuestQr(false)} />}
    </>
  );
}

function InvoiceOverlay({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice" onClick={(e) => e.stopPropagation()}>
        <div className="inv-head">
          <div><h2 style={{ margin: 0 }}>Faktura {inv.number}</h2><div className="muted">{inv.property.name}<br />{[inv.property.street, inv.property.city].filter(Boolean).join(", ")}</div></div>
          <div className="inv-to"><div className="muted">Odběratel</div><b>{inv.billing.company ?? `${inv.guest.firstName} ${inv.guest.lastName}`}</b>{inv.billing.ico && <div>IČO: {inv.billing.ico}</div>}{inv.billing.dic && <div>DIČ: {inv.billing.dic}</div>}</div>
        </div>
        <div className="muted" style={{ margin: "6px 0 14px" }}>Pobyt {d(inv.reservation.checkInDate)} → {d(inv.reservation.checkOutDate)} · rezervace {inv.reservation.code}</div>
        <table><thead><tr><th>Položka</th><th className="right">Částka</th></tr></thead>
          <tbody>{inv.lines.map((l, i) => (<tr key={i}><td>{l.label}</td><td className="right">{money(l.amount)}</td></tr>))}</tbody></table>
        <div className="inv-total"><span>Celkem k úhradě</span><b>{money(inv.total)}</b></div>
        <div className="kvline"><span className="muted">Zaplaceno</span><span>{money(inv.paid)}</span></div>
        <div className="kvline"><span className="muted">Zbývá</span><b>{money(inv.balance)}</b></div>
        <div className="inv-actions no-print"><button className="btn" onClick={() => window.print()}>🖨 Tisk</button><button className="btn ghost" onClick={onClose}>Zavřít</button></div>
      </div>
    </div>
  );
}

// ── Úhrady: seznam + doklady o zaplacení ─────────────────────
function PaymentsView({ selId }: { selId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, error } = useAsync<PaymentsList>(() => api.payments(from, to), [selId, from, to]);
  const [rec, setRec] = useState<Receipt | null>(null);
  const [busyId, setBusyId] = useState("");
  const openReceipt = async (id: string) => {
    setBusyId(id);
    try { setRec(await api.paymentReceipt(id)); } catch { /* */ } finally { setBusyId(""); }
  };
  const t = data?.totals;
  return (
    <>
      <div className="h1">Úhrady</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <label className="row">Od <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row">Do <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(from || to) && <button className="btn ghost sm" onClick={() => { setFrom(""); setTo(""); }}>Zrušit filtr</button>}
        {t && <span className="muted" style={{ marginLeft: "auto" }}>{t.count} přijatých úhrad · celkem <b>{money(t.total)}</b></span>}
      </div>
      {t && Object.keys(t.byMethod).length > 0 && (
        <div className="toolbar" style={{ gap: 16, marginTop: -6 }}>
          {Object.entries(t.byMethod).map(([m, v]) => <span key={m} className="muted">{PAY_METHOD_LABEL[m] ?? m}: <b>{money(v)}</b></span>)}
        </div>
      )}
      <div className="panel">
        <Table cols={["Datum", "Rezervace", "Host", "Typ", "Způsob", "Částka", ""]} rows={data?.payments ?? []} empty="Žádné úhrady"
          render={(p: PaymentRow) => (
            <tr key={p.id}>
              <td className="muted">{p.createdAt.slice(0, 10)}</td>
              <td>{p.reservation?.code ?? "—"}</td>
              <td>{p.reservation?.primaryGuest ? `${p.reservation.primaryGuest.firstName} ${p.reservation.primaryGuest.lastName}` : "—"}</td>
              <td>{PAY_TYPE_LABEL[p.type] ?? p.type}{p.status !== "succeeded" && <span className="chip">{p.status}</span>}</td>
              <td className="muted">{PAY_METHOD_LABEL[p.method] ?? p.method}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}</td>
              <td>{money(p.amount)}</td>
              <td className="right">{p.type !== "deposit_hold" && <button className="btn sm ghost" disabled={busyId === p.id} onClick={() => openReceipt(p.id)}>🧾 Doklad</button>}</td>
            </tr>
          )} />
      </div>
      {rec && <ReceiptOverlay rec={rec} onClose={() => setRec(null)} />}
    </>
  );
}

// Tisknutelný doklad o zaplacení (za platbu i souhrnný za pobyt).
function ReceiptOverlay({ rec, onClose }: { rec: Receipt; onClose: () => void }) {
  const p = rec.property;
  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice" onClick={(e) => e.stopPropagation()}>
        <div className="inv-head">
          <div>
            <h2 style={{ margin: 0 }}>Doklad o zaplacení</h2>
            <div className="muted" style={{ marginTop: 2 }}>č. {rec.number}{rec.kind === "stay" ? " · souhrn za pobyt" : ""}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              <b>{p.name}</b><br />
              {[p.street, p.city].filter(Boolean).join(", ")}
              {(p.ico || p.dic) && <><br />{p.ico ? `IČO: ${p.ico}` : ""}{p.ico && p.dic ? " · " : ""}{p.dic ? `DIČ: ${p.dic}` : ""}</>}
            </div>
          </div>
          <div className="inv-to">
            <div className="muted">Plátce</div>
            <b>{rec.billing.company ?? `${rec.guest.firstName} ${rec.guest.lastName}`}</b>
            {rec.billing.ico && <div>IČO: {rec.billing.ico}</div>}
            {rec.billing.dic && <div>DIČ: {rec.billing.dic}</div>}
          </div>
        </div>
        <div className="muted" style={{ margin: "6px 0 14px" }}>
          Vystaveno {d(rec.issuedAt)} · pobyt {d(rec.reservation.checkInDate)} → {d(rec.reservation.checkOutDate)}{rec.reservation.roomType ? ` · ${rec.reservation.roomType}` : ""} · rezervace {rec.reservation.code}
        </div>
        <table>
          <thead><tr><th>Datum</th><th>Položka</th><th>Způsob</th><th className="right">Částka</th></tr></thead>
          <tbody>{rec.lines.map((l: ReceiptLine, i: number) => (
            <tr key={i}><td className="muted">{d(l.date)}</td><td>{PAY_TYPE_LABEL[l.type] ?? l.type}{l.description ? ` — ${l.description}` : ""}</td><td className="muted">{PAY_METHOD_LABEL[l.method] ?? l.method}</td><td className="right">{money(l.amount)}</td></tr>
          ))}</tbody>
        </table>
        <div className="inv-total"><span>Zaplaceno celkem</span><b>{money(rec.totalPaid)}</b></div>
        {rec.kind === "stay" && rec.charges != null && (
          <>
            <div className="kvline"><span className="muted">Celkem k úhradě</span><span>{money(rec.charges)}</span></div>
            <div className="kvline"><span className="muted">Zbývá doplatit</span><b>{money(rec.balance ?? "0")}</b></div>
          </>
        )}
        <div className="muted" style={{ marginTop: 14, fontSize: 13 }}>Potvrzujeme přijetí platby. Děkujeme.</div>
        <div className="inv-actions no-print"><button className="btn" onClick={() => window.print()}>🖨 Tisk</button><button className="btn ghost" onClick={onClose}>Zavřít</button></div>
      </div>
    </div>
  );
}

// ── Doklady: seznam + tisknutelný doklad ─────────────────────
function DocumentsView({ selId }: { selId: string }) {
  const [type, setType] = useState("");
  const { data, error, reload } = useAsync<Doc[]>(() => api.documents(type ? `?type=${type}` : ""), [selId, type]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const open = async (id: string) => { try { setDoc(await api.document(id)); } catch { /* */ } };
  const cancel = async (id: string) => { if (!confirm("Opravdu stornovat doklad?")) return; await api.cancelDocument(id); reload(); };
  const exportCsv = async () => {
    try {
      const csv = await api.documentsCsv(type ? `?type=${type}` : "");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = "doklady.csv"; a.click(); URL.revokeObjectURL(url);
    } catch { /* */ }
  };
  return (
    <>
      <div className="h1">Doklady</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Všechny typy</option>
          {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={exportCsv}>⬇ Export CSV</button>
      </div>
      <div className="panel">
        <Table cols={["Číslo", "Datum", "Typ", "Odběratel", "Celkem", "Stav", ""]} rows={data ?? []} empty="Žádné doklady"
          render={(r: Doc) => (
            <tr key={r.id} className={r.status === "cancelled" ? "row-cancelled" : ""}>
              <td><b>{r.number}</b></td>
              <td className="muted">{r.issuedAt.slice(0, 10)}</td>
              <td>{DOC_TYPE_LABEL[r.type] ?? r.type}</td>
              <td>{r.customerName}{r.reservations?.length ? <span className="muted"> · {r.reservations.map((x) => x.reservation.code).join(", ")}</span> : null}</td>
              <td>{money(r.total)}</td>
              <td><Badge s={r.status} /></td>
              <td className="right" style={{ whiteSpace: "nowrap" }}>
                <button className="btn sm ghost" onClick={() => open(r.id)}>Otevřít</button>{" "}
                {r.status !== "cancelled" && <button className="btn sm danger" onClick={() => cancel(r.id)}>Storno</button>}
              </td>
            </tr>
          )} />
      </div>
      {doc && <DocumentOverlay doc={doc} onClose={() => { setDoc(null); reload(); }} />}
    </>
  );
}

function DocumentOverlay({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const [cur, setCur] = useState<Doc>(doc);
  const [busy, setBusy] = useState(false);
  const [perr, setPerr] = useState("");
  const [qrImg, setQrImg] = useState("");
  useEffect(() => { if (cur.qrPayment) QRCode.toDataURL(cur.qrPayment, { margin: 1, width: 150 }).then(setQrImg).catch(() => setQrImg("")); else setQrImg(""); }, [cur.qrPayment]);
  const due = parseFloat(cur.total) - parseFloat(cur.paidTotal);
  const pay = async (method: "cash" | "card_terminal") => {
    setBusy(true); setPerr("");
    try { setCur(await api.payDocument(cur.id, method)); }
    catch (e) { setPerr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  // Vytvoří navazující doklad (dobropis / daňový doklad k záloze) a zobrazí ho.
  const act = async (fn: () => Promise<Doc>) => {
    setBusy(true); setPerr("");
    try { setCur(await fn()); }
    catch (e) { setPerr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice" onClick={(e) => e.stopPropagation()}>
        <div className="inv-head">
          <div>
            <h2 style={{ margin: 0 }}>{DOC_TYPE_LABEL[cur.type] ?? "Doklad"}</h2>
            <div className="muted" style={{ marginTop: 2 }}>č. {cur.number}{cur.status === "cancelled" ? " · STORNO" : cur.status === "paid" ? " · ZAPLACENO" : ""}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              <b>{cur.supplierName}</b><br />
              {cur.supplierAddress}
              {(cur.supplierIco || cur.supplierDic) && <><br />{cur.supplierIco ? `IČO: ${cur.supplierIco}` : ""}{cur.supplierIco && cur.supplierDic ? " · " : ""}{cur.supplierDic ? `DIČ: ${cur.supplierDic}` : ""}</>}
              {!cur.vatPayer && <><br />Neplátce DPH</>}
            </div>
          </div>
          <div className="inv-to">
            <div className="muted">Odběratel</div>
            <b>{cur.customerName}</b>
            {cur.customerAddress && <div>{cur.customerAddress}</div>}
            {cur.customerIco && <div>IČO: {cur.customerIco}</div>}
            {cur.customerDic && <div>DIČ: {cur.customerDic}</div>}
          </div>
        </div>
        <div className="muted" style={{ margin: "6px 0 14px" }}>
          Vystaveno {d(cur.issuedAt)}{cur.taxDate ? ` · DUZP ${d(cur.taxDate)}` : ""}{cur.dueDate ? ` · splatnost ${d(cur.dueDate)}` : ""}
          {cur.reservations?.length ? ` · rezervace ${cur.reservations.map((x) => x.reservation.code).join(", ")}` : ""}
        </div>
        <table>
          <thead><tr><th>Položka</th><th className="right">Množ.</th><th className="right">Cena</th>{cur.vatPayer && <th className="right">DPH</th>}<th className="right">Celkem</th></tr></thead>
          <tbody>{(cur.lines ?? []).map((l: DocLine) => (
            <tr key={l.id}><td>{l.label}</td><td className="right">{parseFloat(l.qty)}</td><td className="right">{money(l.unitPrice)}</td>{cur.vatPayer && <td className="right muted">{parseFloat(l.vatRate)} %</td>}<td className="right">{money(l.lineTotal)}</td></tr>
          ))}</tbody>
        </table>
        {cur.vatPayer && (<>
          <div className="kvline"><span className="muted">Základ</span><span>{money(cur.subtotal)}</span></div>
          <div className="kvline"><span className="muted">DPH</span><span>{money(cur.vatTotal)}</span></div>
        </>)}
        <div className="inv-total"><span>Celkem{cur.vatPayer ? " vč. DPH" : ""}</span><b>{money(cur.total)}</b></div>
        <div className="kvline"><span className="muted">Zaplaceno</span><span>{money(cur.paidTotal)}</span></div>
        {due > 0.005 && <div className="kvline"><span className="muted">Zbývá uhradit</span><b>{money(due.toFixed(2))}</b></div>}
        {qrImg && <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}><img src={qrImg} alt="QR platba" width={120} height={120} /><div className="muted" style={{ fontSize: 13 }}>QR platba<br />Naskenuj v bankovní aplikaci pro úhradu zálohy.</div></div>}
        {perr && <div className="error" style={{ marginTop: 10 }}>{perr}</div>}
        <div className="inv-actions no-print">
          {due > 0.005 && cur.status !== "cancelled" && <>
            <button className="btn ok" disabled={busy} onClick={() => pay("cash")}>💵 Zaplatit hotově</button>
            <button className="btn" disabled={busy} onClick={() => pay("card_terminal")}>💳 Zaplatit kartou</button>
          </>}
          {cur.type === "proforma" && <button className="btn ghost" disabled={busy} onClick={() => act(() => api.advanceTaxDoc(cur.id))}>Daňový doklad k záloze</button>}
          {cur.type !== "credit_note" && cur.status !== "cancelled" && <button className="btn ghost" disabled={busy} onClick={() => { const r = prompt("Důvod dobropisu (nepovinné):") ?? undefined; act(() => api.creditNote(cur.id, r)); }}>Dobropis</button>}
          <button className="btn ghost" onClick={() => window.print()}>🖨 Tisk</button>
          <button className="btn ghost" onClick={onClose}>Zavřít</button>
        </div>
      </div>
    </div>
  );
}

// ── Pokladna: směny, příjem/výdej, uzávěrka ──────────────────
function CashRegisterView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<CashState>(() => api.cashState(), [selId]);
  const hist = useAsync<CashSession[]>(() => api.cashSessions(), [selId]);
  const [float, setFloat] = useState("");
  const [mv, setMv] = useState<{ kind: "income" | "expense"; amount: string; note: string }>({ kind: "income", amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const reloadAll = () => { reload(); hist.reload(); };
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await fn(); reloadAll(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  const open = () => { const n = parseFloat((float || "0").replace(",", ".")); if (isNaN(n) || n < 0) return; run(() => api.cashOpen(n).then(() => setFloat(""))); };
  const addMv = () => { const n = parseFloat(mv.amount.replace(",", ".")); if (isNaN(n) || n <= 0) return; run(() => api.cashMovement(mv.kind, n, mv.note || undefined).then(() => setMv({ ...mv, amount: "", note: "" }))); };
  const close = () => {
    const s = data?.session; if (!s) return;
    const v = prompt(`Spočítaná hotovost v pokladně (Kč)?\nOčekáváno: ${s.summary.expected} Kč`);
    if (v == null) return;
    const n = parseFloat(v.replace(",", ".")); if (isNaN(n) || n < 0) return;
    run(() => api.cashClose(n));
  };

  const s = data?.session;
  return (
    <>
      <div className="h1">Pokladna <span className="muted" style={{ fontSize: 14 }}>{data?.register.name}</span></div>
      {(error || err) && <div className="error">{error || err}</div>}

      {!s ? (
        <div className="panel" style={{ padding: 24, maxWidth: 460 }}>
          <h3 style={{ border: "none", padding: 0 }}>Pokladna je zavřená</h3>
          <p className="muted">Otevři směnu zadáním počátečního stavu hotovosti.</p>
          <div className="toolbar">
            <input placeholder="Počáteční hotovost (Kč)" value={float} onChange={(e) => setFloat(e.target.value)} style={{ width: 200 }} />
            <button className="btn ok" disabled={busy} onClick={open}>Otevřít směnu</button>
          </div>
        </div>
      ) : (
        <>
          <div className="panel" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div className="muted">Otevřeno {s.openedAt.slice(0, 16).replace("T", " ")} · {s.openedByName} · počáteční {money(s.summary.openingFloat)}</div>
              <button className="btn" disabled={busy} onClick={close}>🔒 Uzávěrka</button>
            </div>
            <div className="stats" style={{ marginTop: 14 }}>
              <div className="stat"><div className="n">{money(s.summary.income)}</div><div className="l">Příjem hotově</div></div>
              <div className="stat"><div className="n">{money(s.summary.expense)}</div><div className="l">Výdej</div></div>
              <div className="stat"><div className="n">{money(s.summary.expected)}</div><div className="l">Očekávaná hotovost</div></div>
              <div className="stat"><div className="n">{money(s.summary.card)}</div><div className="l">💳 Tržby kartou</div></div>
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <h3 style={{ border: "none", padding: 0, marginBottom: 10 }}>Pohyb hotovosti</h3>
            <div className="toolbar">
              <select value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value as "income" | "expense" })}>
                <option value="income">Příjem (PPD)</option>
                <option value="expense">Výdej (VPD)</option>
              </select>
              <input placeholder="Částka" style={{ width: 110 }} value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} />
              <input placeholder="Poznámka" value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} />
              <button className="btn" disabled={busy || !mv.amount} onClick={addMv}>+ Přidat</button>
            </div>
          </div>

          <div className="panel">
            <Table cols={["Čas", "Druh", "Poznámka", "Částka"]} rows={s.movements} empty="Žádné pohyby"
              render={(m: CashMovement) => (
                <tr key={m.id}>
                  <td className="muted">{m.createdAt.slice(11, 16)}</td>
                  <td>{m.kind === "income" ? "Příjem" : "Výdej"}</td>
                  <td className="muted">{m.note ?? "—"}</td>
                  <td className={m.kind === "income" ? "price-up" : "price-down"}>{m.kind === "income" ? "+" : "−"}{money(m.amount)}</td>
                </tr>
              )} />
          </div>
        </>
      )}

      <div className="panel">
        <h3>Uzávěrky</h3>
        <Table cols={["Otevřeno", "Zavřeno", "Kdo", "Počáteční", "Příjem hot.", "Výdej", "Očekáváno", "Spočítáno", "Rozdíl", "💳 Kartou"]} rows={hist.data ?? []} empty="Žádné uzávěrky"
          render={(x: CashSession) => {
            const diff = x.summary.difference ? parseFloat(x.summary.difference) : 0;
            return (
              <tr key={x.id}>
                <td className="muted">{x.openedAt.slice(0, 16).replace("T", " ")}</td>
                <td className="muted">{x.closedAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                <td>{x.openedByName}</td>
                <td>{money(x.summary.openingFloat)}</td>
                <td>{money(x.summary.income)}</td>
                <td>{money(x.summary.expense)}</td>
                <td>{money(x.summary.expected)}</td>
                <td>{x.summary.counted ? money(x.summary.counted) : "—"}</td>
                <td className={diff < 0 ? "price-down" : diff > 0 ? "price-up" : "muted"}>{x.summary.difference ? money(x.summary.difference) : "—"}</td>
                <td className="muted">{money(x.summary.card)}</td>
              </tr>
            );
          }} />
      </div>
    </>
  );
}

type MoveOpt = { value: string; label: string };

// ── Vybavení: provozovna ─────────────────────────────────────
function EquipmentView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<Equipment[]>(() => api.equipment(), [selId]);
  const rooms = useAsync<Room[]>(() => api.rooms(), [selId]);
  const cats = useAsync<EquipCategory[]>(() => api.equipCategories(), [selId]);
  const [f, setF] = useState({ name: "", categoryId: "", code: "", serialNumber: "", acquiredAt: "", quantity: 1, roomId: "" });
  const [detail, setDetail] = useState<Equipment | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [labels, setLabels] = useState<Equipment[] | null>(null);

  const items = data ?? [];
  const refresh = () => { setSel(new Set()); reload(); };
  const add = async () => {
    if (!f.name) return;
    await api.createEquipment({ name: f.name, categoryId: f.categoryId || null, code: f.code || undefined, serialNumber: f.serialNumber || undefined, acquiredAt: f.acquiredAt || undefined, quantity: Number(f.quantity) || 1, roomId: f.roomId || null });
    setF({ name: "", categoryId: "", code: "", serialNumber: "", acquiredAt: "", quantity: 1, roomId: "" }); refresh();
  };
  const moveOptions: MoveOpt[] = [{ value: "", label: "Sklad provozovny" }, ...(rooms.data ?? []).map((r) => ({ value: r.id, label: `Pokoj ${r.number}` }))];
  const ids = [...sel];

  return (
    <>
      <div className="h1">Vybavení (DHIM)</div>
      {error && <div className="error">{error}</div>}
      <EquipStats items={items} />

      <div className="panel"><h3>Nový kus</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <input placeholder="Název" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Kategorie…</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input placeholder="Kód (prázdné = auto)" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <input placeholder="Sériové č." value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} />
          <select value={f.roomId} onChange={(e) => setF({ ...f, roomId: e.target.value })}><option value="">Sklad provozovny</option>{(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>Pokoj {r.number}</option>)}</select>
          <label className="row">Pořízeno <input type="date" value={f.acquiredAt} onChange={(e) => setF({ ...f, acquiredAt: e.target.value })} /></label>
          <label className="row">Počet <input type="number" min={1} max={500} style={{ width: 70 }} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></label>
          <button className="btn" onClick={add}>+ Přidat</button>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="panel bulkbar"><div className="toolbar" style={{ padding: 14 }}>
          <b>{sel.size} vybráno:</b>
          <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>{moveOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <button className="btn sm ok" onClick={async () => { await apiBulk("/admin/equipment/bulk-move", { ids, roomId: bulkTarget || null }); refresh(); }}>Přesunout</button>
          <button className="btn sm" onClick={async () => { const r = prompt("Důvod vyřazení:") ?? ""; await apiBulk("/admin/equipment/bulk-retire", { ids, retiredReason: r }); refresh(); }}>Vyřadit</button>
          <button className="btn sm ghost" onClick={() => setLabels(items.filter((e) => sel.has(e.id)))}>🏷 QR štítky</button>
          <button className="btn sm danger" onClick={async () => { if (confirm(`Smazat ${sel.size} kusů?`)) { await apiBulk("/admin/equipment/bulk-delete", { ids }); refresh(); } }}>Smazat</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Zrušit výběr</button>
        </div></div>
      )}

      <div className="panel">
        <div className="toolbar" style={{ padding: "10px 16px", justifyContent: "flex-end" }}><button className="btn sm ghost" onClick={() => setLabels(items)}>🏷 QR štítky všech ({items.length})</button></div>
        <EquipTable items={items} sel={sel} setSel={setSel} onDetail={setDetail} location={(e) => e.room ? `pokoj ${e.room.number}` : "sklad provozovny"} />
      </div>

      {detail && <EquipmentDetail item={detail} categories={cats.data ?? []} moveOptions={moveOptions} currentMove={detail.roomId ?? ""}
        onUpdate={(b) => api.updateEquipment(detail.id, b)} onMove={(v, note) => api.moveEquipment(detail.id, { roomId: v || null, note })}
        onDelete={() => api.deleteEquipment(detail.id)} loadMoves={() => api.equipMoves(detail.id)}
        onClose={() => setDetail(null)} onChanged={reload} />}
      {labels && <QrLabels items={labels} onClose={() => setLabels(null)} />}
    </>
  );
}

// ── Vybavení: centrála ───────────────────────────────────────
function CentralEquipmentView() {
  const props = useAsync<Property[]>(() => api.centralProperties(), []);
  const cats = useAsync<EquipCategory[]>(() => api.centralEquipCategories(), []);
  const [filter, setFilter] = useState("");
  const { data, error, reload } = useAsync<Equipment[]>(() => api.centralEquipment(filter === "central" ? "?scope=central" : filter ? `?propertyId=${filter}` : ""), [filter]);
  const [f, setF] = useState({ name: "", categoryId: "", target: "", quantity: 1 });
  const [newCat, setNewCat] = useState("");
  const [detail, setDetail] = useState<Equipment | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [labels, setLabels] = useState<Equipment[] | null>(null);

  const items = data ?? [];
  const refresh = () => { setSel(new Set()); reload(); };
  const add = async () => { if (!f.name) return; await api.centralCreateEquipment({ name: f.name, categoryId: f.categoryId || null, propertyId: f.target || null, quantity: Number(f.quantity) || 1 }); setF({ name: "", categoryId: "", target: "", quantity: 1 }); refresh(); };
  const addCat = async () => { if (!newCat.trim()) return; await api.createCategory(newCat.trim()); setNewCat(""); cats.reload(); };
  const delCat = async (c: EquipCategory) => { if (confirm(`Smazat kategorii „${c.name}"?`)) { await api.deleteCategory(c.id); cats.reload(); } };
  const loc = (e: Equipment) => e.room ? `${e.property?.name} · pokoj ${e.room.number}` : e.property ? `${e.property.name} · sklad` : "Centrální sklad";
  const moveOptions: MoveOpt[] = [{ value: "", label: "Centrální sklad" }, ...(props.data ?? []).map((p) => ({ value: p.id, label: `${p.name} · sklad` }))];
  const ids = [...sel];

  return (
    <>
      <div className="h1">Vybavení (centrála)</div>
      {error && <div className="error">{error}</div>}

      <div className="panel"><h3>Číselník kategorií</h3>
        <div style={{ padding: 16 }}>
          {(cats.data ?? []).map((c) => <span key={c.id} className="chip">{c.name} <button className="linkx" onClick={() => delCat(c)}>✕</button></span>)}
          <div className="toolbar" style={{ marginTop: 10 }}><input placeholder="Nová kategorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} /><button className="btn sm" onClick={addCat}>+ Přidat</button></div>
        </div>
      </div>

      <EquipStats items={items} />

      <div className="toolbar"><span className="muted">Filtr:</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Vše</option><option value="central">Centrální sklad</option>{(props.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      <div className="panel"><h3>Nový kus</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <input placeholder="Název" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Kategorie…</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="">Centrální sklad</option>{(props.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · sklad</option>)}</select>
          <label className="row">Počet <input type="number" min={1} max={500} style={{ width: 70 }} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></label>
          <button className="btn" onClick={add}>+ Přidat</button>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="panel bulkbar"><div className="toolbar" style={{ padding: 14 }}>
          <b>{sel.size} vybráno:</b>
          <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>{moveOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <button className="btn sm ok" onClick={async () => { await apiBulk("/central/equipment/bulk-move", { ids, propertyId: bulkTarget || null, roomId: null }); refresh(); }}>Přesunout</button>
          <button className="btn sm" onClick={async () => { const r = prompt("Důvod vyřazení:") ?? ""; await apiBulk("/central/equipment/bulk-retire", { ids, retiredReason: r }); refresh(); }}>Vyřadit</button>
          <button className="btn sm ghost" onClick={() => setLabels(items.filter((e) => sel.has(e.id)))}>🏷 QR štítky</button>
          <button className="btn sm danger" onClick={async () => { if (confirm(`Smazat ${sel.size} kusů?`)) { await apiBulk("/central/equipment/bulk-delete", { ids }); refresh(); } }}>Smazat</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Zrušit výběr</button>
        </div></div>
      )}

      <div className="panel">
        <div className="toolbar" style={{ padding: "10px 16px", justifyContent: "flex-end" }}><button className="btn sm ghost" onClick={() => setLabels(items)}>🏷 QR štítky všech ({items.length})</button></div>
        <EquipTable items={items} sel={sel} setSel={setSel} onDetail={setDetail} location={loc} />
      </div>

      {detail && <EquipmentDetail item={detail} categories={cats.data ?? []} moveOptions={moveOptions} currentMove={detail.room ? "" : (detail.propertyId ?? "")}
        onUpdate={(b) => api.centralUpdateEquipment(detail.id, b)} onMove={(v, note) => api.centralMoveEquipment(detail.id, { propertyId: v || null, roomId: null, note })}
        onDelete={() => api.centralDeleteEquipment(detail.id)} loadMoves={() => api.centralEquipMoves(detail.id)}
        onClose={() => setDetail(null)} onChanged={reload} />}
      {labels && <QrLabels items={labels} onClose={() => setLabels(null)} />}
    </>
  );
}

// Tabulka vybavení s výběrem (checkboxy).
function EquipTable({ items, sel, setSel, onDetail, location }: { items: Equipment[]; sel: Set<string>; setSel: (s: Set<string>) => void; onDetail: (e: Equipment) => void; location: (e: Equipment) => string }) {
  if (!items.length) return <div className="empty">Žádné vybavení</div>;
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const allOn = items.every((e) => sel.has(e.id));
  return (
    <table>
      <thead><tr>
        <th style={{ width: 36 }}><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(items.map((e) => e.id)))} /></th>
        <th>Kód</th><th>Název</th><th>Kategorie</th><th>Umístění</th><th>Stav</th><th className="right"></th>
      </tr></thead>
      <tbody>{items.map((e) => (
        <tr key={e.id}>
          <td><input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} /></td>
          <td className="muted">{e.code}</td>
          <td><b>{e.name}</b>{e.serialNumber && <div className="muted">SN {e.serialNumber}</div>}</td>
          <td>{e.category?.name ?? "—"}</td>
          <td>{location(e)}</td>
          <td><Badge s={e.condition} /></td>
          <td className="right"><button className="btn sm" onClick={() => onDetail(e)}>Detail</button></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// Statistika počtů.
function EquipStats({ items }: { items: Equipment[] }) {
  const c = (p: (e: Equipment) => boolean) => items.filter(p).length;
  return (
    <div className="stats">
      <div className="stat"><div className="n">{items.length}</div><div className="l">Kusů celkem</div></div>
      <div className="stat"><div className="n">{c((e) => e.condition === "ok")}</div><div className="l">V pořádku</div></div>
      <div className="stat warn"><div className="n">{c((e) => e.condition === "damaged")}</div><div className="l">Poškozeno</div></div>
      <div className="stat"><div className="n">{c((e) => e.condition === "retired")}</div><div className="l">Vyřazeno</div></div>
      <div className="stat"><div className="n">{c((e) => !!e.roomId)}</div><div className="l">V pokojích</div></div>
    </div>
  );
}

// QR štítky k tisku.
function QrImg({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: 200 }).then(setSrc).catch(() => {}); }, [text]);
  return src ? <img src={src} width={120} height={120} alt={text} /> : <div style={{ width: 120, height: 120 }} />;
}
// QR kartičky pro hosty — míří na portál hosta s rezervačním kódem.
function GuestQrLabels({ rows, onClose }: { rows: { code: string; title: string; subtitle?: string }[]; onClose: () => void }) {
  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice" style={{ width: "92vw", maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="inv-actions no-print" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <h2 style={{ margin: 0 }}>QR pro hosty ({rows.length})</h2>
          <div><button className="btn" onClick={() => window.print()}>🖨 Tisk</button>{" "}<button className="btn ghost" onClick={onClose}>Zavřít</button></div>
        </div>
        <div className="labels">
          {rows.map((r) => (
            <div key={r.code} className="label gqr">
              <div className="gqr-head">Vaše požadavky online</div>
              <QrImg text={guestUrl(r.code)} />
              <div className="label-code">{r.title}</div>
              {r.subtitle && <div className="label-name">{r.subtitle}</div>}
              <div className="gqr-foot">Naskenujte telefonem a zadejte úklid, údržbu, praní…</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QrLabels({ items, onClose }: { items: Equipment[]; onClose: () => void }) {
  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice" style={{ width: "92vw", maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="inv-actions no-print" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <h2 style={{ margin: 0 }}>QR štítky ({items.length})</h2>
          <div><button className="btn" onClick={() => window.print()}>🖨 Tisk</button>{" "}<button className="btn ghost" onClick={onClose}>Zavřít</button></div>
        </div>
        <div className="labels">
          {items.map((e) => (
            <div key={e.id} className="label"><QrImg text={e.code ?? e.id} /><div className="label-code">{e.code}</div><div className="label-name">{e.name}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper pro hromadná volání (čistý fetch s tokeny z localStorage).
async function apiBulk(path: string, body: object) {
  const r = await fetch("/api" + path, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": localStorage.getItem("adminToken") ?? "", "x-property-id": localStorage.getItem("propertyId") ?? "" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Hromadná akce selhala (" + r.status + ")");
  return r.json();
}

// Detail kusu — úpravy, vyřazení, PŘESUN S POTVRZENÍM, historie.
function EquipmentDetail({ item, categories, moveOptions, currentMove, onUpdate, onMove, onDelete, loadMoves, onClose, onChanged }: {
  item: Equipment; categories: EquipCategory[]; moveOptions: MoveOpt[]; currentMove: string;
  onUpdate: (b: unknown) => Promise<unknown>; onMove: (value: string, note?: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>; loadMoves: () => Promise<EquipMove[]>; onClose: () => void; onChanged: () => void;
}) {
  const [form, setForm] = useState({
    name: item.name, code: item.code ?? "", categoryId: item.categoryId ?? "", serialNumber: item.serialNumber ?? "",
    acquiredAt: item.acquiredAt?.slice(0, 10) ?? "", manufacturedAt: item.manufacturedAt?.slice(0, 10) ?? "", note: item.note ?? "",
  });
  const [target, setTarget] = useState(currentMove);
  const [moveNote, setMoveNote] = useState("");
  const [retireReason, setRetireReason] = useState("");
  const [moves, setMoves] = useState<EquipMove[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { loadMoves().then(setMoves).catch(() => {}); }, []); // eslint-disable-line
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setMsg(""); try { await fn(); setMsg(ok); onChanged(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  const save = () => run(() => onUpdate({ name: form.name, code: form.code || undefined, categoryId: form.categoryId || null, serialNumber: form.serialNumber, acquiredAt: form.acquiredAt || null, manufacturedAt: form.manufacturedAt || null, note: form.note }), "Uloženo.");
  const doMove = () => run(async () => { await onMove(target, moveNote || undefined); setMoveNote(""); setMoves(await loadMoves()); }, "Přesunuto.");
  const retire = () => run(() => onUpdate({ condition: "retired", retiredAt: new Date().toISOString().slice(0, 10), retiredReason: retireReason || "—" }), "Vyřazeno.");
  const unretire = () => run(() => onUpdate({ condition: "ok", retiredAt: null, retiredReason: null }), "Vráceno do provozu.");
  const del = async () => { if (confirm(`Smazat „${item.name}"?`)) { await onDelete(); onChanged(); onClose(); } };

  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{item.name} <span className="muted" style={{ fontSize: 14 }}>{item.code}</span></h2>
        {msg && <div className="error" style={{ background: "#eef2ff", color: "var(--accent)" }}>{msg}</div>}

        <div className="toolbar">
          <label className="row">Název <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="row">Kód <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label className="row">Kategorie <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <div className="toolbar">
          <label className="row">Sériové č. <input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></label>
          <label className="row">Pořízeno <input type="date" value={form.acquiredAt} onChange={(e) => setForm({ ...form, acquiredAt: e.target.value })} /></label>
          <label className="row">Vyrobeno <input type="date" value={form.manufacturedAt} onChange={(e) => setForm({ ...form, manufacturedAt: e.target.value })} /></label>
        </div>
        <div className="toolbar"><label className="row" style={{ flex: 1 }}>Pozn. <input style={{ width: "100%" }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label><button className="btn" disabled={busy} onClick={save}>Uložit</button></div>

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "14px 0" }} />
        <b>Přesun</b>
        <div className="toolbar" style={{ marginTop: 6 }}>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>{moveOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <input placeholder="Poznámka (nepovinné)" value={moveNote} onChange={(e) => setMoveNote(e.target.value)} />
          <button className="btn ok" disabled={busy} onClick={doMove}>Přesunout</button>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "14px 0" }} />
        <b>Vyřazení</b>
        {item.condition === "retired" ? (
          <div className="toolbar" style={{ marginTop: 6 }}><span className="muted">Vyřazeno {item.retiredAt?.slice(0, 10)} · {item.retiredReason}</span><button className="btn ghost" disabled={busy} onClick={unretire}>Vrátit do provozu</button></div>
        ) : (
          <div className="toolbar" style={{ marginTop: 6 }}><input placeholder="Důvod vyřazení" value={retireReason} onChange={(e) => setRetireReason(e.target.value)} /><button className="btn danger" disabled={busy} onClick={retire}>Vyřadit</button></div>
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "14px 0" }} />
        <b>Historie přesunů</b>
        {moves.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Žádné přesuny.</div> : (
          <table style={{ marginTop: 6 }}><tbody>{moves.map((m) => <tr key={m.id}><td className="muted">{m.createdAt.slice(0, 10)}</td><td>{m.fromLabel} → {m.toLabel}{m.note ? ` · ${m.note}` : ""}</td></tr>)}</tbody></table>
        )}

        <div className="inv-actions"><button className="btn danger" onClick={del}>Smazat kus</button><button className="btn ghost" onClick={onClose}>Zavřít</button></div>
      </div>
    </div>
  );
}

// ── Požadavky: přehled pro manažera ──────────────────────────
function RequestsView({ selId }: { selId: string }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useAsync<ServiceRequest[]>(() => api.adminRequests(status ? `?status=${status}` : ""), [selId, status]);
  const set = async (id: string, st: string) => { await api.staffSetStatus(id, { status: st }); reload(); };
  return (
    <>
      <div className="h1">Servisní požadavky</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Všechny stavy</option>{["open", "in_progress", "done", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      <div className="panel">
        <Table cols={["Typ", "Fronta", "Pokoj", "Host", "Popis", "Stav", ""]} rows={data ?? []} empty="Žádné požadavky"
          render={(r: ServiceRequest) => (
            <tr key={r.id}>
              <td>{SERVICE_ICON[r.type]} {SERVICE_LABEL[r.type]}{r.fromGuest && <span className="chip">host</span>}</td>
              <td className="muted">{r.domain === "maintenance" ? "údržba" : "úklid"}</td>
              <td>{r.room?.number ?? "—"}</td>
              <td>{r.reservation?.primaryGuest ? `${r.reservation.primaryGuest.firstName} ${r.reservation.primaryGuest.lastName}` : "—"}</td>
              <td>{r.description ?? "—"}</td>
              <td><Badge s={r.status} /></td>
              <td className="right">{r.status !== "done" && r.status !== "cancelled" && <button className="btn sm ok" onClick={() => set(r.id, "done")}>Hotovo</button>}</td>
            </tr>
          )} />
      </div>
    </>
  );
}

// ── Kontrolní agent (fáze 4): compliance / billing / inventář ─
const SevBadge = ({ s }: { s: Finding["severity"] }) => <span className={`sev sev-${s}`}>{SEVERITY_LABEL[s]}</span>;

function ChecksView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<ChecksResult>(() => api.checks(), [selId]);
  const c = data?.counts;
  const cats: Finding["category"][] = ["compliance", "billing", "inventory"];
  return (
    <>
      <div className="h1">Kontroly <span className="muted" style={{ fontSize: 14 }}>akční nálezy napříč provozem</span></div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
        {c && <>
          <span className="sev sev-high">{c.high} vysoká</span>
          <span className="sev sev-medium">{c.medium} střední</span>
          <span className="sev sev-low">{c.low} nízká</span>
          <span className="muted" style={{ alignSelf: "center" }}>celkem {c.total}</span>
        </>}
        <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={reload}>↻ Obnovit</button>
      </div>
      {data && data.counts.total === 0 && <div className="panel" style={{ padding: 24, textAlign: "center" }}>✅ Žádné nálezy — vše v pořádku.</div>}
      {data && cats.map((cat) => data.byCategory[cat].length > 0 && (
        <div className="panel" key={cat}>
          <h3>{CHECK_CAT_LABEL[cat]} <span className="muted" style={{ fontSize: 14 }}>({data.byCategory[cat].length})</span></h3>
          <Table cols={["Závažnost", "Nález", "Detail", "Odkaz"]} rows={data.byCategory[cat]} empty="—"
            render={(f: Finding) => (
              <tr key={f.title + f.ref + f.detail} className={`row-sev-${f.severity}`}>
                <td><SevBadge s={f.severity} /></td>
                <td><b>{f.title}</b></td>
                <td className="muted">{f.detail}</td>
                <td className="muted">{f.ref ?? "—"}</td>
              </tr>
            )} />
        </div>
      ))}
    </>
  );
}

// ── Priorita: štítek + formát stáří ──────────────────────────
const PrioBadge = ({ p }: { p: PlanItem["priority"] }) => <span className={`prio prio-${p}`}>{PRIORITY_LABEL[p]}</span>;
const fmtAge = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);
const planLoc = (i: PlanItem) => i.roomNumber ? `Pokoj ${i.roomNumber}` : i.bedLabel ? `Lůžko ${i.bedLabel}` : "—";

// ── Dispečink úklidu: prioritizovaný plán (manažer) ──────────
function HousekeepingView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<HousekeepingPlan>(() => api.housekeepingPlan(), [selId]);
  const [brief, setBrief] = useState<string>("");
  const [briefing, setBriefing] = useState(false);
  const [briefErr, setBriefErr] = useState("");

  const done = async (id: string) => { await api.staffSetStatus(id, { status: "done" }); reload(); };
  const start = async (id: string) => { await api.staffSetStatus(id, { status: "in_progress" }); reload(); };
  const aiBrief = async () => {
    setBriefing(true); setBriefErr(""); setBrief("");
    try { const r = await api.housekeepingBrief("cs"); setBrief(r.brief); }
    catch (e) { setBriefErr(e instanceof Error ? e.message : "Chyba AI shrnutí."); }
    finally { setBriefing(false); }
  };

  const c = data?.counts;
  return (
    <>
      <div className="h1">Dispečink úklidu</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
        {c && <>
          <span className="prio prio-urgent">{c.urgent} urgentní</span>
          <span className="prio prio-high">{c.high} přednostní</span>
          <span className="prio prio-normal">{c.normal} běžné</span>
          <span className="muted" style={{ alignSelf: "center" }}>celkem {c.total}</span>
        </>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn ghost sm" onClick={reload}>↻ Obnovit</button>
          <button className="btn sm" onClick={aiBrief} disabled={briefing || !data?.items.length}>
            {briefing ? "Generuji…" : "✨ AI shrnutí směny"}
          </button>
        </div>
      </div>

      {briefErr && <div className="error">{briefErr}</div>}
      {brief && <div className="panel" style={{ padding: 16, marginBottom: 12, background: "#f6f8ff", whiteSpace: "pre-wrap" }}>{brief}</div>}

      <div className="panel">
        <Table cols={["Priorita", "Úkol", "Místo", "Host", "Důvod", "Stáří", ""]} rows={data?.items ?? []} empty="Fronta úklidu je prázdná 🎉"
          render={(i: PlanItem) => (
            <tr key={i.id} className={`row-${i.priority}`}>
              <td><PrioBadge p={i.priority} /></td>
              <td>{SERVICE_ICON[i.type]} {SERVICE_LABEL[i.type]}{i.fromGuest && <span className="chip">host</span>}{i.status === "in_progress" && <span className="chip">probíhá</span>}</td>
              <td>{planLoc(i)}{i.roomTypeName ? <span className="muted"> · {i.roomTypeName}</span> : null}</td>
              <td>{i.guestName ?? "—"}</td>
              <td className="muted">{i.reason}</td>
              <td className="muted">{fmtAge(i.ageMinutes)}</td>
              <td className="right" style={{ whiteSpace: "nowrap" }}>
                {i.status === "open" && <button className="btn sm" onClick={() => start(i.id)}>Začít</button>}{" "}
                <button className="btn sm ok" onClick={() => done(i.id)}>Hotovo</button>
              </td>
            </tr>
          )} />
      </div>
    </>
  );
}

// ── Dispečink údržby: prioritizovaná fronta (manažer) ────────
function MaintenanceView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<MaintenancePlan>(() => api.maintenancePlan(), [selId]);
  const [brief, setBrief] = useState(""); const [briefing, setBriefing] = useState(false); const [briefErr, setBriefErr] = useState("");

  const done = async (id: string) => { await api.staffSetStatus(id, { status: "done" }); reload(); };
  const start = async (id: string) => { await api.staffSetStatus(id, { status: "in_progress" }); reload(); };
  const aiBrief = async () => {
    setBriefing(true); setBriefErr(""); setBrief("");
    try { const r = await api.maintenanceBrief("cs"); setBrief(r.brief); }
    catch (e) { setBriefErr(e instanceof Error ? e.message : "Chyba AI shrnutí."); }
    finally { setBriefing(false); }
  };
  const c = data?.counts;
  return (
    <>
      <div className="h1">Dispečink údržby</div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
        {c && <>
          <span className="prio prio-urgent">{c.urgent} urgentní</span>
          <span className="prio prio-high">{c.high} přednostní</span>
          <span className="prio prio-normal">{c.normal} běžné</span>
          <span className="muted" style={{ alignSelf: "center" }}>celkem {c.total}</span>
        </>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn ghost sm" onClick={reload}>↻ Obnovit</button>
          <button className="btn sm" onClick={aiBrief} disabled={briefing || !data?.items.length}>{briefing ? "Generuji…" : "✨ AI shrnutí směny"}</button>
        </div>
      </div>
      {briefErr && <div className="error">{briefErr}</div>}
      {brief && <div className="panel" style={{ padding: 16, marginBottom: 12, background: "#f6f8ff", whiteSpace: "pre-wrap" }}>{brief}</div>}
      <div className="panel">
        <Table cols={["Priorita", "Kategorie", "Místo", "Popis", "Stáří", ""]} rows={data?.items ?? []} empty="Fronta údržby je prázdná 🎉"
          render={(i: MaintItem) => (
            <tr key={i.id} className={`row-${i.priority}`}>
              <td><PrioBadge p={i.priority} /></td>
              <td>🔧 {i.category}{i.fromGuest && <span className="chip">host</span>}{i.status === "in_progress" && <span className="chip">probíhá</span>}</td>
              <td>{i.roomNumber ? `Pokoj ${i.roomNumber}` : "—"}{i.occupied && <span className="chip">obsazeno</span>}{i.damagedEquipment > 0 && <span className="chip">{i.damagedEquipment}× poškoz.</span>}</td>
              <td className="muted">{i.description ?? i.reason}</td>
              <td className="muted">{fmtAge(i.ageMinutes)}</td>
              <td className="right" style={{ whiteSpace: "nowrap" }}>
                {i.status === "open" && <button className="btn sm" onClick={() => start(i.id)}>Začít</button>}{" "}
                <button className="btn sm ok" onClick={() => done(i.id)}>Hotovo</button>
              </td>
            </tr>
          )} />
      </div>
    </>
  );
}

// ── Portál personálu (uklízečka / údržbář) ───────────────────
function StaffPortal({ session, onLogout }: { session: LoginResult; onLogout: () => void }) {
  const [selId, setSelId] = useState(getProperty() || session.properties[0]?.id || "");
  useEffect(() => { if (selId) setProperty(selId); }, [selId]);
  const isHK = session.user.role === "housekeeping";
  const isMaint = session.user.role === "maintenance";
  const hasPlan = isHK || isMaint;
  const [status, setStatus] = useState(hasPlan ? "plan" : "active");
  const { data, error, reload } = useAsync<ServiceRequest[]>(() => api.staffRequests(), [selId]);
  const emptyHK: HousekeepingPlan = { generatedAt: "", counts: { total: 0, urgent: 0, high: 0, normal: 0 }, items: [] };
  const plan = useAsync<HousekeepingPlan>(() => isHK ? api.staffPlan() : Promise.resolve(emptyHK), [selId]);
  const mplan = useAsync<MaintenancePlan>(() => isMaint ? api.staffMaintPlan() : Promise.resolve(emptyHK as unknown as MaintenancePlan), [selId]);
  const [showAdd, setShowAdd] = useState(false);
  const [nd, setNd] = useState("");
  const [brief, setBrief] = useState(""); const [briefing, setBriefing] = useState(false);

  const reloadAll = () => { reload(); plan.reload(); mplan.reload(); };
  const act = async (id: string, st: string) => { const note = st === "done" ? (prompt("Poznámka (nepovinné):") ?? undefined) : undefined; await api.staffSetStatus(id, { status: st, note }); reloadAll(); };
  const addMaint = async () => { if (!nd.trim()) return; await api.staffCreateRequest({ type: "maintenance", description: nd }); setNd(""); setShowAdd(false); reloadAll(); };
  const aiBrief = async () => { setBriefing(true); setBrief(""); try { const r = isMaint ? await api.staffMaintBrief("cs") : await api.staffBrief("cs"); setBrief(r.brief); } catch (e) { setBrief(e instanceof Error ? e.message : "Chyba AI."); } finally { setBriefing(false); } };
  const items = (data ?? []).filter((r) => status === "active" ? (r.status === "open" || r.status === "in_progress") : status === "done" ? r.status === "done" : true);

  return (
    <div className="staff">
      <div className="staff-head">
        <div><b>{session.user.name}</b> <span className="muted">· {isHK ? "Úklid" : "Údržba"}</span></div>
        <div className="row">
          {session.properties.length > 1 && <select value={selId} onChange={(e) => setSelId(e.target.value)}>{session.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <button className="btn ghost sm" onClick={onLogout}>Odhlásit</button>
        </div>
      </div>
      <div className="staff-tabs">
        {(([...(hasPlan ? [["plan", isHK ? "🧹 Plán" : "🔧 Plán"]] : []), ["active", "Aktivní"], ["done", "Hotové"], ["", "Vše"]]) as [string, string][]).map(([v, l]) => <button key={v} className={status === v ? "active" : ""} onClick={() => setStatus(v)}>{l}</button>)}
        {isHK && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setShowAdd((s) => !s)}>+ Nahlásit údržbu</button>}
      </div>
      {showAdd && <div className="staff-add"><input placeholder="Popis závady…" value={nd} onChange={(e) => setNd(e.target.value)} /><button className="btn" onClick={addMaint}>Odeslat údržbě</button></div>}
      {error && <div className="error">{error}</div>}

      {status === "plan" ? (
        isMaint ? (
          <MaintCards plan={mplan.data} onStart={(id) => act(id, "in_progress")} onDone={(id) => act(id, "done")}
            brief={brief} briefing={briefing} onBrief={aiBrief} onReload={reloadAll} />
        ) : (
          <PlanCards plan={plan.data} onStart={(id) => act(id, "in_progress")} onDone={(id) => act(id, "done")}
            brief={brief} briefing={briefing} onBrief={aiBrief} onReload={reloadAll} />
        )
      ) : (
      <div className="staff-list">
        {items.length === 0 ? <div className="empty">Žádné požadavky</div> : items.map((r) => (
          <div key={r.id} className={`req-card s-${r.status}`}>
            <div className="req-top"><span className="req-type">{SERVICE_ICON[r.type]} {SERVICE_LABEL[r.type]}</span><Badge s={r.status} /></div>
            <div className="req-loc">{r.room ? `Pokoj ${r.room.number}` : "—"}{r.fromGuest && r.reservation?.primaryGuest ? ` · ${r.reservation.primaryGuest.firstName} ${r.reservation.primaryGuest.lastName}` : ""}</div>
            {r.description && <div className="req-desc">{r.description}</div>}
            {r.status === "done" || r.status === "cancelled" ? (
              <div className="muted">Hotovo {r.resolvedAt?.slice(0, 16).replace("T", " ")}{r.resolvedBy ? ` · ${r.resolvedBy.name}` : ""}{r.note ? ` · ${r.note}` : ""}</div>
            ) : (
              <div className="req-actions">
                {r.status === "open" && <button className="btn sm" onClick={() => act(r.id, "in_progress")}>Začít</button>}
                <button className="btn sm ok" onClick={() => act(r.id, "done")}>Hotovo</button>
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// Karty prioritizovaného plánu úklidu (sdílené v portálu uklízečky).
function PlanCards({ plan, onStart, onDone, brief, briefing, onBrief, onReload }: {
  plan: HousekeepingPlan | null; onStart: (id: string) => void; onDone: (id: string) => void;
  brief: string; briefing: boolean; onBrief: () => void; onReload: () => void;
}) {
  const c = plan?.counts;
  return (
    <>
      <div className="staff-add" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {c && <>
            <span className="prio prio-urgent">{c.urgent} urgentní</span>
            <span className="prio prio-high">{c.high} přednostní</span>
            <span className="prio prio-normal">{c.normal} běžné</span>
          </>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost sm" onClick={onReload}>↻</button>
          <button className="btn sm" onClick={onBrief} disabled={briefing || !plan?.items.length}>{briefing ? "Generuji…" : "✨ AI shrnutí"}</button>
        </div>
      </div>
      {brief && <div className="staff-add" style={{ background: "#f6f8ff", whiteSpace: "pre-wrap", display: "block" }}>{brief}</div>}
      <div className="staff-list">
        {!plan?.items.length ? <div className="empty">Fronta úklidu je prázdná 🎉</div> : plan.items.map((i) => (
          <div key={i.id} className={`req-card s-${i.status} row-${i.priority}`}>
            <div className="req-top"><span className="req-type">{SERVICE_ICON[i.type]} {SERVICE_LABEL[i.type]}</span><PrioBadge p={i.priority} /></div>
            <div className="req-loc">{planLoc(i)}{i.roomTypeName ? ` · ${i.roomTypeName}` : ""}{i.guestName ? ` · ${i.guestName}` : ""}</div>
            <div className="req-desc">{i.reason}{i.description ? ` — ${i.description}` : ""}</div>
            <div className="req-actions">
              {i.status === "open" && <button className="btn sm" onClick={() => onStart(i.id)}>Začít</button>}
              <button className="btn sm ok" onClick={() => onDone(i.id)}>Hotovo</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Karty prioritizované fronty údržby (portál údržbáře).
function MaintCards({ plan, onStart, onDone, brief, briefing, onBrief, onReload }: {
  plan: MaintenancePlan | null; onStart: (id: string) => void; onDone: (id: string) => void;
  brief: string; briefing: boolean; onBrief: () => void; onReload: () => void;
}) {
  const c = plan?.counts;
  return (
    <>
      <div className="staff-add" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {c && <>
            <span className="prio prio-urgent">{c.urgent} urgentní</span>
            <span className="prio prio-high">{c.high} přednostní</span>
            <span className="prio prio-normal">{c.normal} běžné</span>
          </>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost sm" onClick={onReload}>↻</button>
          <button className="btn sm" onClick={onBrief} disabled={briefing || !plan?.items.length}>{briefing ? "Generuji…" : "✨ AI shrnutí"}</button>
        </div>
      </div>
      {brief && <div className="staff-add" style={{ background: "#f6f8ff", whiteSpace: "pre-wrap", display: "block" }}>{brief}</div>}
      <div className="staff-list">
        {!plan?.items.length ? <div className="empty">Fronta údržby je prázdná 🎉</div> : plan.items.map((i) => (
          <div key={i.id} className={`req-card s-${i.status} row-${i.priority}`}>
            <div className="req-top"><span className="req-type">🔧 {i.category}</span><PrioBadge p={i.priority} /></div>
            <div className="req-loc">{i.roomNumber ? `Pokoj ${i.roomNumber}` : "—"}{i.occupied ? " · obsazeno" : ""}{i.damagedEquipment > 0 ? ` · ${i.damagedEquipment}× poškoz. vybavení` : ""}</div>
            <div className="req-desc">{i.description ?? i.reason}</div>
            <div className="req-actions">
              {i.status === "open" && <button className="btn sm" onClick={() => onStart(i.id)}>Začít</button>}
              <button className="btn sm ok" onClick={() => onDone(i.id)}>Hotovo</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── CENTRÁLA: WhatsApp propojení ─────────────────────────────
function WhatsAppView() {
  const [st, setSt] = useState<{ state: string; qr: string | null; error?: string } | null>(null);
  const [qrImg, setQrImg] = useState("");
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.whatsappStatus();
        if (stop) return;
        setSt(s);
        if (s.qr) QRCode.toDataURL(s.qr, { margin: 1, width: 320 }).then(setQrImg).catch(() => {});
        else setQrImg("");
      } catch { /* */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const state = st?.state ?? "loading";
  return (
    <>
      <div className="h1">WhatsApp propojení</div>
      <div className="panel" style={{ padding: 24, maxWidth: 560 }}>
        {state === "ready" && <div style={{ textAlign: "center" }}><div style={{ fontSize: 60 }}>✅</div><h2>Připojeno</h2><p className="muted">Kiosek může posílat zprávy personálu. Spojení se obnoví i po restartu serveru.</p></div>}
        {state === "qr" && (
          <div style={{ textAlign: "center" }}>
            <h2>Propojte zařízení</h2>
            <p className="muted">V mobilu: <b>WhatsApp → Nastavení → Propojená zařízení → Propojit zařízení</b> a naskenujte:</p>
            {qrImg ? <img src={qrImg} alt="WhatsApp QR" style={{ width: 320, height: 320 }} /> : <div className="muted">Generuji QR…</div>}
            <p className="muted">Po propojení se sem session uloží a drží i po restartu.</p>
          </div>
        )}
        {(state === "loading" || state === "authenticated") && <div style={{ textAlign: "center" }}><div className="muted" style={{ fontSize: 18 }}>Spouštím WhatsApp… ({state})</div></div>}
        {state === "disconnected" && <div className="error">Odpojeno. Restartujte server pro nové propojení.</div>}
        {state === "error" && <div className="error">Chyba WhatsAppu: {st?.error}</div>}
        {state === "off" && <div className="muted">WhatsApp je vypnutý (WHATSAPP_ENABLED=false).</div>}
      </div>
    </>
  );
}

// ── Generic table ────────────────────────────────────────────
function Table<T>({ cols, rows, render, empty }: { cols: string[]; rows: T[]; render: (row: T) => ReactNode; empty: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (<table><thead><tr>{cols.map((c, i) => <th key={i} className={i === cols.length - 1 ? "right" : ""}>{c}</th>)}</tr></thead><tbody>{rows.map(render)}</tbody></table>);
}
