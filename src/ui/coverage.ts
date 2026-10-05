import type { Db } from '../db/client';
import { listAccounts, listImports, lastImportDate, type AccountRow } from '../db/repo';
import { coverageGaps, mergeCoverage, type DateRange } from '../lib/balance';

export interface AccountCoverage {
  account: AccountRow;
  ranges: DateRange[];
  gaps: DateRange[];
}

export interface CoverageReport {
  accounts: AccountCoverage[];
  lastImport: string | null;
}

export async function loadCoverage(db: Db): Promise<CoverageReport> {
  const [accounts, imports, lastImport] = await Promise.all([listAccounts(db), listImports(db), lastImportDate(db)]);
  return {
    lastImport,
    accounts: accounts.map((account) => {
      const ranges = mergeCoverage(
        imports
          .filter((i) => i.account_id === account.id && i.range_start && i.range_end)
          .map((i) => ({ start: i.range_start!, end: i.range_end! })),
      );
      return { account, ranges, gaps: coverageGaps(ranges) };
    }),
  };
}
