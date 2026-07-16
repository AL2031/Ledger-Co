/* =============================================================
   LEDGER & CO. — Business Tycoon Simulator
   Vanilla JS, no frameworks, no backend. Everything below is
   organized into clearly labelled sections:

     1. CONFIG        - static game-balance data & formulas' inputs
     2. UTILITIES      - small pure helper functions
     3. STATE          - the single source of truth + factories
     4. PERSISTENCE     - localStorage save/load + offline earnings
     5. ECONOMY ENGINE  - the daily tick: revenue/cost formulas
     6. GAME LOOP       - requestAnimationFrame driven day clock
     7. ACTIONS         - things the player can trigger
     8. RENDER          - DOM output for each tab + modals
     9. EVENTS          - wiring DOM listeners
    10. INIT            - bootstrap

   Tweak difficulty by editing the numbers in CONFIG — every
   formula that reads them is commented where it's used.
   ============================================================= */

/* =============================================================
   1. CONFIG
   ============================================================= */

// Player starting capital.
const STARTING_CASH = 25000;

// Base length (ms) of one in-game day at 1x speed. Divided by the
// current speed multiplier each frame -> 2x is twice as fast, etc.
const BASE_DAY_MS = 3000;

// Days per in-game "week" / "month" (used for autosave + taxes).
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;

// Progressive income tax on a business's *monthly* profit.
// Only positive monthly profit is taxed; losses owe nothing.
const INCOME_TAX_BRACKETS = [
  { upTo: 10000, rate: 0.15 },
  { upTo: 50000, rate: 0.25 },
  { upTo: Infinity, rate: 0.35 }
];

// Annual property tax rate on the *current value* of anything the
// player owns outright (upgraded property + real-estate portfolio).
// Applied once a month, prorated to 1/12th.
const PROPERTY_TAX_ANNUAL_RATE = 0.012;

// Bank loan products. dailyRate = apr/365. Payment uses the
// standard amortized-loan formula (see takeLoan / loan tick).
const LOAN_PRODUCTS = [
  { id: 'short', name: 'Short-Term', termDays: 30, apr: 0.15 },
  { id: 'standard', name: 'Standard', termDays: 90, apr: 0.10 },
  { id: 'long', name: 'Long-Term', termDays: 180, apr: 0.07 }
];
const LOAN_MAX_MULTIPLE_OF_CASH = 4; // max principal ~= 4x current cash
const LOAN_MISSED_PENALTY = 250;

// Marketing campaign tiers. demandMultiplier is the raw multiplier
// on daily demand while active; each business type's
// `marketingSensitivity` scales how much of that multiplier actually
// lands (see computeDemandFactors).
const MARKETING_TIERS = [
  { id: 1, name: 'Local Flyers', cost: 500, demandMultiplier: 1.3, durationDays: 5 },
  { id: 2, name: 'Standard Campaign', cost: 2000, demandMultiplier: 1.7, durationDays: 7 },
  { id: 3, name: 'Premium Blitz', cost: 6000, demandMultiplier: 2.4, durationDays: 10 }
];

// Business slot pricing: slot 1 is free (your first business).
const SLOT_COSTS = [0, 50000, 250000, 750000, 2000000];

// Sectors used by the market-index / ticker system. Each business
// type belongs to one; costFactor drifts its COGS, priceFactor
// drifts the market-average price it's compared against.
const SECTORS = ['food', 'retail', 'industrial', 'tech', 'realestate', 'services'];

// The seven business types. `kind` selects which formula branch
// the economy engine uses: 'sales' | 'manufacturing' | 'subscription' | 'property'.
const BUSINESS_TYPES = {
  restaurant: {
    id: 'restaurant', name: 'Restaurant / Café', icon: '🍽️', kind: 'sales', sector: 'food',
    startupCost: 15000, rent: 150, baseUtilities: 25,
    baseDemand: 45, baseCapacityPerLevel: 40, upgradeCost: [0, 8000, 18000, 35000, 60000],
    perishable: true, marketingSensitivity: 1.5, baseProductSlots: 2,
    employeeSlots: 5, wagePerEmployee: 80, idealEmployees: 3, elasticity: 1.1,
    description: 'High daily overhead and perishable inventory. Unsold prep is wasted every night, so your menu mix, staffing, and pricing all matter.',
    productCatalog: [
      { id: 'burger', name: 'House Burger', baseCost: 3.5, basePrice: 11, demandShare: 1.3, unlockCost: 0 },
      { id: 'pizza', name: 'Wood-Fired Pizza', baseCost: 5.5, basePrice: 16, demandShare: 1.0, unlockCost: 4000 },
      { id: 'salad', name: 'Fresh Salad Bowl', baseCost: 3.0, basePrice: 10, demandShare: 0.8, unlockCost: 1500 },
      { id: 'dessert', name: 'Craft Dessert Plate', baseCost: 4.0, basePrice: 9, demandShare: 0.6, unlockCost: 2500 },
      { id: 'wine', name: 'Reserve Wine Pairing', baseCost: 9.0, basePrice: 28, demandShare: 0.3, unlockCost: 6000 }
    ]
  },
  ecommerce: {
    id: 'ecommerce', name: 'Online Store', icon: '🛒', kind: 'sales', sector: 'retail',
    startupCost: 8000, rent: 60, baseUtilities: 15,
    shippingCostPerUnit: 3, baseDemand: 55,
    baseCapacityPerLevel: 60, upgradeCost: [0, 6000, 14000, 28000, 50000],
    perishable: false, marketingSensitivity: 1.3, baseProductSlots: 2,
    employeeSlots: 4, wagePerEmployee: 70, idealEmployees: 2, elasticity: 1.0,
    description: 'Low property cost, but shipping is added to every unit sold. Digital marketing swings demand hard.',
    productCatalog: [
      { id: 'basics', name: 'Everyday Basics', baseCost: 7, basePrice: 22, demandShare: 1.3, unlockCost: 0 },
      { id: 'homegadgets', name: 'Home Gadgets', baseCost: 9, basePrice: 27, demandShare: 1.0, unlockCost: 3000 },
      { id: 'fitnessgear', name: 'Fitness Gear', baseCost: 11, basePrice: 32, demandShare: 0.8, unlockCost: 3500 },
      { id: 'techacc', name: 'Tech Accessories', baseCost: 14, basePrice: 38, demandShare: 0.6, unlockCost: 5000 },
      { id: 'premium', name: 'Premium Collection', baseCost: 22, basePrice: 60, demandShare: 0.3, unlockCost: 9000 }
    ]
  },
  dropshipping: {
    id: 'dropshipping', name: 'Dropshipping', icon: '📦', kind: 'sales', sector: 'retail',
    startupCost: 1500, rent: 0, baseUtilities: 5,
    baseDemand: 70, baseCapacityPerLevel: 220, upgradeCost: [0, 2000, 5000, 10000, 20000],
    perishable: false, marketingSensitivity: 2.2, adDependent: true, baseProductSlots: 2,
    employeeSlots: 2, wagePerEmployee: 50, idealEmployees: 1, elasticity: 0.8,
    description: 'Almost no overhead, but margins are razor thin and demand collapses without an active ad campaign. Winning products matter more than anything.',
    productCatalog: [
      { id: 'phonecase', name: 'Trending Phone Case', baseCost: 6, basePrice: 15, demandShare: 1.4, unlockCost: 0 },
      { id: 'ledstrip', name: 'LED Strip Lights', baseCost: 8, basePrice: 19, demandShare: 1.1, unlockCost: 800 },
      { id: 'fitband', name: 'Fitness Tracker Band', baseCost: 12, basePrice: 26, demandShare: 0.9, unlockCost: 1200 },
      { id: 'kitchenset', name: 'Kitchen Gadget Set', baseCost: 9, basePrice: 21, demandShare: 1.0, unlockCost: 1000 },
      { id: 'petkit', name: 'Pet Grooming Kit', baseCost: 13, basePrice: 29, demandShare: 0.6, unlockCost: 1500 }
    ]
  },
  manufacturing: {
    id: 'manufacturing', name: 'Manufacturing', icon: '🏭', kind: 'manufacturing', sector: 'industrial',
    startupCost: 60000, rent: 150, baseUtilities: 50,
    baseMaterialCost: 14, baseDemand: 40,
    baseCapacityPerLevel: 260, upgradeCost: [0, 40000, 80000, 150000, 250000],
    productivityPerEmployee: 35, marketingSensitivity: 0.7, baseProductSlots: 2,
    employeeSlots: 12, wagePerEmployee: 95, idealEmployees: 4, elasticity: 1.3,
    description: 'Raw materials are sourced automatically at the day\u2019s market rate as you produce — no restocking to manage. Hire enough line staff to keep up with demand and sell in bulk.',
    productCatalog: [
      { id: 'brackets', name: 'Steel Brackets', basePrice: 38, demandShare: 1.2, unlockCost: 0 },
      { id: 'containers', name: 'Injection-Molded Containers', basePrice: 45, demandShare: 1.0, unlockCost: 15000 },
      { id: 'circuitboards', name: 'Circuit Board Assemblies', basePrice: 68, demandShare: 0.7, unlockCost: 30000 },
      { id: 'furniture', name: 'Furniture Components', basePrice: 52, demandShare: 0.8, unlockCost: 20000 },
      { id: 'packaging', name: 'Custom Packaging Rolls', basePrice: 33, demandShare: 0.9, unlockCost: 10000 }
    ]
  },
  saas: {
    id: 'saas', name: 'Tech Startup (SaaS)', icon: '💻', kind: 'subscription', sector: 'tech',
    startupCost: 20000, rent: 0, baseUtilities: 0,
    monthlyPrice: 29, baseSignupsPerDay: 9, churnRateBase: 0.035,
    serverCostPerUser: 0.6, baseCapacityPerLevel: 1600, upgradeCost: [0, 15000, 35000, 70000, 120000],
    marketingSensitivity: 1.15,
    employeeSlots: 10, wagePerEmployee: 210, idealEmployees: 4, elasticity: 0.9,
    description: 'Recurring subscribers compound daily. Developers reduce churn and lift capacity; server costs scale with your user base.'
  },
  realestate: {
    id: 'realestate', name: 'Real Estate Investing', icon: '🏠', kind: 'property', sector: 'realestate',
    startupCost: 0, baseUtilities: 0,
    propertyBaseCost: 90000, propertyBaseRentMonthly: 1400, propertyValueDriftDaily: 0.0006,
    upgradeCostPerProperty: [0, 12000, 25000, 45000],
    employeeSlots: 5, wagePerEmployee: 65, idealEmployeesPerProperty: 0.5,
    description: 'Buy, renovate, and rent properties. Values drift with the market and condition decays without upkeep. Financing-heavy.'
  },
  freelance: {
    id: 'freelance', name: 'Freelance Agency', icon: '🧑\u200d💻', kind: 'sales', sector: 'services',
    startupCost: 3000, rent: 40, baseUtilities: 10,
    baseDemand: 20, baseCapacityPerLevel: 34, upgradeCost: [0, 4000, 9000, 18000, 30000],
    perishable: false, marketingSensitivity: 1.0, moraleDriven: true, baseProductSlots: 2,
    employeeSlots: 8, wagePerEmployee: 130, idealEmployees: 4, elasticity: 0.9,
    description: 'Overhead is light. Revenue rides almost entirely on how many staff you have, how well you treat them, and which service packages you offer.',
    productCatalog: [
      { id: 'branding', name: 'Brand & Logo Package', baseCost: 2, basePrice: 55, demandShare: 1.2, unlockCost: 0 },
      { id: 'webbuild', name: 'Website Build', baseCost: 4, basePrice: 85, demandShare: 0.9, unlockCost: 2000 },
      { id: 'seo', name: 'SEO Retainer', baseCost: 3, basePrice: 60, demandShare: 1.0, unlockCost: 1500 },
      { id: 'adcampaign', name: 'Ad Campaign Management', baseCost: 5, basePrice: 95, demandShare: 0.7, unlockCost: 2500 },
      { id: 'copywriting', name: 'Copywriting Package', baseCost: 2, basePrice: 45, demandShare: 0.8, unlockCost: 1000 }
    ]
  }
};

