# AGENTS.md

`README.md` is the build spec for Tally. Read it fully before changing anything.
The two sections below are copied verbatim from the README (sections 3 and 17).

## Hard invariants (security, data, correctness)

These are non-negotiable.

### Security and privacy
1. **No real financial data in the repo, ever.** Not in code, tests, fixtures, docs, commit messages, or screenshots.
   `.gitignore` must exclude `*.qfx`, `*.qbo`, `*.ofx`, `*.csv`, `*.budgetbackup.json`, `exports/`, `private/`
   (with an explicit allow-list exception for `sample-data/*.qfx`, which are **fake and generated**).
2. **No network calls with user data.** The app makes no `fetch`/XHR/analytics/telemetry calls to anything (aside from
   the service worker loading its own static assets). No third-party scripts, fonts, or CDNs at runtime.
3. **Never store a full account or card number.** Store only the last 4 digits plus a SHA-256 hash used as a stable key.
   The hash only avoids storing plaintext; it is not encryption (a 16-digit card number is brute-forceable from its hash).
   The real protection is device encryption and passcode. Say this honestly in the docs.
4. **Bank FITIDs can embed the full card number.** (Real card exports do: the FITID starts with the 16-digit card number.)
   Strip the account number out of the FITID before storing it (replace with a placeholder like `{ACCT}`).
5. **Never log or print** raw account numbers, FITIDs, transaction descriptions, or balances: not in `console.log`, error
   messages, or test output. Errors may mention counts and field names only.
6. Backups are plain JSON containing the whole transaction history. Offer **optional passphrase encryption**
   (WebCrypto AES-GCM, key from PBKDF2-SHA256 with >= 600,000 iterations, random salt and IV; format versioned) and warn
   when exporting unencrypted.
7. No secrets in code. (There should be none: no API keys exist in this app.)

### Correctness
8. **Money is integer cents.** Never store or compute with floating-point dollars. Parse amount strings with string
   math. Sign convention everywhere: **money out is negative, money in is positive.**
9. **Dates are calendar dates (`YYYY-MM-DD`), never timestamps.** Bank exports fake the time (checking uses `000000`, cards
   use `120000`); timezone conversion would shift transactions to the wrong day. Keep only the first 8 digits of OFX dates. Do
   date math in UTC on the calendar date. In Postgres use `DATE`, and `SELECT col::text` so the driver does not turn it
   into a JS `Date`.
10. **Dedupe by `(account_id, fitid)`.** Re-importing an overlapping file must create zero duplicates, and must be a no-op
    when the same file is imported twice.
11. **Classification is idempotent and respects user edits.** Anything the user edited by hand is "locked" and is never
    changed by automatic re-classification.
12. **Transfers between the user's own accounts are neither spending nor income.** (See 9.3.)
13. Pure logic (parsing, classification, subscription detection, balances) lives in `src/lib/` with **no DOM, no React,
    no DB imports**, so it is trivially unit-testable.

## Conventions

- Read `README.md` before changing anything; keep it accurate when behavior or decisions change.
- Obey the **Hard invariants** (section 3). Specifically: no real financial data anywhere; money in integer cents; dates as `YYYY-MM-DD` strings; no network calls with user data; never log account numbers/descriptions/balances.
- Pure logic stays in `src/lib` with no React/DOM/DB imports. SQL lives only in `src/db`. The only place PGlite is constructed is `src/db/client.ts`.
- Every new rule in classification/subscription/merchant logic comes with a unit test using fake data.
- TypeScript strict; no `any` unless justified in a comment. Prefer small functions and explicit types at module boundaries.
- Scripts and tooling must run on **Windows** (no bash-only commands).
- Before finishing any task: `npm run typecheck && npm test`. For UI work, also run `npm run dev` and check on a phone-sized viewport.
- Commit messages: imperative, small, one concern each.
- When a library's real API/types differ from this spec, follow the library and update the README.
