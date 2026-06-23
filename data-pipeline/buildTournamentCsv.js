/**
 * Merges data-pipeline/output/player_stats_<surface>.csv (decayed p1-p6,
 * computed separately per court surface) into the matching
 * public/data/smash_*.csv file, overwriting only p1-p6 and leaving
 * id/name/first/last/us_seed/us_rd untouched. US Open is hard, French Open
 * is clay, Wimbledon is grass — each tournament's players get stats
 * computed from their matches on that specific surface, not a blended
 * all-surfaces average.
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const SURFACE_BY_FILE = {
  'smash_us.csv': 'hard',
  'smash_fr.csv': 'clay',
  'smash_wb.csv': 'grass',
};

function main() {
  // Optional suffix (e.g. "upset") writes to a separate output file using
  // the normal smash_*.csv as a template for id/name/seed/round columns,
  // instead of overwriting the default calibrated CSV.
  const suffixArg = process.argv[2];
  const suffix = suffixArg ? `_${suffixArg}` : '';
  const tour = process.argv[3] || 'atp';
  const ns = tour === 'wta' ? 'women' : '';
  const OUTPUT_DIR = path.join(__dirname, 'output', ns);
  const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data', ns);
  if (!fs.existsSync(PUBLIC_DATA_DIR)) fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });

  for (const [file, surface] of Object.entries(SURFACE_BY_FILE)) {
    const statsPath = path.join(OUTPUT_DIR, `player_stats_${surface}${suffix}.csv`);
    if (!fs.existsSync(statsPath)) {
      console.warn(`  skip ${file}: missing ${statsPath} — run computeStats.js first.`);
      continue;
    }
    const { data: statsRows } = Papa.parse(fs.readFileSync(statsPath, 'utf8'), { header: true });
    const statsById = new Map(statsRows.filter((r) => r.id).map((r) => [r.id, r]));

    const templatePath = path.join(PUBLIC_DATA_DIR, file);
    if (!fs.existsSync(templatePath)) {
      console.warn(`  skip ${file}: not found`);
      continue;
    }
    const csvPath = suffix
      ? path.join(PUBLIC_DATA_DIR, file.replace('.csv', `${suffix}.csv`))
      : templatePath;
    const { data: rows, meta } = Papa.parse(fs.readFileSync(templatePath, 'utf8'), { header: true });
    const fields = meta.fields.includes('p6') ? meta.fields : [...meta.fields, 'p6'];

    let updated = 0;
    let missing = 0;
    const merged = rows.filter((r) => r.id).map((row) => {
      const stat = statsById.get(row.id);
      if (!stat) {
        missing++;
        // p6 is a new column — give rows with no surface-specific data yet
        // a neutral fallback instead of leaving it blank.
        return { ...row, p6: row.p6 || '0.05' };
      }
      updated++;
      return { ...row, p1: stat.p1, p2: stat.p2, p3: stat.p3, p4: stat.p4, p5: stat.p5, p6: stat.p6 };
    });

    fs.writeFileSync(csvPath, Papa.unparse({ fields, data: merged }));
    console.log(`  ${file} (${surface}): updated ${updated} players, ${missing} kept as-is (no ${surface}-court match data)`);
  }

  // country/age/year-record only apply to the base files (the H2H hero
  // doesn't need them in the upset-mode variant)
  if (!suffix) mergePlayerFacts(OUTPUT_DIR, PUBLIC_DATA_DIR);
}

// Adds country/age/this-year-W-L (for that file's surface) into each base
// smash_*.csv, from data-pipeline/output/player_facts.json (computeMatchupFacts.js).
function mergePlayerFacts(OUTPUT_DIR, PUBLIC_DATA_DIR) {
  const factsPath = path.join(OUTPUT_DIR, 'player_facts.json');
  if (!fs.existsSync(factsPath)) {
    console.warn('  skip player facts: missing output/player_facts.json — run computeMatchupFacts.js first.');
    return;
  }
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));

  for (const [file, surface] of Object.entries(SURFACE_BY_FILE)) {
    const csvPath = path.join(PUBLIC_DATA_DIR, file);
    if (!fs.existsSync(csvPath)) continue;
    const { data: rows, meta } = Papa.parse(fs.readFileSync(csvPath, 'utf8'), { header: true });
    // recent_w/recent_l (last 10 matches, any surface) is a per-player fact,
    // independent of who they're currently matched against — it must NOT be
    // sourced from the H2H pair record (h2h.json only has an entry for pairs
    // that have actually played each other, so any matchup with zero career
    // meetings would otherwise show no recent form at all, even though both
    // players individually have one).
    const newCols = ['country', 'age', 'year_w', 'year_l', 'recent_w', 'recent_l'];
    const fields = [...meta.fields, ...newCols.filter((c) => !meta.fields.includes(c))];

    const merged = rows.filter((r) => r.id).map((row) => {
      const f = facts[row.id];
      if (!f) return row;
      const record = f.yearRecord?.[surface] || { w: 0, l: 0 };
      const recent = f.recentForm || { w: 0, l: 0 };
      return {
        ...row,
        country: f.country || '',
        age: f.age ?? '',
        year_w: record.w,
        year_l: record.l,
        recent_w: recent.w,
        recent_l: recent.l,
      };
    });

    fs.writeFileSync(csvPath, Papa.unparse({ fields, data: merged }));
    console.log(`  ${file}: merged country/age/year-record/recent-form for ${merged.length} players`);
  }
}

main();