/* =============================================================
   2. UTILITIES
   ============================================================= */

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function randRange(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function uid() { return Math.random().toString(36).slice(2, 10); }

function formatMoney(n, opts) {
  opts = opts || {};
  const neg = n < 0;
  const abs = Math.abs(n);
  let str;
  if (opts.compact && abs >= 1000) {
    str = '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  } else {
    str = '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return (neg ? '-' : '') + str;
}

function formatSignedMoney(n) {
  return (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
}

function formatNum(n, decimals) {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals || 0, minimumFractionDigits: decimals || 0 });
}

function pctStr(n, decimals) {
  return (n * 100).toFixed(decimals != null ? decimals : 1) + '%';
}

// Converts an absolute in-game day number into a Year/Day label.
function dayLabel(day) {
  const year = Math.floor((day - 1) / 360) + 1;
  const dayOfYear = ((day - 1) % 360) + 1;
  return `Year ${year}, Day ${dayOfYear}`;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* =============================================================
   3. STATE
   ============================================================= */

var state = null;

function createDefaultMarketIndex() {
  const idx = {};
  SECTORS.forEach(sector => {
    idx[sector] = {
      costFactor: 1.0,     // multiplies COGS / raw material cost
      priceFactor: 1.0,    // multiplies the "market average" price businesses are compared to
      trend: 'stable'      // flavor text for the Market tab
    };
  });
  return idx;
}

function createEmployee(wage) {
  return {
    id: uid(),
    name: pick(['Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Riley', 'Casey', 'Jamie', 'Drew', 'Quinn', 'Avery', 'Reese']) +
      ' ' + pick(['R.', 'M.', 'T.', 'B.', 'K.', 'S.', 'L.', 'P.']),
    wage: wage,
    morale: 70,
    hiredOnDay: state ? state.day : 1
  };
}

function createProductInstance(catalogEntry, unlockedNow, day) {
  return {
    catalogId: catalogEntry.id,
    everUnlocked: unlockedNow,
    active: unlockedNow,
    price: catalogEntry.basePrice,
    addedOnDay: unlockedNow ? day : null,
    lastDaily: { unitsSold: 0, revenue: 0, cogs: 0, margin: 0 },
    lifetime: { unitsSold: 0, revenue: 0, margin: 0 },
    history: [] // rolling daily snapshots, capped — powers the per-product analytics chart
  };
}

// Creates a fresh business instance of a given type.
function createBusiness(typeId, name) {
  const cfg = BUSINESS_TYPES[typeId];
  const day = state ? state.day : 1;
  const biz = {
    id: uid(),
    typeId: typeId,
    name: name || cfg.name,
    propertyLevel: 1,
    propertyOwned: false,        // if true: no daily rent, but counts toward property tax
    price: cfg.monthlyPrice ? +(cfg.monthlyPrice).toFixed(2) : 0, // used by SaaS only now; sales/manufacturing price lives per-product
    employees: [],
    reputation: 50,
    activeMarketing: null,       // { tierId, demandMultiplier, daysLeft }
    subscriberBase: 0,           // saas only
    properties: [],              // realestate only
    products: (cfg.productCatalog || []).map((c, i) => createProductInstance(c, i === 0, day)),
    lastDaily: { revenue: 0, cogs: 0, expenses: 0, waste: 0, profit: 0, unitsSold: 0 },
    monthly: { revenue: 0, profit: 0 }, // accumulates since last month-end, used for tax
    lifetime: { revenue: 0, profit: 0 },
    createdOnDay: day
  };
  return biz;
}

function createDefaultState() {
  return {
    day: 1,
    speed: 1,
    paused: true,
    cash: STARTING_CASH,
    reputation: 50,               // global reputation, nudged by loan misses / big wins
    businessSlots: 1,
    businesses: [],
    activeBusinessId: null,
    loans: [],
    marketIndex: createDefaultMarketIndex(),
    eventLog: [],                 // { day, text, type }
    news: [],                     // { day, text } - longer form, shown on Market tab
    lifetimeTaxPaid: 0,
    lastSaveRealTime: Date.now()
  };
}

function getActiveBusiness() {
  if (!state.activeBusinessId) return null;
  return state.businesses.find(b => b.id === state.activeBusinessId) || null;
}

function logEvent(text, type) {
  state.eventLog.push({ day: state.day, text: text, type: type || 'info' });
  if (state.eventLog.length > 200) state.eventLog.shift();
}

function logNews(text) {
  state.news.push({ day: state.day, text: text });
  if (state.news.length > 60) state.news.shift();
}

/* =============================================================
   4. PERSISTENCE
   ============================================================= */

const SAVE_KEY = 'ledgerco_save_v1';

function saveGame(silent) {
  try {
    state.lastSaveRealTime = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    if (!silent) showToast('Game saved');
  } catch (e) {
    console.error('Save failed', e);
    if (!silent) showToast('Save failed — storage may be full');
  }
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    state = JSON.parse(raw);
    return true;
  } catch (e) {
    console.error('Load failed', e);
    return false;
  }
}

function resetGame() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  location.reload();
}

// Called once after a save is loaded. Computes how many in-game
// days passed while the tab was closed (using the same BASE_DAY_MS
// reference as 1x speed), then simulates each of those days using
// *last known* daily averages per business, per the spec. Capped so
// a week-long absence doesn't produce absurd numbers, and run at a
// reduced efficiency factor since no one was actively managing price
// or marketing while away.
const OFFLINE_EFFICIENCY = 0.6;
const OFFLINE_MAX_DAYS = 60;

function applyOfflineEarnings() {
  const elapsedMs = Date.now() - (state.lastSaveRealTime || Date.now());
  let offlineDays = Math.floor(elapsedMs / BASE_DAY_MS);
  if (offlineDays < 1) return null;
  offlineDays = Math.min(offlineDays, OFFLINE_MAX_DAYS);

  let totalRevenue = 0, totalExpenses = 0, totalProfit = 0;
  const perBiz = [];

  state.businesses.forEach(biz => {
    const dailyProfit = (biz.lastDaily.profit || 0) * OFFLINE_EFFICIENCY;
    const dailyRevenue = (biz.lastDaily.revenue || 0) * OFFLINE_EFFICIENCY;
    const dailyExpenses = (biz.lastDaily.expenses || 0) + (biz.lastDaily.cogs || 0);
    const bizRevenue = dailyRevenue * offlineDays;
    const bizExpenses = dailyExpenses * OFFLINE_EFFICIENCY * offlineDays;
    const bizProfit = dailyProfit * offlineDays;
    totalRevenue += bizRevenue;
    totalExpenses += bizExpenses;
    totalProfit += bizProfit;
    biz.lifetime.revenue += bizRevenue;
    biz.lifetime.profit += bizProfit;
    biz.monthly.revenue += bizRevenue;
    biz.monthly.profit += bizProfit;
    perBiz.push({ name: biz.name, profit: bizProfit });
  });

  // Loans keep accruing interest / due payments while away too.
  let loanPayments = 0;
  state.loans.forEach(loan => {
    const days = Math.min(offlineDays, loan.termDaysLeft);
    loanPayments += loan.dailyPayment * days;
    loan.termDaysLeft = Math.max(0, loan.termDaysLeft - offlineDays);
    loan.balance = Math.max(0, loan.balance - (loan.dailyPayment - loan.balance * (loan.apr / 365)) * days);
  });
  totalExpenses += loanPayments;
  totalProfit -= loanPayments;

  state.cash += totalProfit;
  state.day += offlineDays;

  logEvent(`Welcome back — ${offlineDays} day(s) passed while you were away.`, 'info');

  return {
    days: offlineDays,
    revenue: totalRevenue,
    expenses: totalExpenses,
    profit: totalProfit,
    perBiz: perBiz
  };
}

/* =============================================================
   5. ECONOMY ENGINE
   ============================================================= */

// --- shared demand-side factors -------------------------------

// Staffing + morale combine into one multiplier on demand fulfillment.
// Businesses with `moraleDriven` (freelance agencies) swing much
// harder with morale since the "product" IS the staff.
function computeEmployeeFactor(biz, cfg) {
  const ideal = cfg.idealEmployees || 1;
  if (biz.employees.length === 0) {
    return cfg.moraleDriven ? 0.08 : 0.4; // solo-operated baseline
  }
  const staffRatio = clamp(biz.employees.length / ideal, 0, 1.4);
  const avgMorale = biz.employees.reduce((s, e) => s + e.morale, 0) / biz.employees.length;
  const moraleFactor = cfg.moraleDriven
    ? (0.3 + (avgMorale / 100) * 1.3)
    : (0.7 + (avgMorale / 100) * 0.5);
  return clamp(staffRatio * moraleFactor, 0.08, 2.2);
}

// Active campaigns boost demand by (tierMultiplier - 1) * sensitivity.
// Ad-dependent businesses (dropshipping) fall to a steep penalty with
// no campaign running at all.
function computeMarketingFactor(biz, cfg) {
  if (biz.activeMarketing && biz.activeMarketing.daysLeft > 0) {
    const raw = biz.activeMarketing.demandMultiplier;
    return 1 + (raw - 1) * cfg.marketingSensitivity;
  }
  return cfg.adDependent ? 0.35 : 1.0;
}

function computeReputationFactor(biz) {
  return 0.7 + (biz.reputation / 100) * 0.6;
}

// Classic constant-elasticity demand curve: demand scales with
// (marketAvgPrice / yourPrice) ^ elasticity. Price at market average
// => factor of 1. Price above average => factor drops; below => rises.
function computePriceElasticity(price, marketAvgPrice, elasticity) {
  if (price <= 0) return 1;
  const ratio = marketAvgPrice / price;
  return clamp(Math.pow(ratio, elasticity), 0.15, 3.0);
}

// --- per-kind daily tick formulas -------------------------------

// How many products a business can have ACTIVE at once. Grows with
// property/capacity level, same lever as everything else space-constrained.
function productSlots(biz, cfg) {
  return (cfg.baseProductSlots || 0) + (biz.propertyLevel - 1);
}

// Distributes total demand across a business's *active* products. Each
// product's own price feeds a per-product elasticity (its price vs that
// product's own market-average). A demandShare-weighted average of those
// elasticities also scales the TOTAL pie of customers, so pricing your
// whole lineup above market still shrinks overall traffic — not just which
// product wins the sale.
function computeProductAllocation(biz, cfg, sectorIdx) {
  const active = biz.products.filter(p => p.active);
  if (active.length === 0) return { weighted: [], avgElasticity: 0, totalWeight: 0 };

  const weighted = active.map(p => {
    const catalogEntry = cfg.productCatalog.find(c => c.id === p.catalogId);
    const marketAvg = catalogEntry.basePrice * sectorIdx.priceFactor;
    const elasticity = computePriceElasticity(p.price, marketAvg, cfg.elasticity);
    return { p, catalogEntry, marketAvg, elasticity, weight: catalogEntry.demandShare * elasticity, demandShare: catalogEntry.demandShare };
  });

  const shareSum = weighted.reduce((s, w) => s + w.demandShare, 0);
  const avgElasticity = shareSum > 0 ? weighted.reduce((s, w) => s + w.demandShare * w.elasticity, 0) / shareSum : 0;
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  return { weighted, avgElasticity, totalWeight };
}

