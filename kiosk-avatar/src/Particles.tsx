// Lehké částicové pozadí (canvas) pro „epic" úvod — body plynule driftují a propojují
// se čarami, když jsou blízko. Bez závislostí, requestAnimationFrame, respektuje DPR.
import { useEffect, useRef } from "react";

export function Particles({ count = 46 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0;
    // pozice/rychlost v normalizovaném prostoru 0..1
    const dots = Array.from({ length: count }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0007, vy: (Math.random() - 0.5) * 0.0007,
      r: Math.random() * 1.8 + 0.8,
    }));
    const resize = () => { w = cv.width = cv.offsetWidth * dpr; h = cv.height = cv.offsetHeight * dpr; };
    resize();
    window.addEventListener("resize", resize);
    const LINK = 150 * dpr;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > 1) d.vx *= -1;
        if (d.y < 0 || d.y > 1) d.vy *= -1;
      }
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = (dots[i].x - dots[j].x) * w, dy = (dots[i].y - dots[j].y) * h;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK) {
            ctx.strokeStyle = `rgba(120,160,255,${0.13 * (1 - dist / LINK)})`;
            ctx.lineWidth = dpr;
            ctx.beginPath(); ctx.moveTo(dots[i].x * w, dots[i].y * h); ctx.lineTo(dots[j].x * w, dots[j].y * h); ctx.stroke();
          }
        }
      }
      for (const d of dots) {
        ctx.fillStyle = "rgba(150,190,255,0.55)";
        ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.r * dpr, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [count]);
  return <canvas ref={ref} className="particles" aria-hidden />;
}
