# Ledger & Co. — Business Tycoon Simulator

A fully client-side business simulation game. No build step, no backend —
just three files.

## Files
- `index.html` — page structure (dashboard shell, tabs, modals)
- `style.css` — all styling (design tokens live at the top as CSS variables)
- `script.js` — the entire game engine, organized into 10 numbered sections
  (CONFIG, UTILITIES, STATE, PERSISTENCE, ECONOMY ENGINE, GAME LOOP, ACTIONS,
  RENDER, EVENTS, INIT). Every economic formula is commented where it's used.

## Running it
Just open `index.html` in a browser — or for GitHub Pages, push all three
files to a repo's root (or `/docs` folder) and enable Pages on that branch.
No server, no dependencies to install.

## Tweaking difficulty
Almost every number that matters lives in the `CONFIG` section at the top of
`script.js`:
- `BUSINESS_TYPES` — startup cost, rent, base demand, capacity, elasticity,
  marketing sensitivity, wages, etc., per business type. Restaurant,
  Online Store, Dropshipping, Manufacturing, and Freelance Agency each also
  carry a `productCatalog` (see below).
- `INCOME_TAX_BRACKETS` / `PROPERTY_TAX_ANNUAL_RATE` — taxation.
- `LOAN_PRODUCTS` / `LOAN_MAX_MULTIPLE_OF_CASH` / `LOAN_MISSED_PENALTY` — bank.
- `MARKETING_TIERS` — campaign cost/duration/strength.
- `SLOT_COSTS` — price of each additional business slot.
- `BASE_DAY_MS` — how many real ms one in-game day takes at 1x speed.

## Product lineups
Restaurant, Online Store, Dropshipping, Manufacturing, and Freelance Agency
each have a hand-picked `productCatalog` (menu items / SKUs / product lines /
service packages). In the Operations tab's **Products** panel you can:
- **Add** a catalog item to your lineup for a one-time cost, up to your
  current product-slot limit (`baseProductSlots` + capacity level).
- **Pause / resume** anything you've already added, for free.
- Set **each product's own price** — every active product competes for the
  same daily demand pool, weighted by its price vs. the market average and
  its innate popularity (`demandShare`).
- Click **Analytics** on any product you've added to see a trend chart plus
  lifetime revenue/units/margin — scoped to just that product.

## Save data
The game autosaves to `localStorage` every in-game week, on tab close, and on
demand via "Save game" in the sidebar. Offline time is simulated (at reduced
efficiency, using each business's last known daily average) and summarized in
a "Welcome back" modal on your next visit.