// Stamps one day of results onto a single product — feeds both the
// "yesterday" figures shown inline and the rolling history sparkline.
function recordProductDay(p, unitsSold, revenue, cogs) {
  p.lastDaily = { unitsSold, revenue, cogs, margin: revenue - cogs };
  p.lifetime.unitsSold += unitsSold;
  p.lifetime.revenue += revenue;
  p.lifetime.margin += (revenue - cogs);
  p.history.push({ day: state.day, unitsSold, revenue, margin: revenue - cogs });
  if (p.history.length > 30) p.history.shift();
}

function tickSalesBusiness(biz, cfg) {
  const sectorIdx = state.marketIndex[cfg.sector];
  const marketingFactor = computeMarketingFactor(biz, cfg);
  const employeeFactor = computeEmployeeFactor(biz, cfg);
  const reputationFactor = computeReputationFactor(biz);
  const noise = randRange(0.9, 1.1);
  const capacity = cfg.baseCapacityPerLevel * biz.propertyLevel;

  const alloc = computeProductAllocation(biz, cfg, sectorIdx);
  biz.products.forEach(p => { if (!alloc.weighted.some(w => w.p === p)) recordProductDay(p, 0, 0, 0); });

  const wages = biz.employees.reduce((s, e) => s + e.wage, 0);
  const rent = biz.propertyOwned ? 0 : cfg.rent;
  const utilities = cfg.baseUtilities * (1 + (biz.propertyLevel - 1) * 0.3);
  const expenses = wages + rent + utilities;

  if (alloc.weighted.length === 0) {
    // Nothing on the menu / shelf — no sales, overhead still runs.
    return { revenue: 0, cogs: 0, expenses, waste: 0, profit: -expenses, unitsSold: 0 };
  }

  const potentialDemand = cfg.baseDemand * alloc.avgElasticity * marketingFactor * employeeFactor * reputationFactor * noise;
  const totalUnitsSold = clamp(Math.min(potentialDemand, capacity), 0, capacity);

  let revenue = 0, cogs = 0, weightedUnitCost = 0;
  alloc.weighted.forEach(w => {
    const share = alloc.totalWeight > 0 ? w.weight / alloc.totalWeight : 1 / alloc.weighted.length;
    const unitsSold = totalUnitsSold * share;
    const unitCost = (w.catalogEntry.baseCost + (cfg.shippingCostPerUnit || 0)) * sectorIdx.costFactor;
    const productRevenue = unitsSold * w.p.price;
    const productCogs = unitsSold * unitCost;
    revenue += productRevenue;
    cogs += productCogs;
    weightedUnitCost += share * unitCost;
    recordProductDay(w.p, unitsSold, productRevenue, productCogs);
  });

  // Perishable businesses (restaurants) prep to full capacity each
  // morning; whatever isn't sold by close is wasted at cost.
  const waste = cfg.perishable ? Math.max(0, capacity - totalUnitsSold) : 0;
  const wasteCost = waste * weightedUnitCost;

  const profit = revenue - cogs - wasteCost - expenses;
  return { revenue, cogs: cogs + wasteCost, expenses, waste: wasteCost, profit, unitsSold: totalUnitsSold };
}

function tickManufacturingBusiness(biz, cfg) {
  const sectorIdx = state.marketIndex[cfg.sector];
  const marketingFactor = computeMarketingFactor(biz, cfg);
  const employeeFactor = computeEmployeeFactor(biz, cfg);
  const reputationFactor = computeReputationFactor(biz);
  const noise = randRange(0.9, 1.1);
  const demandCapacity = cfg.baseCapacityPerLevel * biz.propertyLevel;
  const productionCapacity = biz.employees.length * cfg.productivityPerEmployee;

  const alloc = computeProductAllocation(biz, cfg, sectorIdx);
  biz.products.forEach(p => { if (!alloc.weighted.some(w => w.p === p)) recordProductDay(p, 0, 0, 0); });

  const wages = biz.employees.reduce((s, e) => s + e.wage, 0);
  const rent = biz.propertyOwned ? 0 : cfg.rent;
  const utilities = cfg.baseUtilities * (1 + (biz.propertyLevel - 1) * 0.3);
  const expenses = wages + rent + utilities;

  if (alloc.weighted.length === 0) {
    return { revenue: 0, cogs: 0, expenses, waste: 0, profit: -expenses, unitsSold: 0 };
  }

  const potentialDemand = cfg.baseDemand * alloc.avgElasticity * marketingFactor * employeeFactor * reputationFactor * noise;
  // Production is limited by demand and by how many hands are on the line —
  // NOT by a stockpile. Raw materials are bought automatically, just-in-time,
  // at today's fluctuating market rate (still visible on the ticker), so
  // there's no restocking to manage and no surprise stockouts.
  const production = Math.max(0, Math.min(potentialDemand, demandCapacity, productionCapacity));
  const unitCost = cfg.baseMaterialCost * sectorIdx.costFactor;
  const materialCost = production * unitCost;

  let revenue = 0;
  alloc.weighted.forEach(w => {
    const share = alloc.totalWeight > 0 ? w.weight / alloc.totalWeight : 1 / alloc.weighted.length;
    const unitsSold = production * share;
    const productRevenue = unitsSold * w.p.price;
    const productCogs = unitsSold * unitCost;
    revenue += productRevenue;
    recordProductDay(w.p, unitsSold, productRevenue, productCogs);
  });

  const profit = revenue - materialCost - expenses;
  return { revenue, cogs: materialCost, expenses, waste: 0, profit, unitsSold: production, staffLimited: productionCapacity < demandCapacity && productionCapacity < potentialDemand };
}

function tickSubscriptionBusiness(biz, cfg) {
  const sectorIdx = state.marketIndex[cfg.sector];
  const marketAvgPrice = cfg.monthlyPrice * sectorIdx.priceFactor;
  const priceElasticity = computePriceElasticity(biz.price, marketAvgPrice, cfg.elasticity);
  const marketingFactor = computeMarketingFactor(biz, cfg);
  const reputationFactor = computeReputationFactor(biz);
  const noise = randRange(0.9, 1.1);

  const devCount = biz.employees.length;
  // Developers shave churn down (floor at 0.8%) and lift signups slightly.
  const churnRate = clamp(cfg.churnRateBase - devCount * 0.002, 0.008, cfg.churnRateBase);
  const capacity = cfg.baseCapacityPerLevel * biz.propertyLevel;

  const newSignups = cfg.baseSignupsPerDay * priceElasticity * marketingFactor * reputationFactor * noise * (1 + devCount * 0.05);

  let subscriberBase = biz.subscriberBase * (1 - churnRate) + newSignups;
  subscriberBase = clamp(subscriberBase, 0, capacity);
  biz.subscriberBase = subscriberBase;

  const dailyPricePerUser = biz.price / 30;
  const revenue = subscriberBase * dailyPricePerUser;
  const serverCost = subscriberBase * cfg.serverCostPerUser * sectorIdx.costFactor;
  const wages = biz.employees.reduce((s, e) => s + e.wage, 0);
  const expenses = wages;

  const profit = revenue - serverCost - expenses;
  return { revenue, cogs: serverCost, expenses, waste: 0, profit, unitsSold: Math.round(subscriberBase), churnRate, newSignups, marketAvgPrice };
}

function tickPropertyBusiness(biz, cfg) {
  const sectorIdx = state.marketIndex[cfg.sector];
  const occupancyFactor = clamp(sectorIdx.priceFactor, 0.6, 1.2);
  let rentIncome = 0, upkeep = 0;

  biz.properties.forEach(p => {
    p.condition = clamp(p.condition - 0.3, 0, 100);
    const driftSign = sectorIdx.trend === 'boom' ? 2 : sectorIdx.trend === 'bust' ? -2 : 1;
    p.currentValue = Math.max(1000, p.currentValue * (1 + cfg.propertyValueDriftDaily * driftSign));
    const dailyRent = (p.baseRentMonthly / 30) * (p.condition / 100) * occupancyFactor;
    rentIncome += dailyRent;
    upkeep += (p.baseRentMonthly / 30) * 0.08;
  });

  const wages = biz.employees.reduce((s, e) => s + e.wage, 0);
  const expenses = upkeep + wages;
  const profit = rentIncome - expenses;
  return { revenue: rentIncome, cogs: 0, expenses, waste: 0, profit, unitsSold: biz.properties.length };
}

function tickBusiness(biz) {
  const cfg = BUSINESS_TYPES[biz.typeId];
  let result;
  if (cfg.kind === 'sales') result = tickSalesBusiness(biz, cfg);
  else if (cfg.kind === 'manufacturing') result = tickManufacturingBusiness(biz, cfg);
  else if (cfg.kind === 'subscription') result = tickSubscriptionBusiness(biz, cfg);
  else result = tickPropertyBusiness(biz, cfg);

  biz.lastDaily = result;
  biz.monthly.revenue += result.revenue;
  biz.monthly.profit += result.profit;
  biz.lifetime.revenue += result.revenue;
  biz.lifetime.profit += result.profit;

  // Morale drifts up when paid at/above the type's baseline wage and the
  // business is profitable; drifts down otherwise.
  biz.employees.forEach(e => {
    const fairWage = cfg.wagePerEmployee || 60;
    let delta = e.wage >= fairWage ? randRange(0.3, 1.2) : randRange(-2.2, -0.6);
    if (result.profit < 0) delta -= 0.4;
    e.morale = clamp(e.morale + delta, 0, 100);
  });

  const repTarget = result.profit > 0 ? 65 : 35;
  biz.reputation = clamp(biz.reputation + (repTarget - biz.reputation) * 0.03 + randRange(-1, 1), 0, 100);

  if (biz.activeMarketing) {
    biz.activeMarketing.daysLeft -= 1;
    if (biz.activeMarketing.daysLeft <= 0) biz.activeMarketing = null;
  }

  state.cash += result.profit;
  return result;
}

// --- market index drift & events ---------------------------------

const MARKET_EVENT_CHANCE = 0.05;
const SECTOR_LABELS = {
  food: 'Food & Dining', retail: 'Retail & E-commerce', industrial: 'Manufacturing',
  tech: 'Technology', realestate: 'Real Estate', services: 'Professional Services'
};
const WORLD_NEWS_LINES = [
  'Consumer spending ticks up nationwide as sentiment improves.',
  'Central bank holds interest rates steady this quarter.',
  'Freight costs ease as fuel prices stabilize.',
  'Small business optimism index rises for a second month.',
  'Analysts note tightening labor market across most sectors.'
];

function driftMarketIndex() {
  SECTORS.forEach(sector => {
    const idx = state.marketIndex[sector];
    // Gentle mean-reverting random walk keeps costs/prices from wandering forever.
    idx.costFactor = clamp(idx.costFactor + randRange(-0.015, 0.015) + (1 - idx.costFactor) * 0.02, 0.55, 1.9);
    idx.priceFactor = clamp(idx.priceFactor + randRange(-0.01, 0.01) + (1 - idx.priceFactor) * 0.02, 0.7, 1.6);

    if (Math.random() < MARKET_EVENT_CHANCE) {
      triggerMarketEvent(sector, idx);
    } else {
      idx.trend = idx.costFactor > 1.08 ? 'rising costs' : idx.costFactor < 0.92 ? 'falling costs' : 'stable';
    }
  });
}

function triggerMarketEvent(sector, idx) {
  const kind = pick(['cost_spike', 'cost_drop', 'demand_boom', 'demand_bust']);
  const label = SECTOR_LABELS[sector];
  if (kind === 'cost_spike') {
    idx.costFactor = clamp(idx.costFactor * randRange(1.15, 1.4), 0.5, 2.2);
    idx.trend = 'boom_cost';
    logNews(`Supply shortage hits ${label} — raw material costs spike.`);
  } else if (kind === 'cost_drop') {
    idx.costFactor = clamp(idx.costFactor * randRange(0.7, 0.87), 0.5, 2.2);
    idx.trend = 'bust_cost';
    logNews(`A supplier glut pushes ${label} material costs down sharply.`);
  } else if (kind === 'demand_boom') {
    idx.priceFactor = clamp(idx.priceFactor * randRange(1.1, 1.3), 0.6, 1.8);
    idx.trend = 'boom';
    logNews(`Consumer confidence surges in ${label} — market prices trend up.`);
  } else {
    idx.priceFactor = clamp(idx.priceFactor * randRange(0.75, 0.9), 0.6, 1.8);
    idx.trend = 'bust';
    logNews(`A slowdown hits ${label} — market prices soften.`);
  }
}

