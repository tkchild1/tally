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
  { id: 'dining', name: 'Dining', kind: 'expense', isFixed: false },
  { id: 'tithing', name: 'Tithing', kind: 'expense', isFixed: false },
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
  { flow: 'spend', categoryId: 'tithing', pattern: /TITHING|\bTITHE|CHURCH OF JESUS CHRIST|\bLDS\b/ },
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
  // Fuel sold by grocery and warehouse stores, before the grocery rule claims it.
  { flow: 'spend', categoryId: 'transport', pattern: /COSTCO GAS|\bFUEL\b|GASOLINE|GAS STATION|MURPHY USA/ },
  {
    flow: 'spend',
    categoryId: 'groceries',
    pattern:
      /WALMART|COSTCO|SMITH'?S|HARMONS|WINCO|KROGER|SAFEWAY|TRADER JOE|WHOLE FOODS|ALDI|SPROUTS|MACEY|GROCER|ALBERTSONS|FRED MEYER|PUBLIX|MEIJER|FOOD ?4 ?LESS|SAM'?S ?CLUB|SUPERMARKET/,
  },
  {
    flow: 'spend',
    categoryId: 'dining',
    pattern: new RegExp(
      [
        // Kinds of places
        String.raw`CAFE|COFFEE|\bBEAN\b|RESTAURANT|GRILL|BURGER|SUSHI|TACO|PIZZA|TAQUERIA|CANTINA|\bBBQ\b|BARBECUE|STEAKHOUSE`,
        String.raw`NOODLE|RAMEN|\bPHO\b|\bPOKE\b|BISTRO|EATERY|\bDINER\b|\bDELI\b|BAKERY|BAGEL|DONUT|DOUGHNUT|WAFFLE|PANCAKE|CREPE`,
        String.raw`ICE CREAM|CREAMERY|GELATO|FROZEN YOGURT|FROYO|YOGURT|SMOOTHIE|\bSODA\b|COOKIES?\b`,
        // Toast, a restaurant-only card terminal, prefixes its charges with "TST*".
        String.raw`\bTST\*`,
        // National and regional chains
        String.raw`STARBUCKS|CHIPOTLE|DUTCH BROS|DUNKIN|KRISPY KREME|MCDONALD|WENDY|CHICK-FIL-A|SUBWAY|IN-N-OUT|CRUMBL|SWIG|FIIZ`,
        String.raw`DAIRY QUEEN|\bDQ\b|BASKIN|COLD STONE|MENCHIE|YOGURTLAND|NOTHING BUNDT|ARBY|BURGER KING|PANDA EXPRESS|PANERA`,
        String.raw`CULVER|\bSONIC\b|JACK IN THE BOX|CARL'?S JR|FIVE GUYS|SHAKE SHACK|RAISING CANE|POPEYES|\bKFC\b|DOMINO|PAPA JOHN`,
        String.raw`PAPA MURPHY|LITTLE CAESAR|JERSEY MIKE|JIMMY JOHN|FIREHOUSE SUBS|COSTA VIDA|ZUPAS|BAJIO|QDOBA|WINGSTOP|WINGERS`,
        String.raw`APPLEBEE|CHILI'?S|OLIVE GARDEN|RED ROBIN|\bIHOP\b|DENNY'?S|CRACKER BARREL|OUTBACK|TEXAS ROADHOUSE`,
        String.raw`CHEESECAKE FACTORY|BUFFALO WILD|JAMBA|SWEETGREEN|\bCAVA\b|PEI WEI|P\.? ?F\.? CHANG`,
      ].join('|'),
    ),
  },
  {
    flow: 'spend',
    categoryId: 'transport',
    pattern:
      /\bUBER\b|\bLYFT\b|\bSHELL\b|CHEVRON|MAVERIK|EXXON|SINCLAIR|PHILLIPS 66|CIRCLE K|7-ELEVEN|TEXACO|CONOCO|HOLIDAY STATION|SPEEDWAY|QUIKTRIP|\bARCO\b|VALERO|TESLA SUPERCHARG|PARKING|\bUTA\b|JIFFY LUBE|CAR ?WASH|AUTOZONE|O'?REILLY AUTO|NAPA AUTO|DISCOUNT TIRE|LES SCHWAB|\bDMV\b|MOTOR VEHICLE|\bTOLL/,
  },
  {
    flow: 'spend',
    categoryId: 'shopping',
    pattern:
      /AMAZON|AMZN|TARGET|BEST BUY|BARNES|IKEA|HOME DEPOT|LOWE'?S|ETSY|EBAY|NORDSTROM|OLD NAVY|KOHL'?S|ROSS STORES|DOLLAR TREE|DOLLAR GENERAL|FAMILY DOLLAR|FIVE BELOW|MARSHALLS|T\.?J\.? ?MAXX|HOMEGOODS|BURLINGTON|\bMACY|DICK'?S SPORTING|SCHEELS|\bREI\b|BATH & BODY|SEPHORA|\bULTA\b|APPLE STORE|MICHAELS|HOBBY LOBBY|JOANN|SHEIN|TEMU|\bZARA\b|\bH&M\b|\bGAP\b|AMERICAN EAGLE|DILLARD|PENNEY|WAYFAIR|CHEWY|PETSMART|PETCO|STAPLES|OFFICE DEPOT|GAMESTOP/,
  },
  {
    flow: 'spend',
    categoryId: 'entertainment',
    pattern:
      /GOLF|BOWL|CINEMA|CINEMARK|MEGAPLEX|THEATRE|THEATER|\bAMC\b|REGAL|FANDANGO|STEAM|NINTENDO|PLAYSTATION|XBOX|TICKETMASTER|STUBHUB|SEATGEEK|EVENTBRITE|DAVE ?& ?BUSTER|TRAMPOLINE|ARCADE|LASER TAG|ESCAPE ROOM|ROLLER|SKATE|MUSEUM|\bZOO\b|AQUARIUM|CONCERT|LIFT TICKET|\bSKI\b/,
  },
  {
    flow: 'spend',
    categoryId: 'health',
    pattern:
      /PHARMACY|\bCVS\b|WALGREENS|DENTAL|DENTIST|ORTHODONT|CLINIC|HOSPITAL|MEDICAL|DOCTOR|OPTOMETR|URGENT CARE|INSTACARE|CHIROPRACT|THERAP|LABCORP|QUEST DIAG|DERMATOL|PEDIATRIC|EYE CARE/,
  },
  {
    flow: 'spend',
    categoryId: 'education',
    pattern: /TUITION|UNIVERSITY|COLLEGE|BOOKSTORE|COURSERA|UDEMY|\bSCHOOL|TEXTBOOK|CHEGG|PEARSON|MCGRAW|CENGAGE|QUIZLET/,
  },
  {
    flow: 'spend',
    categoryId: 'travel',
    pattern:
      /AIRLINE|DELTA AIR|SOUTHWEST|UNITED AIR|AMERICAN AIR|ALASKA AIR|JETBLUE|ALLEGIANT|SPIRIT AIR|FRONTIER|HOTEL|MARRIOTT|HILTON|\bINN\b|AIRBNB|VRBO|EXPEDIA|BOOKING\.COM|HOTELS\.COM|HERTZ|ENTERPRISE RENT|\bAVIS\b|TURO/,
  },
  { flow: 'spend', categoryId: 'fees', pattern: /\bFEE\b|INTEREST CHARGE|FINANCE CHARGE|OVERDRAFT|SERVICE CHARGE/ },
];

/** Habit categories (and giving): repeated payments here are not subscriptions unless the user confirms. */
export const NOT_AUTO_SUBSCRIPTION: ReadonlySet<string> = new Set(['groceries', 'dining', 'transport', 'shopping', 'travel', 'tithing']);

/** Spending in this category counts as tithing paid on the dashboard. */
export const TITHING_CATEGORY = 'tithing';

export const CATEGORY_NAME_MAX = 40;

/** A user-facing problem with a category name, or null if it can be used. Names are unique ignoring case. */
export function categoryNameProblem(name: string, otherNames: Iterable<string>): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name.';
  if (trimmed.length > CATEGORY_NAME_MAX) return `Use at most ${CATEGORY_NAME_MAX} characters.`;
  const lower = trimmed.toLowerCase();
  for (const other of otherNames) if (other.trim().toLowerCase() === lower) return 'A category with that name already exists.';
  return null;
}

/** Stable id for a new custom category: "custom-" plus a slug of the name, made unique. */
export function customCategoryId(name: string, existingIds: Iterable<string>): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  const base = `custom-${slug || 'category'}`;
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
