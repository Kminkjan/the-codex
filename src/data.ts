export type Status = "whispered" | "pursuing" | "resolved" | "lost";
export type KindKey =
  | "people"
  | "locations"
  | "quests"
  | "goals"
  | "factions"
  | "items"
  | "lore"
  | "sessions";

export interface Session {
  id: string;
  num: number;
  title: string;
  date: string;
}

export interface Person {
  id: string;
  name: string;
  epithet?: string;
  race?: string;
  role?: string;
  disposition?: string;
  alignment?: string;
  location?: string;
  faction?: string;
  lastSeen?: string;
  imageUrl?: string;
  notes?: string;
}

export interface Location {
  id: string;
  name: string;
  kind: string;
  desc?: string;
  region?: string;
  ruler?: string;
  imageUrl?: string;
  notes?: string;
}

export interface Quest {
  id: string;
  title: string;
  status?: Status;
  reward?: string;
  giver?: string;
  session?: string;
  desc?: string;
  hooks?: string;
}

export interface Goal {
  id: string;
  text: string;
  owner: string;
  kind: string;
  status?: Status;
}

export interface Faction {
  id: string;
  name: string;
  sigil: string;
  desc?: string;
  allegiance?: string;
  imageUrl?: string;
}

export interface Item {
  id: string;
  name: string;
  kind: string;
  desc?: string;
  imageUrl?: string;
}

export interface Lore {
  id: string;
  title: string;
  text: string;
}

export type BoardPosition = { x: number; y: number; rot: number; kind: KindKey };

export interface PresenceUser {
  id: string;
  name: string;
  initials: string;
  color: string;
  active: boolean;
}

export interface PartyNote {
  author: string;
  when: string;
  text: string;
  hand: boolean;
}

export type Connection = [string, string, string];

export type Entity =
  & (Person | Location | Quest | Goal | Faction | Item | Lore | Session)
  & { _kind?: KindKey; _kindLabel?: string };

export interface Campaign {
  id: string;
  title: string;
  subtitle: string;
  sessions: Session[];
  people: Person[];
  locations: Location[];
  quests: Quest[];
  goals: Goal[];
  factions: Faction[];
  items: Item[];
  lore: Lore[];
  connections: Connection[];
  board: Record<string, BoardPosition>;
  presence: PresenceUser[];
  notes: Record<string, PartyNote[]>;
}

export const CURRENT_CAMPAIGN_ID = "fendwick";

export interface KindDef {
  key: KindKey;
  label: string;
  plural: string;
  list: () => any[];
  color: string;
}

export function buildKinds(campaign: Campaign): KindDef[] {
  return [
    { key: "people",    label: "Known People",  plural: "people",    list: () => campaign.people,    color: "var(--bloodred)" },
    { key: "locations", label: "Locations",     plural: "locations", list: () => campaign.locations, color: "var(--teal-deep)" },
    { key: "quests",    label: "Quests",        plural: "quests",    list: () => campaign.quests,    color: "var(--mustard)" },
    { key: "goals",     label: "Goals",         plural: "goals",     list: () => campaign.goals,     color: "var(--forest)" },
    { key: "factions",  label: "Factions",      plural: "factions",  list: () => campaign.factions,  color: "var(--slate)" },
    { key: "items",     label: "Items",         plural: "items",     list: () => campaign.items,     color: "#8a6a28" },
    { key: "lore",      label: "Lore",          plural: "lore",      list: () => campaign.lore,      color: "var(--forest-pale)" },
  ];
}

export function findEntity(
  campaign: Campaign,
  id: string | null | undefined,
): (Entity & Record<string, any>) | null {
  if (!id) return null;
  const kinds = buildKinds(campaign);
  for (const k of kinds) {
    const found = k.list().find((e: any) => e.id === id);
    if (found) return { ...found, _kind: k.key, _kindLabel: k.label };
  }
  const sess = campaign.sessions.find((s) => s.id === id);
  if (sess) return { ...sess, _kind: "sessions", _kindLabel: "Sessions", name: sess.title } as any;
  return null;
}

export function entityLabel(e: any): string {
  return e?.name || e?.title || e?.text || "—";
}
