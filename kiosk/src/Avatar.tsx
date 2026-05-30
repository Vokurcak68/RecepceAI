// Avatar recepční — tři vizuální varianty, animované (mrkání, idle pohyb,
// lip-sync pusy synchronně s hlasem přes Web Speech API).
import { useEffect, useRef, useState } from "react";
import { SPEECH_LANG, type Lang } from "./i18n";
import { RpmCanvas } from "./RpmAvatar";

export type AvatarVariant = "voice" | "rpm" | "receptionist" | "orb" | "robot";

export const AVATAR_VARIANTS: { id: AvatarVariant; label: string; note: string }[] = [
  { id: "voice", label: "Hlasová koule (ChatGPT styl)", note: "Světélkující koule co dýchá a pulzuje při mluvení" },
  { id: "rpm", label: "3D recepční", note: "Skutečná 3D hlava (Three.js), lip-sync + mrkání. Offline; lze nahradit GLB modelem z Avaturn." },
  { id: "receptionist", label: "Recepční Klára (2D)", note: "Lidská tvář — vřelý, hotelový dojem" },
  { id: "orb", label: "Hlasová koule (jednoduchá)", note: "Abstraktní SVG se zvukovými sloupci" },
  { id: "robot", label: "Robot Zvoneček", note: "Hravý maskot, snadno brandovatelný" },
];

// ChatGPT-style hlasová koule — vrstvený glow + organicky se vlnící koule,
// která „dýchá" a při mluvení se rozpulzuje. Čistě CSS, lehké a plynulé.
function VoiceOrb({ speaking }: { speaking: boolean }) {
  return (
    <div className={`vorb-wrap ${speaking ? "talking" : ""}`}>
      <div className="vorb-glow" />
      <div className="vorb">
        <div className="vorb-swirl" />
        <div className="vorb-shine" />
      </div>
    </div>
  );
}

