import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { redactQfx } from '../src/lib/redact';

/**
 * Usage: npm run redact -- path/to/file.qfx [--scrub-names] [--scrub-amounts]
 * Writes <name>.redacted.qfx next to the input and prints a counts-only report.
 * Exits non-zero if the post-check finds long digit runs left behind.
 */
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: npm run redact -- path/to/file.qfx [--scrub-names] [--scrub-amounts]');
  process.exit(2);
}
if (!existsSync(input)) {
  console.error('Input file not found.');
  process.exit(2);
}

const ext = extname(input);
const output = join(dirname(input), `${basename(input, ext)}.redacted${ext || '.qfx'}`);
if (existsSync(output)) {
  console.error(`Refusing to overwrite existing ${basename(output)}. Delete it first.`);
  process.exit(2);
}

const { output: text, report } = redactQfx(readFileSync(input, 'utf8'), {
  scrubNames: args.includes('--scrub-names'),
  scrubAmounts: args.includes('--scrub-amounts'),
});
writeFileSync(output, text, 'utf8');

console.log(`Wrote ${basename(output)}`);
console.log(JSON.stringify(report, null, 2));
if (!report.postCheckPassed) {
  console.error('POST-CHECK FAILED: long digit runs remain in the tags listed above. Review before sharing.');
  process.exit(1);
}
