# UPI Expense Tracker — Build Blueprint

**Scope of this document:** everything needed to build the current phase
(local-only, single-user, HDFC SMS + manual entry, split *tracked* not *settled*).
The schema is designed so future expansion — more banks, multi-user settle-up,
alternate entry triggers — doesn't require rewriting existing tables.

---

## 1. Schema (SQLite, forward-compatible with a future Postgres/Supabase backend)

Design rules carried over from our discussion:
- **UUIDs everywhere**, not auto-increment ints — avoids ID collisions when this
  eventually syncs across devices/users.
- **`updated_at` on every table** — unused for now, but means future sync doesn't
  require a schema migration to *add* the concept of "when did this change."
- **`people` and `expense_participants` exist now**, even though right now the app
  only ever writes one row to `people` (you) plus placeholder rows for split
  participants. This is the "costs nothing now, saves a rewrite later" tradeoff
  we agreed on.

```sql
-- A person you might split an expense with. Right now, only ever populated by
-- you typing a name — no auth, no linking to a real account yet.
CREATE TABLE people (
  id TEXT PRIMARY KEY,              -- UUID
  display_name TEXT NOT NULL,
  is_self INTEGER NOT NULL DEFAULT 0, -- exactly one row has this = 1 (you)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- User-picked categories. Seeded with your 5 defaults but fully editable.
-- No boolean "pinned" flag — instead two independent orderings coexist:
--   sort_order   = the base ranking, set manually in Category Management,
--                  and does NOT change automatically.
--   last_used_at = updated every time the category is picked in Add Expense.
--                  Frontend "top 5 quick-pick" chips = ORDER BY last_used_at DESC
--                  LIMIT 5. Category Management screen (the full list) still
--                  displays by sort_order, which stays stable regardless of usage.
CREATE TABLE categories (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,  -- manual rank, stable
  last_used_at TEXT,                      -- null until first used; drives quick-pick order
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The core expense record.
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,              -- UUID
  amount REAL NOT NULL,             -- YOUR share (if split, already divided)
  total_amount REAL NOT NULL,       -- full bill amount before split
  currency TEXT NOT NULL DEFAULT 'INR',
  category_id TEXT NOT NULL REFERENCES categories(id),
  label TEXT,                       -- free-text note, e.g. "Zomato - team lunch"
  merchant TEXT,                    -- extracted from SMS if available, else null
  source TEXT NOT NULL CHECK(source IN ('manual', 'sms')),
  bank_source TEXT,                 -- e.g. 'hdfc'; set by the parser packet when
                                     -- source = 'sms'. Null for manual entries.
                                     -- Adding a new bank later never touches this
                                     -- schema — only a new parser module + this value.
  raw_sms_text TEXT,                -- stored only if source = 'sms'; null for manual
  is_split INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,        -- date+time of the actual transaction
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Append-only activity log, independent of the expenses table so history
-- survives even after an expense is edited or deleted. Each row is a full
-- JSON snapshot of the expense at the moment of the action — this powers the
-- History tab (created / edited / deleted events, newest first).
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,              -- UUID
  action TEXT NOT NULL CHECK(action IN ('created', 'edited', 'deleted')),
  expense_id TEXT NOT NULL,         -- no FK constraint on purpose — must remain
                                     -- readable even after the expense row is gone
  expense_snapshot TEXT NOT NULL,   -- JSON blob of the expense fields at this moment
  occurred_at TEXT NOT NULL,        -- when the action happened
  created_at TEXT NOT NULL
);

-- Only populated when is_split = 1. One row per participant, including yourself,
-- so "who owes who" is just a query away later, not a data migration.
CREATE TABLE expense_participants (
  id TEXT PRIMARY KEY,              -- UUID
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  share_amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Default seed data on first launch:**
- `people`: one row, `is_self = 1`, name = whatever you set on first run.
- `categories`: Petty Snacks, Food, Transport, Groceries, Utilities — `sort_order`
  0–4, `last_used_at` null. Any new category you add gets appended to the end of
  `sort_order`; you can re-rank manually in Category Management at any time. The
  top-5 quick-pick chips are computed dynamically, so a freshly-added category
  can still show up there the moment you use it once.

**Deleting a split expense** (per your earlier answer): prompt with two options —
"Remove just my copy" (delete the `expenses` row + cascade `expense_participants`)
vs. conceptually "delete for everyone" — right now there's no one else to delete
it for (no multi-user yet), so this prompt is effectively inert today, but the
schema/UI pattern is ready to plug real logic into once multi-user exists.

---

## 2. Screens

| Screen | Purpose |
|---|---|
| **Home Dashboard** | Recent transactions list + pie chart (spend by category, current month). Entry point to everything else, incl. a persistent "+ Add Expense" button. |
| **Add Expense (slide flow)** | See §3 below — same flow for manual and SMS-triggered entry, differing only in pre-fill and the presence of an amount pre-set on slide 1. |
| **Category Management** | Reorder (`sort_order`) / add / rename categories. |
| **Transaction Detail** | Tap a transaction from Home or History → view/edit/delete. Delete triggers the split-aware confirmation if `is_split = 1`. |
| **History** | Reverse-chronological feed from `activity_log` — every create/edit/delete, each showing what changed. Independent of whether the underlying expense still exists. |

**Manual entry is a first-class path, not a fallback:** the same Add Expense
flow is used regardless of entry source — only `source` (`manual` vs `sms`) and
whether slide 1's amount arrives pre-filled differ.

---

## 3. Add Expense — slide flow

Rather than one long form, Add Expense is a sequence of slides, one prompt per
screen:

1. **Amount** — pre-filled if opened via SMS parse; empty and focused if manual.
2. **"What's the category?"** — top-5 quick-pick chips (by `last_used_at`) + a
   "more" option opening the full list (by `sort_order`). Picking one here
   updates that category's `last_used_at`.
3. **"How many people is this split between?"** — defaults to 1 (no split). If
   >1, lets you pick existing `people` or add new ones; computes `share_amount`
   per participant automatically (editable if the split isn't even).
4. **"Give it a label"** — optional free-text note. Skippable.
5. **Preview & confirm** — shows the full assembled expense (amount, category,
   split, label, raw SMS text if applicable) before writing. On confirm:
   writes to `expenses` (+ `expense_participants` if split) + `activity_log`
   inside a single transaction, then shows an explicit **success state**
   ("Saved ✓") before returning to Home — no silent writes, so you always know
   the save actually completed before you navigate away.

**Discard:** a simple **✕ in the top corner**, available on every slide,
regardless of entry source. Tapping it closes the flow immediately with no
confirmation dialog — nothing has been written to the DB until slide 5's
explicit confirm, so there's nothing destructive to warn about.

**Unified entry point:** both manual and SMS-triggered opens route to this exact
same slide flow, differing only in what's pre-filled. This goes through one
centralized hook so there's exactly one code path to test, not two:

```
useAddExpenseIntent()
 ├─ manual open → { source: 'manual', prefill: null }
 └─ deep link open → { source: 'sms', bankSource: 'hdfc', prefill: parseSms('hdfc', rawText), rawText }
