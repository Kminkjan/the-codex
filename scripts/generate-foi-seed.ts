// Generates supabase/migrations/0011_seed_fist_of_ilmater_content.sql from the
// Fist of Ilmater play notes (issue #20), plus a cleaned copy of the notes and
// the decoded images for docs/.
//
// Usage: node scripts/generate-foi-seed.ts [path-to-notes]
//
// Inputs:
//   - "Fist of Ilmater Notes.md" (repo root, gitignored) — the Google-Docs
//     export: `## Session N` headings for 31–90, `| Session N |` table markers
//     for 91–178, ~57 base64 image defs at the bottom.
//   - scripts/foi/head.sql   — hand-curated: locations, factions, items, lore.
//   - scripts/foi/tail.sql   — hand-curated: people, quests, arcs, events,
//     connections, board positions (anything that references session ids).
//   - scripts/foi/titles.json — { "31": "Title", ... } derived session titles.
//
// Outputs:
//   - supabase/migrations/0011_seed_fist_of_ilmater_content.sql
//   - docs/fist-of-ilmater/notes.md (cleaned, images as relative paths)
//   - docs/fist-of-ilmater/images/imageN.png (decoded)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGN = "fist-of-ilmater";
const STORAGE_BASE =
  "https://nsemknuzupcnvctevgfd.supabase.co/storage/v1/object/public/entity-images/foi";

const notesPath = process.argv[2] ?? join(ROOT, "Fist of Ilmater Notes.md");
if (!existsSync(notesPath)) {
  console.error(`Notes file not found: ${notesPath}`);
  console.error("Pass the path to the original export as the first argument.");
  process.exit(1);
}
const raw = readFileSync(notesPath, "utf8");
const lines = raw.split("\n");

// ---------------------------------------------------------------------------
// Split content from the base64 image definitions at the bottom
// ---------------------------------------------------------------------------

const firstDef = lines.findIndex((l) => /^\[image\d+\]:\s*<data:/.test(l));
const contentLines = firstDef === -1 ? lines : lines.slice(0, firstDef);
const defLines = firstDef === -1 ? [] : lines.slice(firstDef);

const images = new Map<string, Buffer>(); // "image7" -> png bytes
for (const l of defLines) {
  const m = l.match(/^\[(image\d+)\]:\s*<data:image\/png;base64,([A-Za-z0-9+/=]+)>/);
  if (m) images.set(m[1], Buffer.from(m[2], "base64"));
}

// ---------------------------------------------------------------------------
// Parse sessions
// ---------------------------------------------------------------------------

interface Session {
  key: string; // "37.5" stays distinct from "37"
  num: number;
  inGameDate: string | null;
  realDate: string | null;
  body: string[]; // raw lines, cleaned later
}

const HEADING = /^##\s+Session\s+(\d+(?:\.\d+)?)\s*(?:\{#[^}]*\})?\s*$/;
const TABLE = /^\|\s*Session\s+(\d+(?:\.\d+)?)\s*\|/;
const DATE_ROW = /^\|\s*\*\*(Date|In-game date|Real world date)\*\*\s*\|\s*(.*?)\s*\|/;
const TABLE_SEP = /^\|\s*:?-+/;
// Skipped structural headings; arc markers are asserted against expectations.
const SKIP_HEADING = /^##\s*(?:—|BAROVIA SAGA|END OF BAROVIA SAGA|Read probably.*)?\s*$/;

const sessions: Session[] = [];
const arcMarkers: { marker: string; beforeSession: string | null }[] = [];
let current: Session | null = null;

