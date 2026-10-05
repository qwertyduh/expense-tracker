# iOS Automation Setup (Apple Shortcuts)

iOS does not let an app read your SMS. The trigger lives outside the app:
a **Message automation** in Shortcuts runs an **App Intent** with the message text.

```
bank SMS arrives
   → Message automation fires (no confirmation tap)
   → Shortcut runs "Process Incoming SMS"  (background classifier, never opens app)
   → Swift isRejected()  → OTP/statement?        → return false (dies silently)
   → Swift isExpense()   → no debit + amount?    → return false (Shortcut If ends)
   → true → AppIntentDispatcher.dispatch("processSms", text)   (queued for JS)
              → If result is true:
                   Shortcut runs "Open Expense from SMS" (foreground, opens the app)
                   → JS useAppIntents drains the queue, runs parseAnySms(text)
                   → parseSucceeded? → setSmsIntent → navigate to /add pre-filled
```

Nothing is parsed inside the Shortcut. It is a dumb pipe; a new bank's message
format is a code change, not a new Shortcut.

There are **two intents**, and they split the decision the system can't make for
a single one. `openAppWhenRun` is a static property the OS reads before
`perform()` runs, so it can't depend on the message. The two-intent split moves
that decision into the Shortcut's `If`:

- **`Process Incoming SMS`** (`ProcessSMSIntent`) runs with
  `openAppWhenRun = false`. It applies the native `isRejected()` / `isExpense()`
  gate, returns a `Bool`, and — for an expense only — dispatches the raw text to
  JS. It never opens the app.
- **`Open Expense from SMS`** (`OpenExpenseSMSIntent`) runs with
  `openAppWhenRun = true`, has **no parameters**, and does no work: it only
  brings the app up. The Shortcut runs it only when the classifier returned
  `true`.

Dispatch lives in the classifier on purpose. The classifier's `Message Text` is
wired once (from the automation/SMS) and is the value the Shortcut already has;
the foreground intent would otherwise need that same variable bound a second
time, and an empty or miswired second binding silently yields no amount with no
error. The classifier writes the invocation to the dispatcher's queue even when
the app is not running, and the foreground intent opens the app so JS can drain
it.

So the Swift gate alone decides whether the app opens, and the JS
`parseSucceeded` check decides whether Add Expense opens *pre-filled* (and
navigates). If the two disagree — Swift says "expense" but `parseAnySms` finds no
anchored amount — the app still comes forward, but no `/add` sheet appears.
Non-expenses never reach the foreground intent at all, so they can never open the
app.

### Where the parsing actually happens

One parser handles every bank SMS: `parseAnySms()` in `src/parsers/sms.ts`.
The full path, in order:

| Step | Code | Result |
| --- | --- | --- |
| Classifier runs | `ProcessSMSIntent.perform()` (`app-intents/ProcessSMSIntent.swift`), background | `isRejected()` then `isExpense()`; for an expense, `AppIntentDispatcher.shared.dispatch(name: "processSms", params: ["text": .string(messageText)])`; returns the `Bool` |
| Open runs | `OpenExpenseSMSIntent.perform()` (same file), foreground, only when the classifier returned `true` | No parameters, no work — just brings the app up so JS can drain the queue |
| JS handler receives | `useAppIntentDispatcher()` (`src/hooks/useAppIntentDispatcher.ts`), via `useAppIntents` from `expo-app-intents` | Calls `parseAnySms(text)`; only sets the intent when `parseSucceeded` |
| Parse | `parseAnySms(rawText)` (`src/parsers/sms.ts`) | Fills `amount`, `merchant`, `occurredAt`, `bankSource`, `parseSucceeded` |
| Route | `AddExpenseIntentProvider` (`src/hooks/add-expense-intent-provider.tsx`) | On an SMS intent, `router.navigate('/add')` from wherever the app was |
| Save | `add.tsx` (`confirmAndSave`) | Writes `merchant`, `bank_source`, `raw_sms_text`, `occurred_at`, and `source: 'sms'` |

Three details worth knowing before you debug anything:

- **`bankSource` is a label, not a parser.** `detectBankHint()` in `sms.ts` scans
  the text for `HDFC`, `FamApp`/`FamPay`, or `GPay`/`Google Pay`/`Pay ₹` and
  returns `hdfc` / `fampapp` / `gpay` / `unknown`. That string is stored in the
  `bank_source` column. It does *not* select a different parser — see §6.
