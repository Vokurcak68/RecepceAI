import { useEffect, useState, useRef, type ReactNode, type CSSProperties, type ChangeEvent } from "react";
import type * as React from "react";
import QRCode from "qrcode";
import { useConfirm } from "./confirm";
import {
  api, money, d, setToken, setProperty, getProperty, TYPE_LABEL, CONDITION_LABEL, SERVICE_LABEL, SERVICE_ICON, PRIORITY_LABEL, SEVERITY_LABEL, CHECK_CAT_LABEL, PAY_TYPE_LABEL, PAY_METHOD_LABEL, DOC_TYPE_LABEL, DOC_STATUS_LABEL, CHARGE_LABEL, DOCTYPE_LABEL, STATUS_LABEL, statusLabel, EMAIL_TYPE_LABEL, ROOM_STATUS_LABEL, DEPOSIT_STATUS_LABEL,
  type EmailLog,
  type Reservation, type Room, type Bed, type RoomType, type Dashboard, type RegistrationEntry, type Property, type User, type LoginResult,
  type ReservationDetail, type Folio, type Invoice, type Payment, type Equipment, type EquipMove, type EquipCategory, type ServiceRequest,
  type HousekeepingPlan, type PlanItem, type NightAudit, type PricingSuggestion, type DaySuggestion, type ChecksResult, type Finding,
  type MaintenancePlan, type MaintItem, type PendingCall, type PaymentRow, type PaymentsList, type Receipt, type ReceiptLine, type Doc, type DocLine,
  type CashState, type CashSession, type CashMovement, type Charge, type OccupancyRow, type ResGuest, type ServiceItem, type OccupancyCalendar, type TapeChart, type TapeRes, type UbyportData, type IcalImportFeed, type GuestListItem, type GuestProfile, type GuestStay, type ReviewsData, type ReviewItem,
  type GroupListItem, type GroupDetail, type GroupMember, type GroupRoomInput, type BulkResult, type StaffRoom, type RoomBoardItem, type RoomDetail, type RoomCandidate, type UnitCandidate, type UnassignedRes, type RoomResItem, type RoomReqItem, type BedRate, type OccupationItem,
  type Company, type CompanyDetail, type CompanyResItem, type BedBoardItem, type BedReservationsData, type Deposit, type MoveItem, type MovementsReport, type AresResult, type PersonRate, type AvailUnit, type FreeBedsRoom, type ReceptionToday, type RecArrival, type RecRow,
} from "./api";

const Badge = ({ s }: { s: string }) => <span className={`badge b-${s}`}>{STATUS_LABEL[s] ?? s}</span>;

// ── Sdílené form-prvky (modulová úroveň → vstupy neztrácejí focus při psaní) ──
const fldLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#8a97a3", marginBottom: 4, display: "block" };
function FieldCol({ label, children, span }: { label: string; children: ReactNode; span?: number }) {
  return <label style={{ display: "block", minWidth: 0, gridColumn: span ? `span ${span}` : undefined }}><span style={fldLabelStyle}>{label}</span>{children}</label>;
}
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><span className="muted" style={{ width: 110, textAlign: "right", flexShrink: 0 }}>{label}</span>{children}</div>;
}

