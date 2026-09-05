# UPI Expense Tracker

A personal, local-first mobile expense tracker built with React Native +
Expo. Its core feature is capturing UPI payment SMS automatically — despite
iOS blocking apps from reading SMS directly — by routing the message through
an Apple Shortcuts automation and a custom deep link.

Currently iOS-only, single-user, fully local (no backend, no account, no
internet dependency once installed).

---

## How it works, in one paragraph

A UPI/card debit SMS arrives from your bank → an Apple Shortcuts automation
captures the raw text (no parsing done in the Shortcut) → it opens
`expensetracker://add?bank=hdfc&data=<url-encoded raw text>` → the app
launches or foregrounds, parses the message with a bank-specific regex
parser, and opens the Add Expense flow pre-filled with the amount/merchant/
date. You can also add expenses manually via the same flow, with nothing
pre-filled.

---

## Features

- Manual + SMS-triggered expense entry through one unified 5-slide flow
  (Amount → Category → Split → Label → Confirm)
- Category tracking: a stable manual ranking (`sort_order`) plus a dynamic
  "recently used" quick-pick (`last_used_at`)
- Expense splitting — tracks _your share_ only; full settlement between
  people is a planned future feature, not built yet
- Fully local SQLite storage — nothing leaves your device
- Activity log of every create/edit/delete action, independent of whether
  the original expense still exists
- Home Dashboard: recent transactions + a toggleable pie chart
  (_in progress_)

## Not yet built

- Category Management screen
- Transactions tab (full list)
- History tab (UI for the activity log)
- Transaction Detail (view/edit/delete)
- The actual on-device Apple Shortcut configuration
- Android support (see [Android Track](#android-track) below)

## Planned, future versions

1. **Next:** Dynamic Island / Live Activity as an alternate entry trigger
   (requires native Swift, a real complexity jump beyond Expo's managed
   workflow)
2. **After that:** Supabase-backed multi-user sync, real "who owes who"
   settlement, budget alerts, weekly digest, yearly recap

---

## Tech stack

| Tool                                          | Purpose                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Expo (managed workflow) + React Native        | Core app framework                                                                            |
| Expo Router                                   | File-based navigation, also handles incoming deep links                                       |
| `expo-sqlite`                                 | Local database                                                                                |
| `expo-crypto`                                 | UUID generation for primary keys                                                              |
| `react-native-chart-kit` + `react-native-svg` | Pie chart                                                                                     |
| TypeScript                                    | Throughout                                                                                    |
| Xcode (local builds)                          | iOS compiling/signing — no paid Apple Developer account required for personal device installs |

---

## Project structure

```
app/
├── _layout.tsx          → root Stack (wraps tabs + add.tsx as a modal)
├── (tabs)/
│   ├── _layout.tsx        → tab bar (NativeTabs)
│   ├── index.tsx           → Home Dashboard
│   └── explore.tsx         → unused template screen
└── add.tsx               → Add Expense slide flow

db/
├── schema.ts              → CREATE TABLE statements + initDatabase()
├── seed.ts                 → default categories + self person
├── categories.ts            → quick-pick + full-list queries
├── people.ts                 → self lookup, find-or-create for splits
└── expenses.ts                 → insertExpense() (transactional), queries

parsers/
├── types.ts                → ParsedTransaction interface
├── hdfc.ts                  → HDFC UPI + Card SMS regex parsing
└── index.ts                  → parseSms(bank, text) dispatcher
```

Full architecture, schema, and decision rationale:
see `docs/expense-tracker-project-documentation.md`.

---

## Getting started

```bash
git clone <repo-url>
cd expense-tracker
npm install
npx expo install expo-sqlite expo-crypto expo-linking react-native-chart-kit react-native-svg
npx expo prebuild --platform ios
npx expo run:ios --device --configuration Release
```

Requires a free Apple ID signed into Xcode (Xcode → Settings → Accounts →
add Apple ID) to create a Personal Team for local device signing —
no paid Apple Developer Program needed.

## Day-to-day development

```bash
npx expo run:ios --device --configuration Release
```

This installs a release version of the app to your device

## Producing a standalone (no-server-needed) build

you would need to run the day to day deployment after getting a new signing key from Xcode every 7 days (thanks apple)

## Database schema changes

`db/schema.ts` currently uses `CREATE TABLE IF NOT EXISTS`, which is safe for
adding new tables but does **not** apply changes to existing tables (e.g.
adding a column). Any schema change beyond a new table needs a proper
migration step (tracked via SQLite's `PRAGMA user_version`) before shipping,
to avoid silently skipping the change on devices that already have data.

---

## Android Track

Android doesn't have iOS's SMS-reading restriction, so the Shortcuts
workaround isn't needed there — a native SMS listener can trigger the exact
same internal deep link (`expensetracker://add?bank=hdfc&data=...`) that
iOS's Shortcut builds, reusing the entire parsing/routing/DB pipeline
unchanged. See `android-track-tasks.md` for the full task breakdown.

**Contribution convention:** Android-specific work stays isolated to a new
`android-sms/` module; `parsers/`, `db/`, and `app/add.tsx` are shared and
should only change with both platforms' agreement, since a change there
affects both.

---