- **The SMS timestamp is extracted, not discarded.** `parseAnySms` calls
  `parseOccurredAt()`, which reads the literal `On …` date out of the message in
  one of two shapes: `On DD/MM/YY` (Indian banks, no time component, so the
  device's current time-of-day stands in) or `On YYYY-MM-DD[:HH:MM:SS]` (HDFC
  card messages, using the message's own time). Dates are validated; an impossible
  date (`31/02`) or one in the future is rejected and returns `null`. `add.tsx`
  then writes `occurredAt: smsIntent?.prefill.occurredAt ?? new Date().toISOString()`,
  so a message with no usable date still falls back to the save time. The date is
  built in the device's local time and stored as an ISO/UTC string, so an evening
  IST payment does not shift to the previous day. It is applied on save; the Add
  flow itself does not display it (History and the detail screen do).
- **Delivery is queued and at-least-once.** `expo-app-intents` records the
  invocation natively first, then notifies JS if it is alive. If the app was not
  running, the invocation waits and `useAppIntents` handles it on the next launch.
  The handler removes each invocation by id after handling it.

This covers **one person's phone**. An automation cannot be exported, AirDropped
or shared — everyone sets up their own by hand. Only the Shortcut itself (§1) is
reusable.

---

## Before you start

Requirements:

- **iOS 16.4 or later** (`expo-app-intents` minimum). Confirmation-free Message
  automations need **iOS 17 or later**.
- A **development or release build** installed on the device — App Intents are
  registered at install time and **do not work in Expo Go**.
- The app **opened at least once** after install, so iOS registers the
  `Process Incoming SMS` and `Open Expense from SMS` actions.

Confirm the app side works **before** touching Shortcuts, so that when something
breaks you know which half is at fault:

1. Build and run the app on device or simulator
   (`npx expo run:ios --device --configuration Release`) and open it once.
2. Build the `Log Expense` shortcut (§1), then run it manually with a test
   message (§1's test step).

If the Add Expense sheet opens with **Rs.49** and **HAIER APPLIANCES INDIA**
pre-filled, the app side is fine. (The parsed date isn't shown in the sheet; it
lands on the saved expense.)

---

## 1. Build the Shortcut

Shortcuts app → **+** → name it `Log Expense`.

**Three actions** (classify → `If` → open):

### 1a. Run App Intent — classify

Add **Run App Intent**. Search for **"Process Incoming SMS"** (the title from
`ProcessSMSIntent`).

Tap the **Message Text** field and pick **Shortcut Input** from the variable row
(it is offered because the shortcut accepts input — see the Share Sheet toggle
below). Do **not** add a **URL Encode** step on this path: the value is a typed
`String`, not a URL.

This action is the background classifier. It returns `true` for expenses,
`false` for everything else (credits, balances, OTPs, statements, promos), and
never opens the app.

### 1b. If — gate on the classifier

Add an **If** action. Set the condition to
`Process Incoming SMS` **is** `true` (tap the left field and pick the result of
the Run App Intent action; type `true` in the equal-to field). Everything in step
1c goes **inside** this `If`.

### 1c. Run App Intent — open (inside the If)

Add a second **Run App Intent**. Search for **"Open Expense from SMS"** (the
title from `OpenExpenseSMSIntent`).

It has **no parameters** — the classifier already sent the text to JS. This
action's only job is to bring the app up, so add it inside the `If` and leave it
unconfigured.

> `Shortcut Input` in a Message automation is the incoming message body.
> The App Intent receives it as a typed `String` — no URL encoding, no `%`/`+`/`&`
> bugs, no double-decoding issues.
>
> The split exists because `openAppWhenRun` is static: the app opens only when
> the `If` above lets `Open Expense from SMS` run. The text only has to be wired
> once, into the classifier; the foreground intent carries no input. Once it
> runs, the JS handler drains the queued dispatch and navigates to `/add` only
> when `parseAnySms` actually found an amount.

### Also turn on the Share Sheet

Tap the shortcut's **(i)** → enable **Show in Share Sheet** → set the accepted
input to **Text**.

This gives you the same shortcut as a manual fallback. When the automation is
being flaky — and per §3 it sometimes will be — you can long-press the bank SMS,
Share, pick `Log Expense`, and get the identical result in two taps. It is also
how you test without waiting for a real bank SMS.

**Test the Shortcut before building the automation**: run the shortcut, choose
"Provide Input" → paste a real bank SMS (e.g. `Spent Rs.49 From HDFC Bank Card x1234 At HAIER APPLIANCES INDIA On 2026-08-10:09:17:38. Get 5% cashback. Call +919876543210`). If the Add sheet opens pre-filled, §1 is done.

> **Legacy deep-link route.** The app still accepts
> `expensetracker://add?data=<URL-encoded raw text>` (handled by
> `src/hooks/useAddExpenseIntent.ts`). A Shortcut built that way needs a **URL
> Encode** step and reaches the parser through `Linking`, not the App Intent. Use
> the App Intent route above; the deep link survives only so older shortcuts keep
> working, and it is the path that logs `[deep-link] Ignored …` in dev builds.

---

## 2. Build the automation

Automations live in the Shortcuts app. On iOS 26 they sit inside the main
Shortcuts view rather than a separate Automation tab, so look for
**Automation** as a section there; on earlier versions it is its own tab.

**New Automation → Message**, then:

**Filters.** Use **Message Contains**, with `Rs.` as the value. HDFC's two known
shapes both carry it (`Sent Rs.…` for UPI, `Spent Rs.…` for card).

Prefer this over the **Sender** filter. Indian bank sender IDs arrive with an
operator prefix that varies by network — `HDFCBK`, but also `VM-HDFCBK`,
`AX-HDFCBK`, `AD-HDFCBK` — so an exact sender match silently stops working when
you change SIM or carrier. Multiple filters are ANDed, so you can add Sender as a
*narrowing* filter later once you have confirmed the exact ID your phone sees.

> The parser and the Swift gate both also accept the `₹` symbol, but a Messages
> automation filter is a plain substring match with no OR. `Message Contains: Rs.`
> will **not** fire for a message that writes only `₹`. If your bank does that, add
> a second automation filtered on `₹` (or on any marker unique to that bank) and
> point it at the same shortcut.

**Run Immediately.** Turn it **on**, and confirm the **Don't Ask** prompt. This
is what removes the confirmation tap, and it is the difference between an
automation and a nag.

**Action.** Add the same three actions directly to the automation:

1. **Add Action** → search **Process Incoming SMS** → tap **Message Text** →
   pick **Shortcut Input**. (Background classifier; never opens the app.)
2. **Add Action** → **If** → set the condition to `Process Incoming SMS`
   **is** `true`.
3. **Add Action** *inside* the `If` → search **Open Expense from SMS** (no
   parameters; just adds the action). (Foreground; opens the app.)

> In a Message automation the incoming message *is* the Shortcut Input, so the
> classifier receives the raw SMS with no plumbing. Inlining is the reliable
> wiring: the **Run Shortcut** action is known to drop the trigger variable
> before it reaches the called shortcut's input.
>
> If you would rather reuse `Log Expense` (one definition for the automation, the
> Share Sheet, and testing), use **Run Shortcut** → `Log Expense` and tap the
> classifier action to confirm its input is **Shortcut Input**. Verify the message
> actually arrives before trusting it; if it does not, inline the actions
> instead.
>
> Either way, the automation and §1's shortcut hold the same three actions —
> nothing is parsed outside the app.

**Save.** Send yourself a text containing `Rs.` — or temporarily change the
filter to something you can trigger on demand, test, then change it back. For an
expense, the `If` passes and `Open Expense from SMS` opens the app; the Add sheet
appears pre-filled once the JS parser runs. If the phone is locked, iOS may hold
the app until you unlock, in which case the dispatch is queued and surfaces the
next time you open the app (see §3). Credits, balances, OTPs, statements and
promos end at the background classifier and never open anything.

---

## 3. What to expect, honestly

Verified against Apple's own documentation:

- Message automations **can** run with no confirmation tap. Apple lists Message
  among the triggers that support it, since iOS 17.
- The pair is deliberately split. `Process Incoming SMS` is declared
  `openAppWhenRun = false`, which Apple documents as running the app in the
  background **without bringing its scenes up**. `Open Expense from SMS` is
  declared `openAppWhenRun = true`, and the Shortcut runs it only when the
  classifier returned `true`, so an expense pulls the app forward while a
  non-expense never does. `openAppWhenRun` is a static property the OS
  reads before `perform()` runs, so it cannot depend on the message — the
  Shortcut's `If` is what makes the decision. A Live Activity / Dynamic Island
  trigger remains the planned alternative for surfacing a capture without opening
  the app (the README lists it under "Not yet built").
- Delivery is at-least-once: the same invocation can reach the handler more than
  once (for example if the app dies before it is removed from the queue).
- Apple's own caveat: turning off "Ask Before Running" covers the *trigger*, and
  you "may also need to set individual actions to run automatically."

Reported by users, **not** confirmed by Apple — treat as things to test on your
device rather than facts:

- **A locked phone may prompt, or just queue the capture.** `Open Expense from
  SMS` asks iOS to run in the foreground, but a locked screen can require an
  unlock before the app is shown. If you consistently trigger expenses with the
  phone in your pocket, check this early.
- **"Run Immediately" can silently revert to "Ask Before Running" after an iOS
  update.** This is widely described as the single most common reason an
  automation stops working. If it worked for months and then stopped, look here
  first.
- Some iOS versions also expose a per-shortcut **Privacy → Allow Running When
  Locked** toggle. If yours has it, turn it on; without it a Message automation
  can be held until you unlock. If the toggle is absent, just test the locked
  case on your device.
- **Low Power Mode** can delay or pause automations, and iOS 26 is reported to be
  more aggressive about pausing low-priority ones on constrained battery.
- Whether the trigger fires for **RCS** messages, and how it behaves on
  **dual-SIM**, is undocumented. Unverified.

The important structural point: **iOS never tells you an automation failed to
run.** There is no error, no notification, nothing in a log. A silent
non-trigger is indistinguishable from "no SMS arrived." That is why §1's Share
Sheet fallback matters — it is your recovery path when the automation is not
there.

---

## 4. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| App never opens for an expense SMS | Automation not firing, the Shortcut's `If` not passing, or Swift `isRejected()` / `isExpense()` returned false | Re-check **Run Immediately** (§3); confirm both `Process Incoming SMS` and `Open Expense from SMS` appear in Shortcuts' App Intent list and the `If` wraps the second one; rebuild after intent changes; confirm the message has a debit verb (`Sent`/`Spent`/`Paid`/`debited`…) and an `Rs`/`INR`/`₹` amount |
| App opens but Add Expense never appears, or opens blank | The foreground intent ran, but JS `parseAnySms` found no anchored amount, so `parseSucceeded === false` and nothing navigates | Add/widen a debit+amount regex in `DEBIT_AMOUNT_PATTERNS` (`src/parsers/sms.ts`, §6), then rebuild. The app opening without a sheet is silent by design |
| Automation runs, but the parser receives an empty or wrong message | `Run Shortcut` dropped the trigger variable before it reached the called shortcut's input | Inline both App Intent actions in the automation, or set the `Run Shortcut` action's input to **Shortcut Input** (§2) |
| A payment only captures when I later open the app | The phone was locked or iOS held the foreground request, so the dispatch queued | See §3; unlock, or enable **Privacy → Allow Running When Locked** if your iOS version exposes it |
| Nothing fires while the phone is locked | Automation held for unlock | Turn on **Run Immediately**; enable **Privacy → Allow Running When Locked** if your iOS version exposes it (§3) |
| Add Expense opens but merchant is blank | `MERCHANT_PATTERNS` didn't match this SMS shape | Add/widen a merchant regex in `src/parsers/sms.ts` (§6) |
| Saved date is "now" instead of the transaction date | `OCCURRED_AT_PATTERNS` didn't match, or the date was rejected as impossible/future, so `add.tsx` fell back to the save time | Add a date pattern in `src/parsers/sms.ts` (§6) |
| Add Expense opens for a promo/credit/balance SMS | Swift `isExpense()` found a debit verb + amount in it | The gate is default-deny; a false open means the text has both. Tighten the verb set or add a `REJECT_PATTERNS` entry in `src/parsers/sms.ts` and mirror it in `ProcessSMSIntent.isRejected()` |
| Worked, then stopped after an iOS update | Run Immediately reverted | Re-enable it in the automation |
| Nothing at all, ever | Filter never matches (e.g. the bank writes only `₹`) | Loosen to `Message Contains` → `Rs.`; add a second automation for `₹`; remember filters are ANDed |
| Add sheet opens for SMS you did not want | Filter is too broad | Narrow with a Sender filter, or add a second condition |
| Shortcut shows "App Intent not available" | App not installed, or intent not registered | Reinstall app; confirm `ProcessSMSIntent.swift` compiles into the app target's inline `app-intents/` module |

When debugging the Shortcut itself, temporarily add **Show Result** just after
the **Process Incoming SMS** action and run it — you will see the `true`/`false`
result, which tells you immediately whether the Swift classification worked.
Remove it when done.

The deep-link fallback (`expensetracker://add?…`) logs why it ignored a URL in
development builds (`[deep-link] Ignored …`). The App Intent path has no
equivalent log and fails silently by design, so use **Show Result** on the intent
action instead.

---

## 5. Privacy note

The full text of every matching bank SMS is passed to the App Intent as a
parameter. It stays on-device — there is no backend — but the message body does
leave Messages' sandbox and lands in the Shortcut's run history. If that trade is
not one you want, use the Share Sheet fallback only and skip §2.

Treat the SMS as untrusted input: it is a pre-fill convenience, not an
authoritative record. The Add Expense flow always shows you the parsed result
and the raw text before anything is written to the database.

---

## 6. Adding a new bank format

**One parser, all banks.** There is no per-bank parser and you should not add
one. `parseAnySms()` in `src/parsers/sms.ts` is the single entry point for SMS
from every bank, and it works by trying an ordered list of regexes.

> This replaced per-bank parser files (`hdfc.ts`, `fampapp.ts`) that used to be
> dispatched on `bankSource`. They were redundant — they matched the same shapes
> with the same patterns — and have been deleted, along with the `parseSms()`
> dispatcher in `src/parsers/index.ts`. `parseGpay()` remains exported for the
> Android Accessibility Service's dump of the GPay "Enter your PIN" screen; it is
> a screen-text parser, not an SMS parser, so it is deliberately *not* on this
> path. `parseAnySms`'s patterns happen to cover GPay screen text too, so an
> Android deep link still pre-fills correctly.

To add a new format:

1. Add debit/merchant regex patterns to `DEBIT_AMOUNT_PATTERNS` /
   `MERCHANT_PATTERNS` in `src/parsers/sms.ts`. **Order matters** — the first
   regex that matches wins. Every amount pattern must carry a debit verb
   alongside the figure (there are no naked `Rs.`/`₹` fallbacks — the gate is
   default-deny, so a bare amount is not an expense). The list runs
   amount→verb, then verb→amount, then the GPay "Pay ₹…" screen line.
2. If the message carries a date in a shape not already handled, add an entry to
   `OCCURRED_AT_PATTERNS`. The two existing shapes are `On DD/MM/YY` and
   `On YYYY-MM-DD[:HH:MM:SS]`; a message with no recognisable `On` date gets
   `occurredAt: null`, and `add.tsx` falls back to the save time.
3. Add a keyword to `detectBankHint()` if you want the row labelled with that
   bank in `bank_source` (`hdfc` / `fampapp` / `gpay` / `unknown`). This is
   cosmetic only; it changes no parsing.
4. **Keep the Swift gate in sync.** `ProcessSMSIntent.isExpense()` mirrors the
   three `DEBIT_AMOUNT_PATTERNS` as anchored, case-insensitive regexes, and
   `isRejected()` mirrors `REJECT_PATTERNS`. If you add or change a shape, update
   both sides — otherwise the classifier returns `false`, the Shortcut's `If`
   fails, and the message never reaches the JS parser (or, worse, Swift says
   `true` while `parseAnySms` finds nothing, so the app opens with no Add sheet).
   Both sides match case-insensitively; keep that consistent. Clearing the Swift
   gate is still not enough: the JS handler also requires `parseSucceeded`.
5. Check the Shortcut filter still matches. The automation in §2 filters on
   `Message Contains: Rs.`, so a bank that never writes `Rs.` (or only `₹`) will
   not reach the parser at all until that filter — or a second automation — is
   widened.

No Shortcut changes are needed for a new bank that uses standard `Rs.` wording —
the same automation covers it. A bank that writes `₹` without `Rs.` needs its own
automation trigger (§2).