// Jednotná sada polí klienta (adresář / host na pokoji / nový host) — vždy stejný styl přes FieldRow.
export type GuestFields = { firstName: string; lastName: string; email: string; phone: string; address: string; dateOfBirth: string; nationality: string; documentType: string; documentNumber: string };
const blankGuestFields = (): GuestFields => ({ firstName: "", lastName: "", email: "", phone: "", address: "", dateOfBirth: "", nationality: "", documentType: "", documentNumber: "" });
function GuestFieldsForm({ v, on, contact = true }: { v: GuestFields; on: (patch: Partial<GuestFields>) => void; contact?: boolean }) {
  const inp: CSSProperties = { flex: 1, minWidth: 0 };
  return (
    <>
      <FieldRow label="Jméno"><input style={inp} value={v.firstName} onChange={(e) => on({ firstName: e.target.value })} /></FieldRow>
      <FieldRow label="Příjmení"><input style={inp} value={v.lastName} onChange={(e) => on({ lastName: e.target.value })} /></FieldRow>
      {contact && <FieldRow label="E-mail"><input style={inp} value={v.email} onChange={(e) => on({ email: e.target.value })} /></FieldRow>}
      {contact && <FieldRow label="Telefon"><input style={inp} value={v.phone} onChange={(e) => on({ phone: e.target.value })} /></FieldRow>}
      <FieldRow label="Datum narození"><input type="date" style={inp} value={v.dateOfBirth} onChange={(e) => on({ dateOfBirth: e.target.value })} /></FieldRow>
      <FieldRow label="Národnost"><input style={inp} value={v.nationality} onChange={(e) => on({ nationality: e.target.value })} /></FieldRow>
      <FieldRow label="Adresa"><input style={inp} value={v.address} onChange={(e) => on({ address: e.target.value })} /></FieldRow>
      <FieldRow label="Doklad"><select style={inp} value={v.documentType} onChange={(e) => on({ documentType: e.target.value })}><option value="">—</option><option value="id_card">OP</option><option value="passport">Pas</option></select></FieldRow>
      <FieldRow label="Číslo dokladu"><input style={inp} value={v.documentNumber} onChange={(e) => on({ documentNumber: e.target.value })} /></FieldRow>
    </>
  );
}
function FormGrid({ children, min = 200 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12, alignItems: "end" }}>{children}</div>;
}
function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ borderTop: "1px solid #e6eaee", paddingTop: 14, marginTop: 16 }}><div style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", color: "#8a97a3", marginBottom: 10 }}>{title}</div>{children}</div>;
}
function Chk({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className="row" style={{ gap: 6, opacity: disabled ? 0.5 : 1 }}><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
}
const fullInput: CSSProperties = { width: "100%", boxSizing: "border-box" };
// Denní úklid (automaticky generovaný stayover úkol) má vlastní ikonu/štítek.
const isDailyTask = (type: string, desc?: string | null) => type === "cleaning" && desc === "Denní úklid";
const taskIcon = (type: string, desc?: string | null) => (isDailyTask(type, desc) ? "🔄" : SERVICE_ICON[type]);

// Adresa portálu hosta (přepsatelné přes VITE_GUEST_URL při buildu).
const GUEST_BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_GUEST_URL || "http://localhost:5175";
// Jazyky hosta (pro e-maily + výchozí jazyk portálu) — sjednoceno s kioskem/portálem.
const GUEST_LANGS: [string, string][] = [["cs", "Čeština"], ["en", "English"], ["de", "Deutsch"], ["ru", "Русский"], ["uk", "Українська"], ["pl", "Polski"], ["sk", "Slovenčina"], ["it", "Italiano"], ["fr", "Français"], ["es", "Español"], ["zh", "中文"]];
const guestUrl = (code: string) => `${GUEST_BASE}/?code=${encodeURIComponent(code)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const addDayIso = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? iso : new Date(t + 864e5).toISOString().slice(0, 10); };
// Odjezd ať je vždy aspoň den po příjezdu: při změně příjezdu vrátí příjezd+1, pokud odjezd není později.
const departAfter = (arrival: string, current: string) => (arrival && (!current || current <= arrival) ? addDayIso(arrival) : current);

// Před hotovostní úhradou: když není otevřená pokladní směna, doklad nevznikne → varuj a nech recepci rozhodnout.
// Vrací true = pokračovat, false = zrušit a počkat na otevření pokladny.
type ConfirmFn = (o: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
async function ensureCashOpen(confirm: ConfirmFn): Promise<boolean> {
  let open = true;
  try { open = !!(await api.cashState()).session; } catch { return true; } // chyba zjištění → nezdržuj
  if (open) return true;
  return confirm({
    title: "Pokladna není otevřená",
    message: <>Hotovostní platba se <b>nezapíše do pokladny</b> — není otevřená pokladní směna, takže o ní pokladní nemusí vědět.<br /><br />Pokračovat bez pokladního dokladu, nebo zrušit a počkat, až se pokladna otevře?</>,
    confirmLabel: "Pokračovat bez dokladu", danger: true,
  });
}

export function App() {
  const [session, setSession] = useState<LoginResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(getProperty());
  const [tab, setTab] = useState("reception");
  const [openGroup, setOpenGroup] = useState(() => localStorage.getItem("navGroup") ?? "Hosté");
  const [navOpen, setNavOpen] = useState(false); // mobilní výsuvné menu
  useEffect(() => { localStorage.setItem("navGroup", openGroup); }, [openGroup]);

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

  // Ubytovna potřebuje spravovat POKOJE i LŮŽKA (lůžko patří do pokoje); hotel/penzion jen pokoje.
  const roomsTabs = prop?.inventoryUnit === "bed"
    ? [{ id: "rooms", label: "Pokoje" }, { id: "beds", label: "Lůžka" }]
    : [{ id: "rooms", label: "Pokoje" }];

  // Samostatné položky (bez skupiny) + rozbalovací skupiny (varianta A)
  const navItems: { id: string; label: string; icon: string }[] = [
    { id: "reception", label: "Recepce", icon: "🛎️" },
    { id: "dashboard", label: "Přehled", icon: "📊" },
  ];
  const navGroups: { label: string; icon: string; items: { id: string; label: string }[] }[] = [
    { label: "Hosté", icon: "🛎️", items: [
      { id: "plan", label: "Plán" },
      { id: "reservations", label: "Rezervace" },
      { id: "movements", label: "Příjezdy/odjezdy" },
      { id: "groups", label: "Skupiny" },
      { id: "guests", label: "Profily hostů" },
      { id: "reviews", label: "Hodnocení" },
      { id: "book", label: "Kniha hostů" },
      { id: "ubyport", label: "Cizinci (UBYPORT)" },
    ] },
    { label: "Finance", icon: "💰", items: [
      { id: "payments", label: "Úhrady" },
      { id: "cashregister", label: "Pokladna" },
      { id: "documents", label: "Doklady" },
      { id: "companies", label: "Firmy" },
    ] },
    { label: "Provoz", icon: "🧹", items: [
      { id: "roomstatus", label: "Přehled pokojů" },
      { id: "housekeeping", label: "Dispečink úklidu" },
      { id: "maintenance", label: "Dispečink údržby" },
      { id: "requests", label: "Požadavky" },
      { id: "checks", label: "Kontroly" },
    ] },
    { label: "Nastavení", icon: "🏨", items: [
      ...roomsTabs,
      { id: "types", label: "Typy & ceny" },
      { id: "personrates", label: "Číselník osob" },
      ...(prop?.inventoryUnit === "bed" ? [{ id: "bedrates", label: "Ceník lůžek" }] : []),
      { id: "equipment", label: "Vybavení" },
      { id: "ical", label: "iCal synchronizace" },
    ] },
  ];
  const navItemsBottom = [{ id: "agents", label: "AI agenti", icon: "🤖" }];
  const goTab = (id: string, group?: string) => { setTab(id); if (group) setOpenGroup(group); setNavOpen(false); };

  return (
    <div className={`app${navOpen ? " nav-open" : ""}`}>
      <button className="nav-toggle" aria-label="Menu" onClick={() => setNavOpen(true)}>☰</button>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className="sidebar">
        <div className="logo"><span>🛎️ Recepce</span>{(session.user.role === "manager" || isSuper) && <CallBell />}</div>


        <select className="prop-switch" value={selId} onChange={(e) => { setProperty(e.target.value); setSelId(e.target.value); }}>
          {session.properties.map((p) => <option key={p.id} value={p.id}>{p.name} · {TYPE_LABEL[p.type]}</option>)}
        </select>

        <nav className="nav">
          {navItems.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => goTab(t.id)}><span>{t.icon}</span> {t.label}</button>
          ))}

          {navGroups.map((g) => {
            const active = g.items.some((i) => i.id === tab);
            const open = openGroup === g.label;
            return (
              <div key={g.label} className="nav-grp">
                <button
                  className={`nav-grp-head${active ? " has-active" : ""}${open ? " open" : ""}`}
                  onClick={() => setOpenGroup(open ? "" : g.label)}
                >
                  <span>{g.icon}</span> {g.label}
                  <span className="nav-grp-arrow">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="nav-grp-items">
                    {g.items.map((i) => (
                      <button key={i.id} className={`nav-sub${tab === i.id ? " active" : ""}`} onClick={() => goTab(i.id, g.label)}>{i.label}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {navItemsBottom.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => goTab(t.id)}><span>{t.icon}</span> {t.label}</button>
          ))}

          {isSuper && (
            <>
              <div className="nav-sep">CENTRÁLA</div>
              <button className={tab === "properties" ? "active" : ""} onClick={() => goTab("properties")}><span>🏢</span> Provozovny</button>
              <button className={tab === "users" ? "active" : ""} onClick={() => goTab("users")}><span>👤</span> Uživatelé</button>
              <button className={tab === "cequipment" ? "active" : ""} onClick={() => goTab("cequipment")}><span>🧰</span> Vybavení</button>
              <button className={tab === "whatsapp" ? "active" : ""} onClick={() => goTab("whatsapp")}><span>📲</span> WhatsApp</button>
            </>
          )}
          <button onClick={() => { setNavOpen(false); logout(); }} style={{ marginTop: 24 }}>🚪 Odhlásit ({session.user.name})</button>
        </nav>
      </aside>

      <main className="main">
        {prop && tab === "dashboard" && <DashboardView selId={selId} />}
        {prop && tab === "agents" && <AgentsView selId={selId} onOpen={setTab} />}
        {prop && tab === "plan" && <PlanView selId={selId} prop={prop} />}
        {prop && tab === "ubyport" && <UbyportView selId={selId} />}
        {prop && tab === "ical" && <IcalView selId={selId} />}
        {prop && tab === "reservations" && <ReservationsView selId={selId} prop={prop} />}
        {prop && tab === "groups" && <GroupsView selId={selId} prop={prop} />}
        {prop && tab === "guests" && <GuestsView selId={selId} />}
        {prop && tab === "reviews" && <ReviewsView selId={selId} />}
        {prop && tab === "rooms" && <RoomsView selId={selId} />}
        {prop && tab === "beds" && <BedsView selId={selId} />}
        {prop && tab === "equipment" && <EquipmentView selId={selId} />}
        {prop && tab === "roomstatus" && <RoomBoardView selId={selId} prop={prop} />}
        {prop && tab === "housekeeping" && <HousekeepingView selId={selId} />}
        {prop && tab === "maintenance" && <MaintenanceView selId={selId} />}
        {prop && tab === "checks" && <ChecksView selId={selId} />}
        {prop && tab === "requests" && <RequestsView selId={selId} />}
        {prop && tab === "types" && <TypesView selId={selId} prop={prop} />}
        {prop && tab === "payments" && <PaymentsView selId={selId} />}
        {prop && tab === "cashregister" && <CashRegisterView selId={selId} />}
        {prop && tab === "documents" && <DocumentsView selId={selId} />}
        {prop && tab === "reception" && <ReceptionView selId={selId} prop={prop} onOpen={setTab} />}
        {prop && tab === "companies" && <CompaniesView selId={selId} />}
        {prop && tab === "personrates" && <PersonRatesView selId={selId} />}
        {prop && tab === "bedrates" && <BedRatesView selId={selId} />}
        {prop && tab === "movements" && <MovementsView selId={selId} />}
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
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 16 }}>
      {/* Pravý <form> s autocomplete → prohlížeč nabídne uložení hesla. */}
      <form className="panel" style={{ width: "min(380px, 100%)", padding: 28 }} onSubmit={submit}>
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
  const confirm = useConfirm();
  const { data, error, reload } = useAsync<Dashboard>(() => api.dashboard(today), [selId]);
  const doCheckin = async (id: string) => { if (!(await confirm({ title: "Check-in", message: "Provést check-in této rezervace?", confirmLabel: "Check-in" }))) return; await api.checkin(id); reload(); };
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
function CalendarView({ selId, embedded }: { selId: string; embedded?: boolean }) {
  const [days, setDays] = useState(21);
  const [from, setFrom] = useState(todayIso());
  const { data, error } = useAsync<OccupancyCalendar>(() => api.calendar(from, days), [selId, from, days]);
  const DOW = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  const day = (iso: string) => { const dt = new Date(iso); return { dom: dt.getUTCDate(), mon: dt.getUTCMonth() + 1, we: [0, 6].includes(dt.getUTCDay()), dow: DOW[dt.getUTCDay()] }; };
  const color = (free: number, total: number) => free <= 0 ? { background: "#fde2e0", color: "#c0392b" } : free <= Math.max(1, Math.round(total * 0.25)) ? { background: "#fff4e0", color: "#9a6b00" } : { background: "#e9f7ef", color: "#1a7f4b" };
  const th: CSSProperties = { border: "1px solid #e6eaee", padding: "5px 7px", fontSize: 12, textAlign: "center", fontWeight: 600 };
  const td: CSSProperties = { border: "1px solid #e6eaee", padding: "6px 8px", fontSize: 13, textAlign: "center", fontWeight: 700, minWidth: 34 };
  const firstCol: CSSProperties = { position: "sticky", left: 0, background: "#fff", textAlign: "left", minWidth: 170, zIndex: 1 };

  return (
    <>
      {!embedded && <div className="h1">Kalendář obsazení</div>}
      <div className="toolbar">
        <label className="row">Od <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row">Dní <select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={14}>14</option><option value={21}>21</option><option value={31}>31</option></select></label>
        <span className="muted">číslo = volných jednotek na noc · <b style={{ color: "#1a7f4b" }}>zelená</b> dost · <b style={{ color: "#9a6b00" }}>oranžová</b> málo · <b style={{ color: "#c0392b" }}>červená</b> plno/přebookováno</span>
      </div>
      {error && <div className="error">{error}</div>}
      {!data ? <div className="muted" style={{ padding: 20 }}>Načítám…</div> : (
        <div className="panel" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ borderCollapse: "collapse", whiteSpace: "nowrap" }}>
            <thead>
              <tr>
                <th style={{ ...th, ...firstCol, background: "#f6f8fa" }}>Typ <span className="muted">(celkem)</span></th>
                {data.dates.map((iso) => { const f = day(iso); return <th key={iso} style={{ ...th, background: f.we ? "#eef1f4" : "#f6f8fa" }}>{f.dow}<br />{f.dom}.{f.mon}.</th>; })}
              </tr>
            </thead>
            <tbody>
              {data.types.map((t) => (
                <tr key={t.roomTypeId}>
                  <td style={{ ...td, ...firstCol, fontWeight: 600 }}>{t.name} <span className="muted">({t.total})</span></td>
                  {t.cells.map((c, i) => (
                    <td key={i} style={{ ...td, ...color(c.free, t.total) }} title={`volných ${c.free} z ${t.total} · obsazeno ${c.booked}`}>{c.free}</td>
                  ))}
                </tr>
              ))}
              {data.types.length === 0 && <tr><td className="muted" style={{ padding: 16 }} colSpan={data.dates.length + 1}>Žádné typy pokojů — nejdřív je založ v „Typy &amp; ceny".</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TapeChartView({ selId, prop, embedded }: { selId: string; prop?: Property; embedded?: boolean }) {
  const confirm = useConfirm();
  const [days, setDays] = useState(14);
  const [from, setFrom] = useState(todayIso());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<TapeRes | null>(null);
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState<{ unitId: string; roomTypeId: string; a: number; b: number } | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{ from: string; to: string; roomTypeId: string; unitId: string } | null>(null);
  const [barMenu, setBarMenu] = useState<TapeRes | null>(null);
  const [moveBar, setMoveBar] = useState<TapeRes | null>(null); // změna pokoje/lůžka z Plánu
  const [doc, setDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useAsync<TapeChart>(() => api.tapechart(from, days), [selId, from, days]);
  const types = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const priceOf = (rtId: string) => { const t = (types.data ?? []).find((x) => x.id === rtId); return t ? money(t.basePrice) : ""; };
  const roomMode = data?.unit === "room";

  const checkinBar = async (r: TapeRes) => { setBusy(true); setMsg(""); try { await api.checkin(r.id); setBarMenu(null); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const checkoutBar = async (r: TapeRes) => { if (await confirm({ title: "Check-out", message: <>Odhlásit <b>{r.guestName}</b> ({r.code})? Účet musí být vyrovnaný.</>, confirmLabel: "Check-out" })) { setBusy(true); setMsg(""); try { const x = await api.checkout(r.id); if (x.document) setDoc(x.document); setBarMenu(null); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } } };

  if (detailId) return <ReservationDetailView id={detailId} prop={prop} onBack={() => { setDetailId(null); reload(); }} />;

  const DAYW = 44, LABELW = 150, ROWH = 30;
  const DOW = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  const dayHdr = (iso: string) => { const dt = new Date(iso); return { dom: dt.getUTCDate(), mon: dt.getUTCMonth() + 1, we: [0, 6].includes(dt.getUTCDay()), dow: DOW[dt.getUTCDay()] }; };
  const idx = (iso: string) => data ? Math.round((Date.parse(iso) - Date.parse(data.from)) / 86400000) : 0;
  const STCOL: Record<string, string> = { hold: "#e8a33d", confirmed: "#4f7cff", checked_in: "#1a9e63", checked_out: "#9aa7b3" };
  const grid: CSSProperties = { backgroundImage: `repeating-linear-gradient(to right, #eef1f4 0 1px, transparent 1px ${DAYW}px)` };

  const assign = async (unitId: string) => {
    if (!assigning) return;
    setMsg("");
    try { await api.assignUnit(assigning.id, unitId); setAssigning(null); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  const bar = (r: TapeRes, lane = false) => {
    const s = Math.max(0, idx(r.checkInDate)), e = Math.min(days, idx(r.checkOutDate));
    const span = e - s; if (span <= 0) return null;
    return (
      <div key={r.id} title={`${r.code} · ${r.guestName} · ${statusLabel(r.status)}`} onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); if (lane) setAssigning(r); else setBarMenu(r); }}
        style={{ position: "absolute", left: s * DAYW + 2, width: span * DAYW - 4, top: 3, height: ROWH - 6, background: STCOL[r.status] ?? "#4f7cff", color: "#fff", borderRadius: 6, fontSize: 11, lineHeight: `${ROWH - 6}px`, padding: "0 6px", overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer", boxShadow: lane ? "0 0 0 2px #fff, 0 0 0 3px #e8a33d" : undefined }}>
        {r.guestName}
      </div>
    );
  };

  return (
    <>
      {!embedded && <div className="h1">Plán pokojů</div>}
      <div className="toolbar">
        <label className="row">Od <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row">Dní <select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7</option><option value={14}>14</option><option value={21}>21</option></select></label>
        <span className="muted">{roomMode ? "tažením po volných dnech = nová rezervace · " : ""}klik na pruh = akce · <b style={{ color: "#e8a33d" }}>blokace</b> / <b style={{ color: "#4f7cff" }}>potvrzeno</b> / <b style={{ color: "#1a9e63" }}>ubytován</b></span>
      </div>
      {(error || msg) && <div className="error">{error || msg}</div>}
      {assigning && <div className="ok-msg" style={{ background: "#fff4e0", color: "#9a6b00" }}>Přiřazuji <b>{assigning.code}</b> ({assigning.guestName}) — klikni na řádek volného pokoje téhož typu. <button className="btn sm ghost" onClick={() => setAssigning(null)}>Zrušit</button></div>}
      {!data ? <div className="muted" style={{ padding: 20 }}>Načítám…</div> : (
        <div className="panel" style={{ overflowX: "auto", padding: 0 }}>
          <div style={{ minWidth: LABELW + days * DAYW }}>
            <div style={{ display: "flex", borderBottom: "2px solid #e6eaee" }}>
              <div style={{ width: LABELW, flex: "0 0 auto", padding: "6px 8px", fontWeight: 700, fontSize: 12, position: "sticky", left: 0, background: "#f6f8fa", zIndex: 1 }}>Pokoj / lůžko</div>
              {data.dates.map((iso) => { const f = dayHdr(iso); return <div key={iso} style={{ width: DAYW, flex: "0 0 auto", textAlign: "center", padding: "4px 0", fontSize: 11, background: f.we ? "#eef1f4" : "#f6f8fa" }}>{f.dow}<br />{f.dom}.{f.mon}.</div>; })}
            </div>
            {data.types.map((tp) => {
              const tUnits = data.units.filter((u) => u.roomTypeId === tp.roomTypeId);
              const unassigned = data.reservations.filter((r) => r.roomTypeId === tp.roomTypeId && !r.unitId);
              const canAssignHere = !!assigning && assigning.roomTypeId === tp.roomTypeId;
              return (
                <div key={tp.roomTypeId}>
                  <div style={{ padding: "4px 8px", fontWeight: 700, fontSize: 12, background: "#f0f3f8", position: "sticky", left: 0 }}>{tp.name} <span style={{ fontWeight: 400, color: "var(--muted)" }}>· {priceOf(tp.roomTypeId)}/noc</span></div>
                  {tUnits.map((u) => (
                    <div key={u.id} onClick={() => { if (canAssignHere) assign(u.id); }} style={{ display: "flex", height: ROWH, borderBottom: "1px solid #f0f3f8", cursor: canAssignHere ? "pointer" : "default", background: canAssignHere ? "#fffaf0" : undefined }}>
                      <div style={{ width: LABELW, flex: "0 0 auto", padding: "0 8px", fontSize: 13, lineHeight: `${ROWH}px`, position: "sticky", left: 0, background: canAssignHere ? "#fffaf0" : "#fff", borderRight: "1px solid #eef1f4" }}>{u.label}</div>
                      <div style={{ position: "relative", width: days * DAYW, flex: "0 0 auto", cursor: roomMode && !assigning ? "crosshair" : "default", ...grid }}
                        onPointerDown={(ev) => { if (!roomMode || assigning) return; const rc = ev.currentTarget.getBoundingClientRect(); const i = Math.max(0, Math.min(days - 1, Math.floor((ev.clientX - rc.left) / DAYW))); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); setDrag({ unitId: u.id, roomTypeId: tp.roomTypeId, a: i, b: i }); }}
                        onPointerMove={(ev) => { if (!drag || drag.unitId !== u.id) return; const rc = ev.currentTarget.getBoundingClientRect(); const i = Math.max(0, Math.min(days - 1, Math.floor((ev.clientX - rc.left) / DAYW))); if (i !== drag.b) setDrag({ ...drag, b: i }); }}
                        onPointerUp={() => { if (!drag || drag.unitId !== u.id || !data) return; const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b); const f = data.dates[lo]; const t = new Date(Date.parse(data.dates[hi]) + 86400000).toISOString().slice(0, 10); setDrag(null); setCreatePrefill({ from: f, to: t, roomTypeId: tp.roomTypeId, unitId: u.id }); }}>
                        {data.reservations.filter((r) => r.unitId === u.id).map((r) => bar(r))}
                        {drag && drag.unitId === u.id && (() => { const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b); return <div style={{ position: "absolute", left: lo * DAYW + 1, width: (hi - lo + 1) * DAYW - 2, top: 3, height: ROWH - 6, background: "rgba(79,124,255,.25)", border: "1px dashed #4f7cff", borderRadius: 6, pointerEvents: "none" }} />; })()}
                      </div>
                    </div>
                  ))}
                  {unassigned.length > 0 && (
                    <div style={{ display: "flex", height: ROWH, borderBottom: "1px solid #f0f3f8", background: "#fcf4e6" }}>
                      <div style={{ width: LABELW, flex: "0 0 auto", padding: "0 8px", fontSize: 12, fontStyle: "italic", color: "#9a6b00", lineHeight: `${ROWH}px`, position: "sticky", left: 0, background: "#fcf4e6", borderRight: "1px solid #eef1f4" }}>Nepřiřazené ({unassigned.length})</div>
                      <div style={{ position: "relative", width: days * DAYW, flex: "0 0 auto", ...grid }}>
                        {unassigned.map((r) => bar(r, true))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {data.units.length === 0 && <div className="muted" style={{ padding: 16 }}>Žádné pokoje — založ je v „Pokoje".</div>}
          </div>
        </div>
      )}

      {createPrefill && prop && <NewReservationWizard prop={prop} prefill={createPrefill} onClose={() => setCreatePrefill(null)} onCreated={() => { setCreatePrefill(null); reload(); }} onOpenDetail={(rid) => { setCreatePrefill(null); setDetailId(rid); }} />}

      {barMenu && (
        <div className="inv-backdrop" onClick={() => setBarMenu(null)}>
          <div className="invoice" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="inv-head">
              <div><h2 style={{ margin: 0 }}>{barMenu.guestName}</h2><div className="muted" style={{ marginTop: 4 }}>{barMenu.code} · {statusLabel(barMenu.status)} · {d(barMenu.checkInDate)} → {d(barMenu.checkOutDate)}</div></div>
              <button className="linkx" onClick={() => setBarMenu(null)}>zavřít</button>
            </div>
            <div className="req-actions" style={{ padding: 12, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => { setDetailId(barMenu.id); setBarMenu(null); }}>Detail</button>
              {["confirmed", "pending"].includes(barMenu.status) && <button className="btn ok" disabled={busy} onClick={() => checkinBar(barMenu)}>Check-in</button>}
              {barMenu.status === "checked_in" && <button className="btn ok" disabled={busy} onClick={() => checkoutBar(barMenu)}>Check-out</button>}
              <button className="btn ghost" onClick={() => { setMoveBar(barMenu); setBarMenu(null); }}>{prop?.inventoryUnit === "bed" ? "Změnit lůžko" : "Změnit pokoj"}</button>
            </div>
          </div>
        </div>
      )}

      {moveBar && <UnitMoveOverlay reservationId={moveBar.id} onClose={() => setMoveBar(null)} onDone={reload} />}
      {doc && <DocumentOverlay doc={doc} onClose={() => setDoc(null)} />}
    </>
  );
}

function IcalView({ selId }: { selId: string }) {
  const confirm = useConfirm();
  const exportA = useAsync<{ all: string; perType: { name: string; url: string }[] }>(() => api.icalFeeds(), [selId]);
  const feeds = useAsync<IcalImportFeed[]>(() => api.icalImportFeeds(), [selId]);
  const types = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const [copied, setCopied] = useState("");
  const [nf, setNf] = useState({ roomTypeId: "", url: "", label: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const copy = (u: string) => { navigator.clipboard?.writeText(u).then(() => { setCopied(u); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); setErr(""); setMsg(""); try { await fn(); if (ok) setMsg(ok); feeds.reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const add = () => { if (!nf.roomTypeId || !nf.url) { setErr("Vyber typ a zadej URL."); return; } run(async () => { await api.addIcalImportFeed({ roomTypeId: nf.roomTypeId, url: nf.url, label: nf.label || undefined }); setNf({ roomTypeId: "", url: "", label: "" }); }, "Feed přidán a synchronizován."); };
  const sync = () => run(async () => { const r = await api.icalSync(); const bad = r.filter((x) => !x.ok).length; setMsg(bad ? `Synchronizováno, ${bad} feed(ů) s chybou.` : `Synchronizováno (${r.length} feed(ů)).`); }, undefined);
  const ExpRow = ({ label, url }: { label: string; url: string }) => (
    <div className="kvline" style={{ alignItems: "center", gap: 10 }}>
      <span className="muted" style={{ minWidth: 160 }}>{label}</span>
      <input readOnly value={url} style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
      <button className="btn sm ghost" onClick={() => copy(url)}>{copied === url ? "✓" : "Kopírovat"}</button>
    </div>
  );
  return (
    <>
      <div className="h1">iCal synchronizace</div>
      {(exportA.error || feeds.error || err) && <div className="error">{exportA.error || feeds.error || err}</div>}
      {msg && <div className="error" style={{ background: "#e6f7ee", color: "var(--ok)" }}>{msg}</div>}

      <div className="panel">
        <h3>Export — naše obsazenost ven</h3>
        <div style={{ padding: 16 }}>
          <p className="muted" style={{ marginTop: 0 }}>Tyto odkazy vlož do Google Kalendáře / Airbnb / Booking („Import iCal"), aby viděly tvoji obsazenost (read-only, jen termíny, bez jmen).</p>
          {!exportA.data ? <div className="muted">Načítám…</div> : (<>
            <ExpRow label="Celá provozovna" url={exportA.data.all} />
            {exportA.data.perType.map((t) => <ExpRow key={t.url} label={t.name} url={t.url} />)}
          </>)}
        </div>
      </div>

      <div className="panel">
        <h3>Import — OTA rezervace dovnitř (blokace) <button className="btn sm" disabled={busy} style={{ float: "right" }} onClick={sync}>↻ Synchronizovat teď</button></h3>
        <div style={{ padding: 16 }}>
          <p className="muted" style={{ marginTop: 0 }}>Vlož sem iCal odkaz z Airbnb/Booking pro daný typ pokoje. Rezervace se stáhnou jako blokace a zaberou dostupnost (brání přebookování). Přidání i tlačítko stáhnou feed hned; doporučeno občas synchronizovat (OTA se mění).</p>
          <div className="toolbar">
            <select value={nf.roomTypeId} onChange={(e) => setNf({ ...nf, roomTypeId: e.target.value })}>
              <option value="">Typ pokoje…</option>
              {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input placeholder="iCal URL (https://…/calendar.ics)" style={{ minWidth: 320 }} value={nf.url} onChange={(e) => setNf({ ...nf, url: e.target.value })} />
            <input placeholder="Popis (Airbnb…)" style={{ width: 140 }} value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} />
            <button className="btn" disabled={busy} onClick={add}>+ Přidat feed</button>
          </div>
          <div style={{ marginTop: 12 }}>
            {!feeds.data ? <div className="muted">Načítám…</div> : feeds.data.length === 0 ? <div className="muted">Zatím žádné importované feedy.</div> : (
              <Table cols={["Typ", "Popis", "URL", "Poslední sync", ""]} rows={feeds.data} empty="Žádné"
                render={(f: IcalImportFeed) => (
                  <tr key={f.id}>
                    <td>{f.roomType?.name ?? "—"}</td><td>{f.label || "—"}</td>
                    <td className="muted" style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.url}</td>
                    <td className="muted">{f.lastSyncedAt ? d(f.lastSyncedAt) : "—"}{f.lastError ? <span style={{ color: "var(--danger)" }}> · chyba: {f.lastError}</span> : ""}</td>
                    <td className="right"><button className="btn sm danger" disabled={busy} onClick={async () => { if (await confirm({ title: "Smazat iCal feed", message: <>Smazat tento import feed{f.label ? <> „{f.label}"</> : ""}? Smažou se i jeho stažené blokace.</>, confirmLabel: "Smazat", danger: true })) run(() => api.deleteIcalImportFeed(f.id), "Feed smazán."); }}>Smazat</button></td>
                  </tr>
                )} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function UbyportView({ selId }: { selId: string }) {
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + "01");
  const [to, setTo] = useState(todayIso());
  const [all, setAll] = useState(false);
  const { data, error } = useAsync<UbyportData>(() => api.ubyport(from, to, all), [selId, from, to, all]);
  const dl = (name: string, content: string, type: string) => {
    const u = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u);
  };
  const csv = () => {
    if (!data) return;
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const head = ["Jméno", "Datum narození", "Národnost", "Druh dokladu", "Číslo dokladu", "Vízum", "Adresa", "Účel pobytu", "Pobyt od", "Pobyt do"];
    const lines = [head.map(esc).join(";")];
    for (const e of data.entries) lines.push([e.jmeno, d(e.datumNarozeni), e.narodnost, DOCTYPE_LABEL[e.druhDokladu] ?? e.druhDokladu, e.cisloDokladu, e.vizum, e.adresa, e.ucelPobytu, d(e.pobytOd), d(e.pobytDo)].map(esc).join(";"));
    dl(`ubyport-${from}_${to}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
  };
  const xml = () => {
    if (!data) return;
    const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const u = data.ubytovatel;
    const body = data.entries.map((e) => `  <Cizinec>\n    <Jmeno>${esc(e.jmeno)}</Jmeno>\n    <DatumNarozeni>${e.datumNarozeni.slice(0, 10)}</DatumNarozeni>\n    <Narodnost>${esc(e.narodnost)}</Narodnost>\n    <DruhDokladu>${esc(e.druhDokladu)}</DruhDokladu>\n    <CisloDokladu>${esc(e.cisloDokladu)}</CisloDokladu>\n    <Vizum>${esc(e.vizum)}</Vizum>\n    <Adresa>${esc(e.adresa)}</Adresa>\n    <UcelPobytu>${esc(e.ucelPobytu)}</UcelPobytu>\n    <PobytOd>${e.pobytOd.slice(0, 10)}</PobytOd>\n    <PobytDo>${e.pobytDo.slice(0, 10)}</PobytDo>\n  </Cizinec>`).join("\n");
    const doc = `<?xml version="1.0" encoding="UTF-8"?>\n<HlaseniUbytovatele od="${from}" do="${to}">\n  <Ubytovatel nazev="${esc(u.nazev)}" ico="${esc(u.ico)}" ulice="${esc(u.ulice)}" mesto="${esc(u.mesto)}"/>\n  <Cizinci>\n${body}\n  </Cizinci>\n</HlaseniUbytovatele>\n`;
    dl(`ubyport-${from}_${to}.xml`, doc, "application/xml;charset=utf-8");
  };
  return (
    <>
      <div className="h1">Hlášení ubytovaných cizinců <span className="muted" style={{ fontSize: 15 }}>(podklad pro UBYPORT)</span></div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <label className="row">Pobyt od <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row">do <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="row"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> včetně tuzemců</label>
        <button className="btn" disabled={!data || !data.entries.length} onClick={csv}>⬇ CSV</button>
        <button className="btn ghost" disabled={!data || !data.entries.length} onClick={xml}>⬇ XML</button>
      </div>
      <div className="muted" style={{ marginBottom: 10 }}>Vybráni hosté s překryvem pobytu v období{all ? "" : " (jen cizinci — národnost ≠ ČR)"}. {data ? <b>{data.pocet} osob</b> : ""}. XML je podklad — před nahráním na UBYPORT ověř strukturu proti aktuálnímu XSD policie.</div>
      {data && (
        <div className="panel">
          <Table cols={["Jméno", "Nar.", "Národnost", "Doklad", "Vízum", "Adresa", "Pobyt"]} rows={data.entries} empty="Žádní ubytovaní v období"
            render={(e: UbyportData["entries"][number]) => (
              <tr key={e.jmeno + e.pobytOd}>
                <td><b>{e.jmeno}</b></td><td className="muted">{d(e.datumNarozeni)}</td><td>{e.narodnost}</td>
                <td>{DOCTYPE_LABEL[e.druhDokladu] ?? e.druhDokladu} {e.cisloDokladu}</td><td className="muted">{e.vizum || "—"}</td>
                <td className="muted">{e.adresa}</td><td className="muted">{d(e.pobytOd)}–{d(e.pobytDo)}</td>
              </tr>
            )} />
        </div>
      )}
    </>
  );
}

function PlanView({ selId, prop }: { selId: string; prop?: Property }) {
  const [view, setView] = useState<"plan" | "list" | "calendar" | "beds">("plan");
  const bedMode = prop?.inventoryUnit === "bed";
  const segs: [string, string][] = [["plan", "📅 Timeline"], ["list", "📋 Obsazení"], ["calendar", "📊 Kalendář"], ...(bedMode ? [["beds", "🛏 Lůžka"] as [string, string]] : [])];
  return (
    <>
      <div className="h1"><span>Plán</span>
        &nbsp;<span className="seg" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {segs.map(([v, l]) => <button key={v} className={`btn sm ${view === v ? "" : "ghost"}`} onClick={() => setView(v as typeof view)}>{l}</button>)}
        </span>
      </div>
      {view === "plan" && <TapeChartView selId={selId} prop={prop} embedded />}
      {view === "list" && <OccupancyView selId={selId} prop={prop} embedded />}
      {view === "calendar" && <CalendarView selId={selId} embedded />}
      {view === "beds" && bedMode && <BedBoardView selId={selId} prop={prop} embedded />}
    </>
  );
}

function OccupancyView({ selId, prop, embedded }: { selId: string; prop?: Property; embedded?: boolean }) {
  const { data, error, reload } = useAsync<OccupancyRow[]>(() => api.occupancy(), [selId]);
  const [detailId, setDetailId] = useState<string | null>(null);
  if (detailId) return <ReservationDetailView id={detailId} prop={prop} onBack={() => { setDetailId(null); reload(); }} />;
  return (
    <>
      {!embedded && <div className="h1">Obsazení <span className="muted" style={{ fontSize: 14 }}>aktuálně ubytovaní hosté</span></div>}
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <Table cols={["Jednotka", "Host", "Osob", "Pobyt", "Položky", "Zůstatek účtu", ""]} rows={data ?? []} empty="Nikdo není ubytovaný"
          render={(o: OccupancyRow) => (
            <tr key={o.id}>
              <td><b>{o.unit}</b>{o.roomType ? <span className="muted"> · {o.roomType}</span> : null}</td>
              <td>{o.guestName}{o.note ? <span title={o.note} style={{ cursor: "help" }}> 📝</span> : null}</td>
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

// ── Domovská obrazovka recepce „Recepce (dnešek)" ────────────
function ReceptionView({ selId, prop, onOpen }: { selId: string; prop: Property; onOpen?: (tab: string) => void }) {
  const { data, error, reload } = useAsync<ReceptionToday>(() => api.reception(), [selId]);
  const bedMode = prop.inventoryUnit === "bed";
  const board = useAsync<(RoomBoardItem | BedBoardItem)[]>(() => bedMode ? api.bedBoard() : api.roomBoard(), [selId]);
  const reloadAll = () => { reload(); board.reload(); };
  const confirm = useConfirm();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [arrQ, setArrQ] = useState(""); // hledání v Příjezdech dnes
  const [depQ, setDepQ] = useState(""); // hledání v Odjezdech dnes
  const [occQ, setOccQ] = useState(""); // hledání v Obsazenosti
  const fnorm = (s: string) => (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const matchArr = (r: { guestName: string; where?: string; code?: string }, q: string) => { const t = fnorm(q).trim(); return !t || fnorm(`${r.guestName} ${r.where ?? ""} ${r.code ?? ""}`).includes(t); };
  const [doc, setDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const checkin = async (r: RecArrival) => {
    if (!r.assigned) { setDetailId(r.id); return; } // nepřiřazený → detail (přiřaď pokoj a odbav)
    if (await confirm({ title: "Check-in", message: <>Ubytovat <b>{r.guestName}</b> ({r.code})?</>, confirmLabel: "Check-in" })) {
      setBusy(true); setMsg(""); try { await api.checkin(r.id); reloadAll(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }
  };
  const checkout = async (r: RecRow) => {
    if (await confirm({ title: "Check-out", message: <>Odhlásit <b>{r.guestName}</b> ({r.code})?{Number(r.balance) > 0 ? ` Zůstatek ${money(r.balance)} musí být vyrovnán.` : ""}</>, confirmLabel: "Check-out" })) {
      setBusy(true); setMsg(""); try { const x = await api.checkout(r.id); if (x.document) setDoc(x.document); reloadAll(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }
  };

  if (detailId) return <ReservationDetailView id={detailId} prop={prop} onBack={() => { setDetailId(null); reload(); }} />;

  const card = (title: string, count: number, body: ReactNode) => (
    <div className="panel"><h3>{title} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {count}</span></h3><div style={{ padding: 12 }}>{body}</div></div>
  );
  const empty = <div className="muted">—</div>;

  return (
    <>
      <div className="h1">
        <span>Recepce {data && <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {d(data.date)}</span>}</span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={() => setWizard(true)}>✨ Nová rezervace</button>
          <button className="btn ghost" onClick={() => setPlanOpen(true)}>🗺 Půdorys</button>
          <button className="btn ghost sm" onClick={reloadAll}>↻</button>
        </span>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="error">{msg}</div>}
      {wizard && <NewReservationWizard prop={prop} onClose={() => setWizard(false)} onCreated={() => { setWizard(false); reloadAll(); }} onOpenDetail={(rid) => { setWizard(false); setDetailId(rid); }} />}

      {data && (
        <div className="toolbar" style={{ gap: 18, flexWrap: "wrap" }}>
          <span>Volno: <b>{data.freeUnits}</b> {data.unitLabel}</span>
          <span className="muted">Ubytováno: {data.inHouseCount}</span>
          <span className="muted">K úklidu: {data.dirtyRooms}</span>
          {data.unpaid.length > 0 && <span style={{ color: "var(--warn)" }}>⚠ {data.unpaid.length} nezaplacených</span>}
        </div>
      )}

      <div className="grid2">
        {card("Příjezdy dnes", data?.arrivals.length ?? 0, (data?.arrivals.length ?? 0) === 0 ? empty : (() => {
          const shown = data!.arrivals.filter((r) => matchArr(r, arrQ));
          return (<>
            <input className="wz-filter" placeholder="🔍 Hledat hosta / kód…" value={arrQ} onChange={(e) => setArrQ(e.target.value)} style={{ marginBottom: 8 }} />
            {shown.length === 0 ? <div className="muted">Nic nenalezeno.</div> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{shown.map((r) => (
              <div key={r.id} className="rd-req" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>👤 <b>{r.guestName}</b> <span className="muted">· {r.where} · {r.code}</span></span>
                <span className="req-actions">
                  <button className="btn sm ghost" onClick={() => setDetailId(r.id)}>Detail</button>
                  <button className="btn sm ok" disabled={busy} onClick={() => checkin(r)}>{r.assigned ? "Check-in" : "Přiřadit"}</button>
                </span>
              </div>
            ))}</div>}
          </>);
        })())}

        {card("Odjezdy dnes", data?.departures.length ?? 0, (data?.departures.length ?? 0) === 0 ? empty : (() => {
          const shown = data!.departures.filter((r) => matchArr(r, depQ));
          return (<>
            <input className="wz-filter" placeholder="🔍 Hledat hosta / kód…" value={depQ} onChange={(e) => setDepQ(e.target.value)} style={{ marginBottom: 8 }} />
            {shown.length === 0 ? <div className="muted">Nic nenalezeno.</div> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{shown.map((r) => (
              <div key={r.id} className="rd-req" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>👤 <b>{r.guestName}</b> <span className="muted">· {r.where}</span>{Number(r.balance) > 0 ? <b style={{ color: "var(--warn)" }}> · {money(r.balance)}</b> : ""}</span>
                <span className="req-actions">
                  {Number(r.balance) > 0 && <button className="btn sm" onClick={() => setDetailId(r.id)}>Doplatit</button>}
                  <button className="btn sm ok" disabled={busy} onClick={() => checkout(r)}>Check-out</button>
                </span>
              </div>
            ))}</div>}
          </>);
        })())}
      </div>

      {(data?.unpaid.length ?? 0) > 0 && card("Nezaplacené (ubytovaní)", data!.unpaid.length,
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{data!.unpaid.map((r) => (
          <div key={r.id} className="rd-req" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>👤 <b>{r.guestName}</b> <span className="muted">· {r.where} · {r.code}</span> <b style={{ color: "var(--warn)" }}>· {money(r.balance)}</b></span>
            <button className="btn sm" onClick={() => setDetailId(r.id)}>Doplatit</button>
          </div>
        ))}</div>)}

      {(() => {
        const units = board.data ?? [];
        if (units.length === 0) return null;
        const occ = bedMode ? (units as BedBoardItem[]).filter((b) => b.current).length : (units as RoomBoardItem[]).filter((r) => r.occupant).length;
        const row = (key: string, label: string, name: string | null | undefined, resId: string | undefined, sub: string | undefined, status: string) => (
          <tr key={key} className={resId ? "row-click" : ""} onClick={() => resId && setDetailId(resId)}>
            <td><b>{label}</b></td>
            <td>{name ? <span className="badge b-checked_in">obsazeno</span> : <span className="muted">volné</span>}</td>
            <td><RoomPill s={status} /></td>
            <td>{name ? <>👤 {name}</> : <span className="muted">—</span>}</td>
            <td className="muted">{sub ?? "—"}</td>
            <td className="right">{resId && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setDetailId(resId); }}>Detail</button>}</td>
          </tr>
        );
        const ot = fnorm(occQ).trim();
        const shown = !ot ? units : units.filter((u) => fnorm(bedMode ? `${(u as BedBoardItem).label} ${(u as BedBoardItem).roomNumber} ${(u as BedBoardItem).current?.guestName ?? ""}` : `${(u as RoomBoardItem).number} ${(u as RoomBoardItem).occupant?.name ?? ""}`).includes(ot));
        return (
          <div className="panel"><h3>Obsazenost {bedMode ? "lůžek" : "pokojů"} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {occ}/{units.length} obsazeno</span></h3>
            <input className="wz-filter" placeholder={bedMode ? "🔍 Hledat lůžko / pokoj / hosta…" : "🔍 Hledat pokoj / hosta…"} value={occQ} onChange={(e) => setOccQ(e.target.value)} style={{ marginBottom: 8 }} />
            <Table cols={[bedMode ? "Lůžko" : "Pokoj", "Stav", "Úklid", "Host", "Do / další", ""]} rows={shown} empty="Nic nenalezeno."
              render={(u: RoomBoardItem | BedBoardItem) => bedMode
                ? (() => { const b = u as BedBoardItem; return row(b.bedId, `${b.label} · pok. ${b.roomNumber} · ${b.floor}. p`, b.current?.guestName, b.current?.reservationId, b.current ? `do ${d(b.current.toDate)}` : (b.upcoming > 0 ? `příjezd ${d(b.nextFrom!)}` : undefined), b.status); })()
                : (() => { const r = u as RoomBoardItem; return row(r.id, `${r.number} · ${r.floor}. p`, r.occupant?.name, r.occupant?.reservationId, r.occupant ? `do ${d(r.occupant.checkOutDate)}` : (r.arrival ? `příjezd: ${r.arrival.name}` : undefined), r.status); })()} />
          </div>
        );
      })()}

      {planOpen && (
        <div className="inv-backdrop" onClick={() => setPlanOpen(false)}>
          <div className="fp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fp-modal-head"><h3 style={{ margin: 0 }}>Půdorys obsazenosti</h3><button className="linkx" onClick={() => setPlanOpen(false)}>zavřít ✕</button></div>
            <div className="fp-modal-body"><FloorPlanView prop={prop} /></div>
          </div>
        </div>
      )}

      {doc && <DocumentOverlay doc={doc} onClose={() => setDoc(null)} />}
    </>
  );
}

// ── Průvodce „Nová rezervace" (sjednocený tok pro recepci) ───
function NewReservationWizard({ prop, onClose, onCreated, onOpenDetail, prefill }: { prop: Property; onClose: () => void; onCreated: () => void; onOpenDetail: (rid: string) => void; prefill?: { from?: string; to?: string; roomTypeId?: string; unitId?: string } }) {
  const bedMode = prop.inventoryUnit === "bed";
  const [step, setStep] = useState(1);
  const [from, setFrom] = useState(prefill?.from ?? todayIso());
  const [to, setTo] = useState(prefill?.to ?? tomorrowIso());
  const [guests, setGuests] = useState(2);
  const [extra, setExtra] = useState<{ firstName: string; lastName: string; dob: string; rateId: string; guestId?: string }[]>([]);
  const [pickPersonIdx, setPickPersonIdx] = useState<number | null>(null); // výběr osoby z adresáře u i-té další osoby
  const [avail, setAvail] = useState<AvailUnit[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>(prefill?.roomTypeId ? { [prefill.roomTypeId]: 1 } : {});
  const [bedsWanted, setBedsWanted] = useState(1);
  const [together, setTogether] = useState(true);
  const [freeRooms, setFreeRooms] = useState<FreeBedsRoom[] | null>(null);
  const [g, setG] = useState({ firstName: "", lastName: "", email: "", phone: "", language: "cs", dob: "", rateId: "" });
  const [customer, setCustomer] = useState<"guest" | "company">("guest");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [pickCo, setPickCo] = useState(false);
  const rates = useAsync<PersonRate[]>(() => api.personRates(), []);
  const ratesEnabled = (rates.data ?? []).length > 0;
  const [pickGuest, setPickGuest] = useState(false);
  const [pickedGuestId, setPickedGuestId] = useState<string | null>(null);
  const [roomQ, setRoomQ] = useState("");
  const [pay, setPay] = useState<"arrival" | "departure" | "deposit" | "company" | "prepay">("arrival");
  const [groupBilling, setGroupBilling] = useState<"collective" | "individual">("collective"); // u skupiny (2+ jednotek): společný účet × každý zvlášť
  const [depositPct, setDepositPct] = useState(String(prop.depositPct || 50));
  const [prepayDays, setPrepayDays] = useState("3"); // platba předem: úhrada N dnů před příjezdem, jinak storno
  // Firemní / dlouhodobé (jen lůžková provozovna + odběratel firma): sazba z ceníku, splatnost, VIP, poznámka.
  const bedRatesA = useAsync<BedRate[]>(() => prop.inventoryUnit === "bed" ? api.bedRates() : Promise.resolve([]), []);
  const [wBedRateId, setWBedRateId] = useState("");
  const [wAmount, setWAmount] = useState(""); // cena za lůžko / pobyt — předvyplněná z ceníku, ručně přepsatelná
  const [wPayUntil, setWPayUntil] = useState("");
  const [wVip, setWVip] = useState(false);
  const [wEnergyFree, setWEnergyFree] = useState(false);
  const [wNote, setWNote] = useState("");
  const [bedByIdx, setBedByIdx] = useState<Record<number, string>>({}); // konkrétní lůžko per osoba (index → bedId)
  const [freeBedsList, setFreeBedsList] = useState<{ id: string; label: string; free: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ id: string; code: string }[] | null>(null);

  const nights = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5));
  const personCount = bedMode ? bedsWanted : guests;
  const ageOf = (dob: string) => { if (!dob) return null; const b = new Date(dob), n = new Date(); let a = n.getFullYear() - b.getFullYear(); const m = n.getMonth() - b.getMonth(); if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--; return a; };
  // null = neplatné/nekompletní datum (neměnit) — chrání před mezistavem „rok 0001" při psaní; "" = žádná věková sazba neodpovídá (vyčistit); jinak id sazby.
  const rateByDob = (dob: string): string | null => { const age = ageOf(dob); if (age == null || age < 0 || age > 120) return null; const list = (rates.data ?? []).filter((r) => r.active && (r.ageFrom != null || r.ageTo != null) && (r.ageFrom == null || age >= r.ageFrom) && (r.ageTo == null || age <= r.ageTo)); list.sort((a, b) => ((a.ageTo ?? 200) - (a.ageFrom ?? 0)) - ((b.ageTo ?? 200) - (b.ageFrom ?? 0))); return list[0]?.id ?? ""; };
  const ratePrice = (id: string) => { const r = (rates.data ?? []).find((x) => x.id === id); return r ? Number(r.pricePerNight) : 0; };
  const allPersons = [g, ...extra];
  // Ceny osob s typem (v pořadí zadání) — použijí se k ocenění přistýlek; ubytovna = čistý součet osob × noci.
  const typedPersonPrices = allPersons.filter((p) => p.rateId).map((p) => ratePrice(p.rateId));
  const perPersonTotal = allPersons.reduce((s, p) => s + ratePrice(p.rateId), 0) * nights;
  const allTyped = ratesEnabled && allPersons.every((p) => p.rateId);

  const loadAvail = async () => {
    setErr(""); setBusy(true);
    try {
      const av = await api.availabilityFor(from, to, bedMode ? 1 : guests);
      setAvail(av);
      if (bedMode) {
        setFreeRooms(await api.freeBedsPerRoom(from, to));
        const bt = av.find((a) => a.unit === "bed");
        const fb = bt ? await api.freeBedsOfType(bt.roomTypeId, from, to) : [];
        setFreeBedsList(fb);
        // Předvyplň konkrétní lůžko 1. osoby, pokud průvodce otevřen z konkrétního lůžka (Plán → Lůžka) a je volné.
        setBedByIdx(prefill?.unitId && fb.some((b) => b.id === prefill.unitId && b.free) ? { 0: prefill.unitId } : {});
      } else { setBedByIdx({}); }
      setStep(2);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const gotoGuests = () => { const want = Math.max(0, personCount - 1); setExtra((prev) => Array.from({ length: want }, (_, i) => prev[i] ?? { firstName: "", lastName: "", dob: "", rateId: "" })); setStep(3); };
  const setPersonDob = (i: number, dob: string) => { const rid = rateByDob(dob); const next = (cur: string) => (rid === null ? cur : rid); if (i === 0) setG((s) => ({ ...s, dob, rateId: next(s.rateId) })); else setExtra((arr) => arr.map((p, idx) => idx === i - 1 ? { ...p, dob, rateId: next(p.rateId) } : p)); };
  const setPersonRate = (i: number, rid: string) => { if (i === 0) setG((s) => ({ ...s, rateId: rid })); else setExtra((arr) => arr.map((p, idx) => idx === i - 1 ? { ...p, rateId: rid } : p)); };

  const roomUnits = (avail ?? []).filter((a) => a.unit === "room");
  const normTxt = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filteredRooms = roomQ.trim() ? roomUnits.filter((a) => normTxt(a.name).includes(normTxt(roomQ))) : roomUnits;
  const bedType = (avail ?? []).find((a) => a.unit === "bed");
  const totalRooms = Object.values(counts).reduce((s, n) => s + n, 0);
  const selCapacity = roomUnits.reduce((s, a) => s + (counts[a.roomTypeId] ?? 0) * (a.capacityAdults + a.maxExtraBeds), 0);
  const roomBaseTotal = roomUnits.reduce((s, a) => s + (counts[a.roomTypeId] ?? 0) * Number(a.roomTotal), 0);
  const selUnit = roomUnits.find((a) => (counts[a.roomTypeId] ?? 0) > 0);
  // Přistýlka se ocení dle typu osoby na ní (typované osoby obsadí přistýlky v pořadí zadání), bez typu cena přistýlky z pokoje.
  const extraBedSurcharge = (!bedMode && totalRooms === 1 && selUnit)
    ? Array.from({ length: selUnit.extraBedsNeeded }, (_, k) => k < typedPersonPrices.length ? typedPersonPrices[k] : Number(selUnit.extraBedPrice)).reduce((s, p) => s + p, 0) * nights
    : 0;
  const estAccommodation = bedMode ? perPersonTotal : roomBaseTotal + extraBedSurcharge;
  const roomsWithEnough = (freeRooms ?? []).filter((r) => r.freeBeds >= bedsWanted);
  const totalFreeBeds = (freeRooms ?? []).reduce((s, r) => s + r.freeBeds, 0);
  const bedsTogetherOk = !together || roomsWithEnough.length > 0;
  const step2Ok = bedMode ? (bedsWanted >= 1 && totalFreeBeds >= bedsWanted && bedsTogetherOk) : totalRooms >= 1;

  const create = async () => {
    setErr(""); setBusy(true);
    try {
      const guest = { firstName: g.firstName, lastName: g.lastName, email: g.email || undefined, phone: g.phone || undefined, language: g.language };
      const ppDays = pay === "prepay" && customer !== "company" && Number(prepayDays) > 0 ? Number(prepayDays) : undefined; // platba předem (jinak storno)
      const ages = allPersons.map((p) => ageOf(p.dob)).filter((a): a is number => a != null);
      const childAges = ages.filter((a) => a < 18);
      const adults = Math.max(1, personCount - childAges.length);
      let ids: { id: string; code: string }[] = [];
      let memberPersons: typeof allPersons = [];
      if (bedMode) {
        if (!bedType) throw new Error("Není dostupný typ lůžka.");
        if (bedsWanted === 1) { const r = await api.createReservation({ roomTypeId: bedType.roomTypeId, from, to, adults: 1, childAges: [], guest, bedId: bedByIdx[0] || undefined, prepayDays: ppDays }); ids = [{ id: r.id, code: r.code }]; memberPersons = [g]; }
        else { const rooms = Array.from({ length: bedsWanted }, (_, i) => { const ex = i >= 1 ? extra[i - 1] : null; const picked = i === 0 ? pickedGuestId : ex?.guestId; const named = !picked && ex && ex.firstName.trim() && ex.lastName.trim(); return named ? { roomTypeId: bedType.roomTypeId, adults: 1, firstName: ex!.firstName.trim(), lastName: ex!.lastName.trim() } : { roomTypeId: bedType.roomTypeId, adults: 1 }; }); const grp = await api.createGroup({ name: `${g.lastName} (${bedsWanted} lůžek)`, from, to, organizer: guest, organizerGuestId: pickedGuestId ?? undefined, rooms, billing: groupBilling }); ids = grp.members.map((m) => ({ id: m.id, code: m.code })); memberPersons = allPersons; for (let i = 0; i < ids.length; i++) { if (bedByIdx[i]) await api.assignUnit(ids[i].id, bedByIdx[i]).catch(() => {}); } }
      } else {
        const flat: string[] = [];
        for (const [rtId, n] of Object.entries(counts)) for (let i = 0; i < n; i++) flat.push(rtId);
        if (!flat.length) throw new Error("Vyber alespoň jeden pokoj.");
        if (flat.length === 1) {
          const r = await api.createReservation({ roomTypeId: flat[0], from, to, adults, childAges, guest, deferEmail: pay === "deposit" && Number(depositPct) > 0, prepayDays: ppDays });
          if (prefill?.unitId) await api.assignUnit(r.id, prefill.unitId).catch(() => {});
          for (const p of extra) { if (p.guestId) await api.addResGuest(r.id, { guestId: p.guestId }).catch(() => {}); else if (p.firstName.trim()) await api.addResGuest(r.id, { firstName: p.firstName, lastName: p.lastName || g.lastName }).catch(() => {}); }
          ids = [{ id: r.id, code: r.code }];
        } else { const rooms = flat.map((rtId) => ({ roomTypeId: rtId, adults, childAges })); const grp = await api.createGroup({ name: `${g.lastName} (${flat.length} pokojů)`, from, to, organizer: guest, organizerGuestId: pickedGuestId ?? undefined, rooms, billing: groupBilling }); ids = grp.members.map((m) => ({ id: m.id, code: m.code })); }
      }
      // Cena: ubytovna = cena za lůžko/osobu (dle typu); pokoj = cena pokoje + přistýlky oceněné dle typu osoby na nich.
      if (bedMode) {
        for (let i = 0; i < ids.length; i++) { const p = memberPersons[i]; if (p?.rateId) await api.setReservationAccommodation(ids[i].id, ratePrice(p.rateId) * nights); }
      } else if (ids.length === 1 && extraBedSurcharge > 0) {
        const det = await api.reservation(ids[0].id);
        const base = Number(det.totalAmount) - Number(det.cityTax ?? 0);
        await api.setReservationAccommodation(ids[0].id, base + extraBedSurcharge);
      }
      // Hlavní osoba z adresáře: u lůžek per osoba (každé lůžko = jiný člověk), u pokoje jen primární.
      if (bedMode) {
        for (let i = 0; i < ids.length; i++) { const gid = i === 0 ? pickedGuestId : (extra[i - 1]?.guestId ?? null); if (gid) await api.setReservationPrimaryGuest(ids[i].id, gid).catch(() => {}); }
      } else if (pickedGuestId && ids[0]) {
        await api.setReservationPrimaryGuest(ids[0].id, pickedGuestId).catch(() => {});
      }
      for (const it of ids) {
        if (customer === "company" && company) await api.setReservationCompany(it.id, company.id);
        if (bedMode && customer === "company") {
          if (wBedRateId) await api.setReservationBedRate(it.id, wBedRateId).catch(() => {}); // sjednaná sazba (předvyplní cenu)
          { const a = Number(String(wAmount).replace(",", ".")); if (wAmount !== "" && !isNaN(a)) await api.setReservationAccommodation(it.id, a).catch(() => {}); } // ruční přepis ceny
          if (wPayUntil || wVip) await api.setReservationBooking(it.id, { payUntil: wPayUntil || null, vip: wVip }).catch(() => {});
          if (wEnergyFree) await api.setReservationEnergyExempt(it.id, true).catch(() => {});
          if (wNote.trim()) await api.saveReservationNote(it.id, wNote.trim()).catch(() => {});
        }
      }
      if (pay === "deposit" && ids.length === 1) { const det = await api.reservation(ids[0].id); const amt = Math.round(Number(det.totalAmount) * Number(depositPct) / 100); if (amt > 0) await api.issueProforma(ids[0].id, amt, undefined, true, true); }
      setDone(ids);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const Stepper = ({ v, set, min = 0, max = 20 }: { v: number; set: (n: number) => void; min?: number; max?: number }) => (
    <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => set(Math.max(min, v - 1))}>−</button><b style={{ minWidth: 22, textAlign: "center" }}>{v}</b><button className="btn sm ghost" onClick={() => set(Math.min(max, v + 1))}>＋</button></span>
  );

  const stepNames = ["Termín", "Ubytování", "Host", "Platba"];
  const personCols = ratesEnabled ? "26px minmax(0,1fr) 160px minmax(0,1fr) 92px" : "26px minmax(0,1fr) 160px";
  const rateOptions = (rates.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({money(r.pricePerNight)}/noc)</option>);
  return (
    <div className="inv-backdrop">{/* klik mimo okno NEZAVÍRÁ — průvodce má rozdělanou rezervaci; zavírá jen tlačítko */}
      <div className="invoice wz">
        <div className="wz-head">
          <div className="wz-titlerow">
            <h2>Nová rezervace</h2>
            <button className="linkx" onClick={onClose}>zavřít</button>
          </div>
          {!done && (
            <div className="wz-steps">
              {stepNames.map((s, i) => (
                <div key={s} className={`wz-step${step === i + 1 ? " active" : step > i + 1 ? " done" : ""}`}>
                  <span className="n">{step > i + 1 ? "✓" : i + 1}</span>{s}
                </div>
              ))}
            </div>
          )}
        </div>
        {err && <div className="error" style={{ margin: "16px 32px 0" }}>{err}</div>}

        {done ? (<>
          <div className="wz-body">
            <div className="wz-done">
              <div className="circle">✓</div>
              <h2 style={{ margin: "0 0 8px" }}>Rezervace vytvořena</h2>
              <div className="muted">Kód: <b style={{ color: "var(--text)", fontFamily: "monospace" }}>{done.map((d) => d.code).join(", ")}</b>{pay === "deposit" && done.length === 1 ? " · vystavena zálohová faktura, e-mail odeslán hostovi" : ""}{pay === "prepay" && customer !== "company" ? ` · odeslán e-mail s QR platbou, splatnost ${prepayDays} dnů před příjezdem` : ""}{done.length > 1 ? (groupBilling === "collective" ? " · společný účet (jeden plátce)" : " · každý platí zvlášť") : ""}</div>
            </div>
          </div>
          <div className="wz-foot">
            <span />
            <div className="row" style={{ gap: 10 }}>
              <button className="btn ghost" onClick={onCreated}>Hotovo</button>
              <button className="btn" onClick={() => onOpenDetail(done[0].id)}>Otevřít detail ▸</button>
            </div>
          </div>
        </>) : (<>
          <div className="wz-body">
            {step === 1 && (
              <div>
                <div className="wz-sec">Termín pobytu</div>
                <div className="wz-row1">
                  <div className="wz-field wz-big-input" style={{ width: 190 }}><label>Příjezd</label><input type="date" value={from} onChange={(e) => { const v = e.target.value; setFrom(v); setTo((t) => departAfter(v, t)); }} /></div>
                  <div className="wz-field wz-big-input" style={{ width: 190 }}><label>Odjezd</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
                  <span className="wz-tag" style={{ marginBottom: 6 }}>{nights} {nights === 1 ? "noc" : "nocí"}</span>
                </div>
                {!bedMode && (<>
                  <div className="wz-sec">Počet osob</div>
                  <div className="row" style={{ gap: 16 }}><Stepper v={guests} set={setGuests} min={1} /><span className="muted">Typy osob (dítě/senior) a jejich cenu zadáš v kroku 3.</span></div>
                </>)}
              </div>
            )}

            {step === 2 && !bedMode && (
              <div>
                <div className="wz-sec">Volné pokoje · {from} – {to} · {guests} {guests === 1 ? "osoba" : "osob"} <span style={{ textTransform: "none", fontWeight: 400, color: "var(--muted)", letterSpacing: 0 }}>· {roomUnits.length} {roomUnits.length === 1 ? "typ" : roomUnits.length < 5 ? "typy" : "typů"}</span></div>
                {roomUnits.length > 6 && <input className="wz-filter" placeholder="🔍 Filtrovat pokoje podle názvu…" value={roomQ} onChange={(e) => setRoomQ(e.target.value)} />}
                {roomUnits.length === 0 ? <div className="muted">V tomto termínu není volný žádný pokoj.</div> : filteredRooms.length === 0 ? <div className="muted">Žádný typ neodpovídá „{roomQ}".</div> : (
                  <div className="wz-rooms">
                    {filteredRooms.map((a) => {
                      const sel = (counts[a.roomTypeId] ?? 0) > 0;
                      const price = Number(a.total) + a.extraBedsNeeded * Number(a.extraBedPrice) * nights;
                      return (
                        <div key={a.roomTypeId} className={`wz-room${sel ? " sel" : ""}`}>
                          <div className="rinfo">
                            <div className="rname">{a.name}</div>
                            <div className="rmeta">
                              <span className="wz-tag">{a.capacityAdults} lůžek</span>
                              {a.maxExtraBeds > 0 && <span className="wz-tag">až {a.maxExtraBeds} přist.</span>}
                              {a.extraBedsNeeded > 0 && <span className="wz-tag warn">+{a.extraBedsNeeded}× přist.</span>}
                              <span className="muted" style={{ fontSize: 13 }}>volné: {a.freeUnits}</span>
                            </div>
                          </div>
                          <div className="rprice">
                            <div className="big">{a.extraBedsNeeded > 0 ? "od " : ""}{money(price)}</div>
                            <div className="sub">{money(Number(a.roomTotal) / nights)}/noc{a.extraBedsNeeded > 0 ? ` + přist.` : ""}</div>
                          </div>
                          <Stepper v={counts[a.roomTypeId] ?? 0} set={(n) => setCounts({ ...counts, [a.roomTypeId]: n })} max={a.freeUnits} />
                        </div>
                      );
                    })}
                  </div>
                )}
                {totalRooms > 0 && selCapacity < guests && <div className="error" style={{ marginTop: 14 }}>⚠ Kapacita vybraných pokojů ({selCapacity}) nestačí pro {guests} osob — přidej pokoj nebo využij přistýlku.</div>}
                {totalRooms > 1 && <div className="muted" style={{ marginTop: 12 }}>Více pokojů → vznikne skupina pod jedním kontaktem.</div>}
                {roomUnits.some((a) => a.extraBedsNeeded > 0) && <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>Cena „od" počítá přistýlku v plné sazbě; po zadání typů osob (senior/dítě) v dalším kroku se může snížit.</div>}
              </div>
            )}

            {step === 2 && bedMode && (
              <div>
                <div className="wz-sec">Lůžka</div>
                <div className="wz-row1" style={{ alignItems: "center" }}>
                  <span className="row" style={{ gap: 12 }}><span className="muted">Počet lůžek</span><Stepper v={bedsWanted} set={setBedsWanted} min={1} /></span>
                  <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} style={{ width: "auto" }} /> společně v jednom pokoji</label>
                  <span className="wz-tag">volná: {totalFreeBeds}</span>
                </div>
                <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>Konkrétní lůžka (nepovinné) přiřadíš u jednotlivých osob v dalším kroku.</div>
                {together && roomsWithEnough.length > 0 && <div className="muted" style={{ marginTop: 14 }}>Pohromadě možné v: {roomsWithEnough.map((r) => `pok. ${r.roomNumber} (${r.freeBeds})`).join(", ")}.</div>}
                {together && roomsWithEnough.length === 0 && (
                  <div className="error" style={{ marginTop: 14 }}>
                    ⚠ Žádný pokoj nemá v tomto termínu volných {bedsWanted} lůžek pohromadě. Volných je celkem {totalFreeBeds}, ale rozptýlených po pokojích.
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <button className="btn sm" onClick={() => setTogether(false)}>Rozdělit do více pokojů</button>
                      <button className="btn sm ghost" onClick={() => setStep(1)}>Změnit termín</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div>
                <div className="wz-sec" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 0 }}>
                  <span>Kontakt na hosta</span>
                  <button className="btn sm" onClick={() => setPickGuest(true)}>📇 Vybrat z adresáře</button>
                </div>
                {pickedGuestId && <div className="muted" style={{ marginBottom: 12 }}>Z adresáře: <b style={{ color: "var(--text)" }}>{g.firstName} {g.lastName}</b> · <button className="linkx" onClick={() => { setPickedGuestId(null); setG({ firstName: "", lastName: "", email: "", phone: "", language: "cs", dob: "", rateId: "" }); }}>nový host</button></div>}
                <div className="wz-grid">
                  <div className="wz-field"><label>Jméno</label><input value={g.firstName} onChange={(e) => setG({ ...g, firstName: e.target.value })} /></div>
                  <div className="wz-field"><label>Příjmení</label><input value={g.lastName} onChange={(e) => setG({ ...g, lastName: e.target.value })} /></div>
                  <div className="wz-field"><label>E-mail</label><input value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></div>
                  <div className="wz-field"><label>Telefon</label><input value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} /></div>
                </div>

                <div className="wz-sec">Osoby <span style={{ textTransform: "none", fontWeight: 400, color: "var(--muted)", letterSpacing: 0 }}>· {ratesEnabled ? "typ se dle data narození vybere sám (uprchlíka ručně) — určuje cenu" : "datum narození kvůli pobytovému poplatku"}</span></div>
                <div className="wz-person" style={{ gridTemplateColumns: personCols }}>
                  <span className="pidx">1</span>
                  <div style={{ fontWeight: 600 }}>{g.firstName || "Primární host"} {g.lastName}</div>
                  <input type="date" value={g.dob} onChange={(e) => setPersonDob(0, e.target.value)} />
                  {ratesEnabled && <select value={g.rateId} onChange={(e) => setPersonRate(0, e.target.value)}><option value="">— typ —</option>{rateOptions}</select>}
                  {ratesEnabled && <span className="pprice">{g.rateId ? `${money(ratePrice(g.rateId))}/noc` : ""}</span>}
                </div>
                {extra.map((p, i) => (
                  <div key={i} className="wz-person" style={{ gridTemplateColumns: personCols }}>
                    <span className="pidx">{i + 2}</span>
                    <div style={{ display: "flex", gap: 4, minWidth: 0 }}>
                      <input placeholder="Jméno a příjmení" value={p.firstName} disabled={!!p.guestId} onChange={(e) => setExtra((arr) => arr.map((x, idx) => idx === i ? { ...x, firstName: e.target.value } : x))} style={{ flex: 1, minWidth: 0 }} />
                      {p.guestId
                        ? <button className="btn sm ghost" title="zrušit výběr z adresáře" onClick={() => setExtra((arr) => arr.map((x, idx) => idx === i ? { ...x, guestId: undefined, firstName: "", lastName: "" } : x))}>×</button>
                        : <button className="btn sm ghost" title="vybrat z adresáře" onClick={() => setPickPersonIdx(i)}>📇</button>}
                    </div>
                    <input type="date" value={p.dob} disabled={!!p.guestId} onChange={(e) => setPersonDob(i + 1, e.target.value)} />
                    {ratesEnabled && <select value={p.rateId} onChange={(e) => setPersonRate(i + 1, e.target.value)}><option value="">— typ —</option>{rateOptions}</select>}
                    {ratesEnabled && <span className="pprice">{p.rateId ? `${money(ratePrice(p.rateId))}/noc` : ""}</span>}
                  </div>
                ))}
                {bedMode
                  ? (ratesEnabled ? (allTyped ? <div style={{ marginTop: 16, fontSize: 15 }}><b>Cena ubytování: {money(perPersonTotal)}</b> <span className="muted">({nights} nocí)</span></div> : <div className="muted" style={{ marginTop: 16 }}>Doplň typ u všech osob, aby se spočítala cena dle ceníku.</div>) : null)
                  : (extraBedSurcharge > 0
                    ? <div style={{ marginTop: 16, fontSize: 15 }}><b>Cena ubytování ≈ {money(estAccommodation)}</b> <span className="muted">(pokoj {money(roomBaseTotal)} + přistýlky {money(extraBedSurcharge)} dle osob na nich, bez pobyt. poplatku)</span></div>
                    : <div className="muted" style={{ marginTop: 16 }}>Cena = cena pokoje. Přistýlka se ocení dle typu osoby na ní (senior/dítě…); bez typu dle ceny přistýlky u pokoje.</div>)}

                {bedMode && (freeBedsList ?? []).length > 0 && (
                  <>
                    <div className="wz-sec">Lůžka (nepovinné)</div>
                    <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>Vyber konkrétní volné lůžko pro každou osobu, nebo nech „přiřadit později".</div>
                    {allPersons.map((p, i) => {
                      const taken = new Set(Object.entries(bedByIdx).filter(([k]) => Number(k) !== i).map(([, v]) => v).filter(Boolean));
                      const nm = (i === 0 ? (g.firstName || g.lastName) : (extra[i - 1]?.firstName || extra[i - 1]?.lastName)) || `${i + 1}. osoba`;
                      return (
                        <FieldRow key={i} label={`${i + 1}. ${nm}`}>
                          <select style={{ flex: 1, minWidth: 0 }} value={bedByIdx[i] ?? ""} onChange={(e) => setBedByIdx((m) => ({ ...m, [i]: e.target.value }))}>
                            <option value="">— přiřadit později —</option>
                            {(freeBedsList ?? []).filter((b) => (b.free && !taken.has(b.id)) || b.id === bedByIdx[i]).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                          </select>
                        </FieldRow>
                      );
                    })}
                  </>
                )}

                <div className="wz-sec">Odběratel</div>
                <div className="wz-pay">
                  <label className={customer === "guest" ? "sel" : ""}><input type="radio" checked={customer === "guest"} onChange={() => setCustomer("guest")} /> Host</label>
                  <label className={customer === "company" ? "sel" : ""}><input type="radio" checked={customer === "company"} onChange={() => setCustomer("company")} /> Firma {customer === "company" && (company ? <b style={{ marginLeft: "auto" }}>{company.name}</b> : <span className="muted" style={{ marginLeft: "auto", fontWeight: 400 }}>nevybrána</span>)}{customer === "company" && <button className="btn sm" style={{ marginLeft: company ? 10 : "auto" }} onClick={(e) => { e.preventDefault(); setPickCo(true); }}>{company ? "Změnit" : "Vybrat"}</button>}</label>
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <div className="wz-summary">
                  <div className="kv"><span>Pobyt</span><b>{from} – {to} · {nights} {nights === 1 ? "noc" : "nocí"}</b></div>
                  <div className="kv"><span>{bedMode ? "Lůžka" : "Pokoje"}</span><b>{bedMode ? `${bedsWanted} lůžek` : `${totalRooms} pokoj(ů)`} · {personCount} {personCount === 1 ? "osoba" : "osob"}</b></div>
                  <div className="kv"><span>Host</span><b>{g.firstName} {g.lastName}</b></div>
                  {customer === "company" && company && <div className="kv"><span>Odběratel</span><b>{company.name}</b></div>}
                  {(bedMode ? allTyped : estAccommodation > 0) && <div className="kv tot"><span>Ubytování <span style={{ fontSize: 12 }}>(bez pobyt. poplatku)</span></span><b>≈ {money(estAccommodation)}</b></div>}
                </div>
                <div className="wz-sec" style={{ marginTop: 0 }}>Platba</div>
                <div className="wz-pay">
                  <label className={pay === "arrival" ? "sel" : ""}><input type="radio" checked={pay === "arrival"} onChange={() => setPay("arrival")} /> Při příjezdu</label>
                  <label className={pay === "departure" ? "sel" : ""}><input type="radio" checked={pay === "departure"} onChange={() => setPay("departure")} /> Při odjezdu</label>
                  {!bedMode && totalRooms === 1 && <label className={pay === "deposit" ? "sel" : ""}><input type="radio" checked={pay === "deposit"} onChange={() => setPay("deposit")} /> Zálohou <input type="number" min={0} max={100} style={{ width: 64, marginLeft: 6 }} value={depositPct} onChange={(e) => setDepositPct(e.target.value)} /> %</label>}
                  {customer === "company" && <label className={pay === "company" ? "sel" : ""}><input type="radio" checked={pay === "company"} onChange={() => setPay("company")} /> Na fakturu firmě</label>}
                  {customer !== "company" && <label className={pay === "prepay" ? "sel" : ""}><input type="radio" checked={pay === "prepay"} onChange={() => setPay("prepay")} /> Platba předem — uhradit <input type="number" min={1} max={365} style={{ width: 56, marginLeft: 6, marginRight: 6 }} value={prepayDays} onChange={(e) => setPrepayDays(e.target.value)} /> dnů před příjezdem (jinak storno)</label>}
                </div>
                {(bedMode ? bedsWanted > 1 : totalRooms > 1) && (
                  <>
                    <div className="wz-sec">Účet skupiny</div>
                    <div className="wz-pay">
                      <label className={groupBilling === "collective" ? "sel" : ""}><input type="radio" checked={groupBilling === "collective"} onChange={() => setGroupBilling("collective")} /> Společný účet <span className="muted" style={{ fontSize: 12 }}>(jeden plátce za všechny)</span></label>
                      <label className={groupBilling === "individual" ? "sel" : ""}><input type="radio" checked={groupBilling === "individual"} onChange={() => setGroupBilling("individual")} /> Každý zvlášť <span className="muted" style={{ fontSize: 12 }}>(samostatný účet na lůžko/pokoj)</span></label>
                    </div>
                  </>
                )}
                {pay === "prepay" && customer !== "company" && (() => {
                  const n = Number(prepayDays);
                  if (!(n > 0)) return null;
                  const due = new Date(from + "T00:00:00"); due.setDate(due.getDate() - n);
                  const today = new Date(todayIso() + "T00:00:00");
                  const collapsed = due.getTime() < today.getTime();
                  const fmt = (collapsed ? today : due).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
                  return collapsed
                    ? <div style={{ fontSize: 12, marginTop: 6, color: "#c0392b" }}>⚠️ Termín příjezdu je dřív než zadaná lhůta — splatnost bude <b>ihned (dnes, {fmt})</b>, připomínka se nepošle a bez úhrady se rezervace následující den stornuje.</div>
                    : <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Splatnost do <b>{fmt}</b>. Hostovi odešleme potvrzení s QR platbou, den předem přijde připomínka; bez úhrady se rezervace v termínu automaticky stornuje.</div>;
                })()}
                {bedMode && customer === "company" && (
                  <>
                    <div className="wz-sec">Firemní / dlouhodobé</div>
                    <div style={{ maxWidth: 520 }}>
                      <FieldRow label="Sjednaná sazba"><select style={{ flex: 1, minWidth: 0 }} value={wBedRateId} onChange={(e) => { const id = e.target.value; setWBedRateId(id); const r = (bedRatesA.data ?? []).find((x) => x.id === id); setWAmount(r ? String(Math.round(Number(r.pricePerNight) * nights)) : ""); }}>
                        <option value="">— dle ceny lůžka —</option>
                        {(bedRatesA.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({money(r.pricePerNight)}/noc)</option>)}
                      </select></FieldRow>
                      <FieldRow label="Cena za lůžko (pobyt)"><input type="number" style={{ flex: 1, minWidth: 0 }} value={wAmount} placeholder={`${nights} nocí`} onChange={(e) => setWAmount(e.target.value)} /><span className="muted" style={{ fontSize: 12 }}>Kč</span></FieldRow>
                      <FieldRow label="Splatnost"><input type="date" style={{ flex: 1, minWidth: 0 }} value={wPayUntil} onChange={(e) => setWPayUntil(e.target.value)} /></FieldRow>
                      <FieldRow label="VIP"><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={wVip} onChange={(e) => setWVip(e.target.checked)} /> prioritní/smluvní pobyt</label></FieldRow>
                      <FieldRow label="Energie (vzdušné)"><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={wEnergyFree} onChange={(e) => setWEnergyFree(e.target.checked)} /> osvobozeno (neúčtovat)</label></FieldRow>
                      <FieldRow label="Poznámka"><input style={{ flex: 1, minWidth: 0 }} value={wNote} onChange={(e) => setWNote(e.target.value)} placeholder="např. agentura, směna, kontakt…" /></FieldRow>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Konkrétní lůžka a střídání osob (obsazení) nastavíš po vytvoření v detailu rezervace.</div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="wz-foot">
            <button className="btn ghost" style={{ visibility: step === 1 ? "hidden" : "visible" }} onClick={() => setStep(step - 1)}>‹ Zpět</button>
            {step === 2 && !bedMode && <span className="muted" style={{ fontSize: 13 }}>{totalRooms > 0 ? `Vybráno: ${totalRooms} pokoj(ů) · kapacita ${selCapacity} pro ${guests} ${guests === 1 ? "osobu" : "osob"}` : "Vyber alespoň jeden pokoj"}</span>}
            {step === 1 && <button className="btn" disabled={busy} onClick={loadAvail}>Zobrazit dostupnost ▸</button>}
            {step === 2 && <button className="btn" disabled={!step2Ok} onClick={gotoGuests}>Pokračovat ▸</button>}
            {step === 3 && <button className="btn" disabled={!g.firstName.trim() || !g.lastName.trim() || (customer === "company" && !company)} onClick={() => setStep(4)}>Pokračovat ▸</button>}
            {step === 4 && <button className="btn" disabled={busy} onClick={create}>{busy ? "Vytvářím…" : "Vytvořit rezervaci ✓"}</button>}
          </div>
        </>)}
        {pickCo && <CompanyPickerOverlay onClose={() => setPickCo(false)} onPick={(cid) => { api.company(cid).then((c) => setCompany({ id: c.id, name: c.name })); setPickCo(false); }} />}
        {pickGuest && <GuestPickerOverlay prefill={g.lastName || g.email || ""} onClose={() => setPickGuest(false)} onPick={(gid) => { api.guestProfile(gid).then((p) => { setG((s) => ({ ...s, firstName: p.guest.firstName, lastName: p.guest.lastName, email: p.guest.email ?? "", phone: p.guest.phone ?? "", language: p.guest.language ?? "cs" })); setPickedGuestId(gid); }); setPickGuest(false); }} />}
        {pickPersonIdx !== null && <GuestPickerOverlay prefill="" title="Vybrat osobu z adresáře" subtitle="Doplní jméno této osoby (a napojí na rezervaci, ať ji nezadáváš znovu)." actionLabel="Vybrat" onClose={() => setPickPersonIdx(null)} onPick={(gid) => { const idx = pickPersonIdx; api.guestProfile(gid).then((p) => setExtra((arr) => arr.map((x, k) => k === idx ? { ...x, guestId: gid, firstName: `${p.guest.firstName} ${p.guest.lastName}`.trim(), lastName: p.guest.lastName } : x))); setPickPersonIdx(null); }} />}
      </div>
    </div>
  );
}

function ReservationsView({ selId, prop }: { selId: string; prop: Property }) {
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, reload } = useAsync<Reservation[]>(() => api.reservations(q, status), [selId, status]);
  const types = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null); // proklik na skupinu ze seznamu
  const [guestQr, setGuestQr] = useState<Reservation[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [f, setF] = useState({ roomTypeId: "", from: todayIso(), to: tomorrowIso(), adults: 2, children: 0, childAges: [] as number[], firstName: "", lastName: "", email: "", phone: "", language: "cs", billingCompany: "", billingIco: "" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkDoc, setBulkDoc] = useState<Doc | null>(null);
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const bulk = async () => { setFormErr(""); try { setBulkDoc(await api.bulkInvoice([...sel])); setSel(new Set()); } catch (e) { setFormErr(e instanceof Error ? e.message : String(e)); } };

  const cancel = async (id: string) => { if (await confirm({ title: "Zrušit rezervaci", message: "Opravdu zrušit tuto rezervaci?", confirmLabel: "Zrušit rezervaci", danger: true })) { await api.cancel(id); reload(); } };
  const create = async () => {
    setFormErr("");
    if (!f.roomTypeId || !f.firstName || !f.lastName) { setFormErr("Vyplň typ, jméno a příjmení."); return; }
    try {
      await api.createReservation({ roomTypeId: f.roomTypeId, from: f.from, to: f.to, adults: Number(f.adults), childAges: f.childAges,
        guest: { firstName: f.firstName, lastName: f.lastName, email: f.email || undefined, phone: f.phone || undefined, language: f.language },
        billingCompany: f.billingCompany || undefined, billingIco: f.billingIco || undefined });
      setShowForm(false); setF({ roomTypeId: "", from: todayIso(), to: tomorrowIso(), adults: 2, children: 0, childAges: [] as number[], firstName: "", lastName: "", email: "", phone: "", language: "cs", billingCompany: "", billingIco: "" }); reload();
    } catch (e) { setFormErr(e instanceof Error ? e.message : String(e)); }
  };

  if (openGroup) return <GroupDetailView id={openGroup} prop={prop} onBack={() => { setOpenGroup(null); reload(); }} />;
  if (detailId) return <ReservationDetailView id={detailId} prop={prop} onBack={() => { setDetailId(null); reload(); }} />;

  return (
    <>
      <div className="h1">Rezervace <button className="btn" onClick={() => setWizard(true)}>✨ Nová rezervace (průvodce)</button> <button className="btn ghost" onClick={() => setShowForm((s) => !s)}>{showForm ? "Zavřít" : "rychlý formulář"}</button></div>
      {error && <div className="error">{error}</div>}
      {wizard && <NewReservationWizard prop={prop} onClose={() => setWizard(false)} onCreated={() => { setWizard(false); reload(); }} onOpenDetail={(rid) => { setWizard(false); setDetailId(rid); }} />}
      {showForm && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 style={{ border: "none", padding: 0, marginBottom: 14 }}>Nová rezervace</h3>
          {formErr && <div className="error">{formErr}</div>}
          <div className="toolbar">
            <select value={f.roomTypeId} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}>
              <option value="">{prop.inventoryUnit === "bed" ? "Typ lůžka…" : "Typ pokoje…"}</option>
              {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({money(t.basePrice)}/noc)</option>)}
            </select>
            <label className="row">Příjezd <input type="date" value={f.from} onChange={(e) => { const v = e.target.value; setF({ ...f, from: v, to: departAfter(v, f.to) }); }} /></label>
            <label className="row">Odjezd <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <label className="row">Dospělých <input type="number" min={1} style={{ width: 64 }} value={f.adults} onChange={(e) => setF({ ...f, adults: Number(e.target.value) })} /></label>
            <label className="row">Dětí <input type="number" min={0} max={10} style={{ width: 64 }} value={f.children} onChange={(e) => { const n = Math.max(0, Math.min(10, Number(e.target.value) || 0)); setF({ ...f, children: n, childAges: Array.from({ length: n }, (_, i) => f.childAges[i] ?? 8) }); }} /></label>
          </div>
          {f.children > 0 && (
            <div className="toolbar">
              {f.childAges.map((age, i) => (
                <label key={i} className="row">Věk dítěte {i + 1} <input type="number" min={0} max={25} style={{ width: 56 }} value={age} onChange={(e) => { const a = [...f.childAges]; a[i] = Math.max(0, Number(e.target.value) || 0); setF({ ...f, childAges: a }); }} /></label>
              ))}
              <span className="muted">poplatek platí děti od věku osvobození provozovny</span>
            </div>
          )}
          <div className="toolbar">
            <input placeholder="Jméno" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
            <input placeholder="Příjmení" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
            <input placeholder="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input placeholder="Telefon" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <label className="row">Jazyk hosta <select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>{GUEST_LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
          </div>
          {f.roomTypeId && (() => { const t = (types.data ?? []).find((x) => x.id === f.roomTypeId); const n = Math.max(1, Math.round((Date.parse(f.to) - Date.parse(f.from)) / 864e5)); return t ? <div className="muted" style={{ margin: "4px 0 10px" }}>Orientační cena: <b style={{ color: "#243240" }}>{money(Number(t.basePrice) * n)}</b> ({n} {n === 1 ? "noc" : "nocí"} × {money(t.basePrice)}) <span style={{ fontSize: 12 }}>— bez pobyt. poplatku a sezónních cen</span></div> : null; })()}
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
          {["pending", "hold", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <button className="btn ghost" onClick={() => setGuestQr((data ?? []).filter((r) => ["confirmed", "checked_in"].includes(r.status)))}>🏷 QR hostů</button>
        {sel.size > 0 && <button className="btn" onClick={bulk}>🧾 Hromadná faktura ({sel.size})</button>}
      </div>
      <div className="panel">
        <Table cols={["", "Kód", "Host", "Termín", "Vznik", "Jednotka", "Stav", "Částka", ""]} rows={[...(data ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))} empty="Žádné rezervace"
          render={(r: Reservation) => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
              <td className="muted">{r.code}</td>
              <td>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}{r.group && <button className="chip" style={{ cursor: "pointer", border: "none", marginLeft: 6 }} title="Otevřít skupinu" onClick={(e) => { e.stopPropagation(); setOpenGroup(r.group!.id); }}>👥 {r.group.name} ›</button>}</td>
              <td>{d(r.checkInDate)} → {d(r.checkOutDate)}</td>
              <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.createdAt ? new Date(r.createdAt).toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
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
// Přehled pokojů = čistý seznam výsledných stavů; klik na řádek → detail pokoje
// (centrální ovládání: stav, přehazování hostů, rezervace, požadavky, vlastnosti).
const ROOM_STATES: [string, string][] = [["clean", "Uklizeno"], ["dirty", "K úklidu"], ["to_inspect", "Zkontrolovat"], ["inspected", "Zkontrolováno"], ["out_of_service", "Mimo"]];
const RoomPill = ({ s }: { s: string }) => <span className={`rs-pill rs-${s}`}>{ROOM_STATUS_LABEL[s] ?? s}</span>;

// ── Grafický půdorys obsazenosti (po patrech, interaktivní + editor rozložení) ──
// Jen další pohled na stávající data (roomBoard/bedBoard) — barevně odliší
// obsazené × volné, proklik na rezervaci/pokoj. compact = náhled na Recepci.
// Edit režim: pokoje/boxy lůžek se rozmístí tažením (uložené souřadnice posX/posY/w/h).
const floorName = (n: number) => (n === 0 ? "Přízemí" : `${n}. patro`);
const FP_CANVAS_W = 860, FP_GAP = 14, FP_SNAP = 6;
type FPPos = { x: number; y: number; w: number; h: number };
type FPNode = { id: string; floor: number; sx: number | null; sy: number | null; sw: number | null; sh: number | null; defW: number; defH: number; wrapClass: string; inner: ReactNode; onClick?: () => void };

function FloorPlanView({ prop, compact, onPickRes, onOpenFull }: { prop: Property; compact?: boolean; onPickRes?: (resId: string) => void; onOpenFull?: () => void }) {
  const bedMode = prop.inventoryUnit === "bed";
  const { data, error, reload } = useAsync<(RoomBoardItem | BedBoardItem)[]>(() => (bedMode ? api.bedBoard() : api.roomBoard()), [prop.id]);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [openRes, setOpenRes] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [edit, setEdit] = useState(false);
  const [lay, setLay] = useState<Record<string, FPPos>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [floorSel, setFloorSel] = useState<number | "all" | null>(null); // volič patra (null = výchozí dle počtu pater)
  const drag = useRef<null | { id: string; mode: "move" | "resize"; px: number; py: number; ox: number; oy: number; ow: number; oh: number }>(null);

  if (openRes) return <ReservationDetailView id={openRes} prop={prop} onBack={() => { setOpenRes(null); reload(); }} />;
  if (openRoom) return <RoomDetailView roomId={openRoom} prop={prop} onBack={() => { setOpenRoom(null); reload(); }} />;

  const pickRes = (id: string) => (onPickRes ? onPickRes(id) : compact ? onOpenFull?.() : setOpenRes(id));
  const pickRoom = (id: string) => (compact ? onOpenFull?.() : setOpenRoom(id));
  const items = data ?? [];
  const floorsOf = (fs: number[]) => [...new Set(fs)].sort((a, b) => a - b);

  // shelf-packing auto rozložení (pro uzly bez uložených souřadnic)
  const autoPos = (ns: FPNode[]) => {
    const m: Record<string, FPPos> = {}; let x = 0, y = 0, rowH = 0;
    for (const n of ns) {
      if (x + n.defW > FP_CANVAS_W && x > 0) { x = 0; y += rowH + FP_GAP; rowH = 0; }
      m[n.id] = { x, y, w: n.defW, h: n.defH }; x += n.defW + FP_GAP; rowH = Math.max(rowH, n.defH);
    }
    return m;
  };
  const effOf = (ns: FPNode[]) => {
    const auto = autoPos(ns); const m: Record<string, FPPos> = {};
    for (const n of ns) m[n.id] = (n.sx != null && n.sy != null) ? { x: n.sx, y: n.sy, w: n.sw ?? n.defW, h: n.sh ?? n.defH } : auto[n.id];
    return m;
  };

  const onDown = (e: React.PointerEvent, id: string, mode: "move" | "resize") => {
    if (!edit) return;
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const c = lay[id]; if (!c) return;
    drag.current = { id, mode, px: e.clientX, py: e.clientY, ox: c.x, oy: c.y, ow: c.w, oh: c.h };
  };
  const onMove = (e: React.PointerEvent) => {
    const dr = drag.current; if (!dr) return;
    const dx = e.clientX - dr.px, dy = e.clientY - dr.py, snap = (v: number) => Math.round(v / FP_SNAP) * FP_SNAP;
    setLay((L) => {
      const c = L[dr.id]; if (!c) return L;
      if (dr.mode === "move") return { ...L, [dr.id]: { ...c, x: Math.max(0, Math.min(FP_CANVAS_W - c.w, snap(dr.ox + dx))), y: Math.max(0, snap(dr.oy + dy)) } };
      return { ...L, [dr.id]: { ...c, w: Math.max(96, Math.min(FP_CANVAS_W, snap(dr.ow + dx))), h: Math.max(54, snap(dr.oh + dy)) } };
    });
  };
  const onUp = () => { drag.current = null; };

  // ── stavba uzlů dle režimu (pokoj × box lůžek) ──
  let nodes: FPNode[] = [];
  let filtersBar: ReactNode = null;
  if (!bedMode) {
    const all = items as RoomBoardItem[];
    const filters: [string, string, (r: RoomBoardItem) => boolean][] = [
      ["all", "Vše", () => true], ["occupied", "Obsazené", (r) => !!r.occupant], ["free", "Volné", (r) => !r.occupant && r.status !== "out_of_service"],
      ["arrivals", "Příjezdy dnes", (r) => !!r.arrival], ["dirty", "K úklidu", (r) => r.status === "dirty"], ["maint", "Údržba", (r) => r.openMaintenance > 0],
    ];
    const pred = edit ? () => true : (filters.find((f) => f[0] === filter)?.[2] ?? (() => true));
    const shown = [...all].filter(pred).sort((a, b) => a.number.localeCompare(b.number, "cs", { numeric: true }));
    nodes = shown.map((r) => {
      const occ = r.occupant;
      return {
        id: r.id, floor: r.floor, sx: r.posX, sy: r.posY, sw: r.w, sh: r.h, defW: 150, defH: 90,
        wrapClass: `fp-room ${occ ? "occ" : r.status === "out_of_service" ? "oos" : "free"}`,
        onClick: () => (occ ? pickRes(occ.reservationId) : pickRoom(r.id)),
        inner: (<>
          {!compact && !edit && <button className="fp-roomlink" onClick={(e) => { e.stopPropagation(); pickRoom(r.id); }}>pokoj ›</button>}
          <div className="fp-num">{r.number}</div>
          <div className="fp-state">{occ ? `● ${occ.name}` : r.status === "out_of_service" ? "⛔ mimo" : "○ volný"}</div>
          {occ && !compact && <div className="fp-sub">do {d(occ.checkOutDate)}</div>}
          {!compact && <div className="fp-badges">
            {occ && Number(occ.balance) > 0 && <span className="fp-tag">⚠ {money(occ.balance)}</span>}
            {occ?.dnd && <span className="fp-tag">🚫</span>}
            {occ?.departsToday && <span className="fp-tag">🔁</span>}
            {r.arrival && <span className="fp-tag">→ {r.arrival.name}</span>}
            {r.openHousekeeping > 0 && <span className="fp-tag">🧹 {r.openHousekeeping}</span>}
            {r.openMaintenance > 0 && <span className="fp-tag">🔧 {r.openMaintenance}</span>}
          </div>}
        </>),
      };
    });
    if (!compact) filtersBar = <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>{filters.map(([v, l, p]) => <button key={v} className={`btn sm ${filter === v ? "" : "ghost"}`} onClick={() => setFilter(v)} disabled={edit}>{l} ({all.filter(p).length})</button>)}</div>;
  } else {
    const allB = items as BedBoardItem[];
    const filters: [string, string, (b: BedBoardItem) => boolean][] = [
      ["all", "Vše", () => true], ["occupied", "Obsazená", (b) => !!b.current], ["free", "Volná", (b) => !b.current && b.status !== "out_of_service"], ["dirty", "K úklidu", (b) => b.status === "dirty"],
    ];
    const pred = edit ? () => true : (filters.find((f) => f[0] === filter)?.[2] ?? (() => true));
    const byRoom = new Map<string, BedBoardItem[]>();
    for (const b of allB.filter(pred)) { if (!byRoom.has(b.roomId)) byRoom.set(b.roomId, []); byRoom.get(b.roomId)!.push(b); }
    nodes = [...byRoom.entries()].map(([roomId, beds]) => {
      const first = beds[0]; const rows = Math.ceil(beds.length / 3);
      return {
        id: roomId, floor: first.floor, sx: first.roomPosX, sy: first.roomPosY, sw: first.roomW, sh: first.roomH, defW: 220, defH: 50 + rows * 48, wrapClass: "fp-bedroom",
        inner: (<>
          <div className="fp-bedroom-h">Pokoj {first.roomNumber}</div>
          <div className="fp-beds">{[...beds].sort((a, b) => a.label.localeCompare(b.label, "cs", { numeric: true })).map((b) => {
            const cur = b.current; const cls = cur ? "occ" : b.status === "out_of_service" ? "oos" : "free";
            return <div key={b.bedId} className={`fp-bed ${cls}`} title={cur ? cur.guestName : `Lůžko ${b.label}`} onClick={() => cur && pickRes(cur.reservationId)}><span className="fp-bl">{b.label}</span><span className="fp-bn">{cur ? (cur.companyName || cur.guestName) : "volné"}</span></div>;
          })}</div>
        </>),
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
    if (!compact) filtersBar = <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>{filters.map(([v, l, p]) => <button key={v} className={`btn sm ${filter === v ? "" : "ghost"}`} onClick={() => setFilter(v)} disabled={edit}>{l} ({allB.filter(p).length})</button>)}</div>;
  }

  const hasLayout = nodes.some((n) => n.sx != null);
  const canvasMode = (edit || hasLayout) && !compact;
  const floors = floorsOf(nodes.map((n) => n.floor));
  // Volič patra: u velkých budov (>4 patra) výchozí jedno patro, jinak vše. Obsazenost počítáme ze syrových dat.
  const allFloors = floorsOf((items as { floor: number }[]).map((x) => x.floor));
  const floorStat = (f: number) => bedMode
    ? { occ: (items as BedBoardItem[]).filter((b) => b.floor === f && b.current).length, total: (items as BedBoardItem[]).filter((b) => b.floor === f).length }
    : { occ: (items as RoomBoardItem[]).filter((r) => r.floor === f && r.occupant).length, total: (items as RoomBoardItem[]).filter((r) => r.floor === f).length };
  const effSel: number | "all" = floorSel ?? (allFloors.length > 4 ? (allFloors[0] ?? "all") : "all");
  const shownFloors = effSel === "all" ? floors : floors.filter((f) => f === effSel);

  const startEdit = () => { const m: Record<string, FPPos> = {}; for (const f of floors) Object.assign(m, effOf(nodes.filter((n) => n.floor === f))); setLay(m); setEdit(true); setMsg(""); };
  const save = async () => { setSaving(true); setMsg(""); try { await api.saveRoomLayout(Object.entries(lay).map(([id, v]) => ({ id, posX: v.x, posY: v.y, w: v.w, h: v.h }))); setEdit(false); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); } };

  const legend = (
    <div className="fp-legend">
      <span><i className="fp-sw occ" /> Obsazené</span>
      <span><i className="fp-sw free" /> Volné</span>
      <span><i className="fp-sw oos" /> Mimo provoz</span>
      {!bedMode && !compact && <span className="muted">⚠ účet · 🚫 nerušit · 🔁 odjezd dnes · → příjezd · 🧹/🔧 úklid/údržba</span>}
    </div>
  );

  const floorBlock = (f: number) => {
    const fn = nodes.filter((n) => n.floor === f);
    if (!canvasMode) return (
      <div className="fp-floor" key={f}>
        <div className="fp-floor-h">{floorName(f)}</div>
        <div className={`fp-grid ${bedMode ? "fp-grid-rooms" : ""}`}>{fn.map((n) => <div key={n.id} className={n.wrapClass} onClick={n.onClick}>{n.inner}</div>)}</div>
      </div>
    );
    const pos = edit ? Object.fromEntries(fn.map((n) => [n.id, lay[n.id] ?? autoPos(fn)[n.id]])) as Record<string, FPPos> : effOf(fn);
    const height = Math.max(200, ...fn.map((n) => (pos[n.id]?.y ?? 0) + (pos[n.id]?.h ?? n.defH) + FP_GAP));
    return (
      <div className="fp-floor" key={f}>
        <div className="fp-floor-h">{floorName(f)}</div>
        <div className="fp-canvas-wrap"><div className={`fp-canvas ${edit ? "fp-editing" : ""}`} style={{ width: FP_CANVAS_W, height }}>
          {fn.map((n) => { const p = pos[n.id] ?? { x: 0, y: 0, w: n.defW, h: n.defH };
            return (
              <div key={n.id} className={`fp-node ${n.wrapClass}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
                onClick={edit ? undefined : n.onClick}
                onPointerDown={edit ? (e) => onDown(e, n.id, "move") : undefined} onPointerMove={edit ? onMove : undefined} onPointerUp={edit ? onUp : undefined}>
                {n.inner}
                {edit && <span className="fp-resize" onPointerDown={(e) => onDown(e, n.id, "resize")} onPointerMove={onMove} onPointerUp={onUp} />}
              </div>
            );
          })}
        </div></div>
      </div>
    );
  };

  return (
    <div className={`floorplan ${compact ? "fp-compact" : ""}`}>
      {error && <div className="error">{error}</div>}
      {msg && <div className="error">{msg}</div>}
      {!compact && (
        <div className="toolbar" style={{ gap: 8, marginBottom: 4, alignItems: "center" }}>
          {allFloors.length > 1 && (
            <label className="row" style={{ gap: 6 }}>Patro:
              <select value={String(effSel)} onChange={(e) => setFloorSel(e.target.value === "all" ? "all" : Number(e.target.value))}>
                <option value="all">Všechna patra</option>
                {allFloors.map((f) => { const s = floorStat(f); return <option key={f} value={f}>{floorName(f)} ({s.occ}/{s.total} obsazeno)</option>; })}
              </select>
            </label>
          )}
          {!edit && <button className="btn sm ghost" onClick={startEdit}>✎ Upravit rozložení</button>}
          {edit && <><button className="btn sm" onClick={save} disabled={saving}>💾 Uložit rozložení</button> <button className="btn sm ghost" onClick={() => { setEdit(false); setMsg(""); }} disabled={saving}>Zrušit</button> <span className="muted" style={{ fontSize: 13 }}>Táhni dlaždice myší; roh vpravo dole mění velikost.</span></>}
        </div>
      )}
      {!edit && filtersBar}
      {legend}
      {shownFloors.length === 0 ? <div className="muted">{bedMode ? "Žádná lůžka." : "Žádné pokoje."}</div> : shownFloors.map(floorBlock)}
    </div>
  );
}

function RoomBoardView({ selId, prop }: { selId: string; prop: Property }) {
  const { data, error, reload } = useAsync<RoomBoardItem[]>(() => api.roomBoard(), [selId]);
  const typesA = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const priceByName = (n: string | null) => { const t = (typesA.data ?? []).find((x) => x.name === n); return t ? money(t.basePrice) : ""; };
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "plan">("list");
  if (openId) return <RoomDetailView roomId={openId} prop={prop} onBack={() => { setOpenId(null); reload(); }} />;
  const rooms = data ?? [];
  const counts = { occupied: rooms.filter((r) => r.occupant).length, free: rooms.filter((r) => !r.occupant).length, arrivals: rooms.filter((r) => r.arrival).length, dirty: rooms.filter((r) => r.status === "dirty").length, maint: rooms.filter((r) => r.openMaintenance > 0).length };
  const match = (r: RoomBoardItem) => filter === "all" ? true : filter === "occupied" ? !!r.occupant : filter === "free" ? !r.occupant : filter === "arrivals" ? !!r.arrival : filter === "dirty" ? r.status === "dirty" : filter === "maint" ? r.openMaintenance > 0 : true;
  const shown = rooms.filter(match);
  const FILTERS: [string, string][] = [["all", `Vše (${rooms.length})`], ["occupied", `Obsazené (${counts.occupied})`], ["free", `Volné (${counts.free})`], ["arrivals", `Příjezdy dnes (${counts.arrivals})`], ["dirty", `K úklidu (${counts.dirty})`], ["maint", `Údržba (${counts.maint})`]];
  if (view === "plan") return (
    <>
      <div className="h1"><span>Přehled pokojů</span> <span className="fp-toggle"><button className="btn sm ghost" onClick={() => setView("list")}>☰ Seznam</button> <button className="btn sm" onClick={() => setView("plan")}>▦ Půdorys</button></span> <button className="btn ghost sm" onClick={reload}>↻ Obnovit</button></div>
      <FloorPlanView prop={prop} />
    </>
  );
  return (
    <>
      <div className="h1"><span>Přehled pokojů</span> <span className="fp-toggle"><button className="btn sm" onClick={() => setView("list")}>☰ Seznam</button> <button className="btn sm ghost" onClick={() => setView("plan")}>▦ Půdorys</button></span> <button className="btn ghost sm" onClick={reload}>↻ Obnovit</button></div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map(([v, l]) => <button key={v} className={`btn sm ${filter === v ? "" : "ghost"}`} onClick={() => setFilter(v)}>{l}</button>)}
      </div>
      <div className="panel">
        <Table cols={["Pokoj", "Typ", "Stav", "Obsazenost", "Účet", "Dnes", "Požadavky"]} rows={shown} empty="Žádné pokoje"
          render={(r: RoomBoardItem) => (
            <tr key={r.id} className="row-click" onClick={() => setOpenId(r.id)}>
              <td><b>Pokoj {r.number}</b> <span className="muted">· {r.floor}.p</span></td>
              <td className="muted">{r.roomType ?? "—"}{r.roomType ? <span> · {priceByName(r.roomType)}/noc</span> : ""}</td>
              <td><RoomPill s={r.status} /></td>
              <td>{r.occupant ? <>👤 {r.occupant.name} <span className="muted">· do {d(r.occupant.checkOutDate)}</span>{r.occupant.dnd && <span className="chip chip-dnd">🚫 Nerušit</span>}</> : <span className="muted">Volný</span>}</td>
              <td>{r.occupant ? (Number(r.occupant.balance) > 0 ? <b style={{ color: "var(--warn)" }}>{money(r.occupant.balance)}</b> : <span className="muted">{money(r.occupant.balance)}</span>) : <span className="muted">—</span>}</td>
              <td className="muted">{[r.occupant?.departsToday ? "🔁 odjezd dnes" : "", r.arrival ? `→ příjezd: ${r.arrival.name}` : ""].filter(Boolean).join(" · ") || "—"}</td>
              <td>{r.openHousekeeping > 0 && <span className="rb-badge hk">🧹 {r.openHousekeeping}</span>}{r.openHousekeeping > 0 && r.openMaintenance > 0 ? " " : ""}{r.openMaintenance > 0 && <span className="rb-badge mt">🔧 {r.openMaintenance}</span>}{!r.openHousekeeping && !r.openMaintenance ? <span className="muted">—</span> : null}</td>
            </tr>
          )} />
      </div>
    </>
  );
}

// Detail pokoje — centrální ovládání provozu pokoje.
function RoomDetailView({ roomId, prop, onBack }: { roomId: string; prop: Property; onBack: () => void }) {
  const confirm = useConfirm();
  const { data, error, reload } = useAsync<RoomDetail>(() => api.roomDetail(roomId), [roomId]);
  const typesA = useAsync<RoomType[]>(() => api.roomTypes(), [roomId]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [resId, setResId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [cands, setCands] = useState<RoomCandidate[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedRes[] | null>(null);
  const [rf, setRf] = useState({ type: "cleaning", description: "" });
  const [payAmt, setPayAmt] = useState("");
  const [payFor, setPayFor] = useState<string | null>(null);
  const [chargeReq, setChargeReq] = useState<RoomReqItem | null>(null);
  const [chargeForm, setChargeForm] = useState({ amount: "", category: "service", description: "" });
  const [ef, setEf] = useState<{ number: string; floor: string; lockType: string; notes: string } | null>(null);
  useEffect(() => { if (data) setEf({ number: data.room.number, floor: String(data.room.floor), lockType: data.room.lockType, notes: data.room.notes }); }, [data?.room.id]); // eslint-disable-line

  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); setMsg(""); try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const setStatus = (s: string) => run(() => api.updateRoom(roomId, { status: s }));
  const openMove = async (rid: string) => { setMoveFor(rid); setCands(null); try { setCands(await api.roomCandidates(rid)); } catch { /* */ } };
  const doMove = (rid: string, targetId: string) => run(async () => { await api.assignUnit(rid, targetId); setMoveFor(null); }, "Host přemístěn.");
  const openPlace = async () => { try { setUnassigned(await api.roomUnassigned(roomId)); } catch { /* */ } };
  const doPlace = (rid: string) => run(async () => { await api.assignUnit(rid, roomId); setUnassigned(null); }, "Rezervace umístěna na pokoj.");
  const addReq = () => run(async () => { await api.createRoomRequest(roomId, { type: rf.type, description: rf.description || undefined }); setRf({ type: "cleaning", description: "" }); }, "Požadavek vytvořen.");
  const saveRoom = () => { if (ef) run(() => api.updateRoom(roomId, { number: ef.number, floor: Number(ef.floor), lockType: ef.lockType, notes: ef.notes }), "Pokoj uložen."); };
  const checkin = async (rid: string, code: string) => { if (await confirm({ title: "Check-in", message: <>Provést check-in rezervace <b>{code}</b>?</>, confirmLabel: "Check-in" })) run(() => api.checkin(rid), "Check-in proveden."); };
  const checkout = async (rid: string, code: string) => { if (await confirm({ title: "Check-out", message: <>Provést check-out rezervace <b>{code}</b>? Účet musí být vyrovnaný.</>, confirmLabel: "Check-out" })) run(async () => { const x = await api.checkout(rid); if (x.document) setDoc(x.document); }, "Check-out proveden."); };
  const pay = async (rid: string, method: string, amount: number) => { if (!Number.isFinite(amount) || amount <= 0) { setMsg("Zadej platnou částku."); return; } if (await confirm({ title: "Úhrada", message: <>Zaúčtovat <b>{money(amount)}</b> {method === "cash" ? "hotově" : "kartou"}?</>, confirmLabel: "Zaúčtovat" })) { if (method === "cash" && !(await ensureCashOpen(confirm))) return; run(() => api.addPayment(rid, { type: "balance", amount, method }), "Úhrada zaúčtována."); setPayAmt(""); setPayFor(null); } };
  const toggleDnd = (rid: string, on: boolean) => run(() => api.setDnd(rid, on), on ? "Nastaveno Nerušit." : "Nerušit zrušeno.");
  const openCharge = (q: RoomReqItem) => { setChargeReq(q); setChargeForm({ amount: "", category: q.domain === "maintenance" ? "other" : "service", description: q.note || q.description || SERVICE_LABEL[q.type] }); };
  const submitCharge = () => {
    const occId = data?.occupantId; if (!occId || !chargeReq) return;
    const amt = Number(chargeForm.amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) { setMsg("Zadej platnou částku."); return; }
    run(async () => { await api.addCharge(occId, { category: chargeForm.category, description: chargeForm.description || undefined, unitPrice: amt, quantity: 1 }); setChargeReq(null); }, "Naúčtováno hostovi.");
  };

  if (resId) return <ReservationDetailView id={resId} prop={prop} onBack={() => { setResId(null); reload(); }} />;
  if (error) return <><div className="h1"><button className="btn ghost" onClick={onBack}>← Zpět</button></div><div className="error">{error}</div></>;
  if (!data || !ef) return <div className="muted" style={{ padding: 20 }}>Načítám…</div>;
  const room = data.room;
  const occ = data.occupantId ? data.reservations.find((r) => r.id === data.occupantId) : null;
  return (
    <>
      <div className="h1"><span><button className="btn ghost" onClick={onBack}>← Zpět</button>&nbsp;&nbsp;Pokoj {room.number} <span className="muted" style={{ fontSize: 15, fontWeight: 400 }}>· {room.roomType.name}{(() => { const t = (typesA.data ?? []).find((x) => x.id === room.roomType.id); return t ? ` · ${money(t.basePrice)}/noc` : ""; })()} · {room.floor}. patro</span></span> <RoomPill s={room.status} /></div>
      {msg && <div className="error" style={/uložen|přemístěn|umístěna|vytvořen|proveden|zaúčtován/i.test(msg) ? { background: "#e6f7ee", color: "var(--ok)" } : undefined}>{msg}</div>}

      <div className="grid2">
        <div className="panel"><h3>Stav úklidu</h3><div style={{ padding: 16 }}>
          <div className="req-actions">{ROOM_STATES.map(([s, l]) => <button key={s} className={`btn sm ${room.status === s ? "" : "ghost"}`} disabled={busy || room.status === s} onClick={() => setStatus(s)}>{l}</button>)}</div>
        </div></div>
        <div className="panel"><h3>Aktuální host</h3><div style={{ padding: 16 }}>
          {occ ? <>
            <div className="kvline"><span className="muted">Host</span><b>{occ.guestName}</b></div>
            <div className="kvline"><span className="muted">Pobyt</span><span>{d(occ.checkInDate)} → {d(occ.checkOutDate)}</span></div>
            <div className="kvline"><span className="muted">Zůstatek</span><b style={{ color: Number(data.occupantBalance) > 0 ? "var(--warn)" : "var(--ok)" }}>{money(data.occupantBalance ?? 0)}</b></div>
            <div className="kvline"><span className="muted">Úklid</span>{data.occupantDnd ? <b style={{ color: "var(--warn)" }}>🚫 Nerušit</b> : <span>povolen</span>}</div>
            <div className="req-actions" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => setResId(occ.id)}>Detail rezervace</button>
              {Number(data.occupantBalance) > 0 && <button className="btn sm" disabled={busy} onClick={() => { setPayFor(occ.id); setPayAmt(""); }}>Doplatit</button>}
              <button className="btn sm ok" disabled={busy} onClick={() => checkout(occ.id, occ.code)}>Check-out</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => openMove(occ.id)}>Přemístit</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => toggleDnd(occ.id, !data.occupantDnd)}>{data.occupantDnd ? "Zrušit Nerušit" : "🚫 Nerušit"}</button>
            </div>
          </> : <>
            <div className="muted">Pokoj není obsazen.</div>
            <div style={{ marginTop: 10 }}><button className="btn sm" disabled={busy} onClick={openPlace}>Umístit hosta sem</button></div>
          </>}
        </div></div>
      </div>

      {payFor && (() => {
        const pr = data.reservations.find((r) => r.id === payFor);
        const bal = pr?.balance ?? data.occupantBalance ?? "0";
        const amt = payAmt ? Number(payAmt.replace(",", ".")) : Number(bal);
        return (
          <div className="panel"><h3>Úhrada {pr ? <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {pr.code} · {pr.guestName}</span> : null} <button className="linkx" style={{ float: "right" }} onClick={() => { setPayFor(null); setPayAmt(""); }}>zavřít</button></h3>
            <div className="req-actions" style={{ padding: 16, alignItems: "center", flexWrap: "wrap" }}>
              <span className="muted">Zbývá {money(bal)}. Částka:</span>
              <input type="number" min={0} style={{ width: 120 }} placeholder={bal} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
              <span className="muted">Kč</span>
              <button className="btn sm" disabled={busy} onClick={() => pay(payFor, "card_terminal", amt)}>Kartou</button>
              <button className="btn sm" disabled={busy} onClick={() => pay(payFor, "cash", amt)}>Hotově</button>
              <span className="muted" style={{ fontSize: 12 }}>(prázdné = celý zůstatek)</span>
            </div>
          </div>
        );
      })()}

      {moveFor && (
        <div className="panel"><h3>Přemístit na pokoj <button className="linkx" style={{ float: "right" }} onClick={() => setMoveFor(null)}>zavřít</button></h3><div style={{ padding: 16 }}>
          {!cands ? <div className="muted">Načítám…</div> : (
            <div className="req-actions" style={{ flexWrap: "wrap" }}>
              {cands.filter((c) => !c.current).length === 0 ? <span className="muted">Žádný jiný pokoj tohoto typu.</span> :
                cands.filter((c) => !c.current).map((c) => <button key={c.id} className={`btn sm ${c.free ? "" : "ghost"}`} disabled={busy || !c.free} title={c.free ? "" : "obsazeno v termínu"} onClick={() => doMove(moveFor, c.id)}>Pokoj {c.number}{c.free ? "" : " (obsazen)"}</button>)}
            </div>
          )}
        </div></div>
      )}

      {unassigned && (
        <div className="panel"><h3>Umístit rezervaci na pokoj <button className="linkx" style={{ float: "right" }} onClick={() => setUnassigned(null)}>zavřít</button></h3>
          {unassigned.length === 0 ? <div style={{ padding: 16 }} className="muted">Žádné nepřiřazené rezervace tohoto typu.</div> :
            <Table cols={["Kód", "Host", "Termín", ""]} rows={unassigned} empty="—" render={(u: UnassignedRes) => (
              <tr key={u.id}><td className="muted">{u.code}</td><td>{u.guestName}</td><td>{d(u.checkInDate)} → {d(u.checkOutDate)}</td><td className="right"><button className="btn sm" disabled={busy} onClick={() => doPlace(u.id)}>Umístit</button></td></tr>
            )} />}
        </div>
      )}

      <div className="panel"><h3>Rezervace na pokoji</h3>
        <Table cols={["Kód", "Host", "Termín", "Stav", "Účet", ""]} rows={data.reservations} empty="Žádné rezervace"
          render={(r: RoomResItem) => (
            <tr key={r.id}>
              <td className="muted">{r.code}</td><td>{r.guestName}</td><td>{d(r.checkInDate)} → {d(r.checkOutDate)}</td><td><Badge s={r.status} /></td>
              <td>{Number(r.balance) > 0 ? <b style={{ color: "var(--warn)" }}>{money(r.balance)}</b> : <span className="muted">{money(r.balance)}</span>}</td>
              <td className="right" style={{ whiteSpace: "nowrap" }}>
                <button className="btn sm ghost" onClick={() => setResId(r.id)}>Detail</button>{" "}
                {Number(r.balance) > 0 && r.status !== "cancelled" && <><button className="btn sm" disabled={busy} onClick={() => { setPayFor(r.id); setPayAmt(""); }}>Doplatit</button>{" "}</>}
                {["confirmed", "pending"].includes(r.status) && <><button className="btn sm ok" disabled={busy} onClick={() => checkin(r.id, r.code)}>Check-in</button>{" "}</>}
                {r.status === "checked_in" && <><button className="btn sm ok" disabled={busy} onClick={() => checkout(r.id, r.code)}>Check-out</button>{" "}</>}
                {["confirmed", "checked_in"].includes(r.status) && <button className="btn sm ghost" disabled={busy} onClick={() => openMove(r.id)}>Přemístit</button>}
              </td>
            </tr>
          )} />
      </div>

      <div className="panel"><h3>Požadavky na pokoji</h3><div style={{ padding: 16 }}>
        <div className="toolbar">
          <select value={rf.type} onChange={(e) => setRf({ ...rf, type: e.target.value })}><option value="cleaning">Úklid</option><option value="maintenance">Údržba</option><option value="laundry">Praní</option><option value="ironing">Žehlení</option><option value="minibar">Minibar</option><option value="other">Jiné</option></select>
          <input placeholder="Popis (nepovinné)" style={{ flex: 1, minWidth: 160 }} value={rf.description} onChange={(e) => setRf({ ...rf, description: e.target.value })} />
          <button className="btn" disabled={busy} onClick={addReq}>+ Vytvořit</button>
        </div>
        {data.requests.length === 0 ? <div className="muted" style={{ marginTop: 8 }}>Žádné požadavky.</div> :
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {data.requests.map((q) => (
              <div key={q.id} className="rd-req">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{SERVICE_ICON[q.type]} <b>{SERVICE_LABEL[q.type]}</b></span>
                  <span className="muted">· {q.domain === "maintenance" ? "údržba" : "úklid"}</span>
                  <Badge s={q.status} />
                  <span className="muted" style={{ fontSize: 12 }}>{d(q.createdAt)}</span>
                </div>
                {q.description && <div className="muted" style={{ marginTop: 4 }}>{q.description}</div>}
                {q.note && <div style={{ marginTop: 4 }}>📝 {q.note}{q.resolvedByName ? <span className="muted"> · {q.resolvedByName}</span> : ""}</div>}
                {q.imageUrls && q.imageUrls.length > 0 && <div className="req-photos" style={{ marginTop: 6 }}>{q.imageUrls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="foto" /></a>)}</div>}
                {data.occupantId && <div style={{ marginTop: 8 }}><button className="btn sm" disabled={busy} onClick={() => openCharge(q)}>💵 Naúčtovat hostovi</button></div>}
              </div>
            ))}
          </div>}
      </div></div>

      {chargeReq && (
        <div className="panel"><h3>Naúčtovat hostovi <button className="linkx" style={{ float: "right" }} onClick={() => setChargeReq(null)}>zavřít</button></h3>
          <div className="req-actions" style={{ padding: 16, alignItems: "center", flexWrap: "wrap" }}>
            <select value={chargeForm.category} onChange={(e) => setChargeForm({ ...chargeForm, category: e.target.value })}>
              <option value="service">Služba (úklid navíc)</option>
              <option value="other">Škoda / jiné</option>
              <option value="laundry">Praní</option>
              <option value="minibar">Minibar</option>
            </select>
            <input placeholder="Popis" style={{ flex: 1, minWidth: 200 }} value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
            <input type="number" min={0} style={{ width: 110 }} placeholder="Kč" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} />
            <span className="muted">Kč</span>
            <button className="btn sm" disabled={busy} onClick={submitCharge}>Naúčtovat</button>
          </div>
        </div>
      )}

      <div className="panel"><h3>Vlastnosti pokoje</h3><div style={{ padding: 16 }}>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <label className="row">Číslo <input style={{ width: 90 }} value={ef.number} onChange={(e) => setEf({ ...ef, number: e.target.value })} /></label>
          <label className="row">Patro <input type="number" style={{ width: 70 }} value={ef.floor} onChange={(e) => setEf({ ...ef, floor: e.target.value })} /></label>
          <label className="row">Zámek <select value={ef.lockType} onChange={(e) => setEf({ ...ef, lockType: e.target.value })}><option value="physical_key">🔑 klíč</option><option value="smart_code">🔢 kód</option></select></label>
        </div>
        <textarea style={{ width: "100%", minHeight: 60, resize: "vertical", marginTop: 8 }} placeholder="Poznámka k pokoji…" value={ef.notes} onChange={(e) => setEf({ ...ef, notes: e.target.value })} />
        <div style={{ marginTop: 8 }}><button className="btn" disabled={busy} onClick={saveRoom}>Uložit pokoj</button></div>
      </div></div>
      {doc && <DocumentOverlay doc={doc} onClose={() => setDoc(null)} />}
    </>
  );
}

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
          render={(r: Room) => (<tr key={r.id}><td><b>{r.number}</b></td><td>{r.roomType?.name}</td><td>{r.floor}.</td><td className="muted">{r.lockType === "smart_code" ? "🔢 kód" : "🔑 klíč"}</td><td><select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}>{["clean", "dirty", "inspected", "out_of_service"].map((s) => <option key={s} value={s}>{ROOM_STATUS_LABEL[s] ?? s}</option>)}</select></td><td className="right"><button className="btn sm danger" onClick={() => del(r.id)}>Smazat</button></td></tr>)} />
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
  const [nw, setNw] = useState({ name: "", capacityAdults: 2, maxExtraBeds: 0, extraBedPrice: "", basePrice: "", weeklyPrice: "", monthlyPrice: "" });
  const saveExtra = async (id: string, v: string) => { const n = parseInt(v, 10) || 0; await api.updateRoomType(id, { maxExtraBeds: n }); setMsg("Přistýlky uloženy."); reload(); };
  const saveExtraPrice = async (id: string, v: string) => { const n = parseFloat(v.replace(",", ".")) || 0; await api.updateRoomType(id, { extraBedPrice: n }); setMsg("Cena přistýlky uložena."); reload(); };

  const saveBase = async (id: string, v: string) => { const n = parseFloat(v); if (isNaN(n)) return; await api.updateRoomType(id, { basePrice: n }); setMsg("Cena uložena."); reload(); };
  const saveLong = async (id: string, field: "weeklyPrice" | "monthlyPrice", v: string) => { const n = parseFloat(v); await api.updateRoomType(id, { [field]: isNaN(n) ? 0 : n }); setMsg("Dlouhodobá cena uložena."); reload(); };
  const saveRate = async () => { if (!rate.roomTypeId || !rate.price) return; await api.setRate({ roomTypeId: rate.roomTypeId, date: rate.date, price: parseFloat(rate.price) }); setMsg(`Cena na ${rate.date} nastavena.`); setRate({ ...rate, price: "" }); };
  const addType = async () => { if (!nw.name || !nw.basePrice) return; await api.createRoomType({ name: nw.name, capacityAdults: Number(nw.capacityAdults), maxExtraBeds: Number(nw.maxExtraBeds), extraBedPrice: nw.extraBedPrice ? Number(nw.extraBedPrice) : 0, basePrice: Number(nw.basePrice), weeklyPrice: nw.weeklyPrice ? Number(nw.weeklyPrice) : undefined, monthlyPrice: nw.monthlyPrice ? Number(nw.monthlyPrice) : undefined }); setNw({ name: "", capacityAdults: 2, maxExtraBeds: 0, extraBedPrice: "", basePrice: "", weeklyPrice: "", monthlyPrice: "" }); reload(); };

  const saveCap = async (id: string, field: "capacityAdults" | "capacityChildren", v: string) => { const n = parseInt(v, 10); if (isNaN(n) || n < 0) return; await api.updateRoomType(id, { [field]: n }); setMsg("Kapacita uložena."); reload(); };
  // Buňka „Kapacita" — řádná lůžka + dětská místa + samostatně přistýlky (počet × cena/noc). Vše editovatelné inline.
  const capCell = (t: RoomType) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <input type="number" min={1} defaultValue={t.capacityAdults} style={{ width: 48 }} onBlur={(e) => saveCap(t.id, "capacityAdults", e.target.value)} />
      <span className="muted">lůžek · přist.</span>
      <input type="number" min={0} defaultValue={t.maxExtraBeds} style={{ width: 48 }} onBlur={(e) => saveExtra(t.id, e.target.value)} />
      <span className="muted">à</span>
      <input type="number" min={0} defaultValue={parseFloat(t.extraBedPrice)} style={{ width: 72 }} onBlur={(e) => saveExtraPrice(t.id, e.target.value)} />
      <span className="muted">Kč/noc</span>
    </div>
  );

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
              <td><b>{t.name}</b></td><td>{capCell(t)}</td>
              <td><PriceCell v={t.basePrice} onSave={(v) => saveBase(t.id, v)} /></td>
              <td><PriceCell v={t.weeklyPrice} onSave={(v) => saveLong(t.id, "weeklyPrice", v)} /></td>
              <td><PriceCell v={t.monthlyPrice} onSave={(v) => saveLong(t.id, "monthlyPrice", v)} /></td>
            </tr>
          ) : (
            <tr key={t.id}>
              <td><b>{t.name}</b><div className="muted">{t.amenities.join(", ")}</div></td>
              <td>{capCell(t)}</td><td>{t._count?.rooms ?? "—"}</td>
              <td><PriceCell v={t.basePrice} onSave={(v) => saveBase(t.id, v)} /></td>
            </tr>
          )} />
      </div>

      <div className="panel">
        <h3>Nový typ</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <input placeholder="Název" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
          <label className="row">Kapacita <input type="number" min={1} style={{ width: 70 }} value={nw.capacityAdults} onChange={(e) => setNw({ ...nw, capacityAdults: Number(e.target.value) })} /></label>
          <label className="row">Přistýlky <input type="number" min={0} style={{ width: 64 }} value={nw.maxExtraBeds} onChange={(e) => setNw({ ...nw, maxExtraBeds: Number(e.target.value) })} /></label>
          <label className="row">Cena přist./noc <input type="number" min={0} style={{ width: 96 }} value={nw.extraBedPrice} onChange={(e) => setNw({ ...nw, extraBedPrice: e.target.value })} /></label>
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

      <ServiceCatalog selId={selId} />
    </>
  );
}

// Ceník služeb (číselník pro připisování na účet pokoje).
function ServiceCatalog({ selId }: { selId: string }) {
  const confirm = useConfirm();
  const { data, error, reload } = useAsync<ServiceItem[]>(() => api.serviceItems(), [selId]);
  const [f, setF] = useState({ name: "", category: "minibar", price: "", vatRate: "21" });
  const add = async () => { if (!f.name || !f.price) return; await api.createServiceItem({ name: f.name, category: f.category, price: parseFloat(f.price.replace(",", ".")), vatRate: parseFloat(f.vatRate) || 21 }); setF({ name: "", category: "minibar", price: "", vatRate: "21" }); reload(); };
  const del = async (id: string, name: string) => { if (await confirm({ title: "Smazat položku ceníku", message: <>Smazat „{name}" z ceníku?</>, confirmLabel: "Smazat", danger: true })) { await api.deleteServiceItem(id); reload(); } };
  return (
    <div className="panel">
      <h3>Ceník služeb <span className="muted" style={{ fontSize: 14 }}>nabídne se při připsání na účet</span></h3>
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ padding: 16, flexWrap: "wrap" }}>
        <input placeholder="Název (Cola, Masáž…)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CHARGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input placeholder="Cena" style={{ width: 100 }} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <label className="row">DPH <input style={{ width: 56 }} value={f.vatRate} onChange={(e) => setF({ ...f, vatRate: e.target.value })} /> %</label>
        <button className="btn" disabled={!f.name || !f.price} onClick={add}>+ Přidat</button>
      </div>
      <Table cols={["Název", "Kategorie", "Cena", "DPH", ""]} rows={data ?? []} empty="Žádné položky ceníku"
        render={(s: ServiceItem) => (<tr key={s.id}><td><b>{s.name}</b></td><td>{CHARGE_LABEL[s.category] ?? s.category}</td><td>{money(s.price)}</td><td className="muted">{parseFloat(s.vatRate)} %</td><td className="right"><button className="btn sm danger" onClick={() => del(s.id, s.name)}>Smazat</button></td></tr>)} />
    </div>
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

// ── Skupinové / vícepokojové rezervace ───────────────────────
const blankGroupRoom = (): GroupRoomInput => ({ roomTypeId: "", adults: 2, children: 0, childAges: [], firstName: "", lastName: "" });
const blankGroupForm = () => ({ name: "", note: "", from: todayIso(), to: tomorrowIso(), billing: "" as "" | "collective" | "individual", firstName: "", lastName: "", email: "", phone: "", language: "cs", rooms: [blankGroupRoom()] });

function GroupsView({ selId, prop }: { selId: string; prop: Property }) {
  const { data, error, reload } = useAsync<GroupListItem[]>(() => api.groups(), [selId]);
  const types = useAsync<RoomType[]>(() => api.roomTypes(), [selId]);
  const [gid, setGid] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [g, setG] = useState(blankGroupForm());
  const [gq, setGq] = useState(""); // hledání ve skupinách
  const setRoom = (i: number, patch: Partial<GroupRoomInput>) => setG((s) => ({ ...s, rooms: s.rooms.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  // Dostupnost ve zvoleném termínu — nabízíme/limitujeme jen volné jednotky (skupina musí jít vytvořit celá).
  const avail = useAsync<AvailUnit[]>(() => api.availabilityFor(g.from, g.to, 1), [selId, g.from, g.to]);
  const availByType = new Map((avail.data ?? []).map((a) => [a.roomTypeId, a]));
  const freeByType = new Map((avail.data ?? []).map((a) => [a.roomTypeId, a.freeUnits]));
  const typeName = (id: string) => (types.data ?? []).find((t) => t.id === id)?.name ?? "typ";
  const wantByType = new Map<string, number>();
  for (const r of g.rooms) { if (!r.roomTypeId) continue; const n = prop.inventoryUnit === "bed" ? Math.max(1, Number(r.adults) || 1) : 1; wantByType.set(r.roomTypeId, (wantByType.get(r.roomTypeId) ?? 0) + n); }
  const shortages = [...wantByType.entries()].filter(([id, want]) => (freeByType.get(id) ?? 0) < want).map(([id, want]) => ({ name: typeName(id), free: freeByType.get(id) ?? 0, want }));
  const create = async () => {
    setErr("");
    if (!g.name.trim() || !g.firstName || !g.lastName) { setErr("Vyplň název skupiny a kontakt (jméno, příjmení)."); return; }
    if (!g.billing) { setErr("Vyber, jak se skupina platí (kolektivně / individuálně)."); return; }
    if (g.rooms.some((r) => !r.roomTypeId)) { setErr("U každého pokoje vyber typ."); return; }
    setBusy(true);
    try {
      await api.createGroup({ name: g.name, note: g.note || undefined, from: g.from, to: g.to, billing: g.billing,
        organizer: { firstName: g.firstName, lastName: g.lastName, email: g.email || undefined, phone: g.phone || undefined, language: g.language },
        rooms: g.rooms.map((r) => ({ roomTypeId: r.roomTypeId, adults: Number(r.adults), children: Number(r.children) || 0, childAges: r.childAges, firstName: r.firstName || undefined, lastName: r.lastName || undefined })) });
      setShowForm(false); setG(blankGroupForm()); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (gid) return <GroupDetailView id={gid} prop={prop} onBack={() => { setGid(null); reload(); }} />;
  return (
    <>
      <div className="h1">Skupiny <button className="btn" onClick={() => setShowForm((s) => !s)}>{showForm ? "Zavřít" : "+ Nová skupina"}</button></div>
      {error && <div className="error">{error}</div>}
      {showForm && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 style={{ border: "none", padding: 0, marginBottom: 14 }}>Nová skupinová rezervace</h3>
          {err && <div className="error">{err}</div>}
          <div className="toolbar">
            <input placeholder="Název skupiny (Svatba Novákovi, Zájezd ČD…)" style={{ minWidth: 260 }} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
            <label className="row">Příjezd <input type="date" value={g.from} onChange={(e) => { const v = e.target.value; setG({ ...g, from: v, to: departAfter(v, g.to) }); }} /></label>
            <label className="row">Odjezd <input type="date" value={g.to} onChange={(e) => setG({ ...g, to: e.target.value })} /></label>
          </div>
          <div className="toolbar">
            <input placeholder="Kontakt — jméno" value={g.firstName} onChange={(e) => setG({ ...g, firstName: e.target.value })} />
            <input placeholder="Kontakt — příjmení" value={g.lastName} onChange={(e) => setG({ ...g, lastName: e.target.value })} />
            <input placeholder="E-mail" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} />
            <input placeholder="Telefon" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} />
            <label className="row">Jazyk <select value={g.language} onChange={(e) => setG({ ...g, language: e.target.value })}>{GUEST_LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
          </div>
          <div className="toolbar" style={{ alignItems: "center" }}>
            <span className="muted">Platba:</span>
            <label className={`row ${g.billing === "collective" ? "" : ""}`} style={{ gap: 5, cursor: "pointer" }}><input type="radio" name="grpbill" checked={g.billing === "collective"} onChange={() => setG({ ...g, billing: "collective" })} /> Kolektivně <span className="muted" style={{ fontSize: 12 }}>(jeden plátce, společná faktura)</span></label>
            <label className="row" style={{ gap: 5, cursor: "pointer" }}><input type="radio" name="grpbill" checked={g.billing === "individual"} onChange={() => setG({ ...g, billing: "individual" })} /> Individuálně <span className="muted" style={{ fontSize: 12 }}>(každý pokoj platí sám)</span></label>
          </div>
          <div style={{ borderTop: "1px solid #e6eaee", margin: "8px 0", paddingTop: 10 }}>
            <div className="muted" style={{ marginBottom: 8 }}>{prop.inventoryUnit === "bed" ? "Lůžka ve skupině — u typu zadej počet lůžek; každé lůžko bude samostatná rezervace (jméno nepovinné):" : "Pokoje ve skupině (jméno hosta nepovinné — jinak se použije kontakt):"}</div>
            {g.rooms.map((r, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div className="toolbar" style={{ marginBottom: (r.children ?? 0) > 0 ? 4 : 0 }}>
                  <span className="muted" style={{ width: 20 }}>{i + 1}.</span>
                  <select value={r.roomTypeId} onChange={(e) => setRoom(i, { roomTypeId: e.target.value })}>
                    <option value="">{prop.inventoryUnit === "bed" ? "Typ lůžka…" : "Typ pokoje…"}</option>
                    {(types.data ?? []).map((t) => { const a = availByType.get(t.id); const free = a?.freeUnits; return <option key={t.id} value={t.id}>{t.name}{prop.inventoryUnit !== "bed" && a ? ` · ${a.capacityAdults} lůžek${a.maxExtraBeds > 0 ? ` +${a.maxExtraBeds} přist.` : ""}` : ""} ({money(t.basePrice)}/noc{free != null ? ` · volné ${free}` : ""})</option>; })}
                  </select>
                  <label className="row">{prop.inventoryUnit === "bed" ? "Lůžek" : "Dosp."} <input type="number" min={1} style={{ width: 56 }} value={r.adults} onChange={(e) => setRoom(i, { adults: Number(e.target.value) })} /></label>
                  {prop.inventoryUnit !== "bed" && <label className="row">Děti <input type="number" min={0} max={10} style={{ width: 56 }} value={r.children ?? 0} onChange={(e) => { const n = Math.max(0, Math.min(10, Number(e.target.value) || 0)); setRoom(i, { children: n, childAges: Array.from({ length: n }, (_, j) => r.childAges?.[j] ?? 8) }); }} /></label>}
                  <input placeholder="Jméno hosta" style={{ width: 110 }} value={r.firstName ?? ""} onChange={(e) => setRoom(i, { firstName: e.target.value })} />
                  <input placeholder="Příjmení" style={{ width: 110 }} value={r.lastName ?? ""} onChange={(e) => setRoom(i, { lastName: e.target.value })} />
                  {g.rooms.length > 1 && <button className="btn sm danger" onClick={() => setG((s) => ({ ...s, rooms: s.rooms.filter((_, idx) => idx !== i) }))}>✕</button>}
                </div>
                {r.roomTypeId && availByType.get(r.roomTypeId) && (() => { const a = availByType.get(r.roomTypeId)!; return (
                  <div className="rmeta" style={{ marginLeft: 24, marginTop: 4 }}>
                    {prop.inventoryUnit !== "bed" && <span className="wz-tag">{a.capacityAdults} lůžek</span>}
                    {prop.inventoryUnit !== "bed" && a.maxExtraBeds > 0 && <span className="wz-tag">až {a.maxExtraBeds} přist.</span>}
                    <span className="muted" style={{ fontSize: 13 }}>{money(a.roomTotal)} za pobyt · volné: {a.freeUnits}{prop.inventoryUnit === "bed" ? " lůžek" : ""}</span>
                  </div>
                ); })()}
                {(r.children ?? 0) > 0 && (
                  <div className="toolbar" style={{ marginLeft: 24 }}>
                    {(r.childAges ?? []).map((age, j) => (
                      <label key={j} className="row">Věk dítěte {j + 1} <input type="number" min={0} max={25} style={{ width: 56 }} value={age} onChange={(e) => { const a = [...(r.childAges ?? [])]; a[j] = Math.max(0, Number(e.target.value) || 0); setRoom(i, { childAges: a }); }} /></label>
                    ))}
                    <span className="muted" style={{ fontSize: 12 }}>poplatek platí děti od věku osvobození</span>
                  </div>
                )}
              </div>
            ))}
            <button className="btn ghost sm" onClick={() => setG((s) => ({ ...s, rooms: [...s.rooms, blankGroupRoom()] }))}>{prop.inventoryUnit === "bed" ? "+ Přidat typ lůžka" : "+ Přidat pokoj"}</button>
          </div>
          {shortages.length > 0 && <div className="error" style={{ marginTop: 10 }}>⚠ V termínu {d(g.from)} – {d(g.to)} není dost volných {prop.inventoryUnit === "bed" ? "lůžek" : "pokojů"}: {shortages.map((s) => `${s.name} (volné ${s.free}, požadováno ${s.want})`).join("; ")}. Uprav počty nebo termín.</div>}
          <button className="btn" disabled={busy || shortages.length > 0} onClick={create}>{busy ? "Vytvářím…" : prop.inventoryUnit === "bed" ? `Vytvořit skupinu (${g.rooms.reduce((s, r) => s + (Number(r.adults) || 0), 0)} lůžek)` : `Vytvořit skupinu (${g.rooms.length} pok.)`}</button>
        </div>
      )}
      <div className="panel">
        {(data?.length ?? 0) > 0 && <input className="wz-filter" placeholder="🔍 Hledat skupinu (název / kód)…" value={gq} onChange={(e) => setGq(e.target.value)} style={{ marginBottom: 10 }} />}
        <Table cols={["Kód", "Název", "Pokojů", "Termín", "Celkem", ""]} rows={(data ?? []).filter((gr) => { const t = gq.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim(); return !t || `${gr.name} ${gr.code}`.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().includes(t); })} empty={gq ? "Nic nenalezeno." : "Žádné skupiny"}
          render={(gr: GroupListItem) => (
            <tr key={gr.id}>
              <td className="muted">{gr.code}</td>
              <td>{gr.name}</td>
              <td>{gr.rooms}</td>
              <td>{gr.from ? `${d(gr.from)} → ${d(gr.to!)}` : "—"}</td>
              <td>{money(gr.total)}</td>
              <td className="right"><button className="btn sm ghost" onClick={() => setGid(gr.id)}>Detail</button></td>
            </tr>
          )} />
      </div>
    </>
  );
}

function GroupDetailView({ id, prop, onBack }: { id: string; prop: Property; onBack: () => void }) {
  const confirm = useConfirm();
  const { data, error, reload } = useAsync<GroupDetail>(() => api.group(id), [id]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberPick, setMemberPick] = useState<GroupMember | null>(null); // výběr hlavní osoby člena z adresáře
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgErr, setMsgErr] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [invoiceCo, setInvoiceCo] = useState<{ id: string; name: string } | null>(null); // firma pro společnou fakturu
  const [gPreview, setGPreview] = useState<{ doc: Doc; onIssue: () => Promise<Doc> } | null>(null);
  const [pickCo, setPickCo] = useState(false);
  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true); setMsg(""); setResults(null);
    try { const r = await fn(); if (Array.isArray(r)) setResults(r as BulkResult[]); setMsg(label); setMsgErr(false); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setMsgErr(true); }
    finally { setBusy(false); }
  };
  if (memberId) return <ReservationDetailView id={memberId} prop={prop} onBack={() => { setMemberId(null); reload(); }} />;
  if (error) return <><div className="h1"><button className="btn ghost" onClick={onBack}>← Zpět</button></div><div className="error">{error}</div></>;
  if (!data) return <div className="muted" style={{ padding: 20 }}>Načítám…</div>;
  const bal = parseFloat(data.totals.balance);
  return (
    <>
      <div className="h1"><span><button className="btn ghost" onClick={onBack}>← Zpět</button>&nbsp;&nbsp;{data.name} <span className="muted" style={{ fontSize: 15 }}>{data.code}</span></span></div>
      {msg && <div className="error" style={msgErr ? undefined : { background: "#e6f7ee", color: "var(--ok)" }}>{msg}</div>}
      <div className="panel" style={{ padding: 16 }}>
        <div className="toolbar">
          <button className="btn ok" disabled={busy} onClick={() => act(() => api.groupCheckin(id), "Check-in proběhl.")}>Check-in vše</button>
          <button className="btn" disabled={busy} onClick={() => act(() => api.groupCheckout(id), "Check-out proběhl.")}>Check-out vše</button>
          <span className="row" style={{ gap: 4 }}>
            {data.invoice
              ? <button className="btn ghost" disabled={busy} onClick={() => act(async () => { setDoc(await api.document(data.invoice!.id)); return "Faktura"; }, "")}>🧾 Zobrazit fakturu</button>
              : <button className="btn ghost" disabled={busy} onClick={() => act(async () => { const p = await api.bulkInvoice(data.members.map((m) => m.id), invoiceCo?.id, true); setGPreview({ doc: p, onIssue: async () => { const dd = await api.bulkInvoice(data.members.map((m) => m.id), invoiceCo?.id); reload(); return dd; } }); return ""; }, "")}>🧾 Společná faktura</button>}
            <button className="btn ghost sm" disabled={busy} onClick={() => setPickCo(true)} title="Fakturovat na firmu">{invoiceCo ? `🏢 ${invoiceCo.name}` : "🏢 firma…"}</button>
            {invoiceCo && <button className="linkx" disabled={busy} onClick={() => setInvoiceCo(null)} title="Zrušit firmu">×</button>}
          </span>
          {bal > 0 && <button className="btn" disabled={busy} onClick={async () => { if (await confirm({ title: "Uhradit celou skupinu", message: <>Zaúčtovat <b>{money(bal)}</b> <b>hotově</b> za celou skupinu?</>, confirmLabel: "Hotově" })) { if (!(await ensureCashOpen(confirm))) return; act(() => api.payGroup(id, "cash"), "Skupina uhrazena hotově."); } }}>💰 Vše hotově</button>}
          {bal > 0 && <button className="btn" disabled={busy} onClick={async () => { if (await confirm({ title: "Uhradit celou skupinu", message: <>Zaúčtovat <b>{money(bal)}</b> <b>kartou</b> za celou skupinu?</>, confirmLabel: "Kartou" })) act(() => api.payGroup(id, "card_terminal"), "Skupina uhrazena kartou."); }}>💳 Vše kartou</button>}
          <button className="btn ghost" disabled={busy} onClick={() => act(() => api.groupEmail(id), "Souhrn odeslán organizátorovi.")}>✉️ Odeslat souhrn</button>
          <button className="btn danger" disabled={busy} onClick={async () => { if (await confirm({ title: "Zrušit skupinu", message: <>Zrušit všechny pokoje skupiny <b>{data.name}</b>? (Odhlášené zůstanou.)</>, confirmLabel: "Zrušit vše", danger: true })) act(() => api.groupCancel(id), "Skupina zrušena."); }}>Zrušit vše</button>
          <span style={{ flex: 1 }} />
          <label className="row" style={{ gap: 5 }}><span className="muted">Platba:</span>
            <select value={data.billing} disabled={busy} onChange={(e) => act(() => api.setGroupBilling(id, e.target.value as "collective" | "individual"), "Platební režim změněn.")}>
              <option value="collective">Kolektivně (za skupinu)</option>
              <option value="individual">Individuálně (každý sám)</option>
            </select>
          </label>
          <span className="muted">Celkem {money(data.totals.charges)} · zaplaceno {money(data.totals.paid)} · <b style={{ color: bal > 0 ? "var(--warn)" : "var(--ok)" }}>{bal > 0 ? `zbývá ${money(bal)}` : "vyrovnáno"}</b></span>
        </div>
        {data.billing === "collective" && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>👥 Kolektivní platba — účtuje se za celou skupinu (společná faktura). Jednotlivé pokoje lze odhlásit kdykoli; „Check-out vše" hlídá vyrovnaný účet celé skupiny.</div>}
        {results && (
          <div style={{ marginTop: 10 }}>
            {results.map((r) => <div key={r.code} className="muted" style={{ fontSize: 13 }}>{r.ok ? "✓" : "✗"} {r.code}{r.error ? ` — ${r.error}` : ""}</div>)}
          </div>
        )}
      </div>
      <div className="panel">
        <Table cols={["Kód", "Host", "Jednotka", "Termín", "Stav", "Částka", "Zůstatek", ""]} rows={data.members} empty="Žádné pokoje"
          render={(m: GroupMember) => (
            <tr key={m.id}>
              <td className="muted">{m.code}</td>
              <td>{m.guestName} <button className="btn sm ghost" title="Změnit hlavní osobu z adresáře" style={{ padding: "2px 7px", marginLeft: 4 }} onClick={() => setMemberPick(m)}>📇</button></td>
              <td>{m.unit}</td>
              <td>{d(m.checkInDate)} → {d(m.checkOutDate)}</td>
              <td><Badge s={m.status} /></td>
              <td>{money(m.totalAmount)}</td>
              <td>{data.billing === "collective" ? <span className="muted" title="Hradí se hromadně za skupinu">hromadně</span> : parseFloat(m.balance) > 0 ? <span style={{ color: "var(--warn)" }}>{money(m.balance)}</span> : <span className="muted">0</span>}</td>
              <td className="right"><button className="btn sm ghost" onClick={() => setMemberId(m.id)}>Detail</button></td>
            </tr>
          )} />
      </div>
      <div className="panel"><h3>E-maily skupiny</h3><div style={{ padding: 16 }}>
        {data.organizer && <div className="muted" style={{ marginBottom: 10 }}>Kontakt: <b>{data.organizer.firstName} {data.organizer.lastName}</b>{data.organizer.email ? ` · ${data.organizer.email}` : " · bez e-mailu (souhrn nelze poslat)"}</div>}
        {data.emails.length === 0 ? <div className="muted">Souhrn zatím neodeslán.</div> : (
          <Table cols={["Čas", "Typ", "Předmět", "Stav"]} rows={data.emails} empty="—"
            render={(e: EmailLog) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{e.createdAt.slice(0, 10)} {e.createdAt.slice(11, 16)}</td>
                <td>{EMAIL_TYPE_LABEL[e.type] ?? e.type}</td>
                <td className="muted" style={{ fontSize: 13 }}>{e.subject}{e.error ? ` — ${e.error}` : ""}</td>
                <td><EmailStatus s={e.status} /></td>
              </tr>
            )} />
        )}
      </div></div>
      {gPreview && <DocumentOverlay doc={gPreview.doc} preview onIssue={gPreview.onIssue} onClose={() => setGPreview(null)} />}
      {doc && <DocumentOverlay doc={doc} onClose={() => setDoc(null)} />}
      {pickCo && <CompanyPickerOverlay onClose={() => setPickCo(false)} onPick={(cid) => { api.company(cid).then((c) => setInvoiceCo({ id: c.id, name: c.name })).catch(() => {}); setPickCo(false); }} />}
      {memberPick && <GuestPickerOverlay
        prefill={memberPick.guestEmail || memberPick.guestName || ""}
        title={`Hlavní osoba pokoje ${memberPick.code}`}
        subtitle="Vyber konkrétního hosta z adresáře — nahradí jméno skupiny u tohoto pokoje (jeho doklad z knihy se pak předvyplní)."
        onClose={() => setMemberPick(null)}
        onPick={(gid) => { const mid = memberPick.id; setMemberPick(null); act(() => api.setReservationPrimaryGuest(mid, gid), "Hlavní osoba pokoje změněna."); }}
      />}
    </>
  );
}

// ── CRM: Profily hostů ───────────────────────────────────────
function GuestsView({ selId }: { selId: string }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const list = useAsync<GuestListItem[]>(() => api.searchGuests(q), [selId]);
  if (sel) return <GuestProfileView id={sel} onBack={() => { setSel(null); list.reload(); }} />;
  return (
    <>
      <div className="h1">Profily hostů</div>
      <div className="toolbar">
        <input placeholder="Hledat jméno / e-mail / telefon…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && list.reload()} style={{ minWidth: 300 }} />
        <button className="btn" onClick={() => list.reload()}>Hledat</button>
      </div>
      {list.error && <div className="error">{list.error}</div>}
      <div className="panel">
        <Table cols={["Host", "Kontakt", "Pobytů", "Poslední pobyt", ""]} rows={list.data ?? []} empty="Žádní hosté"
          render={(g: GuestListItem) => (
            <tr key={g.id}>
              <td>{g.vip && <span title="VIP">⭐ </span>}{g.firstName} {g.lastName}{g.preferences ? <span title={g.preferences} style={{ marginLeft: 6 }}>📝</span> : null}</td>
              <td className="muted">{g.email ?? "—"}{g.phone ? ` · ${g.phone}` : ""}</td>
              <td>{g.stays}</td>
              <td className="muted">{g.lastStay ? d(g.lastStay) : "—"}</td>
              <td className="right"><button className="btn sm ghost" onClick={() => setSel(g.id)}>Profil</button></td>
            </tr>
          )} />
      </div>
    </>
  );
}

type GuestForm = { firstName: string; lastName: string; email: string; phone: string; language: string; address: string; documentType: string; documentNumber: string; dateOfBirth: string; nationality: string; vip: boolean; preferences: string; marketingConsent: boolean };
function GuestProfileView({ id, onBack }: { id: string; onBack: () => void }) {
  const confirm = useConfirm();
  const { data, error, reload } = useAsync<GuestProfile>(() => api.guestProfile(id), [id]);
  const [f, setF] = useState<GuestForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [merge, setMerge] = useState(false);
  const fromData = (): GuestForm | null => {
    if (!data) return null;
    const g = data.guest;
    return { firstName: g.firstName, lastName: g.lastName, email: g.email ?? "", phone: g.phone ?? "", language: g.language ?? "", address: g.address ?? "", documentType: g.documentType ?? "", documentNumber: g.documentNumber ?? "", dateOfBirth: g.dateOfBirth ? g.dateOfBirth.slice(0, 10) : "", nationality: g.nationality ?? "", vip: g.vip, preferences: g.preferences ?? "", marketingConsent: g.marketingConsent };
  };
  useEffect(() => { setF(fromData()); setDirty(false); }, [data?.guest.id]); // eslint-disable-line
  const upd = (patch: Partial<GuestForm>) => { setF((s) => (s ? { ...s, ...patch } : s)); setDirty(true); };
  const save = async () => {
    if (!f) return;
    if (!f.firstName.trim() || !f.lastName.trim()) { setMsg("Jméno a příjmení jsou povinné."); return; }
    setBusy(true); setMsg("");
    try { await api.updateGuest(id, { firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email, phone: f.phone, language: f.language, address: f.address, documentType: f.documentType, documentNumber: f.documentNumber, dateOfBirth: f.dateOfBirth, nationality: f.nationality, vip: f.vip, preferences: f.preferences, marketingConsent: f.marketingConsent }); setMsg("Uloženo."); setDirty(false); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (error) return <><div className="h1"><button className="btn ghost" onClick={onBack}>← Zpět</button></div><div className="error">{error}</div></>;
  if (!data || !f) return <div className="muted" style={{ padding: 20 }}>Načítám…</div>;
  return (
    <>
      <div className="h1"><span><button className="btn ghost" onClick={onBack}>← Zpět</button>&nbsp;&nbsp;{f.vip ? "⭐ " : ""}{f.firstName} {f.lastName}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" disabled={busy} onClick={() => setMerge(true)}>🔗 Sloučit duplicitu</button>
          <button className="btn danger" disabled={busy} onClick={async () => {
            if (await confirm({ title: "Smazat hosta", message: <>Opravdu smazat <b>{f.firstName} {f.lastName}</b> z adresáře? Lze jen u hosta bez pobytů.</>, confirmLabel: "Smazat" })) {
              setBusy(true); setMsg("");
              try { await api.deleteGuest(id); onBack(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setBusy(false); }
            }
          }}>🗑 Smazat</button>
        </span>
      </div>
      {msg && <div className="error" style={msg === "Uloženo." || msg === "Sloučeno." ? { background: "#e6f7ee", color: "var(--ok)" } : undefined}>{msg}</div>}
      <div className="grid2">
        <div className="panel"><h3>Údaje hosta</h3><div style={{ padding: 16, maxWidth: 460 }}>
          <GuestFieldsForm v={f} on={upd} />
          <FieldRow label="Jazyk"><input style={{ width: 90 }} placeholder="cs" value={f.language} onChange={(e) => upd({ language: e.target.value })} /></FieldRow>
        </div></div>
        <div className="panel"><h3>CRM</h3><div style={{ padding: 16 }}>
          <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={f.vip} onChange={(e) => upd({ vip: e.target.checked })} />&nbsp; VIP host</label>
          <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={f.marketingConsent} onChange={(e) => upd({ marketingConsent: e.target.checked })} />&nbsp; Souhlas s marketingem</label>
          <div className="muted" style={{ marginBottom: 6 }}>Preference / poznámky (napříč pobyty):</div>
          <textarea style={{ width: "100%", minHeight: 80, resize: "vertical" }} value={f.preferences} onChange={(e) => upd({ preferences: e.target.value })} placeholder="Např.: alergie na ořechy, preferuje patro výš, manželská postel, tichý pokoj do dvora…" />
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Pobytů: {data.stays.length} · v adresáři od {d(data.guest.createdAt)}</div>
        </div></div>
      </div>
      {dirty && <div className="panel" style={{ padding: 12 }}><button className="btn" disabled={busy} onClick={save}>Uložit změny</button> <button className="btn ghost" onClick={() => { setF(fromData()); setDirty(false); setMsg(""); }}>Zrušit</button></div>}
      <div className="panel"><h3>Historie pobytů</h3>
        <Table cols={["Kód", "Termín", "Pokoj", "Stav", "Cena", "Hodnocení"]} rows={data.stays} empty="Žádné pobyty v této provozovně"
          render={(s: GuestStay) => (
            <tr key={s.id}>
              <td className="muted">{s.code}</td>
              <td>{d(s.checkInDate)} → {d(s.checkOutDate)}</td>
              <td>{s.roomType ?? "—"}</td>
              <td><Badge s={s.status} /></td>
              <td>{money(s.totalAmount)}</td>
              <td>{s.review ? <span title={s.review.comment ?? ""}>{s.review.nps}/10{s.review.comment ? " 💬" : ""}</span> : <span className="muted">—</span>}</td>
            </tr>
          )} />
      </div>
      {merge && <GuestPickerOverlay
        title="Sloučit duplicitní záznam"
        subtitle={`Vyber DRUHÝ záznam téhož hosta — jeho pobyty se přesunou do „${f.firstName} ${f.lastName}" a původní záznam se smaže.`}
        prefill={f.lastName} excludeId={id} actionLabel="Sloučit sem"
        onClose={() => setMerge(false)}
        onPick={async (sid) => {
          if (await confirm({ title: "Sloučit hosty", message: <>Přesunout všechny pobyty vybraného záznamu do <b>{f.firstName} {f.lastName}</b> a původní smazat? Tuto akci nelze vrátit.</>, confirmLabel: "Sloučit" })) {
            setMerge(false); setBusy(true); setMsg("");
            try { await api.mergeGuests(id, sid); setMsg("Sloučeno."); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
          }
        }} />}
    </>
  );
}

// ── Hodnocení (NPS) ──────────────────────────────────────────
function ReviewsView({ selId }: { selId: string }) {
  const { data, error } = useAsync<ReviewsData>(() => api.reviews(), [selId]);
  return (
    <>
      <div className="h1">Hodnocení hostů</div>
      {error && <div className="error">{error}</div>}
      {data && (
        <div className="grid2">
          <div className="panel"><h3>Souhrn</h3><div style={{ padding: 16 }}>
            <div className="kvline"><span className="muted">Hodnocení celkem</span><b>{data.summary.count}</b></div>
            <div className="kvline"><span className="muted">Průměr (0–10)</span><b>{data.summary.avg ?? "—"}</b></div>
            <div className="kvline"><span className="muted">NPS skóre (−100…100)</span><b style={{ color: (data.summary.nps ?? 0) >= 0 ? "var(--ok)" : "var(--danger)" }}>{data.summary.nps ?? "—"}</b></div>
          </div></div>
          <div className="panel"><h3>Rozložení</h3><div style={{ padding: 16 }}>
            <div className="kvline"><span className="muted">Promotéři (9–10)</span><b style={{ color: "var(--ok)" }}>{data.summary.promoters}</b></div>
            <div className="kvline"><span className="muted">Pasivní (7–8)</span><b>{data.summary.passives}</b></div>
            <div className="kvline"><span className="muted">Kritici (0–6)</span><b style={{ color: "var(--danger)" }}>{data.summary.detractors}</b></div>
          </div></div>
        </div>
      )}
      <div className="panel">
        <Table cols={["Datum", "Host", "NPS", "Komentář", "Rezervace"]} rows={data?.reviews ?? []} empty="Zatím žádná hodnocení"
          render={(r: ReviewItem) => (
            <tr key={r.id}>
              <td className="muted">{d(r.createdAt)}</td>
              <td>{r.guestName}</td>
              <td><span style={{ fontWeight: 700, color: r.nps >= 9 ? "var(--ok)" : r.nps <= 6 ? "var(--danger)" : "var(--warn)" }}>{r.nps}</span></td>
              <td>{r.comment ?? "—"}</td>
              <td className="muted">{r.code}</td>
            </tr>
          )} />
      </div>
    </>
  );
}

// ── CENTRÁLA: Provozovny ─────────────────────────────────────
type PropEdit = {
  name: string; identifier: string; type: string; street: string; city: string; country: string; phone: string; email: string;
  ico: string; dic: string; iban: string; vatPayer: boolean;
  operatorName: string; operatorAddress: string; operatorRegistration: string; operatorAccount: string; operatorIco: string; operatorDic: string;
  kioskKeyInfo: string; kioskWifi: string;
  inventoryUnit: string; cityTaxEnabled: boolean; cityTaxPerPersonNight: string; cityTaxFreeAge: string; energyFeePerNight: string;
  allowLongTerm: boolean; selfCheckin: boolean; breakfastIncluded: boolean; dailyCleaning: boolean; active: boolean; infoText: string;
  offeredServices: string[];
  onlineCheckinHours: string;
  freeCancelDays: string; cancelFeePct: string; depositPct: string; reminderHours: string; noShowHours: string;
};

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
    setEf({
      name: p.name, identifier: p.identifier, type: p.type, street: p.street ?? "", city: p.city ?? "", country: p.country ?? "CZ",
      phone: p.phone ?? "", email: p.email ?? "", ico: p.ico ?? "", dic: p.dic ?? "", iban: p.iban ?? "", vatPayer: p.vatPayer,
      operatorName: p.operatorName ?? "", operatorAddress: p.operatorAddress ?? [p.street, p.city].filter(Boolean).join(", "), operatorRegistration: p.operatorRegistration ?? "",
      operatorAccount: p.operatorAccount ?? (p.iban ?? ""), operatorIco: p.operatorIco ?? (p.ico ?? ""), operatorDic: p.operatorDic ?? (p.dic ?? ""),
      kioskKeyInfo: p.kioskKeyInfo ?? "", kioskWifi: p.kioskWifi ?? "",
      inventoryUnit: p.inventoryUnit, cityTaxEnabled: p.cityTaxEnabled, cityTaxPerPersonNight: parseFloat(p.cityTaxPerPersonNight).toString(), cityTaxFreeAge: String(p.cityTaxFreeAge ?? 18), energyFeePerNight: parseFloat(p.energyFeePerNight ?? "0").toString(),
      allowLongTerm: p.allowLongTerm, selfCheckin: p.selfCheckin, breakfastIncluded: p.breakfastIncluded, dailyCleaning: p.dailyCleaning, active: p.active, infoText: p.infoText ?? "",
      offeredServices: p.offeredServices ?? ["cleaning", "laundry", "ironing", "minibar"],
      onlineCheckinHours: String(p.onlineCheckinHours ?? 48),
      freeCancelDays: String(p.freeCancelDays ?? 0), cancelFeePct: String(p.cancelFeePct ?? 0), depositPct: String(p.depositPct ?? 0), reminderHours: String(p.reminderHours ?? 0), noShowHours: String(p.noShowHours ?? 0),
    });
  };
  const saveEdit = async () => {
    if (!editId || !ef) return;
    await api.updateProperty(editId, { ...ef, cityTaxPerPersonNight: Number(ef.cityTaxPerPersonNight), cityTaxFreeAge: Number(ef.cityTaxFreeAge), energyFeePerNight: Number(ef.energyFeePerNight), onlineCheckinHours: Number(ef.onlineCheckinHours), freeCancelDays: Number(ef.freeCancelDays), cancelFeePct: Number(ef.cancelFeePct), depositPct: Number(ef.depositPct), reminderHours: Number(ef.reminderHours), noShowHours: Number(ef.noShowHours) });
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
          <h3 style={{ border: "none", padding: 0, marginBottom: 4 }}>Úprava provozovny <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {ef.name}</span></h3>

          <FormSection title="Základní údaje">
            <FormGrid min={220}>
              <FieldCol label="Název"><input style={fullInput} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></FieldCol>
              <FieldCol label="Identifikátor"><input style={fullInput} value={ef.identifier} onChange={(e) => setEf({ ...ef, identifier: e.target.value })} /></FieldCol>
              <FieldCol label="Typ"><select style={fullInput} value={ef.type} onChange={(e) => setEf({ ...ef, type: e.target.value })}><option value="hotel">Hotel</option><option value="penzion">Penzion</option><option value="ubytovna">Ubytovna</option></select></FieldCol>
            </FormGrid>
          </FormSection>

          <FormSection title="Kontakt a adresa">
            <FormGrid min={150}>
              <FieldCol label="Ulice" span={2}><input style={fullInput} value={ef.street} onChange={(e) => setEf({ ...ef, street: e.target.value })} /></FieldCol>
              <FieldCol label="Město"><input style={fullInput} value={ef.city} onChange={(e) => setEf({ ...ef, city: e.target.value })} /></FieldCol>
              <FieldCol label="Země"><input style={fullInput} value={ef.country} onChange={(e) => setEf({ ...ef, country: e.target.value })} /></FieldCol>
              <FieldCol label="Telefon"><input style={fullInput} value={ef.phone} onChange={(e) => setEf({ ...ef, phone: e.target.value })} /></FieldCol>
              <FieldCol label="E-mail"><input style={fullInput} value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} /></FieldCol>
            </FormGrid>
          </FormSection>

          <FormSection title="Provozovatel a fakturace">
            <div className="muted" style={{ marginBottom: 10 }}>Firma, která fakturuje — dodavatel uvedený na dokladech. Z čísla účtu se generuje i QR platba na proformě (IBAN nebo český formát 123456789/0800). Když necháte název prázdný, použije se název provozovny.</div>
            <FormGrid min={180}>
              <FieldCol label="Název firmy" span={2}><input style={fullInput} value={ef.operatorName} onChange={(e) => setEf({ ...ef, operatorName: e.target.value })} placeholder={ef.name} /></FieldCol>
              <FieldCol label="Sídlo (ulice, město, PSČ)" span={2}><input style={fullInput} value={ef.operatorAddress} onChange={(e) => setEf({ ...ef, operatorAddress: e.target.value })} /></FieldCol>
              <FieldCol label="IČO"><input style={fullInput} value={ef.operatorIco} onChange={(e) => setEf({ ...ef, operatorIco: e.target.value })} /></FieldCol>
              <FieldCol label="DIČ"><input style={fullInput} value={ef.operatorDic} onChange={(e) => setEf({ ...ef, operatorDic: e.target.value })} /></FieldCol>
              <FieldCol label="Číslo účtu (na dokladech)"><input style={fullInput} value={ef.operatorAccount} onChange={(e) => setEf({ ...ef, operatorAccount: e.target.value })} /></FieldCol>
              <FieldCol label="Dodatek — zápis v rejstříku" span={2}><input style={fullInput} value={ef.operatorRegistration} onChange={(e) => setEf({ ...ef, operatorRegistration: e.target.value })} placeholder="Zapsána u Městského soudu v Praze, oddíl C, vložka 12345" /></FieldCol>
            </FormGrid>
            <div style={{ marginTop: 12 }}><Chk label="Plátce DPH" checked={ef.vatPayer} onChange={(v) => setEf({ ...ef, vatPayer: v })} /></div>
          </FormSection>

          <FormSection title="Informace pro AI asistenta (FAQ)">
            <textarea style={{ ...fullInput, minHeight: 100, resize: "vertical" }} value={ef.infoText} onChange={(e) => setEf({ ...ef, infoText: e.target.value })} placeholder="Např.: Wi-Fi heslo je 'vitejte'. Snídaně 7–10 v přízemí. Parkování zdarma na dvoře. Check-in od 14:00, check-out do 10:00. Domácí mazlíčci povoleni." />
          </FormSection>

          <FormSection title="Kiosek — pokyny po ubytování">
            <div className="muted" style={{ marginBottom: 10 }}>Zobrazí se hostovi na kiosku po self check-inu / ubytování (výsledková obrazovka). Když necháte prázdné, použije se výchozí text.</div>
            <FormGrid min={220}>
              <FieldCol label="Vyzvednutí klíče" span={2}><input style={fullInput} value={ef.kioskKeyInfo} onChange={(e) => setEf({ ...ef, kioskKeyInfo: e.target.value })} placeholder="Klíč je pod monitorem" /></FieldCol>
              <FieldCol label="Wi-Fi (síť / heslo)" span={2}><input style={fullInput} value={ef.kioskWifi} onChange={(e) => setEf({ ...ef, kioskWifi: e.target.value })} placeholder="PenzionWifi / vitejte" /></FieldCol>
            </FormGrid>
          </FormSection>

          <FormSection title="Ubytování a provoz">
            <FormGrid min={170}>
              <FieldCol label="Jednotka"><select style={fullInput} value={ef.inventoryUnit} onChange={(e) => setEf({ ...ef, inventoryUnit: e.target.value })}><option value="room">pokoj</option><option value="bed">lůžko</option></select></FieldCol>
              <FieldCol label="Pobyt. poplatek (Kč / os. / noc)"><input style={fullInput} type="number" min={0} value={ef.cityTaxPerPersonNight} disabled={!ef.cityTaxEnabled} onChange={(e) => setEf({ ...ef, cityTaxPerPersonNight: e.target.value })} /></FieldCol>
              <FieldCol label="Děti neplatí do (let)"><input style={fullInput} type="number" min={0} value={ef.cityTaxFreeAge} disabled={!ef.cityTaxEnabled} onChange={(e) => setEf({ ...ef, cityTaxFreeAge: e.target.value })} /></FieldCol>
              <FieldCol label="Online check-in (h před příjezdem)"><input style={fullInput} type="number" min={0} value={ef.onlineCheckinHours} disabled={!ef.selfCheckin} onChange={(e) => setEf({ ...ef, onlineCheckinHours: e.target.value })} /></FieldCol>
              <FieldCol label="Energie / vzdušné (Kč/lůžko/noc)"><input style={fullInput} type="number" min={0} value={ef.energyFeePerNight} onChange={(e) => setEf({ ...ef, energyFeePerNight: e.target.value })} /></FieldCol>
            </FormGrid>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 14 }}>
              <Chk label="Pobytový poplatek" checked={ef.cityTaxEnabled} onChange={(v) => setEf({ ...ef, cityTaxEnabled: v })} />
              <Chk label="Dlouhodobé pobyty" checked={ef.allowLongTerm} onChange={(v) => setEf({ ...ef, allowLongTerm: v })} />
              <Chk label="Self check-in" checked={ef.selfCheckin} onChange={(v) => setEf({ ...ef, selfCheckin: v })} />
              <Chk label="Snídaně v ceně" checked={ef.breakfastIncluded} onChange={(v) => setEf({ ...ef, breakfastIncluded: v })} />
              <Chk label="Úklid každý den" checked={ef.dailyCleaning} onChange={(v) => setEf({ ...ef, dailyCleaning: v })} />
              <Chk label="Aktivní" checked={ef.active} onChange={(v) => setEf({ ...ef, active: v })} />
            </div>
          </FormSection>

          <FormSection title="Služby nabízené hostům (host.recepceai.cz)">
            <div className="muted" style={{ marginBottom: 10 }}>Které služby si může host vyžádat v portálu. Údržba a obecný požadavek „Jiné" jsou vždy dostupné.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
              {[{ id: "cleaning", label: "Úklid na požádání" }, { id: "laundry", label: "Praní" }, { id: "ironing", label: "Žehlení" }, { id: "minibar", label: "Minibar" }].map((s) => (
                <Chk key={s.id} label={s.label} checked={ef.offeredServices.includes(s.id)}
                  onChange={(v) => setEf({ ...ef, offeredServices: v ? [...ef.offeredServices, s.id] : ef.offeredServices.filter((x) => x !== s.id) })} />
              ))}
            </div>
          </FormSection>

          <FormSection title="Storno, zálohy a automatika (0 = vypnuto)">
            <FormGrid min={150}>
              <FieldCol label="Bezplatné storno (dní před příjezdem)"><input style={fullInput} type="number" min={0} value={ef.freeCancelDays} onChange={(e) => setEf({ ...ef, freeCancelDays: e.target.value })} /></FieldCol>
              <FieldCol label="Storno poplatek (% z ceny)"><input style={fullInput} type="number" min={0} max={100} value={ef.cancelFeePct} onChange={(e) => setEf({ ...ef, cancelFeePct: e.target.value })} /></FieldCol>
              <FieldCol label="Požadovaná záloha (%)"><input style={fullInput} type="number" min={0} max={100} value={ef.depositPct} onChange={(e) => setEf({ ...ef, depositPct: e.target.value })} /></FieldCol>
              <FieldCol label="Připomínka (h před příjezdem)"><input style={fullInput} type="number" min={0} value={ef.reminderHours} onChange={(e) => setEf({ ...ef, reminderHours: e.target.value })} /></FieldCol>
              <FieldCol label="No-show (h po příjezdu)"><input style={fullInput} type="number" min={0} value={ef.noShowHours} onChange={(e) => setEf({ ...ef, noShowHours: e.target.value })} /></FieldCol>
            </FormGrid>
          </FormSection>

          <div className="toolbar" style={{ marginTop: 18 }}>
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
// Dlouhodobé/firemní panely u lůžkové rezervace: sjednaná sazba + booking pole + obsazení (rotace osob).
function BedReservationPanels({ id, data, onChanged }: { id: string; data: ReservationDetail; onChanged: () => void }) {
  const confirm = useConfirm();
  const rates = useAsync<BedRate[]>(() => api.bedRates(), [id]);
  const occ = useAsync<OccupationItem[]>(() => api.reservationOccupations(id), [id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [amount, setAmount] = useState("");
  const [pickOcc, setPickOcc] = useState(false);
  const blankOcc = () => ({ guestId: undefined as string | undefined, firstName: "", lastName: "", fromDate: todayIso(), toDate: (data.checkOutDate ?? "").slice(0, 10) || tomorrowIso(), note: "" });
  const [of, setOf] = useState(blankOcc());
  const curAcc = Number(data.totalAmount) - Number(data.cityTax);
  const run = (fn: () => Promise<unknown>) => { setBusy(true); setMsg(""); fn().then(() => { onChanged(); occ.reload(); }).catch((e) => setMsg(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); };
  const addOcc = () => {
    if (!of.guestId && (!of.firstName.trim() || !of.lastName.trim())) { setMsg("Vyplň jméno a příjmení nebo vyber z adresáře."); return; }
    run(() => api.createOccupation(id, { occupantGuestId: of.guestId, firstName: of.firstName || undefined, lastName: of.lastName || undefined, fromDate: of.fromDate, toDate: of.toDate, note: of.note || null }).then(() => setOf(blankOcc())));
  };
  return (
    <>
      <div className="panel"><h3>Dlouhodobé / firemní <span className="muted" style={{ fontSize: 14 }}>sjednaná sazba, splatnost, VIP</span></h3>
        <div style={{ padding: 16, maxWidth: 520 }}>
          <FieldRow label="Sjednaná sazba"><select style={{ flex: 1, minWidth: 0 }} value={data.bedRateId ?? ""} onChange={(e) => run(() => api.setReservationBedRate(id, e.target.value || null))}>
            <option value="">— bez sazby (ruční cena) —</option>
            {(rates.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({money(r.pricePerNight)}/noc)</option>)}
          </select></FieldRow>
          <FieldRow label="Cena ubytování"><input style={{ flex: 1, minWidth: 0 }} type="number" placeholder={`${curAcc} (× ${data.nights} nocí)`} value={amount} onChange={(e) => setAmount(e.target.value)} /><button className="btn sm" disabled={busy || !amount} onClick={() => { const n = Number(amount.replace(",", ".")); if (!isNaN(n)) run(() => api.setReservationAccommodation(id, n).then(() => setAmount(""))); }}>Přepsat</button></FieldRow>
          <FieldRow label="Splatnost"><input type="date" style={{ flex: 1, minWidth: 0 }} defaultValue={data.payUntil ? data.payUntil.slice(0, 10) : ""} onChange={(e) => run(() => api.setReservationBooking(id, { payUntil: e.target.value || null }))} /></FieldRow>
          <FieldRow label="Zaplaceno do"><input type="date" style={{ flex: 1, minWidth: 0 }} defaultValue={data.paidTo ? data.paidTo.slice(0, 10) : ""} onChange={(e) => run(() => api.setReservationBooking(id, { paidTo: e.target.value || null }))} /></FieldRow>
          <FieldRow label="VIP"><label className="row" style={{ gap: 6 }}><input type="checkbox" defaultChecked={!!data.vip} onChange={(e) => run(() => api.setReservationBooking(id, { vip: e.target.checked }))} /> prioritní/smluvní pobyt</label></FieldRow>
        </div>
      </div>

      <div className="panel"><h3>Obsazení lůžka <span className="muted" style={{ fontSize: 14 }}>kdo a kdy na lůžku bydlí (rotace pracovníků)</span></h3>
        {msg && <div className="error" style={{ margin: "12px 16px 0" }}>{msg}</div>}
        <div className="req-actions" style={{ padding: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn sm ghost" onClick={() => setPickOcc(true)}>📇 Z adresáře</button>
          <input placeholder="Jméno" value={of.guestId ? (of.firstName) : of.firstName} disabled={!!of.guestId} onChange={(e) => setOf({ ...of, firstName: e.target.value })} style={{ width: 120 }} />
          <input placeholder="Příjmení" value={of.lastName} disabled={!!of.guestId} onChange={(e) => setOf({ ...of, lastName: e.target.value })} style={{ width: 130 }} />
          {of.guestId && <button className="btn sm ghost" title="zrušit výběr" onClick={() => setOf({ ...of, guestId: undefined, firstName: "", lastName: "" })}>×</button>}
          <label className="row" style={{ gap: 4 }}>od <input type="date" value={of.fromDate} onChange={(e) => setOf({ ...of, fromDate: e.target.value })} /></label>
          <label className="row" style={{ gap: 4 }}>do <input type="date" value={of.toDate} onChange={(e) => setOf({ ...of, toDate: e.target.value })} /></label>
          <input placeholder="Poznámka" value={of.note} onChange={(e) => setOf({ ...of, note: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
          <button className="btn sm" disabled={busy} onClick={addOcc}>Přidat osobu</button>
        </div>
        <Table cols={["Osoba", "Od → Do", "Nocí", "Stav", ""]} rows={occ.data ?? []} empty="Zatím nikdo na lůžku" render={(o: OccupationItem) => (
          <tr key={o.id}>
            <td>{o.occupantName}{o.occupantPhone ? <span className="muted"> · {o.occupantPhone}</span> : ""}{o.note ? <div className="muted" style={{ fontSize: 12 }}>{o.note}</div> : null}</td>
            <td>{d(o.fromDate)} → {d(o.toDate)}</td>
            <td className="muted">{o.nights}</td>
            <td>{o.status === "ended" ? <span className="muted">ukončeno</span> : <b style={{ color: "var(--ok)" }}>aktivní</b>}</td>
            <td className="right" style={{ whiteSpace: "nowrap" }}>{o.status === "active" && <><button className="btn sm" disabled={busy} onClick={() => run(() => api.endOccupation(o.id))}>Ukončit</button>{" "}</>}<button className="btn sm ghost" disabled={busy} style={{ color: "var(--danger)" }} onClick={async () => { if (await confirm({ title: "Smazat obsazení", message: <>Smazat <b>{o.occupantName}</b> z lůžka?</>, danger: true, confirmLabel: "Smazat" })) run(() => api.deleteOccupation(o.id)); }}>✕</button></td>
          </tr>
        )} />
      </div>
      {pickOcc && <GuestPickerOverlay prefill="" title="Vybrat osobu na lůžko" subtitle="Z adresáře nebo zadej nového — bude obsazovat lůžko v zadaném termínu." actionLabel="Vybrat" onClose={() => setPickOcc(false)} onPick={(gid) => { api.guestProfile(gid).then((p) => setOf((s) => ({ ...s, guestId: gid, firstName: p.guest.firstName, lastName: p.guest.lastName }))); setPickOcc(false); }} />}
    </>
  );
}

function ReservationDetailView({ id, prop, onBack }: { id: string; prop?: Property; onBack: () => void }) {
  const confirm = useConfirm();
  const { data, error, reload } = useAsync<ReservationDetail>(() => api.reservation(id), [id]);
  const folioA = useAsync<Folio>(() => api.resFolio(id), [id]);
  const chargesA = useAsync<Charge[]>(() => api.charges(id), [id]);
  const guestsA = useAsync<ResGuest[]>(() => api.resGuests(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState("");
  const svc = useAsync<ServiceItem[]>(() => api.serviceItems(), [id]);
  const personRates = useAsync<PersonRate[]>(() => api.personRates(), [id]);
  const [chg, setChg] = useState({ category: "minibar", description: "", quantity: "1", unitPrice: "" });
  const [egf, setEgf] = useState<GuestFields>(blankGuestFields); // editace hosta na pokoji (jednotná sada polí)
  const [editPrimary, setEditPrimary] = useState(false); // editovaný řádek je hlavní host?
  const [editGuestId, setEditGuestId] = useState<string | undefined>(undefined); // guestId editovaného (kvůli vyloučení z adresáře)
  const [pickRoomGuest, setPickRoomGuest] = useState(false); // přidání osoby z adresáře
  const [pickForEdit, setPickForEdit] = useState(false); // výběr z adresáře z editačního okna (nahradí osobu)
  const [moveUnit, setMoveUnit] = useState(false); // dialog změny pokoje/lůžka
  const [reg, setReg] = useState({ primary: true, fullName: "", dateOfBirth: "", nationality: "Česká republika", documentType: "id_card", documentNumber: "", homeAddress: "" });
  const [offerReg, setOfferReg] = useState(false);
  const [gEdit, setGEdit] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  useEffect(() => { if (data) { setNoteText(data.note ?? ""); setNoteDirty(false); setReg((s) => (s.fullName ? s : { ...s, fullName: `${data.primaryGuest?.firstName ?? ""} ${data.primaryGuest?.lastName ?? ""}`.trim() })); } }, [data?.id]); // eslint-disable-line
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [issuedDoc, setIssuedDoc] = useState<Doc | null>(null);
  const [previewState, setPreviewState] = useState<{ doc: Doc; onIssue: () => Promise<Doc> } | null>(null);
  const [guestQr, setGuestQr] = useState(false);
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [pickGuest, setPickGuest] = useState(false);
  const [pickCompany, setPickCompany] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null); // proklik na skupinu
  const openReceipt = async (fn: () => Promise<Receipt>) => { try { setReceipt(await fn()); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } };
  const issueDoc = async (fn: () => Promise<Doc>) => { setBusy(true); setActErr(""); try { setIssuedDoc(await fn()); refresh(); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  // Náhled → teprve po „Vystavit" se doklad založí (DocumentOverlay preview). Zobrazit existující = otevře už vystavený.
  const previewDoc = async (previewFn: () => Promise<Doc>, issueFn: () => Promise<Doc>) => { setBusy(true); setActErr(""); try { const p = await previewFn(); setPreviewState({ doc: p, onIssue: async () => { const dd = await issueFn(); refresh(); return dd; } }); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const askProforma = () => { const v = prompt("Částka zálohy (Kč):"); if (!v) return; const n = parseFloat(v.replace(",", ".")); if (!(n > 0)) return; previewDoc(() => api.issueProforma(id, n, undefined, undefined, undefined, true), () => api.issueProforma(id, n)); };
  const askPeriod = () => { const from = prompt("Období OD (RRRR-MM-DD):"); if (!from) return; const to = prompt("Období DO (RRRR-MM-DD):"); if (!to) return; previewDoc(() => api.periodInvoice(id, from, to, true), () => api.periodInvoice(id, from, to)); };

  const refresh = () => { reload(); folioA.reload(); chargesA.reload(); guestsA.reload(); };
  const resetGf = () => { setEgf(blankGuestFields()); setGEdit(null); setEditPrimary(false); setEditGuestId(undefined); setPickForEdit(false); };
  const saveGuest = () => {
    if (!egf.firstName.trim() || !egf.lastName.trim() || !gEdit) return;
    const body = { firstName: egf.firstName.trim(), lastName: egf.lastName.trim(), email: egf.email || undefined, phone: egf.phone || undefined, address: egf.address || undefined, dateOfBirth: egf.dateOfBirth || undefined, nationality: egf.nationality || undefined, documentType: egf.documentType || null, documentNumber: egf.documentNumber || undefined };
    run(async () => { await api.updateResGuest(gEdit, body); resetGf(); });
  };
  const editGuest = (g: ResGuest) => { setGEdit(g.id); setEditPrimary(g.isPrimary); setEditGuestId(g.guest.id); setEgf({ firstName: g.guest.firstName, lastName: g.guest.lastName, email: g.guest.email ?? "", phone: g.guest.phone ?? "", address: g.guest.address ?? "", dateOfBirth: g.guest.dateOfBirth ? g.guest.dateOfBirth.slice(0, 10) : "", nationality: g.guest.nationality ?? "", documentType: g.guest.documentType ?? "", documentNumber: g.guest.documentNumber ?? "" }); };
  const saveNote = () => run(async () => { await api.saveReservationNote(id, noteText); });
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setActErr(""); try { await fn(); refresh(); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const addCharge = () => { const q = parseFloat(chg.quantity.replace(",", ".")) || 1; const p = parseFloat(chg.unitPrice.replace(",", ".")); if (isNaN(p) || p < 0) return; run(async () => { await api.addCharge(id, { category: chg.category, description: chg.description || undefined, quantity: q, unitPrice: p }); setChg({ category: chg.category, description: "", quantity: "1", unitPrice: "" }); }); };

  if (openGroup && prop) return <GroupDetailView id={openGroup} prop={prop} onBack={() => { setOpenGroup(null); refresh(); }} />;
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
          <div className="kvline"><span className="muted">Host</span><b>{r.primaryGuest?.vip ? "⭐ " : ""}{r.primaryGuest?.firstName} {r.primaryGuest?.lastName}{(r.previousStays ?? 0) > 0 ? <span className="chip" style={{ marginLeft: 8 }}>🔁 {(r.previousStays ?? 0) + 1}. pobyt</span> : null}</b></div>
          <div className="kvline"><span className="muted">Kontakt</span><span>{r.primaryGuest?.email ?? "—"} · {r.primaryGuest?.phone ?? "—"}</span></div>
          {r.primaryGuest?.preferences ? <div className="kvline"><span className="muted">Preference</span><span style={{ color: "var(--warn)", fontWeight: 600 }}>{r.primaryGuest.preferences}</span></div> : null}
          {r.review ? <div className="kvline"><span className="muted">Hodnocení pobytu</span><span><b>{r.review.nps}/10</b>{r.review.comment ? ` — „${r.review.comment}"` : ""}</span></div> : null}
          <div className="kvline"><span className="muted">Termín</span><span>{d(r.checkInDate)} → {d(r.checkOutDate)} ({r.nights} nocí)</span></div>
          <div className="kvline"><span className="muted">Osob</span><span>{r.adults} {r.adults === 1 ? "dospělý" : "dosp."}{r.children ? ` + ${r.children} ${r.children === 1 ? "dítě" : "dětí"}` : ""}{r.childAges && r.childAges.length > 0 ? ` (věk ${r.childAges.join(", ")})` : ""}</span></div>
          <div className="kvline"><span className="muted">Jednotka</span><span style={{ display: "flex", alignItems: "center", gap: 8 }}>{r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : <span className="muted">{r.roomType?.name ?? "—"} · nepřiřazeno</span>}<button className="btn sm ghost" disabled={busy} onClick={() => setMoveUnit(true)}>{data.property?.inventoryUnit === "bed" ? "Změnit lůžko" : "Změnit pokoj"}</button></span></div>
          {data.property?.inventoryUnit === "bed" ? <div className="kvline"><span className="muted">Energie (vzdušné)</span><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!r.energyFeeExempt} disabled={busy} onChange={(e) => run(() => api.setReservationEnergyExempt(id, e.target.checked))} /> osvobozeno (neúčtovat)</label></div> : null}
          {r.group ? <div className="kvline"><span className="muted">Skupina</span><span>{prop ? <button className="chip" style={{ cursor: "pointer", border: "none" }} onClick={() => setOpenGroup(r.group!.id)} title="Otevřít skupinu">👥 {r.group.name} ›</button> : <span className="chip">👥 {r.group.name}</span>} <span className="muted">{r.group.code}</span></span></div> : null}
          {r.onlineCheckinAt && <div className="kvline"><span className="muted">Online check-in</span><span style={{ color: "var(--ok)", fontWeight: 600 }}>✓ odbaveno online {d(r.onlineCheckinAt)}</span></div>}
          {r.billingCompany && <div className="kvline"><span className="muted">Fakturovat</span><span>{r.billingCompany}{r.billingIco ? ` (IČO ${r.billingIco})` : ""}</span></div>}
        </div></div>
        <div className="panel"><h3>Vyúčtování</h3><div style={{ padding: 16 }}>
          <div className="kvline"><span className="muted">Celkem</span><b>{folio ? money(folio.charges) : "…"}</b></div>
          <div className="kvline"><span className="muted">Zaplaceno</span><span>{folio ? money(folio.paid) : "…"}</span></div>
          <div className="kvline"><span className="muted">{bal >= 0 ? "Zbývá doplatit" : "Přeplatek"}</span><b style={{ color: bal > 0 ? "var(--warn)" : "var(--ok)" }}>{folio ? money(Math.abs(bal)) : "…"}</b></div>
          {prop?.depositPct ? <div className="kvline"><span className="muted">Požadovaná záloha</span><span>{money(Math.round(Number(r.totalAmount) * prop.depositPct / 100))} ({prop.depositPct} %)</span></div> : null}
        </div></div>
      </div>

      <div className="panel" style={{ padding: 16 }}>
        <h3 style={{ border: "none", padding: 0, marginBottom: 12 }}>Akce</h3>
        <div className="toolbar">
          {canCheckIn && <button className="btn ok" disabled={busy} onClick={async () => { if (await confirm({ title: "Check-in", message: <>Provést check-in rezervace <b>{r.code}</b> ({r.primaryGuest?.firstName} {r.primaryGuest?.lastName})?</>, confirmLabel: "Check-in" })) { setBusy(true); setActErr(""); try { await api.checkin(id); setOfferReg(true); refresh(); } catch (e) { setActErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } } }}>Check-in</button>}
          {canCheckOut && <button className="btn" disabled={busy} onClick={async () => { if (await confirm({ title: "Check-out", message: <>Provést check-out rezervace <b>{r.code}</b>? Účet musí být vyrovnaný.</>, confirmLabel: "Check-out" })) run(async () => { const x = await api.checkout(id); if (x.document) setIssuedDoc(x.document); }); }}>Check-out</button>}
          {bal > 0 && <button className="btn" disabled={busy} onClick={async () => { if (await confirm({ title: "Úhrada kartou", message: <>Zaúčtovat úhradu <b>{money(bal)}</b> kartou?</>, confirmLabel: "Zaúčtovat" })) run(() => api.addPayment(id, { type: "balance", amount: bal, method: "card_terminal" })); }}>Doplatit {money(bal)} kartou</button>}
          {bal > 0 && showInvoice && <button className="btn secondary" disabled={busy} onClick={async () => { if (await confirm({ title: "Platba fakturou", message: <>Označit <b>{money(bal)}</b> jako zaplaceno fakturou?</>, confirmLabel: "Označit zaplaceno" })) run(() => api.addPayment(id, { type: "balance", amount: bal, method: "invoice", invoiceNumber: `FA-${r.code.replace("RC-", "")}` })); }}>Zaplaceno fakturou</button>}
          {(() => { const ex = r.documents?.find((x) => x.type === "invoice" && x.status !== "cancelled"); return ex
            ? <button className="btn ghost" disabled={busy} onClick={() => issueDoc(() => api.document(ex.id))}>📄 Zobrazit fakturu</button>
            : <button className="btn ghost" disabled={busy} onClick={() => previewDoc(() => api.issueDocument(id, "invoice", true), () => api.issueDocument(id, "invoice"))}>📄 Vystavit fakturu</button>; })()}
          {(() => { const ex = r.documents?.find((x) => x.type === "receipt" && x.status !== "cancelled"); return ex
            ? <button className="btn ghost" disabled={busy} onClick={() => issueDoc(() => api.document(ex.id))}>🧾 Zobrazit účtenku</button>
            : <button className="btn ghost" disabled={busy} onClick={() => previewDoc(() => api.issueDocument(id, "receipt", true), () => api.issueDocument(id, "receipt"))}>🧾 Vystavit účtenku</button>; })()}
          {(() => { const ex = r.documents?.find((x) => x.type === "proforma" && x.status !== "cancelled"); return ex
            ? <button className="btn ghost" disabled={busy} onClick={() => issueDoc(() => api.document(ex.id))}>💶 Zobrazit zálohovou f.</button>
            : <button className="btn ghost" disabled={busy} onClick={askProforma}>💶 Zálohová faktura</button>; })()}
          {(prop?.allowLongTerm || r.billingCycle === "monthly") && <button className="btn ghost" disabled={busy} onClick={askPeriod}>📅 Faktura za období</button>}
          <button className="btn ghost" onClick={() => setGuestQr(true)}>🏷 QR pro hosta</button>
          <button className="btn ghost" onClick={() => setEmailsOpen(true)}>📧 E-maily</button>
          <button className="btn ghost" onClick={() => setPickGuest(true)}>📇 Adresář</button>
        </div>
      </div>

      <div className="panel"><h3>Poznámka <span className="muted" style={{ fontSize: 14 }}>přání a požadavky hosta</span></h3>
        <div style={{ padding: 16 }}>
          <textarea style={{ width: "100%", minHeight: 80, resize: "vertical" }} value={noteText} onChange={(e) => { setNoteText(e.target.value); setNoteDirty(true); }} placeholder="Např.: pozdní check-in po 22:00, alergie na ořechy, manželská postel místo dvou, dětská postýlka, parkování pro 2 auta, výhled do dvora…" />
          {noteDirty && <div style={{ marginTop: 10 }}><button className="btn sm" disabled={busy} onClick={saveNote}>Uložit poznámku</button> <button className="btn sm ghost" onClick={() => { setNoteText(data.note ?? ""); setNoteDirty(false); }}>Zrušit</button></div>}
        </div>
      </div>

      <div className="panel"><h3>Firma (odběratel) <span className="muted" style={{ fontSize: 14 }}>doklad se vystaví firmě místo hosta</span></h3>
        <div className="req-actions" style={{ padding: 16, alignItems: "center", flexWrap: "wrap" }}>
          {data.company ? <span>🏢 <b>{data.company.name}</b></span> : <span className="muted">Nepřiřazena — fakturuje se hostovi.</span>}
          <button className="btn sm" disabled={busy} onClick={() => setPickCompany(true)} style={{ marginLeft: "auto" }}>{data.company ? "Změnit firmu" : "Přiřadit firmu"}</button>
          {data.company && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api.setReservationCompany(id, null); })}>Odebrat</button>}
        </div>
      </div>

      <DepositsPanel reservationId={id} suggested={data.property?.depositPct ? Math.round(Number(data.totalAmount) * data.property.depositPct / 100) : undefined} />

      {data.property?.inventoryUnit === "bed" ? <BedReservationPanels id={id} data={data} onChanged={refresh} /> : (() => {
        const rates = personRates.data ?? [];
        const showType = rates.length > 0; // typ osoby per osobu (cena přistýlky)
        return (
      <div className="panel"><h3>Hosté na pokoji <span className="muted" style={{ fontSize: 14 }}>kdo na pokoji bydlí{showType ? " · typ osoby určuje cenu přistýlky" : ""}</span></h3>
        <div className="req-actions" style={{ padding: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => setPickRoomGuest(true)}>📇 Přidat osobu z adresáře</button>
          <span className="muted" style={{ fontSize: 13 }}>Vyber z adresáře nebo rovnou zadej nového — jako u hlavního hosta.</span>
        </div>
        <Table cols={showType ? ["Jméno", "Role", "Typ osoby (cena přistýlky)", "Narození", "Doklad", ""] : ["Jméno", "Role", "Narození", "Doklad", ""]} rows={guestsA.data ?? []} empty="—"
          render={(g: ResGuest) => (
            <tr key={g.id} className={gEdit === g.id ? "row-urgent" : ""}>
              <td>{g.guest.firstName} {g.guest.lastName}</td>
              <td>{g.isPrimary ? <span className="chip">hlavní host</span> : <span className="muted">spolubydlící</span>}</td>
              {showType && <td><select value={g.personRateId ?? ""} onChange={(e) => run(() => api.setResGuestRate(g.id, e.target.value || null))}>
                    <option value="">— bez typu —</option>
                    {rates.map((r) => <option key={r.id} value={r.id}>{r.name} ({money(r.pricePerNight)}/noc)</option>)}
                  </select></td>}
              <td className="muted">{g.guest.dateOfBirth ? d(g.guest.dateOfBirth) : "—"}</td>
              <td className="muted">{g.guest.documentNumber ? `${DOCTYPE_LABEL[g.guest.documentType ?? ""] ?? ""} ${g.guest.documentNumber}` : "—"}</td>
              <td className="right" style={{ whiteSpace: "nowrap" }}>
                <button className="btn sm ghost" onClick={() => editGuest(g)}>Upravit</button>{" "}
                {!g.isPrimary && <button className="btn sm danger" onClick={async () => { if (await confirm({ title: "Odebrat osobu", message: <>Odebrat <b>{g.guest.firstName} {g.guest.lastName}</b> z pokoje?</>, confirmLabel: "Odebrat", danger: true })) run(() => api.removeResGuest(g.id)); }}>Odebrat</button>}
              </td>
            </tr>
          )} />
      </div>
        );
      })()}

      <div className="panel"><h3>Účet pokoje — náklady</h3>
        <div className="req-actions" style={{ padding: 16, alignItems: "center", flexWrap: "wrap" }}>
          <select value="" onChange={(e) => { const s = (svc.data ?? []).find((x) => x.id === e.target.value); if (s) setChg({ category: s.category, description: s.name, quantity: chg.quantity || "1", unitPrice: parseFloat(s.price).toString() }); }}>
            <option value="">— z ceníku —</option>
            {(svc.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}
          </select>
          <select value={chg.category} onChange={(e) => setChg({ ...chg, category: e.target.value })}>
            {Object.entries(CHARGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input placeholder="Popis (cola, masáž…)" value={chg.description} onChange={(e) => setChg({ ...chg, description: e.target.value })} />
          <input placeholder="Ks" style={{ width: 60 }} value={chg.quantity} onChange={(e) => setChg({ ...chg, quantity: e.target.value })} />
          <input placeholder="Cena/ks" style={{ width: 100 }} value={chg.unitPrice} onChange={(e) => setChg({ ...chg, unitPrice: e.target.value })} />
          <button className="btn sm" disabled={busy || !chg.unitPrice} onClick={addCharge}>+ Připsat na účet</button>
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
              <td className="right"><button className="btn sm danger" onClick={async () => { if (await confirm({ title: "Smazat položku", message: <>Smazat položku <b>{c.description ?? CHARGE_LABEL[c.category] ?? "—"}</b> ({money(c.amount)}) z účtu?</>, confirmLabel: "Smazat", danger: true })) run(() => api.deleteCharge(c.id)); }}>Smazat</button></td>
            </tr>
          )} />
      </div>

      <div className="panel"><h3>Platby</h3>
        <Table cols={["Datum", "Typ", "Popis", "Způsob", "Částka", ""]} rows={r.payments} empty="Žádné platby"
          render={(p: Payment) => (<tr key={p.id}><td className="muted">{p.createdAt.slice(0, 10)}</td><td>{PAY_TYPE_LABEL[p.type] ?? p.type}</td><td>{p.description ?? "—"}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}</td><td className="muted">{PAY_METHOD_LABEL[p.method] ?? p.method}</td><td>{money(p.amount)}</td><td className="right">{p.type !== "deposit_hold" && <button className="btn sm ghost" onClick={() => openReceipt(() => api.paymentReceipt(p.id))}>🧾</button>}</td></tr>)} />
      </div>

      <div className="panel"><h3>Evidenční kniha <span className="muted" style={{ fontSize: 14 }}>zápis ubytovaných osob</span></h3>
        {offerReg && r.registrationEntries.length === 0 && <div className="error" style={{ background: "#fff4e0", color: "#9a6b00", margin: "16px 16px 0" }}>✓ Host odbaven (check-in). Nezapomeňte ho zapsat do evidenční knihy níže.</div>}
        <div style={{ padding: 16, maxWidth: 520 }}>
          <label className="row" style={{ gap: 6, marginBottom: 12 }}><input type="checkbox" checked={reg.primary} onChange={(e) => {
            const on = e.target.checked;
            if (!on) { setReg({ ...reg, primary: false, fullName: "" }); return; }
            // Předvyplnění z knihy hostů (poslední zápis) → jinak z profilu hosta (doklad/adresa) → jinak ponech.
            const lr = r.primaryGuestLastReg, pg = r.primaryGuest;
            setReg((s) => ({ ...s, primary: true,
              fullName: lr?.fullName || `${pg?.firstName ?? ""} ${pg?.lastName ?? ""}`.trim(),
              dateOfBirth: lr?.dateOfBirth ? lr.dateOfBirth.slice(0, 10) : (pg?.dateOfBirth ? pg.dateOfBirth.slice(0, 10) : s.dateOfBirth),
              nationality: lr?.nationality || pg?.nationality || s.nationality,
              documentType: lr?.documentType || pg?.documentType || s.documentType,
              documentNumber: lr?.documentNumber || pg?.documentNumber || s.documentNumber,
              homeAddress: lr?.homeAddress || pg?.address || s.homeAddress,
            }));
          }} /> zapsat hlavního hosta {(r.primaryGuestLastReg || r.primaryGuest?.documentNumber || r.primaryGuest?.dateOfBirth) && <span className="muted" style={{ fontSize: 12 }}>· 📘 údaje z adresáře/knihy se předvyplní</span>}</label>
          <FieldRow label="Jméno a příjmení"><input style={{ flex: 1, minWidth: 0 }} value={reg.fullName} onChange={(e) => setReg({ ...reg, fullName: e.target.value })} /></FieldRow>
          <FieldRow label="Datum narození"><input type="date" style={{ flex: 1, minWidth: 0 }} value={reg.dateOfBirth} onChange={(e) => setReg({ ...reg, dateOfBirth: e.target.value })} /></FieldRow>
          <FieldRow label="Národnost"><input style={{ flex: 1, minWidth: 0 }} value={reg.nationality} onChange={(e) => setReg({ ...reg, nationality: e.target.value })} /></FieldRow>
          <FieldRow label="Doklad"><select style={{ flex: 1, minWidth: 0 }} value={reg.documentType} onChange={(e) => setReg({ ...reg, documentType: e.target.value })}><option value="id_card">OP</option><option value="passport">Pas</option></select></FieldRow>
          <FieldRow label="Číslo dokladu"><input style={{ flex: 1, minWidth: 0 }} value={reg.documentNumber} onChange={(e) => setReg({ ...reg, documentNumber: e.target.value })} /></FieldRow>
          <FieldRow label="Adresa"><input style={{ flex: 1, minWidth: 0 }} value={reg.homeAddress} onChange={(e) => setReg({ ...reg, homeAddress: e.target.value })} /></FieldRow>
          <div style={{ textAlign: "right", marginTop: 4 }}><button className="btn sm" disabled={busy || !reg.fullName.trim() || !reg.dateOfBirth || !reg.nationality.trim()} onClick={() => run(async () => { await api.addRegistration(id, { primary: reg.primary, fullName: reg.fullName, dateOfBirth: reg.dateOfBirth, nationality: reg.nationality, documentType: reg.documentType || undefined, documentNumber: reg.documentNumber || undefined, homeAddress: reg.homeAddress || undefined }); setReg({ primary: false, fullName: "", dateOfBirth: "", nationality: "Česká republika", documentType: "id_card", documentNumber: "", homeAddress: "" }); })}>Zapsat do knihy</button></div>
        </div>
        <Table cols={["Jméno", "Narození", "Národnost", "Doklad", "Adresa", "Pobyt", ""]} rows={r.registrationEntries} empty="Zatím nikdo zapsán"
          render={(e: RegistrationEntry) => (
            <tr key={e.id}>
              <td>{e.fullName}</td><td>{d(e.dateOfBirth)}</td><td className="muted">{e.nationality}</td>
              <td className="muted">{DOCTYPE_LABEL[e.documentType] ?? e.documentType} {e.documentNumber}</td>
              <td className="muted">{e.homeAddress}</td><td>{d(e.stayFrom)} → {d(e.stayTo)}</td>
              <td className="right"><button className="btn sm danger" disabled={busy} onClick={async () => { if (await confirm({ title: "Smazat zápis", message: <>Smazat <b>{e.fullName}</b> z evidenční knihy?</>, confirmLabel: "Smazat", danger: true })) run(() => api.deleteRegistration(e.id)); }}>Smazat</button></td>
            </tr>
          )} />
      </div>

      {previewState && <DocumentOverlay doc={previewState.doc} preview onIssue={previewState.onIssue} onClose={() => setPreviewState(null)} />}
      {issuedDoc && <DocumentOverlay doc={issuedDoc} onClose={() => setIssuedDoc(null)} />}
      {receipt && <ReceiptOverlay rec={receipt} onClose={() => setReceipt(null)} />}
      {guestQr && <GuestQrLabels rows={[{ code: r.code, title: r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : r.code, subtitle: `${r.primaryGuest?.firstName ?? ""} ${r.primaryGuest?.lastName ?? ""}`.trim() }]} onClose={() => setGuestQr(false)} />}
      {emailsOpen && <EmailsOverlay id={id} guestEmail={r.primaryGuest?.email ?? null} onClose={() => setEmailsOpen(false)} />}
      {pickGuest && <GuestPickerOverlay prefill={r.primaryGuest?.email || r.primaryGuest?.lastName || ""} onClose={() => setPickGuest(false)} onPick={(gid) => run(async () => { await api.setReservationPrimaryGuest(id, gid); setPickGuest(false); })} />}
      {pickRoomGuest && <GuestPickerOverlay
        prefill=""
        title="Přidat osobu na pokoj"
        subtitle="Vyber hosta z adresáře nebo zadej nového — připojí se jako spolubydlící."
        actionLabel="Přidat"
        onClose={() => setPickRoomGuest(false)}
        onPick={(gid) => run(async () => { await api.addResGuest(id, { guestId: gid }); setPickRoomGuest(false); })}
      />}
      {gEdit && (
        <div className="inv-backdrop">
          <div className="invoice wz" style={{ width: 560 }}>
            <div className="wz-head"><div className="wz-titlerow"><div><h2>Upravit hosta</h2><div className="muted" style={{ marginTop: 4 }}>Uprav údaje, nebo vyber jinou osobu z adresáře. Údaje slouží i pro evidenční knihu / UBYPORT.</div></div><button className="linkx" onClick={resetGf}>zavřít</button></div></div>
            <div className="wz-body">
              <div className="req-actions" style={{ padding: 0, marginBottom: 14, alignItems: "center" }}>
                <button className="btn sm ghost" onClick={() => setPickForEdit(true)}>📇 Vybrat z adresáře</button>
                <span className="muted" style={{ fontSize: 12 }}>nahradí tuto osobu existujícím klientem</span>
              </div>
              <GuestFieldsForm v={egf} on={(patch) => setEgf((s) => ({ ...s, ...patch }))} />
            </div>
            <div className="wz-foot"><button className="btn ghost" onClick={resetGf}>Zrušit</button><button className="btn" disabled={busy || !egf.firstName.trim() || !egf.lastName.trim()} onClick={saveGuest}>Uložit</button></div>
          </div>
        </div>
      )}
      {pickForEdit && (
        <GuestPickerOverlay
          prefill={egf.lastName || ""}
          excludeId={editGuestId}
          title="Vybrat osobu z adresáře"
          subtitle="Nahradí tuto osobu existujícím klientem (nebo zadej nového)."
          actionLabel="Použít"
          onClose={() => setPickForEdit(false)}
          onPick={(gid) => { const rgId = gEdit, prim = editPrimary; setPickForEdit(false); resetGf(); run(async () => {
            if (prim) { await api.setReservationPrimaryGuest(id, gid); }
            else { if (rgId) await api.removeResGuest(rgId).catch(() => {}); await api.addResGuest(id, { guestId: gid }); }
          }); }}
        />
      )}
      {pickCompany && <CompanyPickerOverlay onClose={() => setPickCompany(false)} onPick={(cid) => run(async () => { await api.setReservationCompany(id, cid); setPickCompany(false); })} />}
      {moveUnit && <UnitMoveOverlay reservationId={id} onClose={() => setMoveUnit(false)} onDone={refresh} />}
    </>
  );
}

const EmailStatus = ({ s }: { s: string }) => {
  const map: Record<string, [string, string]> = { sent: ["odesláno", "var(--ok)"], failed: ["selhalo", "#c0392b"], skipped: ["přeskočeno", "var(--warn)"] };
  const [label, color] = map[s] ?? [s, "inherit"];
  return <span style={{ color, fontWeight: 600, fontSize: 13 }}>{label}</span>;
};

// Změna pokoje/lůžka rezervace — sdílené z detailu rezervace i z Plánu (tape chart).
// Lůžka téhož typu; pokoje i jiného typu s dostatečnou kapacitou. U jiné ceny se ptá přepočítat/ponechat.
function UnitMoveOverlay({ reservationId, onClose, onDone }: { reservationId: string; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<{ unit: "room" | "bed"; candidates: UnitCandidate[] } | null>(null);
  const [priceAsk, setPriceAsk] = useState<UnitCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.unitCandidates(reservationId).then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, [reservationId]);
  const curPrice = data?.candidates.find((c) => c.current)?.pricePerNight ?? null;
  const apply = (unitId: string, reprice?: "recompute" | "keep") => { setBusy(true); setErr(""); api.assignUnit(reservationId, unitId, reprice).then(() => { onDone(); onClose(); }).catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }); };
  return (
    <div className="inv-backdrop">
      <div className="invoice wz" style={{ width: 540 }}>
        <div className="wz-head"><div className="wz-titlerow"><div><h2>{data?.unit === "bed" ? "Změnit lůžko" : "Změnit pokoj"}</h2><div className="muted" style={{ marginTop: 4 }}>{priceAsk ? "Cílový pokoj má jinou cenu — jak naložit s cenou ubytování?" : data?.unit === "bed" ? "Volná lůžka stejného typu v termínu." : "Volné pokoje (i jiného typu) s dostatečnou kapacitou v termínu."}</div></div><button className="linkx" onClick={onClose}>zavřít</button></div></div>
        <div className="wz-body">
          {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
          {priceAsk ? (
            <div>
              <div className="wz-summary" style={{ marginBottom: 18 }}>
                <div className="kv"><span>Nový pokoj</span><b>{priceAsk.label}</b></div>
                <div className="kv"><span>Cena nového pokoje</span><b>{money(priceAsk.pricePerNight ?? 0)}/noc</b></div>
                <div className="kv"><span>Původní cena pokoje</span><b>{money(curPrice ?? 0)}/noc</b></div>
              </div>
              <div className="wz-pay">
                <button className="btn" disabled={busy} onClick={() => apply(priceAsk.id, "recompute")}>Přepočítat cenu na nový pokoj ({money(priceAsk.pricePerNight ?? 0)}/noc)</button>
                <button className="btn ghost" disabled={busy} onClick={() => apply(priceAsk.id, "keep")}>Ponechat původní cenu {(priceAsk.pricePerNight ?? 0) > (curPrice ?? 0) ? "(rozdíl jako sleva)" : ""}</button>
                <button className="linkx" style={{ alignSelf: "flex-start" }} onClick={() => setPriceAsk(null)}>‹ zpět na výběr</button>
              </div>
            </div>
          ) : !data ? <div className="muted">Načítám…</div> : data.candidates.length === 0 ? <div className="muted">Žádné vhodné jednotky.</div> : (
            <div className="wz-list">
              {data.candidates.map((c) => (
                <div key={c.id} className={`wz-pick${c.current ? " sel" : ""}`} style={c.current || c.free ? undefined : { opacity: 0.55, cursor: "default" }}
                  onClick={() => { if (c.current || !c.free || busy) return; if (data.unit === "room" && c.pricePerNight != null && curPrice != null && Math.abs(c.pricePerNight - curPrice) >= 0.01) { setPriceAsk(c); return; } apply(c.id); }}>
                  <div className="pinfo"><div className="pname">{c.label}</div><div className="pmeta">{c.current ? "✓ aktuálně přiřazeno" : c.free ? "volné" : "obsazeno v termínu"}</div></div>
                  {!c.current && c.free && <span className="parrow">Přesunout ›</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Popup z detailu rezervace: přehled odeslaných e-mailů + znovuodeslání.
// Adresář hostů — výběr existujícího klienta (připojení k rezervaci nebo sloučení).
function GuestPickerOverlay({ prefill, onPick, onClose, title = "Adresář hostů", subtitle = "Vyber existujícího klienta — připojí se k této rezervaci (jeho historie a preference se pak zobrazí).", excludeId, actionLabel = "Použít" }: { prefill: string; onPick: (guestId: string) => void; onClose: () => void; title?: string; subtitle?: string; excludeId?: string; actionLabel?: string }) {
  const [q, setQ] = useState(prefill);
  const list = useAsync<GuestListItem[]>(() => api.searchGuests(q), []);
  const rows = (list.data ?? []).filter((g) => g.id !== excludeId);
  // Ruční založení nového hosta (když klient ještě není v adresáři) — stejná sada polí jako adresář.
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState<GuestFields>(blankGuestFields);
  const [busy, setBusy] = useState(false);
  const [nerr, setNerr] = useState("");
  const createPick = async () => {
    if (!nf.firstName.trim() || !nf.lastName.trim()) { setNerr("Vyplň jméno a příjmení."); return; }
    setBusy(true); setNerr("");
    try { const g = await api.createGuestRecord({ firstName: nf.firstName.trim(), lastName: nf.lastName.trim(), email: nf.email.trim() || undefined, phone: nf.phone.trim() || undefined, dateOfBirth: nf.dateOfBirth || undefined, nationality: nf.nationality.trim() || undefined, documentType: nf.documentType || undefined, documentNumber: nf.documentNumber.trim() || undefined, address: nf.address.trim() || undefined }); onPick(g.id); }
    catch (e) { setNerr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="inv-backdrop">
      <div className="invoice wz" style={{ width: 700 }}>
        <div className="wz-head">
          <div className="wz-titlerow">
            <div><h2>{title}</h2><div className="muted" style={{ marginTop: 4 }}>{subtitle}</div></div>
            <button className="linkx" onClick={onClose}>zavřít</button>
          </div>
        </div>
        <div className="wz-body">
          {!adding ? (
            <>
              <div className="row" style={{ gap: 10, marginBottom: 16 }}>
                <input autoFocus placeholder="🔍 Hledat jméno / e-mail / telefon…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && list.reload()} style={{ flex: 1 }} />
                <button className="btn" onClick={() => list.reload()}>Hledat</button>
              </div>
              {list.error && <div className="error" style={{ marginBottom: 12 }}>{list.error}</div>}
              <div className="wz-list">
                {rows.map((g) => (
                  <div key={g.id} className="wz-pick" onClick={() => onPick(g.id)}>
                    <div className="pinfo">
                      <div className="pname">{g.vip ? "⭐ " : ""}{g.firstName} {g.lastName}{g.preferences ? <span title={g.preferences} style={{ marginLeft: 6 }}>📝</span> : null}{g.hasDocument ? <span title="Doklad je v knize hostů — předvyplní se" style={{ marginLeft: 6 }}>📘</span> : null}</div>
                      <div className="pmeta">{g.email ?? "—"}{g.phone ? ` · ${g.phone}` : ""} · {g.stays} {g.stays === 1 ? "pobyt" : g.stays < 5 ? "pobyty" : "pobytů"}{g.hasDocument ? " · doklad v knize" : ""}</div>
                    </div>
                    <span className="parrow">{actionLabel} ›</span>
                  </div>
                ))}
                {list.data && rows.length === 0 && <div className="muted">Nikdo nenalezen.</div>}
              </div>
            </>
          ) : (
            <>
              <div className="wz-sec" style={{ marginTop: 0 }}>Nový host do adresáře</div>
              {nerr && <div className="error" style={{ marginBottom: 12 }}>{nerr}</div>}
              <GuestFieldsForm v={nf} on={(patch) => setNf((s) => ({ ...s, ...patch }))} />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Datum narození, národnost a doklad jsou nepovinné — když je vyplníš, použijí se i pro evidenční knihu / UBYPORT (recepční se k nim nemusí vracet).</div>
            </>
          )}
        </div>
        <div className="wz-foot">
          {!adding ? (
            <>
              <span className="muted" style={{ fontSize: 13 }}>Klient ještě není v adresáři?</span>
              <button className="btn ghost" onClick={() => { setNf({ ...blankGuestFields(), lastName: /\s/.test(prefill) || prefill.includes("@") ? "" : prefill }); setNerr(""); setAdding(true); }}>➕ Zadat nového hosta</button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={() => { setAdding(false); setNerr(""); }}>‹ Zpět na hledání</button>
              <button className="btn" disabled={busy || !nf.firstName.trim() || !nf.lastName.trim()} onClick={createPick}>{busy ? "Zakládám…" : `Založit a ${actionLabel.toLowerCase()}`}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Výběr firmy (odběratele) z centrálního adresáře — z detailu rezervace.
function CompanyPickerOverlay({ onPick, onClose }: { onPick: (companyId: string) => void; onClose: () => void }) {
  const { data } = useAsync<Company[]>(() => api.companies(), []);
  const [q, setQ] = useState("");
  const [nw, setNw] = useState("");
  const [busy, setBusy] = useState(false);
  const list = (data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.ico ?? "").includes(q));
  const createPick = async () => { if (!nw.trim()) return; setBusy(true); try { const c = await api.createCompany({ name: nw.trim() }); onPick(c.id); } finally { setBusy(false); } };
  return (
    <div className="inv-backdrop">
      <div className="invoice wz" style={{ width: 640 }}>
        <div className="wz-head">
          <div className="wz-titlerow">
            <div><h2>Vybrat firmu</h2><div className="muted" style={{ marginTop: 4 }}>Odběratel na dokladech této rezervace.</div></div>
            <button className="linkx" onClick={onClose}>zavřít</button>
          </div>
        </div>
        <div className="wz-body">
          <input className="wz-filter" autoFocus placeholder="🔍 Hledat (název / IČO)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="wz-list">
            {list.map((c) => (
              <div key={c.id} className="wz-pick" onClick={() => onPick(c.id)}>
                <div className="pinfo">
                  <div className="pname">{c.name}{!c.active ? <span className="muted" style={{ fontWeight: 400 }}> · neaktivní</span> : ""}</div>
                  <div className="pmeta">IČO {c.ico ?? "—"}{c.city ? ` · ${c.city}` : ""}</div>
                </div>
                <span className="parrow">Vybrat ›</span>
              </div>
            ))}
            {data && list.length === 0 && <div className="muted">Žádná firma nenalezena.</div>}
          </div>
        </div>
        <div className="wz-foot">
          <span className="muted" style={{ fontSize: 13 }}>Není v seznamu?</span>
          <div className="row" style={{ gap: 10 }}>
            <input placeholder="Nová firma — název" value={nw} onChange={(e) => setNw(e.target.value)} style={{ width: 240 }} />
            <button className="btn" disabled={busy || !nw.trim()} onClick={createPick}>Založit a přiřadit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailsOverlay({ id, guestEmail, onClose }: { id: string; guestEmail: string | null; onClose: () => void }) {
  const { data, error, reload } = useAsync<EmailLog[]>(() => api.reservationEmails(id), [id]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const logs = data ?? [];
  const lastByType = (t: string) => logs.find((l) => l.type === t); // logy jsou desc → první = nejnovější
  const fmt = (s: string) => { const dt = new Date(s); return `${d(s)} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`; };
  const resend = async (type: string) => {
    setBusy(type); setMsg(""); setErr("");
    try { await api.resendEmail(id, type); setMsg(`Odesláno: ${EMAIL_TYPE_LABEL[type] ?? type}`); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };
  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="inv-head">
          <div>
            <h2 style={{ margin: 0 }}>E-maily hostovi</h2>
            <div className="muted" style={{ marginTop: 4 }}>{guestEmail ? <>Adresát: <b>{guestEmail}</b></> : "Host nemá vyplněný e-mail — nelze odesílat."}</div>
          </div>
          <button className="linkx" onClick={onClose}>zavřít</button>
        </div>
        {error && <div className="error">{error}</div>}
        {err && <div className="error">{err}</div>}
        {msg && <div className="error" style={{ background: "#e6f7ee", color: "var(--ok)" }}>{msg}</div>}

        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Typ e-mailu</th><th>Naposledy</th><th>Stav</th><th className="right"></th></tr></thead>
          <tbody>
            {Object.entries(EMAIL_TYPE_LABEL).map(([type, label]) => {
              const last = lastByType(type);
              return (
                <tr key={type}>
                  <td>{label}</td>
                  <td className="muted">{last ? fmt(last.createdAt) : "—"}</td>
                  <td>{last ? <EmailStatus s={last.status} /> : <span className="muted">neodesláno</span>}</td>
                  <td className="right"><button className="btn sm ghost" disabled={!guestEmail || busy === type} onClick={() => resend(type)}>{busy === type ? "Odesílám…" : last ? "Odeslat znovu" : "Odeslat"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {logs.length > 0 && (
          <>
            <h3 style={{ borderTop: "1px solid #e6eaee", marginTop: 18, paddingTop: 14 }}>Historie odeslání ({logs.length})</h3>
            <table>
              <thead><tr><th>Čas</th><th>Typ</th><th>Předmět</th><th>Stav</th></tr></thead>
              <tbody>{logs.map((l) => (
                <tr key={l.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmt(l.createdAt)}</td>
                  <td>{EMAIL_TYPE_LABEL[l.type] ?? l.type}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{l.subject}{l.error ? ` — ${l.error}` : ""}</td>
                  <td><EmailStatus s={l.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </div>
    </div>
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
              <td>{PAY_TYPE_LABEL[p.type] ?? p.type}{p.status !== "succeeded" && <span className="chip">{statusLabel(p.status)}</span>}</td>
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
// ── Číselník typů osob (ceny dle věku) ───────────────────────
function PersonRateRow({ r, onSave, onDelete }: { r: PersonRate; onSave: (id: string, patch: unknown) => void; onDelete: (r: PersonRate) => void }) {
  const [e, setE] = useState({ name: r.name, ageFrom: r.ageFrom?.toString() ?? "", ageTo: r.ageTo?.toString() ?? "", price: parseFloat(r.pricePerNight).toString() });
  const dirty = e.name !== r.name || e.ageFrom !== (r.ageFrom?.toString() ?? "") || e.ageTo !== (r.ageTo?.toString() ?? "") || e.price !== parseFloat(r.pricePerNight).toString();
  return (
    <tr>
      <td><input value={e.name} onChange={(ev) => setE({ ...e, name: ev.target.value })} style={{ width: "100%", minWidth: 140 }} /></td>
      <td><input type="number" value={e.ageFrom} onChange={(ev) => setE({ ...e, ageFrom: ev.target.value })} style={{ width: 70 }} placeholder="—" /></td>
      <td><input type="number" value={e.ageTo} onChange={(ev) => setE({ ...e, ageTo: ev.target.value })} style={{ width: 70 }} placeholder="—" /></td>
      <td><input type="number" value={e.price} onChange={(ev) => setE({ ...e, price: ev.target.value })} style={{ width: 90 }} /></td>
      <td><input type="checkbox" checked={r.active} onChange={(ev) => onSave(r.id, { active: ev.target.checked })} /></td>
      <td className="right" style={{ whiteSpace: "nowrap" }}>
        {dirty && <><button className="btn sm" onClick={() => onSave(r.id, { name: e.name, ageFrom: e.ageFrom === "" ? null : Number(e.ageFrom), ageTo: e.ageTo === "" ? null : Number(e.ageTo), pricePerNight: Number(e.price.replace(",", ".")) || 0 })}>Uložit</button>{" "}</>}
        <button className="btn sm ghost" onClick={() => onDelete(r)} style={{ color: "var(--danger)" }}>✕</button>
      </td>
    </tr>
  );
}

function PersonRatesView({ selId }: { selId: string }) {
  const confirm = useConfirm();
  const { data, reload } = useAsync<PersonRate[]>(() => api.personRates(true), [selId]);
  const [nw, setNw] = useState({ name: "", ageFrom: "", ageTo: "", price: "" });
  const [busy, setBusy] = useState(false);
  const add = async () => { if (!nw.name.trim()) return; setBusy(true); try { await api.createPersonRate({ name: nw.name.trim(), ageFrom: nw.ageFrom === "" ? null : Number(nw.ageFrom), ageTo: nw.ageTo === "" ? null : Number(nw.ageTo), pricePerNight: Number(nw.price.replace(",", ".")) || 0 }); setNw({ name: "", ageFrom: "", ageTo: "", price: "" }); reload(); } finally { setBusy(false); } };
  const save = async (id: string, patch: unknown) => { await api.updatePersonRate(id, patch); reload(); };
  const del = async (r: PersonRate) => { if (await confirm({ title: "Smazat kategorii", message: <>Smazat <b>{r.name}</b>?</>, danger: true, confirmLabel: "Smazat" })) { await api.deletePersonRate(r.id); reload(); } };
  return (
    <>
      <div className="h1"><span>Číselník osob</span> <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· cena za noc dle typu/věku</span></div>
      <div className="panel"><h3>Nová kategorie</h3>
        <div className="toolbar" style={{ padding: 16, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input placeholder="Název (např. Dítě do 10 let)" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} style={{ flex: 1, minWidth: 220 }} />
          <input type="number" placeholder="věk od" value={nw.ageFrom} onChange={(e) => setNw({ ...nw, ageFrom: e.target.value })} style={{ width: 90 }} />
          <input type="number" placeholder="věk do" value={nw.ageTo} onChange={(e) => setNw({ ...nw, ageTo: e.target.value })} style={{ width: 90 }} />
          <input type="number" placeholder="Kč/noc" value={nw.price} onChange={(e) => setNw({ ...nw, price: e.target.value })} style={{ width: 110 }} />
          <button className="btn" disabled={busy} onClick={add}>Přidat</button>
        </div>
        <div className="muted" style={{ padding: "0 16px 16px" }}>Věk od/do je nepovinný. Když ho vyplníš, kategorie se při umístění osoby vybere automaticky podle data narození a doplní cenu.</div>
      </div>
      <div className="panel">
        <Table cols={["Název", "Věk od", "Věk do", "Kč/noc", "Aktivní", ""]} rows={data ?? []} empty="Žádné kategorie" render={(r: PersonRate) => <PersonRateRow key={r.id} r={r} onSave={save} onDelete={del} />} />
      </div>
    </>
  );
}

// ── Ceník sazeb za lůžko/noc (firemní ubytovny) ──────────────
function BedRatesView({ selId }: { selId: string }) {
  const confirm = useConfirm();
  const { data, reload } = useAsync<BedRate[]>(() => api.bedRates(true), [selId]);
  const [nw, setNw] = useState({ name: "", price: "" });
  const [busy, setBusy] = useState(false);
  const add = async () => { if (!nw.name.trim()) return; setBusy(true); try { await api.createBedRate({ name: nw.name.trim(), pricePerNight: Number(nw.price.replace(",", ".")) || 0 }); setNw({ name: "", price: "" }); reload(); } finally { setBusy(false); } };
  const save = (id: string, patch: unknown) => api.updateBedRate(id, patch).then(reload);
  const del = async (r: BedRate) => { if (await confirm({ title: "Smazat sazbu", message: <>Smazat sazbu <b>{r.name}</b>?</>, danger: true, confirmLabel: "Smazat" })) { await api.deleteBedRate(r.id); reload(); } };
  return (
    <>
      <div className="h1"><span>Ceník lůžek</span> <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· sjednané sazby za lůžko/noc (firemní ubytovny)</span></div>
      <div className="panel"><h3>Nová sazba</h3>
        <div className="toolbar" style={{ padding: 16, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input placeholder="Název (např. Standard, Agentura X)" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} style={{ flex: 1, minWidth: 220 }} />
          <input type="number" placeholder="Kč/noc" value={nw.price} onChange={(e) => setNw({ ...nw, price: e.target.value })} style={{ width: 110 }} />
          <button className="btn" disabled={busy} onClick={add}>Přidat</button>
        </div>
        <div className="muted" style={{ padding: "0 16px 16px" }}>Sazbu pak vybereš v detailu lůžkové rezervace (sekce „Dlouhodobé / firemní"); výslednou částku lze ručně přepsat.</div>
      </div>
      <div className="panel">
        <Table cols={["Název", "Kč/noc", "Aktivní", ""]} rows={data ?? []} empty="Žádné sazby" render={(r: BedRate) => (
          <tr key={r.id}>
            <td><input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && save(r.id, { name: e.target.value })} style={{ width: 240 }} /></td>
            <td><input type="number" defaultValue={parseFloat(r.pricePerNight)} onBlur={(e) => save(r.id, { pricePerNight: Number(e.target.value.replace(",", ".")) || 0 })} style={{ width: 100 }} /></td>
            <td><input type="checkbox" checked={r.active} onChange={(e) => save(r.id, { active: e.target.checked })} /></td>
            <td className="right"><button className="btn sm danger" onClick={() => del(r)}>Smazat</button></td>
          </tr>
        )} />
      </div>
    </>
  );
}

// ── Report příchodů/odchodů za období ────────────────────────
function MovementsView({ selId }: { selId: string }) {
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  const { data, error } = useAsync<MovementsReport>(() => api.movements(from, to), [selId, from, to]);
  const kind = (k: string) => k === "occupancy" ? "lůžko" : "rezervace";
  const exportCsv = () => {
    const rows = [
      ["Pohyb", "Datum", "Jméno", "Kde", "Typ", "Firma", "Kód"],
      ...(data?.arrivals ?? []).map((m) => ["Příjezd", d(m.date), m.name, m.where, kind(m.kind), m.companyName ?? "", m.code ?? ""]),
      ...(data?.departures ?? []).map((m) => ["Odjezd", d(m.date), m.name, m.where, kind(m.kind), m.companyName ?? "", m.code ?? ""]),
    ];
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `prijezdy-odjezdy_${from}_${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const tbl = (title: string, items: MoveItem[]) => (
    <div className="panel"><h3>{title} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {items.length}</span></h3>
      <Table cols={["Datum", "Jméno", "Kde", "Typ", "Firma", "Kód"]} rows={items} empty="Žádné" render={(m: MoveItem) => (
        <tr key={`${m.kind}-${m.code ?? m.name}-${m.date}-${m.where}`}>
          <td>{d(m.date)}</td><td>{m.name}</td><td className="muted">{m.where}</td>
          <td className="muted">{kind(m.kind)}</td><td className="muted">{m.companyName ?? "—"}</td><td className="muted">{m.code ?? "—"}</td>
        </tr>
      )} />
    </div>
  );
  return (
    <>
      <div className="h1"><span>Příjezdy / odjezdy</span></div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <label className="muted">Od <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="muted">Do <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn ghost sm" onClick={exportCsv} style={{ marginLeft: "auto" }}>⬇ Export CSV</button>
      </div>
      {tbl("Příjezdy", data?.arrivals ?? [])}
      {tbl("Odjezdy", data?.departures ?? [])}
    </>
  );
}

// ── Vratná kauce (jistota) — sdílený panel pro rezervaci i firmu ──
function DepositsPanel({ reservationId, companyId, suggested }: { reservationId?: string; companyId?: string; suggested?: number }) {
  const confirm = useConfirm();
  const { data, reload } = useAsync<Deposit[]>(() => reservationId ? api.reservationDeposits(reservationId) : api.companyDeposits(companyId!), [reservationId, companyId]);
  const [amt, setAmt] = useState(suggested && suggested > 0 ? String(suggested) : "");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const take = async () => { const a = Number(amt.replace(",", ".")); if (!(a > 0)) { setMsg("Zadej částku."); return; } setBusy(true); setMsg(""); try { await api.createDeposit({ reservationId, companyId, amount: a, method }); setAmt(""); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const ret = async (dp: Deposit) => { const v = prompt("Vrácená částka (prázdné = celá kauce):", dp.amount); if (v === null) return; const ra = v.trim() === "" ? undefined : Number(v.replace(",", ".")); setBusy(true); try { await api.returnDeposit(dp.id, ra != null ? { returnedAmount: ra } : {}); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const forf = async (dp: Deposit) => { if (await confirm({ title: "Zadržet kauci", message: <>Zadržet celou kauci <b>{money(dp.amount)}</b> (propadne — např. škoda)?</>, danger: true, confirmLabel: "Zadržet" })) { setBusy(true); try { await api.forfeitDeposit(dp.id); reload(); } finally { setBusy(false); } } };
  const del = async (dp: Deposit) => { if (await confirm({ title: "Smazat kauci", message: <>Smazat záznam kauce {money(dp.amount)}? (jen oprava chyby)</>, danger: true, confirmLabel: "Smazat" })) { setBusy(true); try { await api.deleteDeposit(dp.id); reload(); } finally { setBusy(false); } } };
  const held = (data ?? []).filter((dp) => dp.status === "held").reduce((s, dp) => s + Number(dp.amount), 0);
  return (
    <div className="panel"><h3>Kauce (jistota) {held > 0 && <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· drženo {money(held)}</span>}</h3>
      <div className="req-actions" style={{ padding: 16, alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted">Přijmout kauci:</span>
        <input type="number" min={0} placeholder="Kč" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ width: 110 }} />
        <select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">hotově</option><option value="card_terminal">kartou</option><option value="invoice">převodem/fakturou</option></select>
        <button className="btn sm" disabled={busy} onClick={take}>Přijmout</button>
        {msg && <span className="error" style={{ padding: "2px 8px" }}>{msg}</span>}
      </div>
      {(data ?? []).length > 0 && (
        <Table cols={["Přijato", "Částka", "Způsob", "Stav", "Vráceno", ""]} rows={data ?? []} empty="—" render={(dp: Deposit) => (
          <tr key={dp.id}>
            <td className="muted">{d(dp.takenAt)}</td>
            <td><b>{money(dp.amount)}</b></td>
            <td className="muted">{PAY_METHOD_LABEL[dp.method] ?? dp.method}</td>
            <td>{dp.status === "held" ? <b style={{ color: "var(--warn)" }}>držena</b> : <span className="muted">{DEPOSIT_STATUS_LABEL[dp.status]}</span>}</td>
            <td className="muted">{dp.returnedAt ? `${dp.returnedAmount != null ? money(dp.returnedAmount) : "—"} · ${d(dp.returnedAt)}` : "—"}</td>
            <td className="right" style={{ whiteSpace: "nowrap" }}>
              {dp.status === "held" && <><button className="btn sm" disabled={busy} onClick={() => ret(dp)}>Vrátit</button>{" "}<button className="btn sm ghost" disabled={busy} onClick={() => forf(dp)} style={{ color: "var(--danger)" }}>Zadržet</button>{" "}</>}
              <button className="btn sm ghost" disabled={busy} onClick={() => del(dp)}>✕</button>
            </td>
          </tr>
        )} />
      )}
    </div>
  );
}

// ── Lůžka (obsazenost z rezervací) ───────────────────────────
function BedBoardView({ selId, prop, embedded }: { selId: string; prop?: Property; embedded?: boolean }) {
  const { data, error, reload } = useAsync<BedBoardItem[]>(() => api.bedBoard(), [selId]);
  const [openBed, setOpenBed] = useState<BedBoardItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{ from?: string; to?: string; roomTypeId?: string; unitId?: string } | null>(null);
  const beds = data ?? [];
  const occupied = beds.filter((b) => b.current).length;
  if (detailId && prop) return <ReservationDetailView id={detailId} prop={prop} onBack={() => { setDetailId(null); reload(); }} />;
  return (
    <>
      {!embedded && <div className="h1"><span>Lůžka</span> <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· obsazenost z rezervací (kdo na kterém lůžku bydlí)</span> <button className="btn ghost sm" onClick={reload}>↻</button></div>}
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ alignItems: "center" }}><span className="muted">Obsazeno {occupied} / {beds.length} lůžek</span><span style={{ flex: 1 }} />{prop && <button className="btn" onClick={() => setWizard({})}>✨ Nová rezervace</button>}</div>
      <div className="panel">
        <Table cols={["Lůžko", "Pokoj", "Aktuální obyvatel", "Firma", "Do", "Další", ""]} rows={beds} empty="Žádná lůžka (provozovna nemá jednotku = lůžko)" render={(b: BedBoardItem) => (
          <tr key={b.bedId} className="row-click" onClick={() => setOpenBed(b)}>
            <td><b>{b.label}</b></td>
            <td className="muted">{b.roomNumber} · {b.floor}.p</td>
            <td>{b.current ? <>👤 {b.current.guestName}</> : <span className="muted">volné</span>}</td>
            <td className="muted">{b.current?.companyName ?? "—"}</td>
            <td className="muted">{b.current ? d(b.current.toDate) : "—"}</td>
            <td className="muted">{b.upcoming > 0 ? `${b.upcoming}× (od ${d(b.nextFrom!)})` : "—"}</td>
            <td className="right"><button className="btn sm ghost">Spravovat</button></td>
          </tr>
        )} />
      </div>
      {openBed && <BedReservationsOverlay bed={openBed} onClose={() => { setOpenBed(null); reload(); }} onDetail={(rid) => { setOpenBed(null); setDetailId(rid); }} onNew={() => { const b = openBed; setOpenBed(null); setWizard({ roomTypeId: b.roomTypeId, unitId: b.bedId }); }} />}
      {wizard && prop && <NewReservationWizard prop={prop} prefill={wizard} onClose={() => setWizard(null)} onCreated={() => { setWizard(null); reload(); }} onOpenDetail={(rid) => { setWizard(null); setDetailId(rid); }} />}
    </>
  );
}

function BedReservationsOverlay({ bed, onClose, onDetail, onNew }: { bed: BedBoardItem; onClose: () => void; onDetail: (rid: string) => void; onNew: () => void }) {
  const { data } = useAsync<BedReservationsData>(() => api.bedReservations(bed.bedId), [bed.bedId]);
  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="invoice wz" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="wz-head"><div className="wz-titlerow"><div><h2>Lůžko {bed.label}</h2><div className="muted" style={{ marginTop: 4 }}>Pokoj {bed.roomNumber} · rezervace na tomto lůžku</div></div><button className="linkx" onClick={onClose}>zavřít</button></div></div>
        <div className="wz-body">
          {!data ? <div className="muted">Načítám…</div> : data.items.length === 0 ? <div className="muted">Žádné rezervace na tomto lůžku.</div> : (
            <div className="wz-list">
              {data.items.map((r) => (
                <div key={r.id} className="wz-pick" onClick={() => onDetail(r.id)}>
                  <div className="pinfo"><div className="pname">{r.guestName}{r.companyName ? <span className="muted" style={{ fontWeight: 400 }}> · {r.companyName}</span> : ""}</div><div className="pmeta">{d(r.fromDate)} → {d(r.toDate)} · {statusLabel(r.status)} · {r.code}</div></div>
                  <span className="parrow">Detail ›</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="wz-foot"><span className="muted" style={{ fontSize: 13 }}>Nový dlouhodobý/krátkodobý pobyt na tomto lůžku:</span><button className="btn" onClick={onNew}>✨ Nová rezervace na lůžko</button></div>
      </div>
    </div>
  );
}

// ── Firmy (centrální adresář odběratelů) ─────────────────────
function CompaniesView({ selId }: { selId: string }) {
  const { data, error, reload } = useAsync<Company[]>(() => api.companies(), [selId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const emptyNw = { ico: "", name: "", dic: "", account: "", street: "", city: "", zip: "", country: "CZ", email: "", phone: "", vatPayer: false };
  const [nw, setNw] = useState(emptyNw);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");

  const lookup = async () => {
    if (!nw.ico.trim()) return;
    setLookupBusy(true); setLookupMsg("");
    try {
      const a: AresResult = await api.companyLookup(nw.ico);
      setNw({ ...nw, name: a.name ?? nw.name, dic: a.dic ?? "", account: a.account ?? "", street: a.street ?? "", city: a.city ?? "", zip: a.zip ?? "", country: a.country ?? "CZ", vatPayer: a.vatPayer });
      setLookupMsg(`✓ ${a.name ?? "?"}` + (a.viesValid === true ? " · plátce DPH (VIES ✓)" : a.viesValid === false ? " · DIČ neplatné ve VIES" : a.dic ? ` · DIČ ${a.dic}` : " · neplátce DPH") + (a.account ? ` · účet ${a.account}` : ""));
    } catch (e) { setLookupMsg(e instanceof Error ? e.message : String(e)); } finally { setLookupBusy(false); }
  };
  const add = async () => { if (!nw.name.trim()) return; const c = await api.createCompany(nw); setNw(emptyNw); setLookupMsg(""); setAdding(false); reload(); setOpenId(c.id); };
  if (openId) return <CompanyDetailView id={openId} selId={selId} onBack={() => { setOpenId(null); reload(); }} />;
  const list = (data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.ico ?? "").includes(q));
  return (
    <>
      <div className="h1"><span>Firmy</span> <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· centrální adresář odběratelů</span></div>
      {error && <div className="error">{error}</div>}
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
        <input placeholder="Hledat (název / IČO)" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <button className="btn" onClick={() => setAdding((a) => !a)}>+ Nová firma</button>
      </div>
      {adding && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 style={{ border: "none", padding: 0, marginBottom: 4 }}>Nová firma</h3>
          <div className="muted" style={{ marginBottom: 14 }}>Zadej IČO a načti údaje z ARES (název, adresa, DIČ, plátce DPH dle VIES), nebo vyplň ručně.</div>

          <FormSection title="Načtení z rejstříku (ARES)">
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input style={{ ...fullInput, maxWidth: 200 }} placeholder="IČO" value={nw.ico} onChange={(e) => setNw({ ...nw, ico: e.target.value })} onKeyDown={(e) => e.key === "Enter" && lookup()} />
              <button className="btn" disabled={lookupBusy || !nw.ico.trim()} onClick={lookup}>{lookupBusy ? "Načítám…" : "🔍 Načíst z ARES"}</button>
              {lookupMsg && <span className="muted" style={{ flex: 1, minWidth: 200 }}>{lookupMsg}</span>}
            </div>
          </FormSection>

          <FormSection title="Údaje firmy">
            <FormGrid min={200}>
              <FieldCol label="Název" span={2}><input style={fullInput} value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} /></FieldCol>
              <FieldCol label="IČO"><input style={fullInput} value={nw.ico} onChange={(e) => setNw({ ...nw, ico: e.target.value })} /></FieldCol>
              <FieldCol label="DIČ"><input style={fullInput} value={nw.dic} onChange={(e) => setNw({ ...nw, dic: e.target.value })} /></FieldCol>
              <FieldCol label="Číslo účtu" span={2}><input style={fullInput} value={nw.account} onChange={(e) => setNw({ ...nw, account: e.target.value })} /></FieldCol>
              <FieldCol label="Ulice" span={2}><input style={fullInput} value={nw.street} onChange={(e) => setNw({ ...nw, street: e.target.value })} /></FieldCol>
              <FieldCol label="Město"><input style={fullInput} value={nw.city} onChange={(e) => setNw({ ...nw, city: e.target.value })} /></FieldCol>
              <FieldCol label="PSČ"><input style={fullInput} value={nw.zip} onChange={(e) => setNw({ ...nw, zip: e.target.value })} /></FieldCol>
              <FieldCol label="Země"><input style={fullInput} value={nw.country} onChange={(e) => setNw({ ...nw, country: e.target.value })} /></FieldCol>
              <FieldCol label="E-mail"><input style={fullInput} value={nw.email} onChange={(e) => setNw({ ...nw, email: e.target.value })} /></FieldCol>
              <FieldCol label="Telefon"><input style={fullInput} value={nw.phone} onChange={(e) => setNw({ ...nw, phone: e.target.value })} /></FieldCol>
            </FormGrid>
            <div style={{ marginTop: 12 }}><Chk label="Plátce DPH" checked={nw.vatPayer} onChange={(v) => setNw({ ...nw, vatPayer: v })} /></div>
          </FormSection>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" disabled={!nw.name.trim()} onClick={add}>Založit firmu</button>
            <button className="btn ghost" onClick={() => { setAdding(false); setNw(emptyNw); setLookupMsg(""); }}>Zrušit</button>
          </div>
        </div>
      )}
      <div className="panel">
        <Table cols={["Firma", "IČO", "Kontakt", ""]} rows={list} empty="Žádné firmy" render={(c: Company) => (
          <tr key={c.id} className="row-click" onClick={() => setOpenId(c.id)}>
            <td><b>{c.name}</b>{!c.active && <span className="muted"> · neaktivní</span>}</td>
            <td className="muted">{c.ico ?? "—"}</td>
            <td className="muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</td>
            <td className="right"><button className="btn sm ghost">Detail</button></td>
          </tr>
        )} />
      </div>
    </>
  );
}

function CompanyDetailView({ id, selId, onBack }: { id: string; selId: string; onBack: () => void }) {
  const confirm = useConfirm();
  const { data, error, reload } = useAsync<CompanyDetail>(() => api.company(id), [id]);
  type CEf = { name: string; ico: string; dic: string; account: string; street: string; city: string; zip: string; country: string; email: string; phone: string; note: string; vatPayer: boolean; active: boolean };
  const [ef, setEf] = useState<CEf | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => { if (data) setEf({ name: data.name, ico: data.ico ?? "", dic: data.dic ?? "", account: data.account ?? "", street: data.street ?? "", city: data.city ?? "", zip: data.zip ?? "", country: data.country ?? "CZ", email: data.email ?? "", phone: data.phone ?? "", note: data.note ?? "", vatPayer: data.vatPayer, active: data.active }); }, [data?.id]); // eslint-disable-line
  const aresFill = async () => { if (!ef?.ico.trim()) return; setBusy(true); setMsg(""); try { const a: AresResult = await api.companyLookup(ef.ico); setEf({ ...ef, name: a.name ?? ef.name, dic: a.dic ?? ef.dic, account: a.account ?? ef.account, street: a.street ?? ef.street, city: a.city ?? ef.city, zip: a.zip ?? ef.zip, country: a.country ?? ef.country, vatPayer: a.vatPayer }); setMsg("Načteno z ARES — zkontroluj a ulož." + (a.account ? ` Účet: ${a.account}.` : "")); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  const save = async () => { if (!ef) return; setBusy(true); setMsg(""); try { await api.updateCompany(id, ef); setMsg("Uloženo."); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const del = async () => { if (await confirm({ title: "Smazat firmu", message: <>Smazat firmu <b>{data?.name}</b>? Rezervace zůstanou, jen se od firmy odpojí.</>, danger: true, confirmLabel: "Smazat" })) { await api.deleteCompany(id); onBack(); } };
  const billable = (data?.reservations ?? []).filter((r) => r.propertyId === selId);
  const selectedIds = billable.filter((r) => sel[r.id]).map((r) => r.id);
  const invoice = async () => {
    if (!selectedIds.length) return;
    if (await confirm({ title: "Souhrnná faktura", message: <>Vystavit jednu fakturu za <b>{selectedIds.length}</b> rezervací firmě <b>{data?.name}</b>?</>, confirmLabel: "Vystavit" })) {
      setBusy(true); try { const dc = await api.companyInvoice(id, selectedIds); setDoc(dc); setSel({}); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }
  };

  if (error) return <><div className="h1"><button className="btn ghost" onClick={onBack}>← Zpět</button></div><div className="error">{error}</div></>;
  if (!data || !ef) return <div className="muted" style={{ padding: 20 }}>Načítám…</div>;
  return (
    <>
      <div className="h1"><span><button className="btn ghost" onClick={onBack}>← Zpět</button>&nbsp;&nbsp;{data.name}</span></div>
      {msg && <div className="error" style={/uložen|vystaven/i.test(msg) ? { background: "#e6f7ee", color: "var(--ok)" } : undefined}>{msg}</div>}

      <div className="panel" style={{ padding: 18 }}>
        <FormSection title="Údaje firmy">
          <FormGrid min={200}>
            <FieldCol label="Název" span={2}><input style={fullInput} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></FieldCol>
            <FieldCol label="IČO"><input style={fullInput} value={ef.ico} onChange={(e) => setEf({ ...ef, ico: e.target.value })} /></FieldCol>
            <FieldCol label="DIČ"><input style={fullInput} value={ef.dic} onChange={(e) => setEf({ ...ef, dic: e.target.value })} /></FieldCol>
            <FieldCol label="Číslo účtu"><input style={fullInput} value={ef.account} onChange={(e) => setEf({ ...ef, account: e.target.value })} /></FieldCol>
            <FieldCol label="Ulice" span={2}><input style={fullInput} value={ef.street} onChange={(e) => setEf({ ...ef, street: e.target.value })} /></FieldCol>
            <FieldCol label="Město"><input style={fullInput} value={ef.city} onChange={(e) => setEf({ ...ef, city: e.target.value })} /></FieldCol>
            <FieldCol label="PSČ"><input style={fullInput} value={ef.zip} onChange={(e) => setEf({ ...ef, zip: e.target.value })} /></FieldCol>
            <FieldCol label="Země"><input style={fullInput} value={ef.country} onChange={(e) => setEf({ ...ef, country: e.target.value })} /></FieldCol>
            <FieldCol label="E-mail"><input style={fullInput} value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} /></FieldCol>
            <FieldCol label="Telefon"><input style={fullInput} value={ef.phone} onChange={(e) => setEf({ ...ef, phone: e.target.value })} /></FieldCol>
          </FormGrid>
          <div style={{ marginTop: 12 }}><FieldCol label="Poznámka"><textarea style={{ ...fullInput, minHeight: 60, resize: "vertical" }} value={ef.note} onChange={(e) => setEf({ ...ef, note: e.target.value })} /></FieldCol></div>
          <div style={{ marginTop: 12, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <Chk label="Plátce DPH" checked={ef.vatPayer} onChange={(v) => setEf({ ...ef, vatPayer: v })} />
            <Chk label="Aktivní" checked={ef.active} onChange={(v) => setEf({ ...ef, active: v })} />
            <button className="btn ghost sm" disabled={busy || !ef.ico.trim()} onClick={aresFill} style={{ marginLeft: "auto" }}>🔍 Načíst z ARES (dle IČO)</button>
          </div>
        </FormSection>
        <div className="toolbar" style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy} onClick={save}>Uložit</button>
          <button className="btn ghost" disabled={busy} onClick={del} style={{ marginLeft: "auto", color: "var(--danger)" }}>Smazat firmu</button>
        </div>
      </div>

      <div className="panel"><h3>Pobyty firmy <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· zůstatek celkem {money(data.totalBalance)}</span></h3>
        {data.reservations.length === 0 ? <div className="muted" style={{ padding: 16 }}>Žádné pobyty.</div> :
          <Table cols={["", "Kód", "Provozovna", "Host", "Termín", "Stav", "Zůstatek"]} rows={data.reservations} empty="—" render={(r: CompanyResItem) => {
            const here = r.propertyId === selId;
            return (
              <tr key={r.id}>
                <td>{here ? <input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} /> : <span className="muted" title="jiná provozovna">·</span>}</td>
                <td className="muted">{r.code}</td><td className="muted">{r.propertyName}</td><td>{r.guestName}</td>
                <td>{d(r.checkInDate)} → {d(r.checkOutDate)}</td><td><Badge s={r.status} /></td>
                <td>{Number(r.balance) > 0 ? <b style={{ color: "var(--warn)" }}>{money(r.balance)}</b> : <span className="muted">{money(r.balance)}</span>}</td>
              </tr>
            );
          }} />}
        <div className="toolbar" style={{ padding: 16 }}>
          <span className="muted">Zaškrtni pobyty této provozovny a vystav jednu společnou fakturu.</span>
          <button className="btn" disabled={busy || !selectedIds.length} onClick={invoice} style={{ marginLeft: "auto" }}>Vystavit souhrnnou fakturu ({selectedIds.length})</button>
        </div>
      </div>


      <DepositsPanel companyId={id} />

      {doc && <DocumentOverlay doc={doc} onClose={() => setDoc(null)} />}
    </>
  );
}

function DocumentsView({ selId }: { selId: string }) {
  const confirm = useConfirm();
  const [type, setType] = useState("");
  const { data, error, reload } = useAsync<Doc[]>(() => api.documents(type ? `?type=${type}` : ""), [selId, type]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const open = async (id: string) => { try { setDoc(await api.document(id)); } catch { /* */ } };
  const cancel = async (id: string) => { if (!(await confirm({ title: "Stornovat doklad", message: "Opravdu stornovat tento doklad?", confirmLabel: "Stornovat", danger: true }))) return; await api.cancelDocument(id); reload(); };
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

function DocumentOverlay({ doc, onClose, preview, onIssue }: { doc: Doc; onClose: () => void; preview?: boolean; onIssue?: () => Promise<Doc> }) {
  const confirm = useConfirm();
  const [cur, setCur] = useState<Doc>(doc);
  const [isPreview, setIsPreview] = useState(!!preview);
  const [busy, setBusy] = useState(false);
  const [perr, setPerr] = useState("");
  const [qrImg, setQrImg] = useState("");
  const issue = async () => { if (!onIssue) return; setBusy(true); setPerr(""); try { setCur(await onIssue()); setIsPreview(false); } catch (e) { setPerr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  useEffect(() => { if (cur.qrPayment) QRCode.toDataURL(cur.qrPayment, { margin: 1, width: 150 }).then(setQrImg).catch(() => setQrImg("")); else setQrImg(""); }, [cur.qrPayment]);
  const due = parseFloat(cur.total) - parseFloat(cur.paidTotal);
  const pay = async (method: "cash" | "card_terminal") => {
    if (!(await confirm({ title: "Zaplacení dokladu", message: <>Označit doklad jako zaplacený <b>{method === "cash" ? "hotově" : "kartou"}</b> ({money(due)})?</>, confirmLabel: "Zaplaceno" }))) return;
    if (method === "cash" && !(await ensureCashOpen(confirm))) return;
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
            <div className="muted" style={{ marginTop: 2 }}>{isPreview ? <b style={{ color: "var(--warn)" }}>NÁHLED — zatím nevystaveno</b> : <>č. {cur.number}{cur.status === "cancelled" ? " · STORNO" : cur.status === "paid" ? " · ZAPLACENO" : ""}</>}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              <b>{cur.supplierName}</b><br />
              {cur.supplierAddress}
              {(cur.supplierIco || cur.supplierDic) && <><br />{cur.supplierIco ? `IČO: ${cur.supplierIco}` : ""}{cur.supplierIco && cur.supplierDic ? " · " : ""}{cur.supplierDic ? `DIČ: ${cur.supplierDic}` : ""}</>}
              {cur.supplierAccount && <><br />Účet: {cur.supplierAccount}</>}
              {cur.supplierRegistration && <><br />{cur.supplierRegistration}</>}
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
          {isPreview ? <>
            <button className="btn ok" disabled={busy} onClick={issue}>✅ Vystavit doklad</button>
            <button className="btn ghost" disabled={busy} onClick={onClose}>Zrušit</button>
          </> : <>
            {due > 0.005 && cur.status !== "cancelled" && <>
              <button className="btn ok" disabled={busy} onClick={() => pay("cash")}>💵 Zaplatit hotově</button>
              <button className="btn" disabled={busy} onClick={() => pay("card_terminal")}>💳 Zaplatit kartou</button>
            </>}
            {cur.type === "proforma" && <button className="btn ghost" disabled={busy} onClick={() => act(() => api.advanceTaxDoc(cur.id))}>Daňový doklad k záloze</button>}
            {cur.type !== "credit_note" && cur.status !== "cancelled" && <button className="btn ghost" disabled={busy} onClick={() => { const r = prompt("Důvod dobropisu (nepovinné):") ?? undefined; act(() => api.creditNote(cur.id, r)); }}>Dobropis</button>}
            <button className="btn ghost" onClick={() => window.print()}>🖨 Tisk</button>
            <button className="btn ghost" onClick={onClose}>Zavřít</button>
          </>}
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
    const loc = f.roomId; // "" = sklad provozovny · "central" = centrální sklad · jinak roomId
    await api.createEquipment({ name: f.name, categoryId: f.categoryId || null, code: f.code || undefined, serialNumber: f.serialNumber || undefined, acquiredAt: f.acquiredAt || undefined, quantity: Number(f.quantity) || 1, central: loc === "central", roomId: loc && loc !== "central" ? loc : null });
    setF({ name: "", categoryId: "", code: "", serialNumber: "", acquiredAt: "", quantity: 1, roomId: "" }); refresh();
  };
  const moveOptions: MoveOpt[] = [{ value: "", label: "Sklad provozovny" }, { value: "central", label: "Centrální sklad" }, ...(rooms.data ?? []).map((r) => ({ value: r.id, label: `Pokoj ${r.number}` }))];
  const moveBody = (v: string) => ({ central: v === "central", roomId: v && v !== "central" ? v : null });
  const ids = [...sel];

  return (
    <>
      <div className="h1">Vybavení (DHIM)</div>
      {error && <div className="error">{error}</div>}
      <EquipStats items={items} centralSeparate />

      <div className="panel"><h3>Nový kus</h3>
        <div className="toolbar" style={{ padding: 16 }}>
          <input placeholder="Název" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Kategorie…</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input placeholder="Kód (prázdné = auto)" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <input placeholder="Sériové č." value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} />
          <select value={f.roomId} onChange={(e) => setF({ ...f, roomId: e.target.value })}><option value="">Sklad provozovny</option><option value="central">Centrální sklad</option>{(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>Pokoj {r.number}</option>)}</select>
          <label className="row">Pořízeno <input type="date" value={f.acquiredAt} onChange={(e) => setF({ ...f, acquiredAt: e.target.value })} /></label>
          <label className="row">Počet <input type="number" min={1} max={500} style={{ width: 70 }} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></label>
          <button className="btn" onClick={add}>+ Přidat</button>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="panel bulkbar"><div className="toolbar" style={{ padding: 14 }}>
          <b>{sel.size} vybráno:</b>
          <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>{moveOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <button className="btn sm ok" onClick={async () => { await apiBulk("/admin/equipment/bulk-move", { ids, ...moveBody(bulkTarget) }); refresh(); }}>Přesunout</button>
          <button className="btn sm" onClick={async () => { const r = prompt("Důvod vyřazení:") ?? ""; await apiBulk("/admin/equipment/bulk-retire", { ids, retiredReason: r }); refresh(); }}>Vyřadit</button>
          <button className="btn sm ghost" onClick={() => setLabels(items.filter((e) => sel.has(e.id)))}>🏷 QR štítky</button>
          <button className="btn sm danger" onClick={async () => { if (confirm(`Smazat ${sel.size} kusů?`)) { await apiBulk("/admin/equipment/bulk-delete", { ids }); refresh(); } }}>Smazat</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Zrušit výběr</button>
        </div></div>
      )}

      <div className="panel">
        <div className="toolbar" style={{ padding: "10px 16px", justifyContent: "flex-end" }}><button className="btn sm ghost" onClick={() => setLabels(items)}>🏷 QR štítky všech ({items.length})</button></div>
        <EquipTable items={items} sel={sel} setSel={setSel} onDetail={setDetail} location={(e) => e.room ? `pokoj ${e.room.number}` : (e.propertyId ? "sklad provozovny" : "Centrální sklad")}
          onTake={async (e) => { await api.moveEquipment(e.id, { central: false, roomId: null, note: "převzato z centrálního skladu" }); refresh(); }} />
      </div>

      {detail && <EquipmentDetail item={detail} categories={cats.data ?? []} moveOptions={moveOptions} currentMove={detail.room ? (detail.roomId ?? "") : (detail.propertyId ? "" : "central")}
        onUpdate={(b) => api.updateEquipment(detail.id, b)} onMove={(v, note) => api.moveEquipment(detail.id, { ...moveBody(v), note })}
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
function EquipTable({ items, sel, setSel, onDetail, location, onTake }: { items: Equipment[]; sel: Set<string>; setSel: (s: Set<string>) => void; onDetail: (e: Equipment) => void; location: (e: Equipment) => string; onTake?: (e: Equipment) => void }) {
  if (!items.length) return <div className="empty">Žádné vybavení</div>;
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const allOn = items.every((e) => sel.has(e.id));
  return (
    <table>
      <thead><tr>
        <th style={{ width: 36 }}><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(items.map((e) => e.id)))} /></th>
        <th>Kód</th><th>Název</th><th>Kategorie</th><th>Umístění</th><th>Stav</th><th className="right"></th>
      </tr></thead>
      <tbody>{items.map((e) => {
        const central = !e.propertyId && !e.roomId;
        return (
        <tr key={e.id} className={central && onTake ? "row-central" : ""}>
          <td><input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} /></td>
          <td className="muted">{e.code}</td>
          <td><b>{e.name}</b>{e.serialNumber && <div className="muted">SN {e.serialNumber}</div>}</td>
          <td>{e.category?.name ?? "—"}</td>
          <td>{location(e)}{central && onTake && <span className="chip-central">sdílené</span>}</td>
          <td><Badge s={e.condition} /></td>
          <td className="right">
            {central && onTake && <button className="btn sm ok" onClick={() => onTake(e)}>Převzít</button>}{" "}
            <button className="btn sm" onClick={() => onDetail(e)}>Detail</button>
          </td>
        </tr>
        );
      })}</tbody>
    </table>
  );
}

// Statistika počtů. Při `centralSeparate` se kusy na centrálním skladu
// nezapočítají do počtů provozovny a dostanou vlastní kolonku.
function EquipStats({ items, centralSeparate }: { items: Equipment[]; centralSeparate?: boolean }) {
  const isCentral = (e: Equipment) => !e.propertyId && !e.roomId;
  const own = centralSeparate ? items.filter((e) => !isCentral(e)) : items;
  const centralCount = items.filter(isCentral).length;
  const c = (p: (e: Equipment) => boolean) => own.filter(p).length;
  return (
    <div className="stats">
      <div className="stat"><div className="n">{own.length}</div><div className="l">Kusů celkem</div></div>
      <div className="stat"><div className="n">{c((e) => e.condition === "ok")}</div><div className="l">V pořádku</div></div>
      <div className="stat warn"><div className="n">{c((e) => e.condition === "damaged")}</div><div className="l">Poškozeno</div></div>
      <div className="stat"><div className="n">{c((e) => e.condition === "retired")}</div><div className="l">Vyřazeno</div></div>
      <div className="stat"><div className="n">{c((e) => !!e.roomId)}</div><div className="l">V pokojích</div></div>
      {centralSeparate && <div className="stat"><div className="n">{centralCount}</div><div className="l">Centrální sklad</div></div>}
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
      <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Všechny stavy</option>{["open", "in_progress", "done", "cancelled"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></div>
      <div className="panel">
        <Table cols={["Typ", "Fronta", "Pokoj", "Host", "Popis", "Stav", ""]} rows={data ?? []} empty="Žádné požadavky"
          render={(r: ServiceRequest) => (
            <tr key={r.id}>
              <td>{SERVICE_ICON[r.type]} {SERVICE_LABEL[r.type]}{r.fromGuest && <span className="chip">host</span>}</td>
              <td className="muted">{r.domain === "maintenance" ? "údržba" : "úklid"}</td>
              <td>{r.room?.number ?? "—"}</td>
              <td>{r.reservation?.primaryGuest ? `${r.reservation.primaryGuest.firstName} ${r.reservation.primaryGuest.lastName}` : "—"}</td>
              <td>{r.description ?? "—"}{r.imageUrls && r.imageUrls.length > 0 && <div className="req-photos">{r.imageUrls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="foto" /></a>)}</div>}</td>
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
              <td>{taskIcon(i.type, i.description)} {SERVICE_LABEL[i.type]}{isDailyTask(i.type, i.description) && <> <span className="chip chip-daily">denní</span></>}{i.fromGuest && <> <span className="chip">host</span></>}{i.status === "in_progress" && <> <span className="chip">probíhá</span></>}</td>
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
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result as string); fr.onerror = reject; fr.readAsDataURL(file); });
}
// Náhledy fotek + tlačítko na pořízení/výběr fotky (z telefonu personálu).
function PhotoStrip({ urls, onUpload, busy }: { urls?: string[]; onUpload: (dataUrls: string[]) => void; busy?: boolean }) {
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 5);
    if (files.length) onUpload(await Promise.all(files.map(fileToDataUrl)));
    e.target.value = "";
  };
  return (
    <div className="req-photos">
      {(urls ?? []).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="foto" /></a>)}
      <label className="btn sm ghost photo-btn">{busy ? "…" : "📷 Foto"}<input type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={pick} /></label>
    </div>
  );
}

// Naúčtování položky z ceníku (praní/žehlení/minibar) na účet hosta z požadavku.
const BILLABLE = ["laundry", "ironing", "minibar", "other"];
// Typ úkolu → kategorie ceníku (žehlení nabídne jen žehlení atd.). „other" = vše.
const CAT_FOR_TYPE: Record<string, string> = { laundry: "laundry", ironing: "ironing", minibar: "minibar" };
function BillRequest({ reqId, type, items, onDone }: { reqId: string; type: string; items: ServiceItem[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [markDone, setMarkDone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cat = CAT_FOR_TYPE[type];
  const inCat = items.filter((i) => i.active && (!cat || i.category === cat));
  const act = inCat.length ? inCat : items.filter((i) => i.active); // fallback: když v kategorii nic není, ukaž vše
  const submit = async () => {
    if (!itemId) { setErr("Vyber položku."); return; }
    setBusy(true); setErr("");
    try { await api.staffChargeRequest(reqId, { serviceItemId: itemId, quantity: Number(qty.replace(",", ".")) || 1, markDone }); setOpen(false); setItemId(""); setQty("1"); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Nepodařilo se naúčtovat."); }
    finally { setBusy(false); }
  };
  if (!open) return <button className="btn sm ghost" onClick={() => setOpen(true)}>💵 Naúčtovat</button>;
  return (
    <div className="bill-box">
      <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
        <option value="">{act.length ? "Položka ceníku…" : "Ceník je prázdný"}</option>
        {act.map((i) => <option key={i.id} value={i.id}>{i.name} — {money(i.price)}</option>)}
      </select>
      <input type="number" min={1} style={{ width: 56 }} value={qty} onChange={(e) => setQty(e.target.value)} title="počet" />
      <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} /> a označit hotové</label>
      <button className="btn sm" disabled={busy} onClick={submit}>Naúčtovat</button>
      <button className="btn sm ghost" onClick={() => { setOpen(false); setErr(""); }}>✕</button>
      {err && <span className="muted" style={{ color: "var(--danger)" }}>{err}</span>}
    </div>
  );
}

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
  const priceList = useAsync<ServiceItem[]>(() => isHK ? api.staffServiceItems() : Promise.resolve([] as ServiceItem[]), [selId]);
  const [showAdd, setShowAdd] = useState(false);
  const [nd, setNd] = useState("");
  const [ndPhotos, setNdPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState("");
  const [brief, setBrief] = useState(""); const [briefing, setBriefing] = useState(false);

  const reloadAll = () => { reload(); plan.reload(); mplan.reload(); };
  const act = async (id: string, st: string) => {
    let note: string | undefined;
    if (st === "done") {
      const r = prompt("Poznámka (nepovinné):");
      if (r === null) return; // Zrušit → úkol NEoznačovat hotový
      note = r || undefined;
    }
    await api.staffSetStatus(id, { status: st, note });
    reloadAll();
  };
  const addPhotos = async (id: string, dataUrls: string[]) => { setPhotoBusy(id); try { await api.staffRequestPhotos(id, dataUrls); reloadAll(); } catch (e) { alert(e instanceof Error ? e.message : "Foto se nepodařilo nahrát."); } finally { setPhotoBusy(""); } };
  const setDnd = async (reservationId: string, on: boolean) => { try { await api.staffSetDnd(reservationId, on); reloadAll(); } catch (e) { alert(e instanceof Error ? e.message : "Nepodařilo se uložit."); } };
  const addMaint = async () => {
    if (!nd.trim()) return;
    const r = await api.staffCreateRequest({ type: "maintenance", description: nd });
    if (ndPhotos.length) await api.staffRequestPhotos(r.id, ndPhotos).catch(() => {});
    setNd(""); setNdPhotos([]); setShowAdd(false); reloadAll();
  };
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
      {showAdd && (
        <div className="staff-add" style={{ flexWrap: "wrap", gap: 8 }}>
          <input placeholder="Popis závady…" value={nd} onChange={(e) => setNd(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <label className="btn ghost">📷 Foto {ndPhotos.length ? `(${ndPhotos.length})` : ""}<input type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={async (e) => { const fs = Array.from(e.target.files ?? []).slice(0, 5); if (fs.length) setNdPhotos(await Promise.all(fs.map(fileToDataUrl))); e.target.value = ""; }} /></label>
          <button className="btn" onClick={addMaint}>Odeslat údržbě</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {status === "plan" ? (
        isMaint ? (
          <MaintCards plan={mplan.data} onStart={(id) => act(id, "in_progress")} onDone={(id) => act(id, "done")}
            brief={brief} briefing={briefing} onBrief={aiBrief} onReload={reloadAll} onPhoto={addPhotos} photoBusy={photoBusy} />
        ) : (
          <PlanCards plan={plan.data} onStart={(id) => act(id, "in_progress")} onDone={(id) => act(id, "done")}
            brief={brief} briefing={briefing} onBrief={aiBrief} onReload={reloadAll} items={priceList.data ?? []} onPhoto={addPhotos} photoBusy={photoBusy} onDnd={setDnd} />
        )
      ) : (
      <div className="staff-list">
        {items.length === 0 ? <div className="empty">Žádné požadavky</div> : items.map((r) => (
          <div key={r.id} className={`req-card s-${r.status}`}>
            <div className="req-top"><span className="req-type">{taskIcon(r.type, r.description)} {SERVICE_LABEL[r.type]}{isDailyTask(r.type, r.description) && <> <span className="chip chip-daily">denní</span></>}</span><Badge s={r.status} /></div>
            <div className="req-loc">{r.room ? `Pokoj ${r.room.number}` : "—"}{r.fromGuest && r.reservation?.primaryGuest ? ` · ${r.reservation.primaryGuest.firstName} ${r.reservation.primaryGuest.lastName}` : ""}</div>
            {r.description && <div className="req-desc">{r.description}</div>}
            {r.status === "done" || r.status === "cancelled" ? (
              <div className="muted">Hotovo {r.resolvedAt?.slice(0, 16).replace("T", " ")}{r.resolvedBy ? ` · ${r.resolvedBy.name}` : ""}{r.note ? ` · ${r.note}` : ""}</div>
            ) : (
              <div className="req-actions">
                {r.status === "open" && <button className="btn sm" onClick={() => act(r.id, "in_progress")}>Začít</button>}
                <button className="btn sm ok" onClick={() => act(r.id, "done")}>Hotovo</button>
                {isHK && BILLABLE.includes(r.type) && <BillRequest reqId={r.id} type={r.type} items={priceList.data ?? []} onDone={reloadAll} />}
              </div>
            )}
            <PhotoStrip urls={r.imageUrls} onUpload={(d) => addPhotos(r.id, d)} busy={photoBusy === r.id} />
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// Karty prioritizovaného plánu úklidu (sdílené v portálu uklízečky).
function PlanCards({ plan, onStart, onDone, brief, briefing, onBrief, onReload, items, onPhoto, photoBusy, onDnd }: {
  plan: HousekeepingPlan | null; onStart: (id: string) => void; onDone: (id: string) => void;
  brief: string; briefing: boolean; onBrief: () => void; onReload: () => void; items: ServiceItem[];
  onPhoto: (id: string, dataUrls: string[]) => void; photoBusy: string; onDnd: (reservationId: string, on: boolean) => void;
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
          <div key={i.id} className={`req-card s-${i.status} row-${i.priority}${i.dnd ? " dnd" : ""}`}>
            <div className="req-top"><span className="req-type">{taskIcon(i.type, i.description)} {SERVICE_LABEL[i.type]}{isDailyTask(i.type, i.description) && <> <span className="chip chip-daily">denní</span></>}{i.dnd && <> <span className="chip chip-dnd">🚫 Nerušit</span></>}</span><PrioBadge p={i.priority} /></div>
            <div className="req-loc">{planLoc(i)}{i.roomTypeName ? ` · ${i.roomTypeName}` : ""}{i.guestName ? ` · ${i.guestName}` : ""}</div>
            <div className="req-desc">{i.reason}{i.description ? ` — ${i.description}` : ""}</div>
            <div className="req-actions">
              {!i.dnd && i.status === "open" && <button className="btn sm" onClick={() => onStart(i.id)}>Začít</button>}
              {!i.dnd && <button className="btn sm ok" onClick={() => onDone(i.id)}>Hotovo</button>}
              {!i.dnd && BILLABLE.includes(i.type) && <BillRequest reqId={i.id} type={i.type} items={items} onDone={onReload} />}
              {i.reservationId && <button className="btn sm ghost" onClick={() => onDnd(i.reservationId!, !i.dnd)}>{i.dnd ? "Zrušit Nerušit" : "🚫 Nerušit"}</button>}
            </div>
            <PhotoStrip urls={i.imageUrls} onUpload={(d) => onPhoto(i.id, d)} busy={photoBusy === i.id} />
          </div>
        ))}
      </div>
    </>
  );
}

// Karty prioritizované fronty údržby (portál údržbáře).
function MaintCards({ plan, onStart, onDone, brief, briefing, onBrief, onReload, onPhoto, photoBusy }: {
  plan: MaintenancePlan | null; onStart: (id: string) => void; onDone: (id: string) => void;
  brief: string; briefing: boolean; onBrief: () => void; onReload: () => void;
  onPhoto: (id: string, dataUrls: string[]) => void; photoBusy: string;
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
            <PhotoStrip onUpload={(d) => onPhoto(i.id, d)} busy={photoBusy === i.id} />
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
