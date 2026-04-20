import type { CSSProperties, SVGProps } from "react";
import type { KindKey } from "./data";

type IconName =
  | "people" | "location" | "quest" | "goal" | "faction" | "item" | "lore"
  | "session" | "board" | "share" | "link" | "plus" | "search" | "filter"
  | "close" | "compass" | "sparkle" | "sword" | "scroll" | "layers"
  | "check" | "chevron" | "trash";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export const Icon = ({ name, size = 16, ...p }: IconProps) => {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...p,
  };
  switch (name) {
    case "people":    return <svg {...common}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/></svg>;
    case "location":  return <svg {...common}><path d="M12 21s-6-6-6-11a6 6 0 1 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/></svg>;
    case "quest":     return <svg {...common}><path d="M6 3h9l3 4v14l-6-3-6 3V3z"/><path d="M9 8h6M9 12h5"/></svg>;
    case "goal":      return <svg {...common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>;
    case "faction":   return <svg {...common}><path d="M4 6l8-3 8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/></svg>;
    case "item":      return <svg {...common}><path d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7l8-4z"/><circle cx="12" cy="11" r="2.5"/></svg>;
    case "lore":      return <svg {...common}><path d="M4 5v14l8-3 8 3V5l-8 3-8-3z"/></svg>;
    case "session":   return <svg {...common}><rect x="3" y="5" width="18" height="15" rx="1"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>;
    case "board":     return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M8 9l3 3-3 3M13 15h4"/></svg>;
    case "share":     return <svg {...common}><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>;
    case "link":      return <svg {...common}><path d="M10 14a5 5 0 0 1 0-7l3-3a5 5 0 0 1 7 7l-1 1"/><path d="M14 10a5 5 0 0 1 0 7l-3 3a5 5 0 0 1-7-7l1-1"/></svg>;
    case "plus":      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "search":    return <svg {...common}><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>;
    case "filter":    return <svg {...common}><path d="M4 5h16l-6 8v5l-4 2v-7L4 5z"/></svg>;
    case "close":     return <svg {...common}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case "compass":   return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M8 16l2.5-5.5L16 8l-2.5 5.5L8 16z"/></svg>;
    case "sparkle":   return <svg {...common}><path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/></svg>;
    case "sword":     return <svg {...common}><path d="M4 20l6-6M14 10l6-6v4l-6 6-4-4 4-6 4 4M9 15l-2 2-2-2 2-2"/></svg>;
    case "scroll":    return <svg {...common}><path d="M5 5h10v14H5z"/><path d="M15 5c2 0 4 1 4 3s-2 3-4 3"/><path d="M8 9h4M8 13h3"/></svg>;
    case "layers":    return <svg {...common}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/></svg>;
    case "check":     return <svg {...common}><path d="M5 12l4 4L19 6"/></svg>;
    case "chevron":   return <svg {...common}><path d="M9 6l6 6-6 6"/></svg>;
    case "trash":     return <svg {...common}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>;
    default: return null;
  }
};

export const kindIcon: Record<KindKey, IconName> = {
  people: "people",
  locations: "location",
  quests: "quest",
  goals: "goal",
  factions: "faction",
  items: "item",
  lore: "lore",
  sessions: "session",
};

export const CompassRose = ({ style }: { style?: CSSProperties }) => (
  <svg className="compass" viewBox="0 0 100 100" style={style} aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.8"/>
    <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2"/>
    <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeWidth="0.5"/>
    <g stroke="currentColor" strokeWidth="0.8" fill="none">
      <path d="M50 8 L54 50 L50 46 L46 50 Z" fill="currentColor"/>
      <path d="M50 92 L54 50 L50 54 L46 50 Z"/>
      <path d="M8 50 L50 54 L46 50 L50 46 Z"/>
      <path d="M92 50 L50 54 L54 50 L50 46 Z"/>
    </g>
    <text x="50" y="6" fontFamily="var(--font-fell-sc)" fontSize="5" fill="currentColor" textAnchor="middle">N</text>
    <text x="50" y="98" fontFamily="var(--font-fell-sc)" fontSize="5" fill="currentColor" textAnchor="middle">S</text>
    <text x="4"  y="52" fontFamily="var(--font-fell-sc)" fontSize="5" fill="currentColor" textAnchor="middle">W</text>
    <text x="96" y="52" fontFamily="var(--font-fell-sc)" fontSize="5" fill="currentColor" textAnchor="middle">E</text>
  </svg>
);

export const MapScribble = ({ seed = 1 }: { seed?: number }) => {
  const paths = [
    "M5 70 Q 30 40, 60 55 T 200 40",
    "M 20 20 Q 60 30, 100 20 T 190 30",
    "M 30 90 Q 80 70, 140 85 T 205 75",
  ];
  return (
    <svg viewBox="0 0 210 100" preserveAspectRatio="none">
      <defs>
        <pattern id={`hatch${seed}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(74,109,104,.3)" strokeWidth="1"/>
        </pattern>
      </defs>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(42,31,20,.45)" strokeWidth="0.8" strokeDasharray={i === 1 ? "3 2" : ""}/>
      ))}
      <path d="M 120 60 l 6 -10 l 6 10 M 130 60 l 5 -7 l 5 7" fill="none" stroke="rgba(42,31,20,.5)" strokeWidth="0.8"/>
      <circle cx="40" cy="50" r="1.2" fill="rgba(61,85,54,.6)"/>
      <circle cx="55" cy="55" r="1.2" fill="rgba(61,85,54,.6)"/>
      <circle cx="70" cy="48" r="1.2" fill="rgba(61,85,54,.6)"/>
      <circle cx="170" cy="65" r="1.5" fill="rgba(138,42,31,.6)"/>
      <text x="172" y="78" fontFamily="var(--font-fell)" fontSize="7" fill="rgba(42,31,20,.55)" fontStyle="italic">✕</text>
    </svg>
  );
};
