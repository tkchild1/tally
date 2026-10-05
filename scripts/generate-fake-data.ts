import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateFakeExports } from '../src/lib/fake';

/**
 * Writes deterministic FAKE QFX exports to sample-data/.
 * Usage: npm run fake [-- --end 2026-01-02 --months 7 --seed 42]
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const endDate = arg('end') ?? '2026-01-02';
const months = Number(arg('months') ?? 7);
const seed = Number(arg('seed') ?? 42);

const outDir = join(process.cwd(), 'sample-data');
mkdirSync(outDir, { recursive: true });

for (const file of generateFakeExports({ seed, endDate, months })) {
  writeFileSync(join(outDir, file.fileName), file.text, 'utf8');
  console.log(`wrote sample-data/${file.fileName}`);
}
