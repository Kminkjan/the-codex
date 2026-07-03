// Generates supabase/migrations/0012_seed_fist_of_ilmater_sessions_179_191.sql
// from an updated Fist of Ilmater notes export (issue #20 follow-up).
//
// This is the ADDITIVE sibling of generate-foi-seed.ts. 0011 already seeded
// sessions 31–178 and is applied to prod; rather than rewrite it, this script
// emits only the sessions at or beyond FROM_SESSION and the hand-curated
// entities that go with them, all with idempotent inserts.
//
// Usage: node scripts/generate-foi-0012.ts ["path to updated notes"]
//   Defaults to the updated export dropped at the repo root.
//
// Inputs:
//   - the updated Google-Docs export ("| Session N |" table markers, base64
//     image defs at the bottom). Only sessions >= FROM_SESSION are used.
//   - scripts/foi/0012_head.sql — new locations/factions/items/lore.
//   - scripts/foi/0012_tail.sql — people/arcs/quests/events/connections/board.
//   - scripts/foi/titles.json   — shared titles map (now covers 179–191).
//
// Outputs:
//   - supabase/migrations/0012_seed_fist_of_ilmater_sessions_179_191.sql
//   - docs/fist-of-ilmater/images/imageN.png for the new images (renumbered
//     from IMAGE_BASE so they never clash with 0011's image1–57).
//   - docs/fist-of-ilmater/notes.md extended with the new sessions.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGN = "fist-of-ilmater";
const STORAGE_BASE =
  "https://nsemknuzupcnvctevgfd.supabase.co/storage/v1/object/public/entity-images/foi";
const FROM_SESSION = 179; // 148–178 already live via 0011 (unchanged).
const IMAGE_BASE = 58; // 0011 shipped image1–57; keep new names disjoint.
const MIGRATION = "supabase/migrations/0012_seed_fist_of_ilmater_sessions_179_191.sql";

const notesPath = process.argv[2] ?? join(ROOT, "Fist of Ilmater Notes.md");
if (!existsSync(notesPath)) {
  console.error(`Notes file not found: ${notesPath}`);
  console.error("Pass the path to the updated export as the first argument.");
  process.exit(1);
}
const lines = readFileSync(notesPath, "utf8").split("\n");

// Split content from the base64 image definitions at the bottom.
const firstDef = lines.findIndex((l) => /^\[image\d+\]:\s*<data:/.test(l));
const contentLines = firstDef === -1 ? lines : lines.slice(0, firstDef);
const defLines = firstDef === -1 ? [] : lines.slice(firstDef);

const rawImages = new Map<string, Buffer>(); // "image3" -> png bytes (export numbering)
for (const l of defLines) {
  const m = l.match(/^\[(image\d+)\]:\s*<data:image\/png;base64,([A-Za-z0-9+/=]+)>/);
  if (m) rawImages.set(m[1], Buffer.from(m[2], "base64"));
}

// Parse sessions (same markers as generate-foi-seed.ts).
interface Session {
  key: string;
  num: number;
  inGameDate: string | null;
  realDate: string | null;
  body: string[];
}

const HEADING = /^##\s+Session\s+(\d+(?:\.\d+)?)\s*(?:\{#[^}]*\})?\s*$/;
const TABLE = /^\|\s*Session\s+(\d+(?:\.\d+)?)\s*\|/;
const DATE_ROW = /^\|\s*\*\*(Date|In-game date|Real world date)\*\*\s*\|\s*(.*?)\s*\|/;
const TABLE_SEP = /^\|\s*:?-+/;
// Stray structural headings in the export (arc/section dividers, GM notes) —
// drop them rather than fold them into the current session's body. Mirrors
// the SKIP_HEADING filter in generate-foi-seed.ts; "## Long Rest" and other
// meaningful sub-headings don't match, so they stay in the body.
const SKIP_HEADING = /^##\s*(?:—|BAROVIA SAGA|END OF BAROVIA SAGA|Read probably.*)?\s*$/;