```

Both cold-start and warm-start deep links funnel through Expo Router's linking
config into this same hook.

---

## 4. SMS parser structure

Goal: isolate all bank-specific regex logic behind one interface, so the app
today only implements HDFC, but adding a second bank later (or if HDFC changes
their format) never touches the rest of the app or the schema — see §1, where
`source` is the generic `'sms'` and `bank_source` carries the specific bank.

```
/parsers
  ├─ types.ts          → shared ParsedTransaction interface
  ├─ hdfc.ts            → HDFC-specific regex + parseHdfcSms()
  └─ index.ts           → parseSms(bankSource, rawText) dispatches by bank
                           identifier (only 'hdfc' registered for now)
```

```ts
// types.ts
export interface ParsedTransaction {
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null; // ISO string, null if unparseable
  raw: string;
  parseSucceeded: boolean;
}
```

**Fallback behavior (your chosen option A):** if `parseSucceeded` is false, Add
Expense still opens, with the raw SMS text shown at the top for reference and
every field left empty for manual fill-in. Nothing is silently lost.

**Getting real regex data:** you mentioned asking someone to re-send old HDFC
transaction texts — do that before we write `hdfc.ts`. We need actual sample
messages (debit, credit if relevant, and any variant formats HDFC uses — UPI vs
POS vs ATM wording often differs even within one bank) to build the regex
against real strings rather than guessed ones.

---

## 5. Build order (deep-link risk front-loaded)

Your original Day 1–4 plan pushed deep linking to the very end. Given it's the
riskiest, least-Expo-Go-friendly part, we front-load it right after basic setup:

1. **Project + EAS dev build setup.** `create-expo-app`, install SQLite/chart/svg
   libs, then immediately set up an EAS development build profile (needed since
   custom URL schemes don't work in plain Expo Go). Confirm the dev build installs
   and runs on both Simulator and your phone before writing any feature code.
2. **Deep link spike (throwaway-quality).** Register `mytracker://` scheme,
   wire Expo Router linking config, and get *any* payload from
   `xcrun simctl openurl` to reach a console.log in the app — both cold-start and
   warm-start. This is the step most likely to eat unexpected time; doing it
   second (not fourth) means you find out early.
3. **Schema + SQLite helpers.** Create tables above (incl. `activity_log`), seed
   categories/self-person, write insert/fetch/log-write functions.
4. **HDFC parser**, built against real sample SMS text (see §4), unit-testable
   independent of the UI.
5. **Add Expense slide flow**, built to accept both manual and SMS-prefilled
   intents from day one via the shared hook (§3), including the split step and
   the corner-✕ discard.
6. **Home Dashboard** — list + pie chart, wired to real SQLite data.
7. **Category Management screen.**
8. **History tab** — reads `activity_log`, independent of live `expenses` state.
9. **End-to-end test:** real HDFC SMS on your phone → Shortcut → deep link →
   parsed → Add Expense pre-filled → saved → visible on Home Dashboard + History.
10. **Configure the actual Apple Shortcut** last, once you trust the app side —
    trigger on incoming HDFC message, pass raw text (no in-Shortcut parsing),
    open the deep link.

---

## 6. Open item

We still need your real HDFC SMS samples before step 4 can start for real —
everything else (steps 1–3, 6–8) can proceed in parallel without them.