// --- loans ---------------------------------------------------------

function processLoansDaily() {
  for (let i = state.loans.length - 1; i >= 0; i--) {
    const loan = state.loans[i];
    const interest = loan.balance * (loan.apr / 365);

    if (state.cash >= loan.dailyPayment) {
      state.cash -= loan.dailyPayment;
      loan.balance = Math.max(0, loan.balance + interest - loan.dailyPayment);
      loan.termDaysLeft -= 1;
      loan.missedPayments = 0;
    } else {
      loan.balance += interest + LOAN_MISSED_PENALTY;
      loan.missedPayments = (loan.missedPayments || 0) + 1;
      loan.termDaysLeft -= 1;
      state.reputation = clamp(state.reputation - 3, 0, 100);
      logEvent(`Missed a payment on your ${loan.productName} loan — $${LOAN_MISSED_PENALTY} penalty added and reputation took a hit.`, 'bad');
    }

    if (loan.balance <= 0.5 || loan.termDaysLeft <= 0) {
      if (loan.balance > 0.5) {
        logEvent(`Your ${loan.productName} loan term ended with ${formatMoney(loan.balance)} still outstanding.`, 'warn');
      } else {
        logEvent(`Loan "${loan.productName}" paid off in full.`, 'good');
      }
      state.loans.splice(i, 1);
    }
  }
}

// --- taxes -----------------------------------------------------------

// Progressive brackets applied to a business's profit *for the month*.
function computeIncomeTax(profit) {
  if (profit <= 0) return 0;
  let tax = 0, lastCap = 0;
  for (const bracket of INCOME_TAX_BRACKETS) {
    const taxableInBracket = Math.min(profit, bracket.upTo) - lastCap;
    if (taxableInBracket > 0) tax += taxableInBracket * bracket.rate;
    lastCap = bracket.upTo;
    if (profit <= bracket.upTo) break;
  }
  return tax;
}

function getOwnedPropertyValue(biz, cfg) {
  if (cfg.kind === 'property') {
    return biz.properties.reduce((s, p) => s + p.currentValue, 0);
  }
  if (biz.propertyOwned) {
    const upgradeSpend = (cfg.upgradeCost || []).slice(0, biz.propertyLevel).reduce((a, b) => a + b, 0);
    return cfg.startupCost + upgradeSpend;
  }
  return 0;
}

function processMonthlyClose() {
  let totalIncomeTax = 0, totalPropertyTax = 0;
  state.businesses.forEach(biz => {
    const cfg = BUSINESS_TYPES[biz.typeId];
    const incomeTax = computeIncomeTax(biz.monthly.profit);
    const propValue = getOwnedPropertyValue(biz, cfg);
    const propertyTax = propValue * (PROPERTY_TAX_ANNUAL_RATE / 12);
    totalIncomeTax += incomeTax;
    totalPropertyTax += propertyTax;
    biz.monthly = { revenue: 0, profit: 0 };
  });
  const totalTax = totalIncomeTax + totalPropertyTax;
  state.cash -= totalTax;
  state.lifetimeTaxPaid += totalTax;
  logEvent(`Month-end taxes: ${formatMoney(totalIncomeTax)} income tax + ${formatMoney(totalPropertyTax)} property tax = ${formatMoney(totalTax)} total.`, 'warn');
}

/* =============================================================
   6. GAME LOOP
   ============================================================= */

var rafHandle = null;
var lastFrameTime = null;
var dayAccumulatorMs = 0;

function gameLoopFrame(timestamp) {
  if (lastFrameTime == null) lastFrameTime = timestamp;
  const delta = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  if (!state.paused) {
    dayAccumulatorMs += delta;
    const dayLengthMs = BASE_DAY_MS / state.speed;
    if (dayAccumulatorMs >= dayLengthMs) {
      dayAccumulatorMs -= dayLengthMs;
      advanceDay();
    }
  }
  rafHandle = requestAnimationFrame(gameLoopFrame);
}

function startGameLoop() {
  if (rafHandle) cancelAnimationFrame(rafHandle);
  lastFrameTime = null;
  dayAccumulatorMs = 0;
  rafHandle = requestAnimationFrame(gameLoopFrame);
}

function advanceDay() {
  state.day += 1;

  driftMarketIndex();

  state.businesses.forEach(biz => tickBusiness(biz));

  processLoansDaily();

  if (state.day % DAYS_PER_MONTH === 0) processMonthlyClose();
  if (state.day % DAYS_PER_WEEK === 0) saveGame(true);
  if (Math.random() < 0.04) logNews(pick(WORLD_NEWS_LINES));

  renderAll();
}

/* =============================================================
   7. ACTIONS — things the player can trigger from the UI
   ============================================================= */

function showToast(msg) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 2200);
}

function openModal(innerHTML) {
  const root = qs('#modalRoot');
  root.innerHTML = innerHTML;
  qs('#modalOverlay').classList.add('open');
}
function closeModal() {
  qs('#modalOverlay').classList.remove('open');
  qs('#modalRoot').innerHTML = '';
}

function setPaused(paused) {
  state.paused = paused;
  qs('#playPauseBtn .icon-play').style.display = paused ? '' : 'none';
  qs('#playPauseBtn .icon-pause').style.display = paused ? 'none' : '';
}

function setSpeed(speed) {
  state.speed = speed;
  qsa('.speed-btn').forEach(b => b.classList.toggle('active', +b.dataset.speed === speed));
}

function switchActiveBusiness(id) {
  state.activeBusinessId = id;
  renderAll();
}

function nextSlotCost() {
  const idx = state.businessSlots; // slots already owned = index of the NEXT slot to buy
  if (SLOT_COSTS[idx] != null) return SLOT_COSTS[idx];
  // Beyond the predefined tiers, keep scaling ~2.5x per additional slot
  // instead of flatlining at the last tier's price.
  const lastIdx = SLOT_COSTS.length - 1;
  return Math.round(SLOT_COSTS[lastIdx] * Math.pow(2.5, idx - lastIdx));
}

function buyBusinessSlot() {
  const cost = nextSlotCost();
  if (state.cash < cost) { showToast(`Need ${formatMoney(cost)} to buy this slot`); return; }
  state.cash -= cost;
  state.businessSlots += 1;
  logEvent(`Purchased business slot #${state.businessSlots} for ${formatMoney(cost)}.`, 'good');
  showToast('New business slot unlocked');
  renderAll();
}

function startNewBusiness(typeId) {
  const cfg = BUSINESS_TYPES[typeId];
  if (state.businesses.length >= state.businessSlots) { showToast('No free business slots — buy another slot first'); return; }
  if (state.cash < cfg.startupCost) { showToast(`Need ${formatMoney(cfg.startupCost)} to start this business`); return; }

  state.cash -= cfg.startupCost;
  const biz = createBusiness(typeId);
  state.businesses.push(biz);
  state.activeBusinessId = biz.id;
  logEvent(`Opened a new ${cfg.name} for ${formatMoney(cfg.startupCost)}.`, 'good');
  showToast(`${cfg.name} is open for business!`);
  closeModal();
  renderAll();
}

function renameBusiness(bizId, name) {
  const biz = state.businesses.find(b => b.id === bizId);
  if (!biz || !name.trim()) return;
  biz.name = name.trim().slice(0, 40);
  renderAll();
}

function setPrice(bizId, price) {
  const biz = state.businesses.find(b => b.id === bizId);
  if (!biz) return;
  biz.price = Math.max(0.1, price);
  renderOperations();
  renderTicker();
}

// Handles all three product states with one button:
//  - never unlocked -> pay unlockCost, go active (if a slot is free)
//  - active -> pause it (frees a slot, no penalty, keeps its history)
//  - unlocked but paused -> resume it for free (if a slot is free)
function toggleProduct(bizId, catalogId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  const p = biz.products.find(x => x.catalogId === catalogId);
  if (!p) return;
  const catalogEntry = cfg.productCatalog.find(c => c.id === catalogId);
  const activeCount = biz.products.filter(x => x.active).length;
  const slots = productSlots(biz, cfg);

  if (p.active) {
    p.active = false;
    logEvent(`Paused "${catalogEntry.name}" at ${biz.name}.`, 'info');
  } else if (p.everUnlocked) {
    if (activeCount >= slots) { showToast(`No free product slots (${activeCount}/${slots}) — pause something else or upgrade capacity`); return; }
    p.active = true;
    logEvent(`Resumed selling "${catalogEntry.name}" at ${biz.name}.`, 'info');
  } else {
    if (activeCount >= slots) { showToast(`No free product slots (${activeCount}/${slots}) — pause something else or upgrade capacity`); return; }
    if (state.cash < catalogEntry.unlockCost) { showToast(`Need ${formatMoney(catalogEntry.unlockCost)} to add this product`); return; }
    state.cash -= catalogEntry.unlockCost;
    p.everUnlocked = true;
    p.active = true;
    p.addedOnDay = state.day;
    logEvent(`Added "${catalogEntry.name}" to the lineup at ${biz.name} for ${formatMoney(catalogEntry.unlockCost)}.`, 'good');
  }
  renderOperations();
}

function setProductPrice(bizId, catalogId, price) {
  const biz = state.businesses.find(b => b.id === bizId);
  const p = biz && biz.products.find(x => x.catalogId === catalogId);
  if (!p) return;
  p.price = Math.max(0.1, price);
  renderOperations();
}

function hireEmployee(bizId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  if (biz.employees.length >= cfg.employeeSlots) { showToast('This business is fully staffed'); return; }
  const wage = cfg.wagePerEmployee || 60;
  const hireCost = wage * 2; // one-time onboarding cost
  if (state.cash < hireCost) { showToast(`Need ${formatMoney(hireCost)} to hire`); return; }
  state.cash -= hireCost;
  const emp = createEmployee(wage);
  biz.employees.push(emp);
  logEvent(`Hired ${emp.name} at ${biz.name} for ${formatMoney(wage)}/day.`, 'info');
  renderOperations();
  renderOverview();
}

function fireEmployee(bizId, empId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const emp = biz.employees.find(e => e.id === empId);
  biz.employees = biz.employees.filter(e => e.id !== empId);
  if (emp) logEvent(`Let go of ${emp.name} at ${biz.name}.`, 'warn');
  renderOperations();
}

function setEmployeeWage(bizId, empId, wage) {
  const biz = state.businesses.find(b => b.id === bizId);
  const emp = biz.employees.find(e => e.id === empId);
  if (!emp) return;
  emp.wage = clamp(wage, 0, 2000);
  renderOperations();
}

function buyMarketing(bizId, tierId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const tier = MARKETING_TIERS.find(t => t.id === tierId);
  if (state.cash < tier.cost) { showToast(`Need ${formatMoney(tier.cost)} for this campaign`); return; }
  state.cash -= tier.cost;
  biz.activeMarketing = { tierId: tier.id, demandMultiplier: tier.demandMultiplier, daysLeft: tier.durationDays };
  logEvent(`Launched "${tier.name}" at ${biz.name} for ${formatMoney(tier.cost)} (${tier.durationDays} days).`, 'good');
  renderOperations();
}

function upgradeProperty(bizId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  const nextLevel = biz.propertyLevel + 1;
  const cost = (cfg.upgradeCost || [])[nextLevel - 1];
  if (cost == null) { showToast('Already at max upgrade level'); return; }
  if (state.cash < cost) { showToast(`Need ${formatMoney(cost)} to upgrade`); return; }
  state.cash -= cost;
  biz.propertyLevel = nextLevel;
  logEvent(`Upgraded ${biz.name} to level ${nextLevel} for ${formatMoney(cost)} — more capacity.`, 'good');
  renderOperations();
}

