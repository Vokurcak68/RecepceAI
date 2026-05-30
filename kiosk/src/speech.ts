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

const KEYWORDS: Record<Lang, Record<Exclude<Intent, null>, string[]>> = {
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
  if (k.checkout.some((w) => t.includes(w))) return "checkout";
  if (k.reservation.some((w) => t.includes(w))) return "reservation";
  if (k.walkin.some((w) => t.includes(w))) return "walkin";
  if (k.human.some((w) => t.includes(w))) return "human";
  return null;
}

export function useRecognition(lang: Lang, onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR>(null);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  const stop = () => { try { recRef.current?.stop(); } catch { /* */ } setListening(false); };

  const start = () => {
    const Ctor = getSR();
    if (!Ctor) return;
    try { recRef.current?.abort?.(); } catch { /* */ }
    const rec = new Ctor();
    rec.lang = SPEECH_LANG[lang];
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.continuous = false;
    rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const first = e.results[0];
      const alts: string[] = [];
      for (let i = 0; i < first.length; i++) alts.push(first[i].transcript);
      cbRef.current(alts.join(" "));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { /* už běží */ }
  };

  useEffect(() => () => { try { recRef.current?.abort?.(); } catch { /* */ } }, []);
  return { listening, start, stop, supported: !!getSR() };
}