for (let i = 0; i < contentLines.length; i++) {
  const line = contentLines[i];

  const h = line.match(HEADING);
  const t = h ? null : line.match(TABLE);
  const startKey = h?.[1] ?? t?.[1];
  if (startKey) {
    current = {
      key: startKey,
      num: Math.floor(Number(startKey)),
      inGameDate: null,
      realDate: null,
      body: [],
    };
    sessions.push(current);
    if (t) {
      // Consume the table's separator and its date rows ("Date" /
      // "In-game date" / "Real world date"), in whatever order they appear.
      while (i + 1 < contentLines.length) {
        const next = contentLines[i + 1];
        if (TABLE_SEP.test(next)) {
          i++;
          continue;
        }
        const d = next?.match(DATE_ROW);
        if (!d) break;
        const value = unescapeGdoc(d[2]).trim();
        // "-" / "—" placeholder cells mean the table had no date that week.
        if (!/^[-—\s?]*$/.test(value)) {
          if (d[1] === "Real world date") current.realDate = value;
          else current.inGameDate = value;
        }
        i++;
      }
    }
    continue;
  }

  if (/^##\s*(BAROVIA SAGA|END OF BAROVIA SAGA)\s*$/.test(line)) {
    arcMarkers.push({
      marker: line.replace(/^##\s*/, "").trim(),
      beforeSession: null, // filled below: the next session parsed
    });
  }
  if (SKIP_HEADING.test(line)) continue;
  if (!current) continue; // preamble before Session 31
  // Tag pending arc markers with the session they precede.
  current.body.push(line);
}

// Arc markers: find which session follows each marker line (by re-scan order).
{
  let markerIdx = 0;
  let sessionIdx = 0;
  for (const line of contentLines) {
    if (markerIdx >= arcMarkers.length) break;
    const isStart = HEADING.test(line) || TABLE.test(line);
    if (isStart) sessionIdx++;
    if (/^##\s*(BAROVIA SAGA|END OF BAROVIA SAGA)\s*$/.test(line)) {
      arcMarkers[markerIdx].beforeSession = sessions[sessionIdx]?.key ?? null;
      markerIdx++;
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function unescapeGdoc(s: string): string {
  return s.replace(/\\([!\-=[\]().+*#~_])/g, "$1");
}

const FAERUN_MONTHS =
  "Hammer|Alturiak|Ches|Tarsakh|Mirtul|Kythorn|Flamerule|Eleasis|Eleint|Marpenoth|Uktar|Nightal";
// A line that is nothing but an (optionally bold/italic, optionally "Still")
// Faerûnian date, e.g. "**Still Eleasis 10**", "*Flamerule 1*", "Flamerule 2".
const DATE_LINE = new RegExp(
  `^[\\s*_]*(?:Still\\s+)?((?:${FAERUN_MONTHS})\\s+\\d+)[\\s*_?.:]*$`,
  "i"
);

interface CleanSession extends Session {
  summary: string;
  imageUrl: string | null;
}

const cleaned: CleanSession[] = sessions.map((s) => {
  let firstImage: string | null = null;
  const out: string[] = [];
  for (let line of s.body) {
    // Decorative separators between sessions ("\~’\~", "~'~", …)
    if (/^[\s\\~'’]+$/.test(line) && line.trim() !== "") continue;
    line = line.replace(/!\[\]\[(image\d+)\]/g, (_, name) => {
      if (!images.has(name)) return "";
      if (!firstImage) firstImage = name;
      return `![](${STORAGE_BASE}/${name}.png)`;
    });
    line = unescapeGdoc(line).replace(/[ \t]+$/u, (m) =>
      // Preserve markdown hard breaks (2+ trailing spaces), drop other tail ws.
      m.includes("  ") ? "  " : ""
    );
    out.push(line);
  }
  // Collapse 3+ blank lines and trim the block.
  const body = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let inGameDate = s.inGameDate;
  if (!inGameDate) {
    for (const line of body.split("\n")) {
      const m = line.match(DATE_LINE);
      if (m) {
        inGameDate = m[1];
        break;
      }
    }
  }

  return {
    ...s,
    inGameDate,
    summary: body,
    imageUrl: firstImage ? `${STORAGE_BASE}/${firstImage}.png` : null,
  };
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const problems: string[] = [];
for (let i = 1; i < cleaned.length; i++) {
  if (Number(cleaned[i].key) <= Number(cleaned[i - 1].key))
    problems.push(`Session order broken at ${cleaned[i - 1].key} -> ${cleaned[i].key}`);
}
for (const s of cleaned) {
  if (!s.summary) problems.push(`Session ${s.key} has an empty summary`);
  if (/!\[\]\[image|base64,/.test(s.summary))
    problems.push(`Session ${s.key} still contains raw image markup`);
}
const barovia = arcMarkers.find((m) => m.marker === "BAROVIA SAGA");
const baroviaEnd = arcMarkers.find((m) => m.marker === "END OF BAROVIA SAGA");
if (barovia?.beforeSession !== "78")
  problems.push(`BAROVIA SAGA marker precedes session ${barovia?.beforeSession}, expected 78`);
if (baroviaEnd?.beforeSession !== "147")
  problems.push(`END OF BAROVIA SAGA precedes session ${baroviaEnd?.beforeSession}, expected 147`);
if (problems.length) {
  console.error("Validation failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

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

const migration = [
  `-- Issue #20: seed the Fist of Ilmater campaign content (sessions 31–178`,
  `-- imported from the play notes, plus a first-pass entity extraction).`,
  `-- Generated by scripts/generate-foi-seed.ts — do not edit by hand.`,
  ``,
  readPart("scripts/foi/head.sql", "locations/factions/items/lore"),
  ``,
  `-- ==========================================================================`,
  `-- Sessions ${cleaned[0].key}–${cleaned[cleaned.length - 1].key} (generated from the play notes)`,
  `-- ==========================================================================`,
  ``,
  sessionSql,
  ``,
  readPart("scripts/foi/tail.sql", "people/quests/arcs/events/connections/board"),
  ``,
].join("\n");

writeFileSync(join(ROOT, "supabase/migrations/0011_seed_fist_of_ilmater_content.sql"), migration);

// Docs copy: same cleanup, but relative image paths and original structure.
const docsDir = join(ROOT, "docs/fist-of-ilmater");
mkdirSync(join(docsDir, "images"), { recursive: true });
for (const [name, buf] of images) writeFileSync(join(docsDir, "images", `${name}.png`), buf);

const docsNotes = cleaned
  .map((s) => {
    const title = titles[s.key] ? ` — ${titles[s.key]}` : "";
    const date = s.inGameDate ? `\n*${s.inGameDate}*\n` : "";
    const body = s.summary.replaceAll(`${STORAGE_BASE}/`, "images/");
    return `## Session ${s.key}${title}\n${date}\n${body}`;
  })
  .join("\n\n");
writeFileSync(
  join(docsDir, "notes.md"),
  `# Fist of Ilmater — Play Notes\n\nSessions ${cleaned[0].key}–${cleaned[cleaned.length - 1].key}, cleaned from the original Google-Docs export by scripts/generate-foi-seed.ts.\nImages live in [images/](images/) and in the app's entity-images storage bucket.\n\n${docsNotes}\n`
);

// Report
console.log(`Parsed ${cleaned.length} sessions, ${images.size} images.`);
console.log(`num     date                          bytes  image  title`);
for (const s of cleaned) {
  console.log(
    `${s.key.padEnd(7)} ${(s.inGameDate ?? "—").padEnd(29)} ${String(s.summary.length).padStart(5)}  ${s.imageUrl ? "yes " : "    "}  ${titles[s.key] ?? ""}`
  );
}
const withDate = cleaned.filter((s) => s.inGameDate).length;
const withTitle = cleaned.filter((s) => titles[s.key]).length;
console.log(`\n${withDate}/${cleaned.length} dated, ${withTitle}/${cleaned.length} titled.`);
