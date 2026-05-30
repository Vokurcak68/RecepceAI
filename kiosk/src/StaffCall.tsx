// Přivolání člověka: 1) povolení kamery/mikrofonu (čeká se na něj), 2) zvonění
// + WhatsApp personálu, 3) po připojení malé okno v rohu — kiosek zůstává ovladatelný.
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "./api";

const ENV = (import.meta as { env?: Record<string, string> }).env ?? {};
const DOMAIN = ENV.VITE_JITSI_DOMAIN || "meet.jit.si";
const APP_ID = ENV.VITE_JITSI_APP_ID || "";
const JWT = ENV.VITE_JITSI_JWT || "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApi = any;

export function StaffCall({ room, propertyName, onClose }: {
  room: string; propertyName: string; whatsapp?: string; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AnyApi>(null);
  const [granted, setGranted] = useState(false);
  const [permErr, setPermErr] = useState("");
  const [connected, setConnected] = useState(false);
  const [qr, setQr] = useState("");
  const [notify, setNotify] = useState<"sending" | "sent" | "error">("sending");

  const secure = typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  const joinUrl = `https://${DOMAIN}/${APP_ID ? `${APP_ID}/${room}` : room}`;

  useEffect(() => { QRCode.toDataURL(joinUrl, { margin: 1, width: 220 }).then(setQr).catch(() => {}); }, [joinUrl]);

  const ring = () => { setNotify("sending"); api.notifyStaff(joinUrl, propertyName).then(() => setNotify("sent")).catch(() => setNotify("error")); };

  // Povolení kamery/mikrofonu — s hlášením přesné chyby.
  const askPermission = async () => {
    if (!secure) { setPermErr("insecure"); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
      setPermErr(""); setGranted(true);
    } catch (e) {
      const name = (e as Error).name || "Error";
      setPermErr(name); // NotAllowedError / NotFoundError / NotReadableError
    }
  };

  useEffect(() => { askPermission(); ring(); }, []); // eslint-disable-line

  // Jitsi spustíme až po povolení.
  useEffect(() => {
    if (!granted) return;
    let disposed = false;
    const start = () => {
      const w = window as unknown as { JitsiMeetExternalAPI?: AnyApi };
      if (disposed || !ref.current || !w.JitsiMeetExternalAPI) return;
      const japi = new w.JitsiMeetExternalAPI(DOMAIN, {
        roomName: APP_ID ? `${APP_ID}/${room}` : room,
        ...(JWT ? { jwt: JWT } : {}),
        parentNode: ref.current, width: "100%", height: "100%",
        userInfo: { displayName: "Recepce" },
        configOverwrite: { prejoinPageEnabled: false, prejoinConfig: { enabled: false }, disableDeepLinking: true, startWithAudioMuted: false, startWithVideoMuted: false, toolbarButtons: [], disableInviteFunctions: true, filmstrip: { disabled: true } },
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: [], MOBILE_APP_PROMO: false, DISABLE_JOIN_LEAVE_NOTIFICATIONS: true },
      });
      apiRef.current = japi;
      japi.addEventListener("participantJoined", () => setConnected(true));
      japi.addEventListener("participantLeft", () => { try { if ((japi.getNumberOfParticipants?.() ?? 1) <= 1) setConnected(false); } catch { /* */ } });
      japi.addEventListener("readyToClose", onClose);
    };
    const w = window as unknown as { JitsiMeetExternalAPI?: AnyApi };
    if (w.JitsiMeetExternalAPI) start();
    else { const s = document.createElement("script"); s.src = `https://${DOMAIN}/external_api.js`; s.async = true; s.onload = start; document.body.appendChild(s); }
    return () => { disposed = true; try { apiRef.current?.dispose(); } catch { /* */ } };
  }, [granted, room]); // eslint-disable-line

  const hangup = () => { try { apiRef.current?.executeCommand("hangup"); apiRef.current?.dispose(); } catch { /* */ } onClose(); };

  const ERR: Record<string, string> = {
    insecure: "Kamera vyžaduje zabezpečené spojení (https:// nebo localhost). Otevřete kiosek přes https.",
    NotAllowedError: "Přístup ke kameře/mikrofonu byl zamítnut. Klikněte na ikonu zámku 🔒 vlevo od adresy → Kamera/Mikrofon → Povolit, a obnovte stránku.",
    NotFoundError: "Nenašla se kamera ani mikrofon. Připojte je k zařízení.",
    NotReadableError: "Kameru/mikrofon používá jiná aplikace. Zavřete ji a zkuste znovu.",
  };

  return (
    <>
      {/* Okno hovoru — mountuje se až po povolení. */}
      {granted && (
        <div className={`call-pip ${connected ? "live" : "behind"}`}>
          <div ref={ref} className="call-frame" />
          {connected && <button className="call-hangup" onClick={hangup}>Zavěsit</button>}
        </div>
      )}

      {/* Před spojením: povolení + zvonění. */}
      {!connected && (
        <div className="call-ring-backdrop">
          <div className="call-ring">
            {!granted ? (
              <>
                <div className="bell" style={{ animation: "none" }}>🎥</div>
                <h2>Povolte kameru a mikrofon</h2>
                <p className="muted">Aby vás pracovník viděl a slyšel, povolte prosím kameru a mikrofon.</p>
                {permErr && <div className="call-warn">⚠️ {ERR[permErr] ?? `Chyba: ${permErr}`}</div>}
                <div className="call-actions">
                  <button className="btn ok" onClick={askPermission}>🎥 Povolit kameru a mikrofon</button>
                  <button className="btn ghost" onClick={hangup}>Zrušit</button>
                </div>
              </>
            ) : (
              <>
                <div className="bell">🔔</div>
                <h2>Voláme personál…</h2>
                <p className="muted">
                  {notify === "sending" && "Posílám zprávu personálu…"}
                  {notify === "sent" && "✓ Personál byl upozorněn na WhatsApp. Připojí se za okamžik."}
                  {notify === "error" && "Personál se může připojit naskenováním QR níže."}
                </p>
                {qr && <img className="call-qr" src={qr} alt="QR pro připojení" />}
                <div className="call-actions">
                  <button className="btn ok" onClick={ring}>📲 Zazvonit znovu</button>
                  <button className="btn ghost" onClick={hangup}>Zrušit</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