function buyOutProperty(bizId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  if (biz.propertyOwned) return;
  const cost = Math.round(cfg.startupCost * 1.4);
  if (state.cash < cost) { showToast(`Need ${formatMoney(cost)} to buy the property outright`); return; }
  state.cash -= cost;
  biz.propertyOwned = true;
  logEvent(`Bought the property under ${biz.name} outright for ${formatMoney(cost)} — rent is gone, but property tax now applies.`, 'good');
  renderOperations();
}


// --- real estate specific -----------------------------------------

function buyRealEstateProperty(bizId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  const count = biz.properties.length;
  const cost = Math.round(cfg.propertyBaseCost * Math.pow(1.18, count));
  if (state.cash < cost) { showToast(`Need ${formatMoney(cost)} for this property — consider a bank loan`); return; }
  state.cash -= cost;
  biz.properties.push({
    id: uid(),
    label: `Property #${count + 1}`,
    cost: cost,
    currentValue: cost,
    baseRentMonthly: Math.round(cfg.propertyBaseRentMonthly * Math.pow(1.1, count)),
    condition: 100,
    level: 1
  });
  logEvent(`Bought ${biz.name} property #${count + 1} for ${formatMoney(cost)}.`, 'good');
  renderOperations();
}

function upgradeRealEstateProperty(bizId, propId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  const p = biz.properties.find(x => x.id === propId);
  if (!p) return;
  const nextLevel = p.level + 1;
  const cost = (cfg.upgradeCostPerProperty || [])[nextLevel - 1];
  if (cost == null) { showToast('This property is already fully renovated'); return; }
  if (state.cash < cost) { showToast(`Need ${formatMoney(cost)} to renovate`); return; }
  state.cash -= cost;
  p.level = nextLevel;
  p.condition = 100;
  p.baseRentMonthly = Math.round(p.baseRentMonthly * 1.22);
  p.currentValue = Math.round(p.currentValue + cost * 1.1);
  logEvent(`Renovated ${p.label} at ${biz.name} for ${formatMoney(cost)} — rent and value both rose.`, 'good');
  renderOperations();
}

function sellRealEstateProperty(bizId, propId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const p = biz.properties.find(x => x.id === propId);
  if (!p) return;
  state.cash += p.currentValue;
  biz.properties = biz.properties.filter(x => x.id !== propId);
  logEvent(`Sold ${p.label} for ${formatMoney(p.currentValue)}.`, 'info');
  renderOperations();
}

// --- bank / loans ----------------------------------------------------

function loanMax() {
  return Math.max(5000, Math.round(state.cash * LOAN_MAX_MULTIPLE_OF_CASH));
}

// Standard amortized-loan payment formula:
//   payment = P * r / (1 - (1+r)^-n)
// where P = principal, r = daily interest rate, n = term in days.
function computeDailyPayment(principal, apr, termDays) {
  const r = apr / 365;
  if (r === 0) return principal / termDays;
  return principal * r / (1 - Math.pow(1 + r, -termDays));
}

function takeLoan(productId, amount) {
  const product = LOAN_PRODUCTS.find(p => p.id === productId);
  amount = Math.round(amount);
  if (amount < 500) { showToast('Minimum loan is $500'); return; }
  if (amount > loanMax()) { showToast(`Max loan right now is ${formatMoney(loanMax())}`); return; }
  const dailyPayment = computeDailyPayment(amount, product.apr, product.termDays);
  state.loans.push({
    id: uid(), productName: product.name, principal: amount, balance: amount,
    apr: product.apr, termDaysLeft: product.termDays, dailyPayment: dailyPayment, missedPayments: 0
  });
  state.cash += amount;
  logEvent(`Took a ${product.name} loan of ${formatMoney(amount)} at ${pctStr(product.apr)} APR.`, 'info');
  closeModal();
  renderAll();
}

function payOffLoan(loanId) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  if (state.cash < loan.balance) { showToast(`Need ${formatMoney(loan.balance)} to pay this off`); return; }
  state.cash -= loan.balance;
  logEvent(`Paid off the remaining ${formatMoney(loan.balance)} on your ${loan.productName} loan early.`, 'good');
  state.loans = state.loans.filter(l => l.id !== loanId);
  renderAll();
}

// --- closing / bankrupting a business --------------------------------
//
// There was previously no way out of a business that's underwater —
// rent, wages, and marketing keep billing forever even if you've given
// up on it. This liquidates whatever's recoverable (owned property,
// a real-estate portfolio, unused manufacturing stock — all at a
// discount, since it's a fire sale) and removes the business for good.
// Any outstanding bank loans are tied to the player, not the business,
// so they are NOT forgiven by closing it.
const LIQUIDATION_PROPERTY_RATE = 0.6;   // owned property/leasehold improvements
const CLOSE_BUSINESS_REPUTATION_HIT = 4;

function estimateLiquidationValue(biz, cfg) {
  let value = 0;
  if (cfg.kind === 'property') {
    value += biz.properties.reduce((s, p) => s + p.currentValue, 0);
  } else if (biz.propertyOwned) {
    value += getOwnedPropertyValue(biz, cfg) * LIQUIDATION_PROPERTY_RATE;
  }
  return Math.round(value);
}

function closeBusiness(bizId) {
  const biz = state.businesses.find(b => b.id === bizId);
  if (!biz) return;
  const cfg = BUSINESS_TYPES[biz.typeId];
  const liquidation = estimateLiquidationValue(biz, cfg);

  state.cash += liquidation;
  state.reputation = clamp(state.reputation - CLOSE_BUSINESS_REPUTATION_HIT, 0, 100);
  state.businesses = state.businesses.filter(b => b.id !== bizId);
  if (state.activeBusinessId === bizId) {
    state.activeBusinessId = state.businesses.length ? state.businesses[0].id : null;
  }

  logEvent(
    `Closed ${biz.name}${liquidation > 0 ? ` — recovered ${formatMoney(liquidation)} liquidating assets.` : ' — nothing left to recover.'}`,
    'warn'
  );
  showToast(`${biz.name} closed`);
  closeModal();
  renderAll();
}

/* =============================================================
   8. RENDER
   ============================================================= */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function computeNetWorth() {
  let value = state.cash;
  state.businesses.forEach(biz => {
    const cfg = BUSINESS_TYPES[biz.typeId];
    value += getOwnedPropertyValue(biz, cfg);
  });
  state.loans.forEach(l => { value -= l.balance; });
  return value;
}

function renderAll() {
  renderTopbar();
  renderTicker();
  renderEventLog();
  renderOverview();
  renderOperations();
  renderFinances();
  renderBusinesses();
  renderMarket();
}

function renderTopbar() {
  qs('#statCash').textContent = formatMoney(state.cash);
  qs('#statNetWorth').textContent = formatMoney(computeNetWorth());
  const todayProfit = state.businesses.reduce((s, b) => s + (b.lastDaily.profit || 0), 0);
  const tpEl = qs('#statTodayProfit');
  tpEl.textContent = formatSignedMoney(todayProfit);
  tpEl.classList.toggle('pos', todayProfit >= 0);
  tpEl.classList.toggle('neg', todayProfit < 0);
  qs('#statDate').textContent = dayLabel(state.day);
  qs('#repValue').textContent = Math.round(state.reputation);
  qs('#repBarFill').style.width = clamp(state.reputation, 0, 100) + '%';
}

function renderTicker() {
  const track = qs('#tickerTrack');
  const items = SECTORS.map(sector => {
    const idx = state.marketIndex[sector];
    const delta = (idx.costFactor - 1) * 100;
    const dirClass = delta > 1 ? 'tup' : delta < -1 ? 'tdown' : '';
    const arrow = delta > 1 ? '\u25B2' : delta < -1 ? '\u25BC' : '\u2014';
    return `<span class="ticker-item"><span class="tsym">${SECTOR_LABELS[sector].toUpperCase()}</span> <span class="${dirClass}">${arrow} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%</span></span>`;
  }).join('');
  track.innerHTML = items + items;
}

function renderEventLog() {
  qs('#eventLogDay').textContent = 'Day ' + state.day;
  const list = qs('#eventLogList');
  list.innerHTML = state.eventLog.slice(-80).map(e => `
    <div class="log-entry type-${e.type}">
      <span class="log-day">${dayLabel(e.day)}</span>${escapeHtml(e.text)}
    </div>`).join('');
}

/* ---------- OVERVIEW ---------- */

function bizCardHtml(biz) {
  const cfg = BUSINESS_TYPES[biz.typeId];
  const active = biz.id === state.activeBusinessId;
  const p = biz.lastDaily.profit || 0;
  return `
    <div class="biz-card ${active ? 'active' : ''}" data-action="switch-biz" data-biz="${biz.id}">
      <div class="biz-card-top">
        <span class="biz-icon">${cfg.icon}</span>
        <div>
          <div class="biz-card-name">${escapeHtml(biz.name)}</div>
          <div class="biz-card-type">${cfg.name}</div>
        </div>
      </div>
      <div class="biz-card-stats">
        <span class="muted">Yesterday</span>
        <span class="badge ${p >= 0 ? 'badge-profit' : 'badge-loss'}">${formatSignedMoney(p)}</span>
      </div>
    </div>`;
}

function renderOverview() {
  const root = qs('#tab-overview');
  const todayProfit = state.businesses.reduce((s, b) => s + (b.lastDaily.profit || 0), 0);
  const todayRevenue = state.businesses.reduce((s, b) => s + (b.lastDaily.revenue || 0), 0);

  let html = `
    <div class="section-title"><h2>Overview</h2><span class="muted">${dayLabel(state.day)}</span></div>
    <div class="grid grid-4">
      <div class="card stat-card"><span class="label">Cash on hand</span><span class="value">${formatMoney(state.cash)}</span></div>
      <div class="card stat-card"><span class="label">Net worth</span><span class="value">${formatMoney(computeNetWorth())}</span></div>
      <div class="card stat-card"><span class="label">Today's revenue</span><span class="value">${formatMoney(todayRevenue)}</span></div>
      <div class="card stat-card"><span class="label">Today's profit</span><span class="value ${todayProfit >= 0 ? 'pos' : 'neg'}">${formatSignedMoney(todayProfit)}</span></div>
    </div>
    <div class="panel-header" style="margin-top:22px;">
      <h3>Your businesses</h3>
      <span class="muted">${state.businesses.length}/${state.businessSlots} slots used</span>
    </div>`;

  if (state.businesses.length === 0) {
    html += `
      <div class="card empty-state">
        <h3>No businesses yet</h3>
        <p>Head to the Businesses tab to open your first one. You're starting with ${formatMoney(STARTING_CASH)}.</p>
        <div style="margin-top:14px;"><button class="btn btn-primary" data-action="go-tab" data-tab="businesses">Choose a business</button></div>
      </div>`;
  } else {
    html += `<div class="grid grid-3">${state.businesses.map(bizCardHtml).join('')}</div>`;
  }

  root.innerHTML = html;
}

/* ---------- OPERATIONS ---------- */

function bizSwitcherHtml() {
  if (state.businesses.length < 2) return '';
  return `<div class="btn-row" style="margin-bottom:16px;">` + state.businesses.map(b => {
    const cfg = BUSINESS_TYPES[b.typeId];
    const active = b.id === state.activeBusinessId;
    return `<button class="btn btn-small ${active ? 'btn-primary' : 'btn-ghost'}" data-action="switch-biz" data-biz="${b.id}">${cfg.icon} ${escapeHtml(b.name)}</button>`;
  }).join('') + `</div>`;
}