function unescapeGdoc(s: string): string {
  return s.replace(/\\([!\-=[\]().+*#~_])/g, "$1");
}

const sessions: Session[] = [];
let current: Session | null = null;
for (let i = 0; i < contentLines.length; i++) {
  const line = contentLines[i];
  const h = line.match(HEADING);
  const t = h ? null : line.match(TABLE);
  const startKey = h?.[1] ?? t?.[1];
  if (startKey) {
    current = { key: startKey, num: Math.floor(Number(startKey)), inGameDate: null, realDate: null, body: [] };
    sessions.push(current);
    if (t) {
      while (i + 1 < contentLines.length) {
        const next = contentLines[i + 1];
        if (TABLE_SEP.test(next)) { i++; continue; }
        const d = next?.match(DATE_ROW);
        if (!d) break;
        const value = unescapeGdoc(d[2]).trim();
        if (!/^[-—\s?]*$/.test(value)) {
          if (d[1] === "Real world date") current.realDate = value;
          else current.inGameDate = value;
        }
        i++;
      }
    }
    continue;
  }
  if (SKIP_HEADING.test(line)) continue;
  if (!current) continue;
  current.body.push(line);
}

const FAERUN_MONTHS =
  "Hammer|Alturiak|Ches|Tarsakh|Mirtul|Kythorn|Flamerule|Eleasis|Eleint|Marpenoth|Uktar|Nightal";
const DATE_LINE = new RegExp(
  `^[\\s*_]*(?:Still\\s+)?((?:${FAERUN_MONTHS})\\s+\\d+)[\\s*_?.:]*$`,
  "i"
);

const selected = sessions.filter((s) => s.num >= FROM_SESSION);
if (!selected.length) {
  console.error(`No sessions at or beyond ${FROM_SESSION} found in ${notesPath}.`);
  process.exit(1);
}

// Renumber images referenced by the selected sessions, in first-appearance
// order, starting at IMAGE_BASE. Only these get decoded and uploaded.
const rename = new Map<string, string>(); // "image3" -> "image58"
const usedImages = new Map<string, Buffer>(); // "image58" -> bytes
let nextImage = IMAGE_BASE;
function mapImage(name: string): string | null {
  if (!rawImages.has(name)) return null;
  if (!rename.has(name)) {
    const newName = `image${nextImage++}`;
    rename.set(name, newName);
    usedImages.set(newName, rawImages.get(name)!);
  }
  return rename.get(name)!;
}

interface CleanSession extends Session {
  summary: string;
  imageUrl: string | null;
}

const cleaned: CleanSession[] = selected.map((s) => {
  let firstImage: string | null = null;
  const out: string[] = [];
  for (let line of s.body) {
    if (/^[\s\\~'’]+$/.test(line) && line.trim() !== "") continue;
    line = line.replace(/!\[\]\[(image\d+)\]/g, (_, name) => {
      const mapped = mapImage(name);
      if (!mapped) return "";
      if (!firstImage) firstImage = mapped;
      return `![](${STORAGE_BASE}/${mapped}.png)`;
    });
    line = unescapeGdoc(line).replace(/[ \t]+$/u, (m) => (m.includes("  ") ? "  " : ""));
    out.push(line);
  }
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  let inGameDate = s.inGameDate;
  if (!inGameDate) {
    for (const line of body.split("\n")) {
      const m = line.match(DATE_LINE);
      if (m) { inGameDate = m[1]; break; }
    }
  }
  return { ...s, inGameDate, summary: body, imageUrl: firstImage ? `${STORAGE_BASE}/${firstImage}.png` : null };
});

// Validation.
const problems: string[] = [];
for (let i = 1; i < cleaned.length; i++) {
  if (Number(cleaned[i].key) <= Number(cleaned[i - 1].key))
    problems.push(`Session order broken at ${cleaned[i - 1].key} -> ${cleaned[i].key}`);
}
for (const s of cleaned) {
  if (!s.summary) problems.push(`Session ${s.key} has an empty summary`);
  if (/!\[\]\[image|base64,/.test(s.summary)) problems.push(`Session ${s.key} still contains raw image markup`);
}
if (problems.length) {
  console.error("Validation failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

// Emit.
const titlesPath = join(ROOT, "scripts/foi/titles.json");
const titles: Record<string, string> = existsSync(titlesPath)
  ? JSON.parse(readFileSync(titlesPath, "utf8"))
  : {};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const qn = (s: string | null) => (s === null ? "null" : q(s));

const sessionSql = cleaned
  .map((s) => {
    const id = `foi-s${s.key.replace(".5", "b")}`;
    const title = titles[s.key] ?? `Session ${s.key}`;
    return (
      `insert into public.sessions (id, campaign_id, num, title, date, in_game_date, image_url, summary) values\n` +
      `  (${q(id)}, ${q(CAMPAIGN)}, ${s.num}, ${q(title)}, ${qn(s.realDate)}, ${qn(s.inGameDate)}, ${qn(s.imageUrl)}, ${q(s.summary)})\n` +
      `on conflict (id) do nothing;`
    );
  })
  .join("\n\n");

const readPart = (p: string, label: string) => {
  const full = join(ROOT, p);
  if (existsSync(full)) return readFileSync(full, "utf8").trim();
  console.warn(`WARNING: ${p} missing — emitting migration without the ${label} block.`);
  return `-- (${label} block pending: ${p} not present at generation time)`;
};

const first = cleaned[0].key;
const last = cleaned[cleaned.length - 1].key;

const migration = [
  `-- Issue #20 (follow-up): additive seed of Fist of Ilmater sessions ${first}–${last}`,
  `-- and their entities, on top of the already-applied 0011. Every statement is`,
  `-- idempotent (on conflict do nothing, not-exists guard for connections, and`,
  `-- fixed-value updates), so a re-apply is a safe no-op.`,
  `-- Generated by scripts/generate-foi-0012.ts — do not edit by hand.`,
  ``,
  readPart("scripts/foi/0012_head.sql", "locations/factions/items/lore"),
  ``,
  `-- ==========================================================================`,
  `-- Sessions ${first}–${last} (generated from the updated play notes)`,
  `-- ==========================================================================`,
  ``,
  sessionSql,
  ``,
  readPart("scripts/foi/0012_tail.sql", "people/arcs/quests/events/connections/board"),
  ``,
].join("\n");

writeFileSync(join(ROOT, MIGRATION), migration);

// Decode the new images.
const docsDir = join(ROOT, "docs/fist-of-ilmater");
mkdirSync(join(docsDir, "images"), { recursive: true });
for (const [name, buf] of usedImages) writeFileSync(join(docsDir, "images", `${name}.png`), buf);

// Extend docs/fist-of-ilmater/notes.md with the new sessions.
const notesFile = join(docsDir, "notes.md");
const newBlocks = cleaned
  .map((s) => {
    const title = titles[s.key] ? ` — ${titles[s.key]}` : "";
    const date = s.inGameDate ? `\n*${s.inGameDate}*\n` : "";
    const body = s.summary.replaceAll(`${STORAGE_BASE}/`, "images/");
    return `## Session ${s.key}${title}\n${date}\n${body}`;
  })
  .join("\n\n");

if (existsSync(notesFile)) {
  let docs = readFileSync(notesFile, "utf8").replace(/\n+$/, "");
  // Idempotent: drop any previously-appended sessions >= FROM_SESSION before
  // re-appending, so re-running the generator doesn't duplicate them.
  const cut = docs.search(new RegExp(`\\n## Session ${FROM_SESSION}\\b`));
  if (cut !== -1) docs = docs.slice(0, cut).replace(/\n+$/, "");
  docs = docs.replace(/Sessions 31[–-]\d+(?:\.\d+)?/, `Sessions 31–${last}`);
  writeFileSync(notesFile, `${docs}\n\n${newBlocks}\n`);
} else {
  console.warn(`WARNING: ${notesFile} missing — skipped docs update.`);
}

// Report.
console.log(`Parsed ${sessions.length} sessions total; selected ${cleaned.length} (>= ${FROM_SESSION}).`);
console.log(`Renumbered ${usedImages.size} images to image${IMAGE_BASE}+.`);
for (const [from, to] of rename) console.log(`  ${from} -> ${to}`);
console.log(`num     date                          bytes  image  title`);
for (const s of cleaned) {
  console.log(
    `${s.key.padEnd(7)} ${(s.inGameDate ?? "—").padEnd(29)} ${String(s.summary.length).padStart(5)}  ${s.imageUrl ? "yes " : "    "}  ${titles[s.key] ?? ""}`
  );
}
