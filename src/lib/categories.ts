export type CategoryKind = 'income' | 'expense' | 'system';

export interface CategoryDef {
  id: string;
  name: string;
  kind: CategoryKind;
  isFixed: boolean;
}

/** Seeded into `categories` on first run. Users can toggle `isFixed` later. */
export const DEFAULT_CATEGORIES: readonly CategoryDef[] = [
  { id: 'income_paycheck', name: 'Paycheck', kind: 'income', isFixed: false },
  { id: 'income_other', name: 'Other income', kind: 'income', isFixed: false },
  { id: 'housing', name: 'Housing', kind: 'expense', isFixed: true },
  { id: 'utilities', name: 'Utilities & phone', kind: 'expense', isFixed: true },
  { id: 'insurance', name: 'Insurance', kind: 'expense', isFixed: true },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'expense', isFixed: true },
  { id: 'groceries', name: 'Groceries', kind: 'expense', isFixed: false },
  { id: 'dining', name: 'Dining & coffee', kind: 'expense', isFixed: false },
  { id: 'transport', name: 'Transport & fuel', kind: 'expense', isFixed: false },
  { id: 'shopping', name: 'Shopping', kind: 'expense', isFixed: false },
  { id: 'entertainment', name: 'Entertainment', kind: 'expense', isFixed: false },
  { id: 'health', name: 'Health', kind: 'expense', isFixed: false },
  { id: 'education', name: 'Education', kind: 'expense', isFixed: false },
  { id: 'travel', name: 'Travel', kind: 'expense', isFixed: false },
  { id: 'fees', name: 'Fees & interest', kind: 'expense', isFixed: false },
  { id: 'uncategorized', name: 'Uncategorized', kind: 'expense', isFixed: false },
  { id: 'transfer', name: 'Transfer', kind: 'system', isFixed: false },
];

export type Flow = 'spend' | 'income' | 'transfer';

export interface DefaultRule {
  /** Matched against `MERCHANT | RAW NAME MEMO`, all uppercase. */
  pattern: RegExp;
  categoryId: string;
  /** Rules only fire for this flow, so a paycheck never becomes "Education". */
  flow: 'spend' | 'income';
}

/**
 * Ordered: first match wins, so more specific rules come first (UBER EATS before UBER).
 * Users teach the app everything else via merchant rules.
 */
export const DEFAULT_RULES: readonly DefaultRule[] = [
  // Income
  { flow: 'income', categoryId: 'income_paycheck', pattern: /PAYROLL|DIRECT DEP|DIR DEP|SALARY|\bPAYCHECK/ },
  { flow: 'income', categoryId: 'income_other', pattern: /INTEREST|DIVIDEND|CASHBACK|CASH BACK|ZELLE FROM|VENMO/ },

  // Spending: specific before general
  { flow: 'spend', categoryId: 'dining', pattern: /UBER\s*EATS|DOORDASH|GRUBHUB|POSTMATES/ },
  { flow: 'spend', categoryId: 'subscriptions', pattern: /AMAZON PRIME|PRIME VIDEO|KINDLE UNLTD|AUDIBLE/ },
  {
    flow: 'spend',
    categoryId: 'subscriptions',
    pattern:
      /NETFLIX|SPOTIFY|HULU|DISNEY|APPLE\.COM\/BILL|ICLOUD|YOUTUBE|GOOGLE \*?STORAGE|ADOBE|PEACOCK|PARAMOUNT|MAX\.COM|HBO|CHATGPT|OPENAI|PLANET FITNESS|\bGYM\b|FITNESS|CRUNCH/,
  },
  {
    flow: 'spend',
    categoryId: 'utilities',
    pattern:
      /ROCKY MOUNTAIN POWER|DOMINION ENERGY|ENBRIDGE|COMCAST|XFINITY|T-MOBILE|VERIZON|AT&T|GOOGLE FI|MINT MOBILE|UTILITIES|CITY OF .* WATER|ELECTRIC|INTERNET/,
  },
  { flow: 'spend', categoryId: 'insurance', pattern: /INSURANCE|STATE FARM|GEICO|PROGRESSIVE|ALLSTATE|LEMONADE/ },
  { flow: 'spend', categoryId: 'housing', pattern: /\bRENT\b|APARTMENTS|PROPERTY MGMT|PROPERTY MANAGEMENT|MORTGAGE|\bHOA\b/ },
  {
    flow: 'spend',
    categoryId: 'groceries',
    pattern: /WALMART|COSTCO|SMITH'?S|HARMONS|WINCO|KROGER|SAFEWAY|TRADER JOE|WHOLE FOODS|ALDI|SPROUTS|MACEY|GROCER/,
  },
  {
    flow: 'spend',
    categoryId: 'dining',
    pattern:
      /STARBUCKS|CHIPOTLE|CAFE|COFFEE|\bBEAN\b|DUTCH BROS|MCDONALD|WENDY|TACO|PIZZA|CRUMBL|SWIG|CHICK-FIL-A|SUBWAY|IN-N-OUT|RESTAURANT|GRILL|BURGER|SUSHI/,
  },
  {
    flow: 'spend',
    categoryId: 'transport',
    pattern: /\bUBER\b|\bLYFT\b|\bSHELL\b|CHEVRON|MAVERIK|EXXON|SINCLAIR|PHILLIPS 66|CIRCLE K|7-ELEVEN|\bFUEL\b|PARKING|\bUTA\b|JIFFY LUBE/,
  },
  {
    flow: 'spend',
    categoryId: 'shopping',
    pattern: /AMAZON|AMZN|TARGET|BEST BUY|BARNES|IKEA|HOME DEPOT|LOWE'?S|ETSY|EBAY|NORDSTROM|OLD NAVY|KOHL'?S|ROSS STORES/,
  },
  {
    flow: 'spend',
    categoryId: 'entertainment',
    pattern: /BOWL|CINEMA|CINEMARK|MEGAPLEX|THEATRE|THEATER|STEAM|NINTENDO|PLAYSTATION|XBOX|TICKETMASTER/,
  },
  { flow: 'spend', categoryId: 'health', pattern: /PHARMACY|\bCVS\b|WALGREENS|DENTAL|CLINIC|HOSPITAL|MEDICAL|DOCTOR|OPTOMETR/ },
  { flow: 'spend', categoryId: 'education', pattern: /TUITION|UNIVERSITY|COLLEGE|BOOKSTORE|COURSERA|UDEMY/ },
  {
    flow: 'spend',
    categoryId: 'travel',
    pattern: /AIRLINE|DELTA AIR|SOUTHWEST|UNITED AIR|FRONTIER|HOTEL|MARRIOTT|HILTON|AIRBNB|EXPEDIA/,
  },
  { flow: 'spend', categoryId: 'fees', pattern: /\bFEE\b|INTEREST CHARGE|FINANCE CHARGE|OVERDRAFT|SERVICE CHARGE/ },
];

/** Habit categories: repeated purchases here are not subscriptions unless the user confirms. */
export const NOT_AUTO_SUBSCRIPTION: ReadonlySet<string> = new Set(['groceries', 'dining', 'transport', 'shopping', 'travel']);
