import type { Db } from '../db/client';
import { importFiles, type FileImportResult } from '../db/importer';
import { todayISO } from '../lib/dates';
import { generateFakeExports } from '../lib/fake';

/** Feeds fake exports through the real import pipeline. */
export function loadDemoData(db: Db): Promise<FileImportResult[]> {
  const files = generateFakeExports({ seed: 42, endDate: todayISO(), months: 7 }).map((f) => ({
    name: f.fileName,
    text: f.text,
  }));
  return importFiles(db, files);
}
