/**
 * Merges data-pipeline/output/player_stats.csv (decayed p1-p5) into the
 * existing public/data/smash_*.csv files, overwriting only p1-p5 and
 * leaving id/name/first/last/us_seed/us_rd untouched.
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const OUTPUT_DIR = path.join(__dirname, 'output');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const TARGET_FILES = ['smash_us.csv', 'smash_fr.csv', 'smash_wb.csv'];

function main() {
  const statsPath = path.join(OUTPUT_DIR, 'player_stats.csv');
  if (!fs.existsSync(statsPath)) {
    console.error('Missing data-pipeline/output/player_stats.csv — run computeStats.js first.');
    process.exit(1);
  }
  const { data: statsRows } = Papa.parse(fs.readFileSync(statsPath, 'utf8'), { header: true });
  const statsById = new Map(statsRows.filter((r) => r.id).map((r) => [r.id, r]));

  for (const file of TARGET_FILES) {
    const csvPath = path.join(PUBLIC_DATA_DIR, file);
    if (!fs.existsSync(csvPath)) {
      console.warn(`  skip ${file}: not found`);
      continue;
    }
    const { data: rows, meta } = Papa.parse(fs.readFileSync(csvPath, 'utf8'), { header: true });

    let updated = 0;
    let missing = 0;
    const merged = rows.filter((r) => r.id).map((row) => {
      const stat = statsById.get(row.id);
      if (!stat) {
        missing++;
        return row;
      }
      updated++;
      return { ...row, p1: stat.p1, p2: stat.p2, p3: stat.p3, p4: stat.p4, p5: stat.p5 };
    });

    fs.writeFileSync(csvPath, Papa.unparse({ fields: meta.fields, data: merged }));
    console.log(`  ${file}: updated ${updated} players, ${missing} kept as-is (no recent match data)`);
  }
}

main();
