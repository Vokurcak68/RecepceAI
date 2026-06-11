// Hybridní avatar (cesta B + C) v JEDNOM <video> elementu:
//  • poster   – statická fotka Daniela (klid, 0 kreditů),
//  • klip     – předrenderované MP4 pevné věty (cesta B, 0 kreditů za běhu),
//  • živě     – real-time D-ID WebRTC stream (cesta C) pro dynamiku (AI odpovědi).
//
// Pravidlo say(text, clipUrl?):
//  – už běží živý stream → řekni živě (ať nepřepínáme zdroj elementu),
//  – jinak je-li klip → přehraj klip,
//  – jinak otevři živý stream a řekni živě.
// Živý stream se otevírá LÍNĚ (až je potřeba) a zavírá při unmountu (návrat na idle).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "./api";

export type AvatarStageHandle = { say: (text: string, clipUrl?: string) => void; warmup: () => void; goLocal: () => void };

// O kolik sekund zpozdit VIDEO oproti zvuku u živého streamu (rty předbíhají). Lze doladit.
const AV_VIDEO_DELAY = 0.12;

type Props = { lang: string; size?: number; poster?: string; className?: string; width?: number; height?: number; onSpeaking?: (b: boolean) => void };

export const AvatarStage = forwardRef<AvatarStageHandle, Props>(function AvatarStage(
  { lang, size = 120, poster, className = "", width, height, onSpeaking },
  ref,
) {
  const onSpeakRef = useRef(onSpeaking);
  onSpeakRef.current = onSpeaking;
  const speakSafety = useRef<ReturnType<typeof setTimeout>>(); // pojistka, kdyby „done" nedorazilo
  const emitSpeak = (b: boolean) => {
    onSpeakRef.current?.(b);
    clearTimeout(speakSafety.current);
    if (b) speakSafety.current = setTimeout(() => onSpeakRef.current?.(false), 9000); // max doba mluvení (pojistka)
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const idRef = useRef<string>("");
  const sessionRef = useRef<string>("");
  const liveReadyRef = useRef(false);   // stream připojen, lze posílat talk
  const liveOpenRef = useRef(false);     // stream se otevírá/otevřen → vše posílej živě
  const queueRef = useRef<string[]>([]); // texty čekající na připojení streamu
  const langRef = useRef(lang);
  langRef.current = lang;

  const [showVideo, setShowVideo] = useState(false); // překryj poster (klip nebo živé video)
  const [connecting, setConnecting] = useState(false);

  // ── Klip (předrenderované MP4) ──
  const playClip = (url: string) => {
    const v = videoRef.current; if (!v) return;
    v.srcObject = null;
    v.src = url; v.loop = false; v.muted = false;
    setShowVideo(true);
    emitSpeak(true); // klip = řeč (s pusou)
    v.play().catch(() => {});
  };
  const onEnded = () => { if (!liveOpenRef.current) { setShowVideo(false); emitSpeak(false); } }; // klip dohrál → klid

  // ── Živý D-ID stream ──
  const revealedRef = useRef(false); // už jednou ukázáno živé video?
  // Odhal živé video až s PRVNÍM REÁLNÝM snímkem (po talku). Idle/warmup snímky jsou prázdné (bílé) → drž poster.
  const revealOnFrame = () => {
    if (revealedRef.current) return;
    const v = videoRef.current; if (!v) return;
    const rvfc = (v as unknown as { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback;
    const reveal = () => { revealedRef.current = true; setShowVideo(true); setConnecting(false); };
    if (rvfc) rvfc.call(v, reveal); else reveal();
  };

  const openLive = async () => {
    if (liveOpenRef.current) return;
    liveOpenRef.current = true;
    setShowVideo(false); // drž POSTER (předehřátí na pozadí — žádné kolečko, žádná bílá plocha)
    try {
      const s = await api.didCreateStream();
      idRef.current = s.id; sessionRef.current = s.session_id;
      const pc = new RTCPeerConnection({ iceServers: s.ice_servers });
      pcRef.current = pc;
      // D-ID posílá přes data channel události streamu → přesné „mluví / domluvil"
      pc.ondatachannel = (e) => {
        e.channel.onmessage = (msg) => {
          const d = String((msg as MessageEvent).data || "");
          if (d.includes("stream/started")) emitSpeak(true);
          else if (d.includes("stream/done")) emitSpeak(false);
        };
      };
      pc.ontrack = (e) => {
        const v = videoRef.current;
        if (v && e.streams[0]) { v.src = ""; v.srcObject = e.streams[0]; v.play().catch(() => {}); }
        // poster zůstává; živé video odhalí až revealOnFrame() po skutečném talku
        if (e.track?.kind === "video") {
          try { (e.receiver as unknown as { playoutDelayHint?: number }).playoutDelayHint = AV_VIDEO_DELAY; } catch { /* nepodporováno */ }
        }
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) api.didIce(s.id, { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex }, s.session_id).catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          liveReadyRef.current = true;
          const q = queueRef.current; queueRef.current = [];
          if (q.length) { setConnecting(true); emitSpeak(true); revealOnFrame(); } // čekáme na řeč → kolečko + odhal s prvním snímkem
          q.forEach((txt) => api.didTalk(idRef.current, sessionRef.current, txt, langRef.current).catch(() => {}));
        } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          setConnecting(false);
        }
      };
      await pc.setRemoteDescription(s.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await api.didSdp(s.id, answer, s.session_id);
    } catch (e) {
      console.warn("[did] openLive", e);
      setConnecting(false);
    }
  };

  const talkLive = (text: string) => {
    if (liveReadyRef.current && idRef.current) {
      if (!revealedRef.current) setConnecting(true); // čekáme na první snímek řeči → kolečko (přes poster)
      emitSpeak(true); revealOnFrame();
      api.didTalk(idRef.current, sessionRef.current, text, langRef.current).catch((e) => console.warn("[did] talk", e));
    } else queueRef.current.push(text); // ještě se připojuje → fronta
  };

  const say = (text: string, clipUrl?: string) => {
    const clean = text.trim(); if (!clean) return;
    if (liveOpenRef.current) { talkLive(clean); return; }   // už živě → drž živě
    if (clipUrl) { playClip(clipUrl); return; }             // pevná věta → klip
    void openLive().then(() => talkLive(clean));            // dynamika → otevři živě
  };
  // Předehřátí: otevři živý stream na pozadí (bez mluvení), ať je připravený, než přijde dotaz.
  const warmup = () => { if (!liveOpenRef.current) void openLive(); };
  // Zpět na lokálního Daniela (poster/klipy): zavři živý stream (mimo asistenta).
  const goLocal = () => {
    if (!liveOpenRef.current) return;
    const id = idRef.current, sess = sessionRef.current;
    if (id && sess) api.didClose(id, sess).catch(() => {});
    try { pcRef.current?.close(); } catch { /* ignore */ }
    pcRef.current = null; idRef.current = ""; sessionRef.current = "";
    liveOpenRef.current = false; liveReadyRef.current = false; revealedRef.current = false;
    queueRef.current = [];
    clearTimeout(speakSafety.current); onSpeakRef.current?.(false);
    const v = videoRef.current; if (v) { v.srcObject = null; v.src = ""; }
    setShowVideo(false); setConnecting(false); // zpět na poster (další pevná věta = klip)
  };
  useImperativeHandle(ref, () => ({ say, warmup, goLocal }), []);

  // úklid streamu při odchodu (návrat na idle odmountuje aktivní avatar)
  useEffect(() => () => {
    clearTimeout(speakSafety.current);
    onSpeakRef.current?.(false);
    const id = idRef.current, sess = sessionRef.current;
    if (id && sess) api.didClose(id, sess).catch(() => {});
    try { pcRef.current?.close(); } catch { /* ignore */ }
  }, []);

  return (
    <div className={`did-avatar ${className}`} style={{ width: width ?? size, height: height ?? size }}>
      <video ref={videoRef} autoPlay playsInline poster={poster} onEnded={onEnded} style={{ opacity: showVideo ? 1 : 0 }} />
      {!showVideo && poster && <img className="did-poster" src={poster} alt="" />}
      {connecting && <div className="did-spinner" aria-label="připojuji avatara" />}
    </div>
  );
});
