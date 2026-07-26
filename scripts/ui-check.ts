// Theme-drift guard. Modern Atlas is the default theme (PR #102) but the
// parchment themes are still first-class, and the two are kept in sync by an
// override layer rather than by branching components. That layer is easy to get
// subtly wrong in ways nothing else catches — a build passes, one theme just
// quietly looks off. This encodes the rules that are mechanically checkable.
//
// Deliberately narrow: only rules with no legitimate exceptions are enforced,
// because a guard that cries wolf gets switched off. Things like "labels need
// uppercase in Atlas" are real conventions but have too many honest exemptions
// (source text already uppercase, free-form inputs) to assert here — those live
// in docs/design-atlas.md and CLAUDE.md instead.
//
// Usage: npx tsx scripts/ui-check.ts   (exits non-zero on any violation)

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");
const css = readFileSync(join(SRC, "styles.css"), "utf8");
const tsxFiles = readdirSync(SRC).filter((f) => f.endsWith(".tsx"));

interface Violation { rule: string; where: string; detail: string; fix: string }
const violations: Violation[] = [];

// Note on what is NOT checked: fonts. It's tempting to assert that an Atlas
// override never restates `font-family: var(--font-ui)` (the variable remap
// makes --font-body and --font-fell-sc Inter already, so it's a no-op), or that
// it never demotes a --font-display title off Cormorant. Both were tried; the
// first flags 19 lines of the Atlas author's own work in #101–#105, and the
// second has a deliberate exception in the #105 breadcrumb chip. Font choices
// here are judgement, not rule — see docs/design-atlas.md.

// ── Rule 1: ornaments must be wrappable ────────────────────────────────────
// `.fleuron { display: none }` is how Atlas drops the parchment ✦ flourishes,
// which only works if the ✦ sits in a real span — see the Fleurons component's
// doc comment. A bare ✦ in JSX text can't be reached by the theme layer.
//
// The allowlist is the set of surfaces that are still parchment-only ceremony
// and have not been through an Atlas pass. It is a migration to-do list, not a
// blessing: shrinking it is the goal. Everything else must use <Fleurons> or an
// explicit className="fleuron" span.
// Classes Atlas hides outright, so any ornament nested inside one is already
// unreachable in Atlas and needs no wrapper of its own (.scratch-divider is the
// case that matters: [data-theme="modern"] drops the whole rule).
const ATLAS_HIDDEN_CLASSES = [...css.matchAll(
  /\[data-theme="modern"\]\s+\.([a-z-]+)[^{]*\{[^}]*display:\s*none/g,
)].map((m) => m[1]);

const ORNAMENT_ALLOWLIST: Record<string, string> = {
  "App.tsx": "boot splash + 'pages will not turn' error screen — full-bleed ceremony, no Atlas pass yet",
  "auth.tsx": "gate / name / membership screens — full-bleed ceremony, no Atlas pass yet",
  "join.tsx": "invite summons screen — full-bleed ceremony, no Atlas pass yet",
  "campaign.tsx": "charter title + section rules — no Atlas pass yet",
  "events.tsx": "date-group headings + scratch divider — no Atlas pass yet",
  "board.tsx": "wax seals, default faction sigil, scratch divider — decorative props, not labels",
};
for (const file of tsxFiles) {
  if (file in ORNAMENT_ALLOWLIST) continue;
  const text = readFileSync(join(SRC, file), "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.includes("✦")) return;
    // Fine: inside a Fleurons element, inside a fleuron span, in a comment
    // explaining the convention, or inside an element Atlas hides entirely.
    if (/Fleurons|className="fleuron"|^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (ATLAS_HIDDEN_CLASSES.some((c) => line.includes(`"${c}"`))) return;
    violations.push({
      rule: "bare-ornament",
      where: `${file}:${i + 1}`,
      detail: `Bare ✦ in JSX: ${line.trim().slice(0, 72)}`,
      fix: "Wrap it in <Fleurons> so [data-theme=\"modern\"] .fleuron can hide it.",
    });
  });
}

// ── Rule 2: every dark theme declares color-scheme: dark ───────────────────
// Native <select> popups are painted by the OS. A dark theme missing from the
// color-scheme list renders light-on-white options and the menu vanishes — the
// exact regression PR #106 fixed, with a comment asking for this to be kept up.
{
  const declared = new Set<string>();
  const themeBlocks = css.matchAll(/\[data-theme="([a-z]+)"\]\s*\{/g);
  for (const m of themeBlocks) declared.add(m[1]);
  const darkList = css.match(/((?:\[data-theme="[a-z]+"\],?\s*)+)\{\s*color-scheme:\s*dark/);
  const dark = new Set([...(darkList?.[1].matchAll(/"([a-z]+)"/g) ?? [])].map((m) => m[1]));
  // Themes whose variable block redefines the canvas to a dark value.
  for (const theme of declared) {
    const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
    const canvas = block?.[1].match(/--vellum:\s*(#[0-9a-f]{3,6})/i)?.[1];
    if (!canvas) continue;
    const hex = canvas.length === 4
      ? canvas.slice(1).split("").map((c) => c + c).join("")
      : canvas.slice(1);
    const lum = parseInt(hex.slice(0, 2), 16) + parseInt(hex.slice(2, 4), 16) + parseInt(hex.slice(4, 6), 16);
    if (lum < 300 && !dark.has(theme)) {
      violations.push({
        rule: "dark-theme-color-scheme",
        where: "styles.css",
        detail: `Theme "${theme}" has a dark canvas (${canvas}) but isn't in the color-scheme: dark list.`,
        fix: `Add [data-theme="${theme}"] to that list, or its native select popups render light-on-white.`,
      });
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
if (violations.length === 0) {
  console.log("\nui-check: no theme drift.\n");
  process.exit(0);
}
const byRule = new Map<string, Violation[]>();
for (const v of violations) {
  const list = byRule.get(v.rule);
  if (list) list.push(v); else byRule.set(v.rule, [v]);
}
console.log("");
for (const [rule, list] of byRule) {
  console.log(`${rule} — ${list.length}`);
  for (const v of list) {
    console.log(`  ${v.where}\n    ${v.detail}\n    → ${v.fix}`);
  }
  console.log("");
}
console.log(`ui-check: ${violations.length} violation(s).\n`);
process.exit(1);