function employeesPanelHtml(biz, cfg) {
  const wageBase = cfg.wagePerEmployee || 60;
  const rows = biz.employees.map(e => `
    <div class="emp-row">
      <span class="emp-name">${escapeHtml(e.name)}</span>
      <div class="emp-morale-bar"><div class="emp-morale-fill" style="width:${e.morale}%; background:${e.morale > 55 ? 'var(--profit)' : e.morale > 30 ? 'var(--accent)' : 'var(--loss)'};"></div></div>
      <input type="number" class="emp-wage" value="${Math.round(e.wage)}" min="0" step="5" data-action="set-wage" data-biz="${biz.id}" data-emp="${e.id}">
      <button class="btn btn-ghost btn-small btn-danger-text" data-action="fire-emp" data-biz="${biz.id}" data-emp="${e.id}">Let go</button>
    </div>`).join('') || `<p class="muted" style="font-size:12.5px;">No employees yet — ${cfg.moraleDriven ? 'this business barely runs without staff.' : 'you are running this solo.'}</p>`;

  return `
    <div class="card">
      <div class="panel-header">
        <h3>Staff (${biz.employees.length}/${cfg.employeeSlots})</h3>
        <button class="btn btn-small btn-primary" data-action="hire-emp" data-biz="${biz.id}">Hire (~${formatMoney(wageBase * 2)})</button>
      </div>
      ${rows}
    </div>`;
}

function marketingPanelHtml(biz, cfg) {
  const active = biz.activeMarketing;
  const tiers = MARKETING_TIERS.map(t => `
    <button class="btn btn-small" data-action="buy-marketing" data-biz="${biz.id}" data-tier="${t.id}">
      ${t.name} — ${formatMoney(t.cost)} (${t.durationDays}d)
    </button>`).join('');
  return `
    <div class="card">
      <div class="panel-header"><h3>Marketing</h3>${cfg.adDependent ? '<span class="badge badge-loss">Ad-dependent</span>' : ''}</div>
      ${active ? `<p style="font-size:13px;margin-bottom:10px;">Running <strong>${MARKETING_TIERS.find(t => t.id === active.tierId).name}</strong> — ${active.daysLeft} day(s) left.</p>` : `<p class="muted" style="font-size:12.5px;margin-bottom:10px;">No campaign running${cfg.adDependent ? ' — demand is currently suppressed.' : '.'}</p>`}
      <div class="btn-row">${tiers}</div>
    </div>`;
}