// ── Čištění textu (model může poslat Markdown/emoji) ─────────
/** Odstraní Markdown zvýraznění — pro zobrazení v bublině. */
export function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/gs, "$1")   // **tučné**
    .replace(/__(.*?)__/gs, "$1")       // __tučné__
    .replace(/\*(.*?)\*/gs, "$1")       // *kurzíva*
    .replace(/`([^`]*)`/g, "$1")        // `kód`
    .replace(/^#{1,6}\s+/gm, "")         // nadpisy #
    .replace(/\*/g, "");                 // zbylé osamocené hvězdičky
}

/** Pro předčítání: navíc pryč emoji/symboly, ať je TTS nečte. */
function cleanForSpeech(s: string): string {
  return stripMarkdown(s)
    .replace(/[\p{Extended_Pictographic}️⃣]/gu, "") // emoji
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ── Hlas ─────────────────────────────────────────────────────
export function useSpeech(lang: Lang) {
  const [speaking, setSpeaking] = useState(false);
  const enabled = useRef(true);

  const speak = (text: string) => {
    if (!enabled.current || !("speechSynthesis" in window)) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = SPEECH_LANG[lang];
    u.rate = 1;
    u.pitch = 1.05;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return { speak, speaking };
}

// ── Varianty kresby ──────────────────────────────────────────

function Receptionist({ speaking }: { speaking: boolean }) {
  return (
    <svg className={`av av-bob ${speaking ? "talking" : ""}`} viewBox="0 0 200 210" width="100%" height="100%">
      <defs>
        <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe0c2" /><stop offset="1" stopColor="#f6c9a3" />
        </linearGradient>
        <linearGradient id="uniform" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4a7a" /><stop offset="1" stopColor="#2a366010" />
        </linearGradient>
      </defs>
      {/* ramena / uniforma */}
      <path d="M40 210 Q100 150 160 210 Z" fill="#33417a" />
      <path d="M88 175 L100 200 L112 175 Z" fill="#fff" opacity="0.9" />
      <circle cx="118" cy="188" r="3" fill="#ffd54a" />
      {/* vlasy vzadu */}
      <ellipse cx="100" cy="100" rx="66" ry="74" fill="#5b3b2e" />
      {/* obličej */}
      <ellipse cx="100" cy="102" rx="50" ry="58" fill="url(#skin)" />
      {/* tváře */}
      <circle cx="72" cy="118" r="9" fill="#ff9d8a" opacity="0.35" />
      <circle cx="128" cy="118" r="9" fill="#ff9d8a" opacity="0.35" />
      {/* ofina / vlasy nahoře */}
      <path d="M48 86 Q56 36 100 38 Q150 38 152 90 Q140 60 100 60 Q66 58 48 86 Z" fill="#6b4636" />
      {/* obočí */}
      <rect x="68" y="84" width="22" height="5" rx="2.5" fill="#5b3b2e" />
      <rect x="110" y="84" width="22" height="5" rx="2.5" fill="#5b3b2e" />
      {/* oči */}
      <g className="av-eyes">
        <ellipse cx="79" cy="98" rx="8.5" ry="9" fill="#fff" />
        <ellipse cx="121" cy="98" rx="8.5" ry="9" fill="#fff" />
        <circle cx="80" cy="99" r="4.2" fill="#3a2a20" />
        <circle cx="122" cy="99" r="4.2" fill="#3a2a20" />
        {/* víčka pro mrkání */}
        <rect className="av-lid" x="70" y="89" width="18" height="20" rx="9" fill="url(#skin)" />
        <rect className="av-lid" x="112" y="89" width="18" height="20" rx="9" fill="url(#skin)" />
      </g>
      {/* nos */}
      <path d="M100 108 Q96 120 102 122" fill="none" stroke="#e0a884" strokeWidth="2.5" strokeLinecap="round" />
      {/* pusa */}
      <ellipse className="av-mouth" cx="100" cy="140" rx="15" ry="5" fill="#c0473f" />
    </svg>
  );
}

function Orb({ speaking }: { speaking: boolean }) {
  return (
    <svg className={`av ${speaking ? "talking" : ""}`} viewBox="0 0 200 200" width="100%" height="100%">
      <defs>
        <radialGradient id="orbg" cx="42%" cy="36%" r="68%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="28%" stopColor="#9ec3ff" />
          <stop offset="62%" stopColor="#4f7cff" />
          <stop offset="100%" stopColor="#00c2a8" />
        </radialGradient>
        <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      {/* měkký glow halo */}
      <circle className="av-glow" cx="100" cy="100" r="84" fill="#5a93ff" opacity="0.35" filter="url(#soft)" />
      {/* hlavní koule — dýchá a pulzuje */}
      <circle className="av-orb" cx="100" cy="100" r="64" fill="url(#orbg)" />
      {/* lesklý odlesk */}
      <circle cx="76" cy="74" r="18" fill="#fff" opacity="0.4" filter="url(#soft)" />
      {/* zvukové sloupce — animují při mluvení */}
      <g className="av-wave" transform="translate(100 104)">
        {[-30, -15, 0, 15, 30].map((x, i) => (
          <rect key={i} x={x - 4} y={-7} width="8" height="14" rx="4" fill="#fff" opacity="0.95" style={{ ["--i" as string]: i }} />
        ))}
      </g>
    </svg>
  );
}

function Robot({ speaking }: { speaking: boolean }) {
  return (
    <svg className={`av av-bob ${speaking ? "talking" : ""}`} viewBox="0 0 200 210" width="100%" height="100%">
      <defs>
        <linearGradient id="bell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd66b" /><stop offset="1" stopColor="#f2a73c" />
        </linearGradient>
      </defs>
      {/* anténka */}
      <line x1="100" y1="40" x2="100" y2="20" stroke="#9aa6c8" strokeWidth="4" />
      <circle className="av-glow" cx="100" cy="16" r="9" fill="#4f7cff" />
      {/* tělo zvonku */}
      <path d="M44 168 Q44 64 100 60 Q156 64 156 168 Z" fill="url(#bell)" stroke="#d98e23" strokeWidth="3" />
      <rect x="36" y="166" width="128" height="16" rx="8" fill="#d98e23" />
      {/* displej obličeje */}
      <rect x="62" y="86" width="76" height="54" rx="16" fill="#1b2440" />
      <g className="av-eyes">
        <circle cx="86" cy="108" r="8" fill="#7ee0ff" />
        <circle cx="114" cy="108" r="8" fill="#7ee0ff" />
        <rect className="av-lid" x="76" y="98" width="20" height="22" rx="10" fill="#1b2440" />
        <rect className="av-lid" x="104" y="98" width="20" height="22" rx="10" fill="#1b2440" />
      </g>
      {/* pusa / reproduktor */}
      <ellipse className="av-mouth" cx="100" cy="128" rx="12" ry="3.5" fill="#7ee0ff" />
    </svg>
  );
}

const RENDER: Record<AvatarVariant, (p: { speaking: boolean }) => JSX.Element> = {
  voice: VoiceOrb,
  rpm: RpmCanvas,
  receptionist: Receptionist,
  orb: Orb,
  robot: Robot,
};

// ── Veřejná komponenta ───────────────────────────────────────
export function Avatar({
  speaking, line, variant = "receptionist", size = 140,
}: { speaking: boolean; line?: string; variant?: AvatarVariant; size?: number }) {
  const Body = RENDER[variant];
  return (
    <div className="avatar">
      <div className="avatar-stage" style={{ width: size, height: size }}>
        <Body speaking={speaking} />
      </div>
      {line ? <div className="avatar-line">{line}</div> : null}
    </div>
  );
}
