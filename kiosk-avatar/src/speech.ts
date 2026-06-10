// Rozpoznávání řeči (Web Speech API) + vyhodnocení záměru hosta.
// Funguje hlavně v Chrome/Edge; jazyk dle zvoleného jazyka kiosku.
import { useEffect, useRef, useState } from "react";
import { SPEECH_LANG, type Lang } from "./i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;
function getSR(): SR | null {
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
export const recognitionSupported = () => !!getSR();

export type Intent = "walkin" | "reservation" | "checkout" | "human" | null;

// Klíčová slova jen pro rychlou volbu na úvodu (cs/en). Ostatní jazyky se
// vyhodnotí přes AI asistenta (matchIntent vrátí null → předá se AI).
const KEYWORDS: Partial<Record<Lang, Record<Exclude<Intent, null>, string[]>>> = {
  cs: {
    checkout: ["odjíždím", "odjizd", "odjezd", "odhlás", "odhlas", "check out", "check-out", "platím a", "konec pobytu", "odcházím", "odchazim"],
    reservation: ["rezervac", "objedn", "mám rezerv", "mam rezerv", "potvrzen", "check in", "check-in", "přihlás", "prihlas"],
    walkin: ["ubytov", "pokoj", "nocleh", "noclen", "přespat", "prespat", "volno", "volný pokoj", "bez rezervace", "lůžko", "luzko", "chci přespat"],
    human: ["člověk", "clovek", "recepční", "recepcni", "pomoc", "pracovník", "pracovnik", "personál", "personal", "živého", "ziveho"],
  },
  en: {
    checkout: ["check out", "checkout", "check-out", "leaving", "departure", "bill", "leave"],
    reservation: ["reservation", "booking", "i have a", "booked", "check in", "check-in"],
    walkin: ["room", "stay", "accommodation", "book a room", "need a room", "without reservation", "walk in", "a bed", "sleep"],
    human: ["human", "staff", "person", "help", "receptionist", "someone"],
  },
};

export function matchIntent(text: string, lang: Lang): Intent {
  const t = (text || "").toLowerCase();
  const k = KEYWORDS[lang];
  if (!k) return null; // jazyk bez klíčových slov → vyhodnotí AI asistent
  if (k.checkout.some((w) => t.includes(w))) return "checkout";
  if (k.reservation.some((w) => t.includes(w))) return "reservation";
  if (k.walkin.some((w) => t.includes(w))) return "walkin";
  if (k.human.some((w) => t.includes(w))) return "human";
  return null;
}

export function useRecognition(lang: Lang, onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");   // diagnostika: kód chyby Web Speech
  const [interim, setInterim] = useState(""); // diagnostika: průběžný přepis
  const recRef = useRef<SR>(null);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  const stop = () => { try { recRef.current?.stop(); } catch { /* */ } setListening(false); setInterim(""); };

  const start = () => {
    const Ctor = getSR();
    if (!Ctor) return;
    try { recRef.current?.abort?.(); } catch { /* */ }
    const rec = new Ctor();
    rec.lang = SPEECH_LANG[lang];
    // continuous=false → finalizuje hned po dořečení (rychlá odezva). interimResults=true →
    // máme průběžný přepis jako zálohu, kdyby nedorazil finální (jinak by host nic neviděl).
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    let finalText = "";
    let interimText = "";
    rec.onstart = () => { setError(""); setInterim(""); };
    rec.onresult = (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => {
      interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript || "";
        if (r.isFinal) finalText += txt + " "; else interimText += txt;
      }
      setInterim(interimText);
      const f = finalText.trim();
      if (f) { finalText = ""; setInterim(""); cbRef.current(f); }
    };
    rec.onend = () => {
      setListening(false);
      const txt = interimText.trim(); // nepřišel finál → použij poslední průběžný
      if (txt) { interimText = ""; setInterim(""); cbRef.current(txt); }
    };
    rec.onerror = (e: { error?: string }) => { setListening(false); setInterim(""); setError(e?.error || "error"); };
    recRef.current = rec;
    try { rec.start(); setListening(true); setError(""); } catch { setListening(false); }
  };

  useEffect(() => () => { try { recRef.current?.abort?.(); } catch { /* */ } }, []);
  return { listening, start, stop, supported: !!getSR(), error, interim };
}