function plCardHtml(biz) {
  const d = biz.lastDaily;
  const rows = [
    ['Revenue', d.revenue, false],
    ['COGS / waste', -d.cogs, false],
    ['Operating expenses', -d.expenses, false],
    ['Net profit', d.profit, true]
  ];
  return `
    <div class="card">
      <div class="panel-header"><h3>Yesterday's P&amp;L</h3></div>
      <table>
        <tbody>
          ${rows.map(([label, val, bold]) => `
            <tr>
              <td${bold ? ' style="font-weight:700;"' : ''}>${label}</td>
              <td class="mono" style="text-align:right;${bold ? 'font-weight:700;' : ''} color:${val >= 0 ? 'var(--profit)' : 'var(--loss)'}">${formatSignedMoney(val)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function salesOperationsHtml(biz, cfg) {
  const capacity = cfg.baseCapacityPerLevel * biz.propertyLevel;
  const nextUpgradeCost = (cfg.upgradeCost || [])[biz.propertyLevel];
  return `
    <div class="card">
      <div class="panel-header"><h3>Capacity</h3></div>
      <div class="field">
        <label>Level ${biz.propertyLevel} — ${formatNum(capacity)} units/day, shared across your whole menu</label>
        <div class="hint">Units sold yesterday: ${formatNum(biz.lastDaily.unitsSold, 1)}${cfg.perishable && biz.lastDaily.waste > 0 ? ` · wasted ${formatMoney(biz.lastDaily.waste)} in unsold prep` : ''}</div>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn btn-small" data-action="upgrade-property" data-biz="${biz.id}" ${nextUpgradeCost == null ? 'disabled' : ''}>
            ${nextUpgradeCost != null ? `Upgrade — ${formatMoney(nextUpgradeCost)}` : 'Max level'}
          </button>
          ${cfg.rent > 0 && !biz.propertyOwned ? `<button class="btn btn-small btn-ghost" data-action="buyout-property" data-biz="${biz.id}">Buy property outright — ${formatMoney(Math.round(cfg.startupCost * 1.4))}</button>` : ''}
          ${biz.propertyOwned ? `<span class="badge badge-accent">Property owned</span>` : cfg.rent > 0 ? `<span class="badge badge-neutral">Renting — ${formatMoney(cfg.rent)}/day</span>` : ''}
        </div>
      </div>
    </div>`;
}

function manufacturingOperationsHtml(biz, cfg) {
  const capacity = cfg.baseCapacityPerLevel * biz.propertyLevel;
  const nextUpgradeCost = (cfg.upgradeCost || [])[biz.propertyLevel];
  const sectorIdx = state.marketIndex[cfg.sector];
  const unitCost = (cfg.baseMaterialCost * sectorIdx.costFactor).toFixed(2);
  const productionCapacity = biz.employees.length * cfg.productivityPerEmployee;

  let warning = '';
  if (biz.employees.length === 0) {
    warning = `<div class="alert-banner">⚠️ No one is staffing the line — hire at least one employee or production stays at zero.</div>`;
  } else if (biz.lastDaily.staffLimited) {
    warning = `<div class="alert-banner warn">Staff throughput is your bottleneck — hire more line workers to capture the demand you're leaving on the table.</div>`;
  }

  return `
    <div class="card">
      <div class="panel-header"><h3>Production line</h3></div>
      ${warning}
      <div class="field">
        <label>Demand ceiling — level ${biz.propertyLevel} (${formatNum(capacity)} units/day, shared across every product)</label>
        <div class="hint">Produced &amp; sold yesterday: ${formatNum(biz.lastDaily.unitsSold, 1)} units</div>
        <button class="btn btn-small" style="margin-top:8px;" data-action="upgrade-property" data-biz="${biz.id}" ${nextUpgradeCost == null ? 'disabled' : ''}>
          ${nextUpgradeCost != null ? `Upgrade — ${formatMoney(nextUpgradeCost)}` : 'Max level'}
        </button>
      </div>
      <div class="field">
        <label>Staff throughput: ${formatNum(productionCapacity)} units/day (${biz.employees.length} employee${biz.employees.length === 1 ? '' : 's'} × ${cfg.productivityPerEmployee}/day each)</label>
        <div class="hint">Raw materials are bought automatically as you produce, at today's market rate — currently ~$${unitCost}/unit. No restocking to manage.</div>
      </div>
    </div>`;
}

function productRowStatus(p) {
  if (p.active) return { badge: '<span class="badge badge-profit">Active</span>', btnLabel: 'Pause', btnClass: 'btn-ghost' };
  if (p.everUnlocked) return { badge: '<span class="badge badge-neutral">Paused</span>', btnLabel: 'Resume', btnClass: '' };
  return { badge: '<span class="badge badge-neutral">Not added</span>', btnLabel: null, btnClass: 'btn-primary' };
}

function productsPanelHtml(biz, cfg) {
  if (!cfg.productCatalog) return '';
  const slots = productSlots(biz, cfg);
  const activeCount = biz.products.filter(p => p.active).length;
  const sectorIdx = state.marketIndex[cfg.sector];

  const rows = cfg.productCatalog.map(catalogEntry => {
    const p = biz.products.find(x => x.catalogId === catalogEntry.id);
    const status = productRowStatus(p);
    const marketAvg = catalogEntry.basePrice * sectorIdx.priceFactor;

    const priceCell = p.everUnlocked
      ? `<input type="number" step="0.5" min="0.1" value="${p.price.toFixed(2)}" data-action="set-product-price" data-biz="${biz.id}" data-product="${catalogEntry.id}" style="width:88px;">`
      : `<span class="muted mono" style="font-size:11.5px;">~$${marketAvg.toFixed(2)} avg</span>`;

    const statsCell = p.everUnlocked
      ? (p.active
          ? `<span class="mono" style="font-size:11.5px;">${formatNum(p.lastDaily.unitsSold, 1)} sold · ${formatMoney(p.lastDaily.revenue)}</span>`
          : `<span class="muted" style="font-size:11.5px;">Idle</span>`)
      : `<span class="muted" style="font-size:11.5px;">—</span>`;

    const actionBtn = status.btnLabel
      ? `<button class="btn btn-small ${status.btnClass}" data-action="toggle-product" data-biz="${biz.id}" data-product="${catalogEntry.id}">${status.btnLabel}</button>`
      : `<button class="btn btn-small btn-primary" data-action="toggle-product" data-biz="${biz.id}" data-product="${catalogEntry.id}">Add — ${formatMoney(catalogEntry.unlockCost)}</button>`;

    return `
      <tr>
        <td>${escapeHtml(catalogEntry.name)}<br>${status.badge}</td>
        <td>${priceCell}</td>
        <td>${statsCell}</td>
        <td>
          <div class="btn-row">
            ${actionBtn}
            ${p.everUnlocked ? `<button class="btn btn-small btn-ghost" data-action="view-product-analytics" data-biz="${biz.id}" data-product="${catalogEntry.id}">Analytics</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="panel-header"><h3>Products (${activeCount}/${slots} active)</h3></div>
      ${activeCount === 0 ? `<div class="alert-banner">⚠️ Nothing is active — you're paying full overhead with zero revenue coming in. Add or resume a product below.</div>` : ''}
      <table>
        <thead><tr><th>Product</th><th>Price</th><th>Yesterday</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint" style="margin-top:10px;">Every active product draws from the same daily demand pool — price near the market average to win volume, or go niche with fewer, pricier items. Upgrading capacity also opens more product slots.</p>
    </div>`;
}

// A tiny inline SVG line chart for one product's recent history — this is
// the "analytics for just that product" view, opened from its Analytics button.
function buildSparklineSvg(history, field, color) {
  const w = 420, h = 120, pad = 10;
  if (!history || history.length < 2) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><text x="${w / 2}" y="${h / 2}" fill="var(--text-faint)" font-size="12" text-anchor="middle" font-family="Inter, sans-serif">Not enough history yet</text></svg>`;
  }
  const values = history.map(d => d[field]);
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const stepX = (w - pad * 2) / (history.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const areaPoints = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;
  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
      <polyline points="${areaPoints}" fill="${color}" opacity="0.12" stroke="none"></polyline>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    </svg>`;
}

function openProductAnalyticsModal(bizId, catalogId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  const catalogEntry = cfg.productCatalog.find(c => c.id === catalogId);
  const p = biz.products.find(x => x.catalogId === catalogId);

  const chart = buildSparklineSvg(p.history, 'margin', 'var(--profit)');
  const daysActive = p.addedOnDay ? Math.max(1, state.day - p.addedOnDay) : 0;
  const avgDailyUnits = daysActive > 0 ? p.lifetime.unitsSold / daysActive : 0;

  openModal(`
    <button class="modal-close" data-action="close-modal">&times;</button>
    <h3>${escapeHtml(catalogEntry.name)}</h3>
    <p class="modal-sub">${biz.name} · ${p.active ? 'Active' : p.everUnlocked ? 'Paused' : 'Not added yet'} · on the lineup for ${daysActive} day(s)</p>
    ${chart}
    <div class="wb-row"><span>Yesterday's units sold</span><span class="mono">${formatNum(p.lastDaily.unitsSold, 1)}</span></div>
    <div class="wb-row"><span>Yesterday's revenue</span><span class="mono">${formatMoney(p.lastDaily.revenue)}</span></div>
    <div class="wb-row"><span>Yesterday's margin</span><span class="mono">${formatSignedMoney(p.lastDaily.margin)}</span></div>
    <div class="wb-row"><span>Avg. units/day (lifetime)</span><span class="mono">${formatNum(avgDailyUnits, 1)}</span></div>
    <div class="wb-row"><span>Lifetime revenue</span><span class="mono">${formatMoney(p.lifetime.revenue)}</span></div>
    <div class="wb-row"><span>Lifetime margin</span><span class="mono">${formatSignedMoney(p.lifetime.margin)}</span></div>
    <div class="modal-footer"><button class="btn btn-ghost" data-action="close-modal">Close</button></div>
  `);
}

function subscriptionOperationsHtml(biz, cfg) {
  const capacity = cfg.baseCapacityPerLevel * biz.propertyLevel;
  const nextUpgradeCost = (cfg.upgradeCost || [])[biz.propertyLevel];
  const churn = biz.lastDaily.churnRate != null ? pctStr(biz.lastDaily.churnRate, 2) : '—';
  return `
    <div class="card">
      <div class="panel-header"><h3>Subscription &amp; infrastructure</h3></div>
      <div class="field">
        <label>Monthly subscription price</label>
        <input type="number" step="1" min="1" value="${biz.price.toFixed(2)}" data-action="set-price" data-biz="${biz.id}">
        <div class="hint">Subscribers: ${formatNum(biz.subscriberBase, 0)} / ${formatNum(capacity)} capacity · daily churn ${churn} · new signups yesterday ${formatNum(biz.lastDaily.newSignups || 0, 1)}</div>
      </div>
      <div class="progress" style="margin-bottom:12px;"><div class="progress-fill" style="width:${clamp(biz.subscriberBase / capacity * 100, 0, 100)}%;"></div></div>
      <div class="field">
        <label>Server / infra capacity — level ${biz.propertyLevel}</label>
        <button class="btn btn-small" data-action="upgrade-property" data-biz="${biz.id}" ${nextUpgradeCost == null ? 'disabled' : ''}>
          ${nextUpgradeCost != null ? `Upgrade — ${formatMoney(nextUpgradeCost)}` : 'Max level'}
        </button>
      </div>
    </div>`;
}

function propertyOperationsHtml(biz, cfg) {
  const count = biz.properties.length;
  const nextCost = Math.round(cfg.propertyBaseCost * Math.pow(1.18, count));
  const rows = biz.properties.map(p => {
    const nextUpg = (cfg.upgradeCostPerProperty || [])[p.level];
    return `
      <tr>
        <td>${p.label} <span class="badge badge-neutral">Lv${p.level}</span></td>
        <td class="mono">${formatMoney(p.currentValue)}</td>
        <td class="mono">${formatMoney(Math.round(p.baseRentMonthly))}/mo</td>
        <td>
          <div class="progress" style="width:70px;"><div class="progress-fill ${p.condition < 40 ? 'loss' : ''}" style="width:${p.condition}%;"></div></div>
        </td>
        <td>
          <div class="btn-row">
            <button class="btn btn-small" data-action="upgrade-realestate" data-biz="${biz.id}" data-prop="${p.id}" ${nextUpg == null ? 'disabled' : ''}>${nextUpg != null ? `Renovate ${formatMoney(nextUpg)}` : 'Maxed'}</button>
            <button class="btn btn-small btn-ghost" data-action="sell-realestate" data-biz="${biz.id}" data-prop="${p.id}">Sell</button>
          </div>
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="5" class="muted">No properties yet.</td></tr>`;

  return `
    <div class="card">
      <div class="panel-header">
        <h3>Property portfolio (${count})</h3>
        <button class="btn btn-small btn-primary" data-action="buy-realestate" data-biz="${biz.id}">Buy property — ${formatMoney(nextCost)}</button>
      </div>
      <table>
        <thead><tr><th>Property</th><th>Value</th><th>Rent</th><th>Condition</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint" style="margin-top:10px;">Values drift with the real-estate market; condition decays daily and drags down rent until renovated. Buying a property outright is a heavy up-front cost — the Bank tab can finance it.</p>
    </div>`;
}

function renderOperations() {
  const root = qs('#tab-operations');
  const biz = getActiveBusiness();

  if (!biz) {
    root.innerHTML = `
      <div class="section-title"><h2>Operations</h2></div>
      <div class="card empty-state">
        <h3>No active business</h3>
        <p>Open a business from the Businesses tab to manage pricing, staff, and marketing here.</p>
        <div style="margin-top:14px;"><button class="btn btn-primary" data-action="go-tab" data-tab="businesses">Choose a business</button></div>
      </div>`;
    return;
  }

  const cfg = BUSINESS_TYPES[biz.typeId];
  let body = '';
  if (cfg.kind === 'sales') body = salesOperationsHtml(biz, cfg);
  else if (cfg.kind === 'manufacturing') body = manufacturingOperationsHtml(biz, cfg);
  else if (cfg.kind === 'subscription') body = subscriptionOperationsHtml(biz, cfg);
  else body = propertyOperationsHtml(biz, cfg);

  const showEmployees = true; // every kind uses some staff
  const showMarketing = cfg.kind !== 'property';

  root.innerHTML = `
    <div class="section-title"><h2>Operations</h2><span class="muted">${cfg.name}</span></div>
    ${bizSwitcherHtml()}
    <div class="card" style="display:flex; align-items:center; gap:14px;">
      <span style="font-size:26px;">${cfg.icon}</span>
      <input type="text" value="${escapeHtml(biz.name)}" data-action="rename-biz" data-biz="${biz.id}" style="font-family:var(--font-display); font-weight:600; font-size:15px; background:transparent; border:1px solid transparent; padding:6px 8px; max-width:260px;">
      <span class="badge ${biz.lastDaily.profit >= 0 ? 'badge-profit' : 'badge-loss'}" style="margin-left:auto;">Yesterday ${formatSignedMoney(biz.lastDaily.profit)}</span>
      <button class="btn btn-small btn-ghost btn-danger-text" data-action="open-close-business-modal" data-biz="${biz.id}">Close business</button>
    </div>
    ${cfg.productCatalog ? productsPanelHtml(biz, cfg) : ''}
    <div class="grid grid-2" style="margin-top:14px; align-items:start;">
      <div>
        ${body}
        ${showMarketing ? marketingPanelHtml(biz, cfg) : ''}
      </div>
      <div>
        ${showEmployees ? employeesPanelHtml(biz, cfg) : ''}
        ${plCardHtml(biz)}
      </div>
    </div>`;
}

/* ---------- FINANCES ---------- */

function loanRowHtml(loan) {
  return `
    <tr>
      <td>${loan.productName}</td>
      <td class="mono">${formatMoney(loan.balance)}</td>
      <td class="mono">${pctStr(loan.apr)}</td>
      <td class="mono">${formatMoney(loan.dailyPayment)}/day</td>
      <td class="mono">${loan.termDaysLeft}d left</td>
      <td>${loan.missedPayments > 0 ? `<span class="badge badge-loss">${loan.missedPayments} missed</span>` : `<span class="badge badge-profit">Current</span>`}</td>
      <td><button class="btn btn-small btn-ghost" data-action="payoff-loan" data-loan="${loan.id}">Pay off</button></td>
    </tr>`;
}

function bizPlRowHtml(biz) {
  const cfg = BUSINESS_TYPES[biz.typeId];
  const d = biz.lastDaily;
  return `
    <tr>
      <td>${cfg.icon} ${escapeHtml(biz.name)}</td>
      <td class="mono">${formatMoney(d.revenue)}</td>
      <td class="mono">${formatMoney(d.cogs)}</td>
      <td class="mono">${formatMoney(d.expenses)}</td>
      <td class="mono" style="color:${d.profit >= 0 ? 'var(--profit)' : 'var(--loss)'}">${formatSignedMoney(d.profit)}</td>
    </tr>`;
}

function renderFinances() {
  const root = qs('#tab-finances');
  const totalRevenue = state.businesses.reduce((s, b) => s + (b.lastDaily.revenue || 0), 0);
  const totalCogs = state.businesses.reduce((s, b) => s + (b.lastDaily.cogs || 0), 0);
  const totalExpenses = state.businesses.reduce((s, b) => s + (b.lastDaily.expenses || 0), 0);
  const totalProfit = state.businesses.reduce((s, b) => s + (b.lastDaily.profit || 0), 0);
  const daysToTax = DAYS_PER_MONTH - (state.day % DAYS_PER_MONTH || DAYS_PER_MONTH);
  const totalLoanBalance = state.loans.reduce((s, l) => s + l.balance, 0);

  const plRows = state.businesses.map(bizPlRowHtml).join('') || `<tr><td colspan="5" class="muted">No businesses yet.</td></tr>`;
  const loanRows = state.loans.map(loanRowHtml).join('') || `<tr><td colspan="7" class="muted">No active loans.</td></tr>`;

  root.innerHTML = `
    <div class="section-title"><h2>Finances</h2><span class="muted">${dayLabel(state.day)}</span></div>

    <div class="grid grid-4">
      <div class="card stat-card"><span class="label">Revenue (yesterday)</span><span class="value">${formatMoney(totalRevenue)}</span></div>
      <div class="card stat-card"><span class="label">COGS &amp; waste</span><span class="value">${formatMoney(totalCogs)}</span></div>
      <div class="card stat-card"><span class="label">Operating expenses</span><span class="value">${formatMoney(totalExpenses)}</span></div>
      <div class="card stat-card"><span class="label">Net profit</span><span class="value ${totalProfit >= 0 ? 'pos' : 'neg'}">${formatSignedMoney(totalProfit)}</span></div>
    </div>

    <div class="panel-header" style="margin-top:22px;"><h3>Profit &amp; loss by business (yesterday)</h3></div>
    <div class="card" style="padding:6px 10px;">
      <table>
        <thead><tr><th>Business</th><th>Revenue</th><th>COGS</th><th>Expenses</th><th>Profit</th></tr></thead>
        <tbody>${plRows}</tbody>
      </table>
    </div>

    <div class="panel-header" style="margin-top:22px;">
      <h3>The Bank</h3>
      <button class="btn btn-small btn-primary" data-action="open-loan-modal">Take a loan</button>
    </div>
    <div class="card" style="padding:6px 10px;">
      <table>
        <thead><tr><th>Product</th><th>Balance</th><th>APR</th><th>Payment</th><th>Term</th><th>Status</th><th></th></tr></thead>
        <tbody>${loanRows}</tbody>
      </table>
      ${state.loans.length > 0 ? `<p class="hint" style="padding:8px 10px;">Total outstanding: ${formatMoney(totalLoanBalance)}. Missed payments add a $${LOAN_MISSED_PENALTY} penalty and hurt your reputation.</p>` : ''}
    </div>

    <div class="panel-header" style="margin-top:22px;"><h3>Taxes</h3></div>
    <div class="grid grid-3">
      <div class="card stat-card"><span class="label">Lifetime tax paid</span><span class="value">${formatMoney(state.lifetimeTaxPaid)}</span></div>
      <div class="card stat-card"><span class="label">Next tax day in</span><span class="value">${daysToTax} day(s)</span></div>
      <div class="card stat-card"><span class="label">Property tax rate</span><span class="value">${pctStr(PROPERTY_TAX_ANNUAL_RATE)}/yr</span></div>
    </div>
    <p class="hint" style="margin-top:8px;">Income tax is progressive on each business's monthly profit (15% / 25% / 35% brackets). Property tax applies to owned real estate and any business property you've bought outright, charged monthly.</p>
  `;
}

/* ---------- BUSINESSES ---------- */

function typeCardHtml(typeId) {
  const cfg = BUSINESS_TYPES[typeId];
  const owned = state.businesses.some(b => b.typeId === typeId);
  const canAfford = state.cash >= cfg.startupCost;
  const hasSlot = state.businesses.length < state.businessSlots;
  let actionHtml;
  if (owned) {
    const biz = state.businesses.find(b => b.typeId === typeId);
    actionHtml = `<button class="btn btn-small btn-primary" data-action="manage-biz" data-biz="${biz.id}">Manage</button>`;
  } else {
    actionHtml = `<button class="btn btn-small ${canAfford && hasSlot ? 'btn-primary' : ''}" data-action="start-biz" data-type="${typeId}" ${(!canAfford || !hasSlot) ? 'disabled' : ''}>
        Start — ${formatMoney(cfg.startupCost)}
      </button>`;
  }
  return `
    <div class="type-card">
      <div class="type-card-head"><span class="type-icon">${cfg.icon}</span><span class="type-name">${cfg.name}</span>${owned ? '<span class="badge badge-accent" style="margin-left:auto;">Owned</span>' : ''}</div>
      <p class="type-desc">${cfg.description}</p>
      <div class="type-meta">
        <span>Startup ${formatMoney(cfg.startupCost)}</span>
        ${cfg.rent ? `<span>Rent ${formatMoney(cfg.rent)}/day</span>` : ''}
      </div>
      ${actionHtml}
    </div>`;
}

function renderBusinesses() {
  const root = qs('#tab-businesses');
  const cost = nextSlotCost();
  root.innerHTML = `
    <div class="section-title"><h2>Businesses</h2><span class="muted">${state.businesses.length}/${state.businessSlots} slots used</span></div>

    <div class="card" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:600; font-size:13.5px;">Business slots</div>
        <div class="muted" style="font-size:12px;">Each slot lets you run one more business at the same time.</div>
      </div>
      <button class="btn btn-primary" style="margin-left:auto;" data-action="buy-slot">Buy slot #${state.businessSlots + 1} — ${formatMoney(cost)}</button>
    </div>

    <div class="panel-header" style="margin-top:20px;"><h3>Choose a business type</h3></div>
    <div class="grid grid-3">
      ${Object.keys(BUSINESS_TYPES).map(typeCardHtml).join('')}
    </div>
  `;
}

/* ---------- MARKET & NEWS ---------- */

function renderMarket() {
  const root = qs('#tab-market');
  const sectorRows = SECTORS.map(sector => {
    const idx = state.marketIndex[sector];
    const costDelta = (idx.costFactor - 1) * 100;
    const priceDelta = (idx.priceFactor - 1) * 100;
    return `
      <div class="sector-row">
        <span class="sector-name">${SECTOR_LABELS[sector]}</span>
        <span class="sector-index" style="color:${costDelta > 0 ? 'var(--loss)' : 'var(--profit)'}">Costs ${costDelta >= 0 ? '+' : ''}${costDelta.toFixed(1)}%</span>
        <span class="sector-index" style="color:${priceDelta > 0 ? 'var(--profit)' : 'var(--loss)'}">Prices ${priceDelta >= 0 ? '+' : ''}${priceDelta.toFixed(1)}%</span>
      </div>`;
  }).join('');

  const newsItems = state.news.slice().reverse().slice(0, 40).map(n => `
    <div class="news-item"><span class="news-day">${dayLabel(n.day)}</span>${escapeHtml(n.text)}</div>`).join('') || `<p class="muted">No news yet — check back after a few in-game days.</p>`;

  root.innerHTML = `
    <div class="section-title"><h2>Market &amp; News</h2><span class="muted">${dayLabel(state.day)}</span></div>
    <div class="card">
      <div class="panel-header"><h3>Sector index</h3></div>
      ${sectorRows}
      <p class="hint" style="margin-top:10px;">Costs drift the raw-material price you pay; Prices drift the market average your customers compare you against. Both random-walk day to day with occasional shocks.</p>
    </div>
    <div class="panel-header" style="margin-top:20px;"><h3>News feed</h3></div>
    ${newsItems}
  `;
}

/* ---------- MODALS ---------- */

function openLoanModal() {
  const max = loanMax();
  const optionsHtml = LOAN_PRODUCTS.map(p => `<option value="${p.id}">${p.name} — ${pctStr(p.apr)} APR, ${p.termDays}d term</option>`).join('');
  openModal(`
    <button class="modal-close" data-action="close-modal">&times;</button>
    <h3>Take a loan</h3>
    <p class="modal-sub">Max available right now: ${formatMoney(max)}, based on your cash on hand.</p>
    <div class="field">
      <label>Loan product</label>
      <select id="loanProduct">${optionsHtml}</select>
    </div>
    <div class="field">
      <label>Amount</label>
      <input type="number" id="loanAmount" min="500" max="${max}" step="500" value="${Math.min(10000, max)}">
      <div class="hint" id="loanPreview"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="confirm-loan">Confirm loan</button>
    </div>
  `);
  updateLoanPreview();
  qs('#loanProduct').addEventListener('change', updateLoanPreview);
  qs('#loanAmount').addEventListener('input', updateLoanPreview);
}

function updateLoanPreview() {
  const productId = qs('#loanProduct').value;
  const amount = +qs('#loanAmount').value || 0;
  const product = LOAN_PRODUCTS.find(p => p.id === productId);
  const payment = computeDailyPayment(amount, product.apr, product.termDays);
  qs('#loanPreview').textContent = `Estimated payment: ${formatMoney(payment)}/day for ${product.termDays} days.`;
}

function openWelcomeBackModal(summary) {
  const perBizRows = summary.perBiz.map(b => `
    <div class="wb-row"><span>${escapeHtml(b.name)}</span><span class="mono">${formatSignedMoney(b.profit)}</span></div>`).join('');
  openModal(`
    <h3>Welcome back!</h3>
    <p class="modal-sub">${summary.days} in-game day(s) passed while you were away.</p>
    <div class="wb-row"><span>Revenue earned</span><span class="mono">${formatMoney(summary.revenue)}</span></div>
    <div class="wb-row"><span>Expenses paid</span><span class="mono">${formatMoney(summary.expenses)}</span></div>
    ${perBizRows}
    <div class="wb-row"><span>Net profit</span><span class="mono">${formatSignedMoney(summary.profit)}</span></div>
    <div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Back to work</button></div>
  `);
}

function openOnboardingModal() {
  const cards = Object.keys(BUSINESS_TYPES).map(id => {
    const cfg = BUSINESS_TYPES[id];
    return `
      <button class="onboard-type" data-action="start-biz" data-type="${id}">
        <span class="oi">${cfg.icon}</span>
        <span class="on">${cfg.name}</span>
        <span class="oc">${formatMoney(cfg.startupCost)} startup</span>
      </button>`;
  }).join('');
  openModal(`
    <h3>Welcome to Ledger &amp; Co.</h3>
    <p class="modal-sub">You're starting with ${formatMoney(STARTING_CASH)}. Pick your first business — you can open more later as you unlock business slots.</p>
    <div class="onboard-grid">${cards}</div>
  `);
}

function openCloseBusinessModal(bizId) {
  const biz = state.businesses.find(b => b.id === bizId);
  const cfg = BUSINESS_TYPES[biz.typeId];
  const liquidation = estimateLiquidationValue(biz, cfg);
  const isLosingMoney = biz.lastDaily.profit < 0;

  openModal(`
    <button class="modal-close" data-action="close-modal">&times;</button>
    <h3>Close ${escapeHtml(biz.name)}?</h3>
    <p class="modal-sub">This shuts the business down for good — employees are let go, any product lineup is lost, and the slot frees up for something new. Any bank loans stay with you; they're not tied to this business.</p>
    <div class="wb-row"><span>Estimated liquidation proceeds</span><span class="mono">${formatMoney(liquidation)}</span></div>
    <div class="wb-row"><span>Reputation impact</span><span class="mono" style="color:var(--loss);">-${CLOSE_BUSINESS_REPUTATION_HIT}</span></div>
    ${isLosingMoney ? `<p class="hint" style="margin-top:8px;">This business lost ${formatMoney(Math.abs(biz.lastDaily.profit))} yesterday — closing it stops the bleeding immediately.</p>` : ''}
    <p class="hint" style="margin-top:8px;">This can't be undone.</p>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn btn-danger" data-action="confirm-close-business" data-biz="${biz.id}">Close business</button>
    </div>
  `);
}

/* =============================================================
   9. EVENTS
   ============================================================= */

function switchTab(tabName) {
  qsa('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tabName));
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  qsa('.mnav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
}

function wireEvents() {
  // Sidebar + mobile nav tab switching
  qsa('.nav-item, .mnav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Time controls
  qs('#playPauseBtn').addEventListener('click', () => setPaused(!state.paused));
  qs('#speedToggle').addEventListener('click', e => {
    const btn = e.target.closest('.speed-btn');
    if (btn) setSpeed(+btn.dataset.speed);
  });

  qs('#saveNowBtn').addEventListener('click', () => saveGame(false));
  qs('#resetGameBtn').addEventListener('click', () => {
    if (confirm('Reset your entire game? This cannot be undone.')) resetGame();
  });

  // Click on overlay background (not the modal itself) closes it
  qs('#modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  // Delegated click handling for every data-action button across all tabs + modals
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const bizId = target.dataset.biz;

    switch (action) {
      case 'go-tab': switchTab(target.dataset.tab); break;
      case 'switch-biz': switchActiveBusiness(bizId); break;
      case 'manage-biz': switchActiveBusiness(bizId); switchTab('operations'); break;
      case 'start-biz': startNewBusiness(target.dataset.type); break;
      case 'buy-slot': buyBusinessSlot(); break;
      case 'hire-emp': hireEmployee(bizId); break;
      case 'fire-emp': fireEmployee(bizId, target.dataset.emp); break;
      case 'buy-marketing': buyMarketing(bizId, +target.dataset.tier); break;
      case 'upgrade-property': upgradeProperty(bizId); break;
      case 'buyout-property': buyOutProperty(bizId); break;
      case 'buy-realestate': buyRealEstateProperty(bizId); break;
      case 'upgrade-realestate': upgradeRealEstateProperty(bizId, target.dataset.prop); break;
      case 'sell-realestate': sellRealEstateProperty(bizId, target.dataset.prop); break;
      case 'toggle-product': toggleProduct(bizId, target.dataset.product); break;
      case 'view-product-analytics': openProductAnalyticsModal(bizId, target.dataset.product); break;
      case 'open-close-business-modal': openCloseBusinessModal(bizId); break;
      case 'confirm-close-business': closeBusiness(bizId); break;
      case 'open-loan-modal': openLoanModal(); break;
      case 'confirm-loan': takeLoan(qs('#loanProduct').value, +qs('#loanAmount').value || 0); break;
      case 'payoff-loan': payOffLoan(target.dataset.loan); break;
      case 'close-modal': closeModal(); break;
      default: break;
    }
  });

  // Delegated 'change' handling for text/number inputs (fires on blur / enter,
  // so typing isn't interrupted by a mid-edit re-render).
  document.addEventListener('change', e => {
    const target = e.target;
    if (!target.dataset || !target.dataset.action) return;
    const action = target.dataset.action;
    const bizId = target.dataset.biz;

    switch (action) {
      case 'set-price': setPrice(bizId, +target.value); break;
      case 'set-product-price': setProductPrice(bizId, target.dataset.product, +target.value); break;
      case 'set-wage': setEmployeeWage(bizId, target.dataset.emp, +target.value); break;
      case 'rename-biz': renameBusiness(bizId, target.value); break;
      default: break;
    }
  });

  window.addEventListener('beforeunload', () => saveGame(true));
}

/* =============================================================
   10. INIT
   ============================================================= */

function init() {
  const loaded = loadGame();

  if (loaded) {
    const summary = applyOfflineEarnings();
    renderAll();
    setPaused(state.paused);
    setSpeed(state.speed);
    if (summary) openWelcomeBackModal(summary);
  } else {
    state = createDefaultState();
    renderAll();
    setPaused(true);
    setSpeed(1);
    openOnboardingModal();
  }

  wireEvents();
  startGameLoop();
}

document.addEventListener('DOMContentLoaded', init);
