// Vložený videohovor přes Jitsi (WebRTC). Kiosek se připojí do místnosti a
// čeká; jakmile se připojí personál, objeví se obousměrné video přímo zde.
import { useEffect, useRef } from "react";

export const JITSI_DOMAIN = "meet.jit.si";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApi = any;

export function JitsiCall({ room, onEnd }: { room: string; onEnd?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AnyApi>(null);

  useEffect(() => {
    let disposed = false;
    const start = () => {
      const w = window as unknown as { JitsiMeetExternalAPI?: AnyApi };
      if (disposed || !ref.current || !w.JitsiMeetExternalAPI) return;
      const api = new w.JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName: room,
        parentNode: ref.current,
        width: "100%",
        height: "100%",
        userInfo: { displayName: "Recepce – kiosek" },
        configOverwrite: { prejoinPageEnabled: false, disableDeepLinking: true },
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: ["microphone", "camera", "hangup", "tileview"], MOBILE_APP_PROMO: false },
      });
      apiRef.current = api;
      api.addEventListener("readyToClose", () => onEnd?.());
    };

    const w = window as unknown as { JitsiMeetExternalAPI?: AnyApi };
    if (w.JitsiMeetExternalAPI) {
      start();
    } else {
      const s = document.createElement("script");
      s.src = `https://${JITSI_DOMAIN}/external_api.js`;
      s.async = true;
      s.onload = start;
      document.body.appendChild(s);
    }
    return () => { disposed = true; try { apiRef.current?.dispose(); } catch { /* */ } };
  }, [room]); // eslint-disable-line

  return <div ref={ref} style={{ width: "100%", height: "100%", borderRadius: 16, overflow: "hidden" }} />;
}
