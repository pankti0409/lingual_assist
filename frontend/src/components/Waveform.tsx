import { useEffect, useRef, useState } from "react";
import { useDecorativeMotion } from "@/lib/motion";

/**
 * Decorative waveform. It moves only while audio is actually playing (`active`) and rests as a
 * gentle still shape otherwise. It is not a measurement and is hidden from assistive technology.
 */
export function Waveform({ active, bars = 32, rate = 1, className = "" }: { active: boolean; bars?: number; rate?: number; className?: string }) {
  const animate = useDecorativeMotion() && active;
  const [t, setT] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    const tick = (now: number) => {
      setT(((now - start) / 1000) * rate);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [animate, rate]);

  const w = 6;
  const gap = 4;
  const width = bars * (w + gap) - gap;
  const h = 64;
  return (
    <svg className={`waveform${active ? " is-active" : ""} ${className}`} viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const envelope = Math.sin((Math.PI * (i + 0.5)) / bars);
        const rest = 0.18 + 0.22 * envelope * (0.6 + 0.4 * Math.sin(i * 1.7));
        const live = 0.2 + 0.8 * envelope * Math.abs(Math.sin(t * 5.2 + i * 0.55) * Math.cos(t * 2.1 + i * 0.23));
        const v = animate ? live : active ? 0.25 + 0.6 * envelope : rest;
        const bh = Math.max(6, v * h);
        return <rect key={i} x={i * (w + gap)} y={(h - bh) / 2} width={w} height={bh} rx={3} />;
      })}
    </svg>
  );
}
