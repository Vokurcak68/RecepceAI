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
  const baseUrl = `https://${DOMAIN}/${APP_ID ? `${APP_ID}/${room}` : room}`;
  const [token, setToken] = useState<string | null>(JWT || null);
  const [tokenReady, setTokenReady] = useState(!APP_ID); // bez App ID (veřejný server) token neřešíme
  // U JaaS nese token i odkaz personálu — jinak by se host nepřipojil k autentizované místnosti.
  const joinUrl = token ? `${baseUrl}?jwt=${token}` : baseUrl;

  useEffect(() => { QRCode.toDataURL(joinUrl, { margin: 1, width: 220 }).then(setQr).catch(() => {}); }, [joinUrl]);

  // Zhasnutí zvonečku v adminu — když se někdo připojí nebo se okno zavře.
  const callIdRef = useRef<string | null>(null);
  const resolvedRef = useRef(false);
  const resolveBell = () => {
    if (resolvedRef.current || !callIdRef.current) return;
    resolvedRef.current = true;
    api.resolveCall(callIdRef.current).catch(() => {});
  };

  const ring = (url = joinUrl) => {
    setNotify("sending");
    api.notifyStaff(url, propertyName)
      .then((r) => { setNotify("sent"); if (r.callId) callIdRef.current = r.callId; })
      .catch(() => setNotify("error"));
  };

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

  // Pojistka proti dvojímu spuštění (React StrictMode v devu pustí effect 2×).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; started.current = true;
    (async () => {
      let jwt: string | null = JWT || null;
      if (!jwt && APP_ID) { try { jwt = (await api.callToken()).jwt; } catch { /* fallback bez tokenu */ } }
      setToken(jwt); setTokenReady(true);
      askPermission();
      ring(jwt ? `${baseUrl}?jwt=${jwt}` : baseUrl);
    })();
  }, []); // eslint-disable-line

  // Při zavření okna hovoru (zavěšení / zrušení / konec) zhasni zvoneček v adminu.
  useEffect(() => () => { resolveBell(); }, []); // eslint-disable-line

  // Jitsi spustíme až po povolení.
  useEffect(() => {
    if (!granted || !tokenReady) return; // u JaaS počkej na token, ať se nepřipojíš bez něj
    let disposed = false;
    const start = () => {
      const w = window as unknown as { JitsiMeetExternalAPI?: AnyApi };
      if (disposed || !ref.current || !w.JitsiMeetExternalAPI) return;
      const japi = new w.JitsiMeetExternalAPI(DOMAIN, {
        roomName: APP_ID ? `${APP_ID}/${room}` : room,
        ...(token ? { jwt: token } : {}),
        parentNode: ref.current, width: "100%", height: "100%",
        userInfo: { displayName: "Recepce" },
        configOverwrite: { prejoinPageEnabled: false, prejoinConfig: { enabled: false }, disableDeepLinking: true, startWithAudioMuted: false, startWithVideoMuted: false, toolbarButtons: [], disableInviteFunctions: true, filmstrip: { disabled: true } },
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: [], MOBILE_APP_PROMO: false, DISABLE_JOIN_LEAVE_NOTIFICATIONS: true },
      });
      apiRef.current = japi;
      japi.addEventListener("participantJoined", () => { setConnected(true); resolveBell(); });
      // Recepční mohl naskočit (přes WhatsApp/QR) DŘÍV, než se kiosek připojil — pak už
      // participantJoined nepřijde. Po vlastním připojení proto zkontroluj stávající účastníky.
      japi.addEventListener("videoConferenceJoined", () => {
        const check = () => { try { if ((japi.getNumberOfParticipants?.() ?? 1) > 1) { setConnected(true); resolveBell(); } } catch { /* */ } };
        check(); setTimeout(check, 1500);
      });
      japi.addEventListener("participantLeft", () => { try { if ((japi.getNumberOfParticipants?.() ?? 1) <= 1) setConnected(false); } catch { /* */ } });
      japi.addEventListener("readyToClose", onClose);
    };
    // U JaaS je external_api.js pod App ID: https://8x8.vc/<appId>/external_api.js
    const scriptUrl = APP_ID ? `https://${DOMAIN}/${APP_ID}/external_api.js` : `https://${DOMAIN}/external_api.js`;
    const w = window as unknown as { JitsiMeetExternalAPI?: AnyApi };
    if (w.JitsiMeetExternalAPI) start();
    else { const s = document.createElement("script"); s.src = scriptUrl; s.async = true; s.onload = start; document.body.appendChild(s); }
    return () => { disposed = true; try { apiRef.current?.dispose(); } catch { /* */ } };
  }, [granted, room, token, tokenReady]); // eslint-disable-line

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
                  <button className="btn ok" onClick={() => ring()}>📲 Zazvonit znovu</button>
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
