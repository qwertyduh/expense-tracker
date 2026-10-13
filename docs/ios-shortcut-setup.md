# iOS Automation Setup (Apple Shortcuts)

iOS does not let an app read your SMS. The trigger lives outside the app:
a **Message automation** in Shortcuts runs an **App Intent** with the message text.

```
bank SMS arrives
   → Message automation fires (no confirmation tap)
   → Shortcut runs "Process Incoming SMS"  (background classifier, never opens app)
   → Swift isRejected()  → OTP/statement?   → return false (dies silently)
   → Swift isExpense()   → debit + amount?  → stash text natively            → return true
   → Swift isCredit()    → credit + amount? → dispatch("processSmsIncoming") → return false

EXPENSE (classifier returned true)
   → Shortcut's If passes → runs "Show Expense Capture" (background; app stays closed)
   → LiveActivityIntent starts a Dynamic Island / Lock Screen capsule (amount · vendor · category)
   → Edit   → deep link opens /add pre-filled (JS parses, reviews)
   → Save   → dispatch("processSmsSave") → JS writes the expense, no app open
   → ignore → capture stays pending; auto-logged on the next app foreground

CREDIT (classifier returned false; app NOT opened)
   → Shortcut's If fails, nothing else runs; invocation waits in the native queue
   → next app launch: JS drains it, runs parseIncomingSms(text)
   → insertIncomingReceipt + setReceiveIntent → navigate to /receive to review
```

Nothing is parsed inside the Shortcut. It is a dumb pipe; a new bank's message
format is a code change, not a new Shortcut.

There are **two intents**, and they split the decision the system can't make for
a single one. `openAppWhenRun` is a static property the OS reads before
`perform()` runs, so it can't depend on the message. The two-intent split moves
that decision into the Shortcut's `If`:

- **`Process Incoming SMS`** (`ProcessSMSIntent`) runs with
  `openAppWhenRun = false`. It applies the native `isRejected()` → `isExpense()`
  → `isCredit()` gate and returns a `Bool`. For an expense it only stashes the raw
  text natively (no JS dispatch — the capsule is the surface now). For a credit it
  dispatches `processSmsIncoming`. It never opens the app.
- **`Show Expense Capture`** (`ShowExpenseCaptureIntent`) is a
  `LiveActivityIntent` (iOS 17.2+), runs with `openAppWhenRun = false`, and does
  no app work: it starts the Dynamic Island / Lock Screen Live Activity. The
  Shortcut runs it only when the classifier returned `true`. The capsule carries
  two actions: **Edit** (deep link into `/add`) and **Save** (`SaveExpenseCaptureIntent`).

Dispatch lives in the classifier on purpose. The classifier's `Message Text` is
wired once (from the automation/SMS) and is the value the Shortcut already has.
The Live Activity intent does **not** need that variable bound a second time: the
classifier stashes the expense text in the app's shared `UserDefaults`, and the
intent reads it back. (An empty or miswired second binding would otherwise
silently yield no amount with no error.) The classifier writes the invocation to
the dispatcher's queue even when the app is not running, and the Live Activity
intent starts the capsule the user can tap to open the app.

So the Swift gate alone decides whether a capsule appears, and the JS
`parseSucceeded` check decides whether tapping through opens Add Expense
*pre-filled* (and navigates). If the two disagree — Swift says "expense" but
`parseAnySms` finds no anchored amount — the app still opens, but no `/add` sheet
appears. Non-expenses never reach the Live Activity intent at all, so they can
never produce a capsule. A credit is a non-expense: Swift dispatches
`processSmsIncoming` and returns `false`, so no capsule appears, and the
invocation waits in the native queue for review on the next launch (see §3).

### Where the parsing actually happens

Two parsers share `src/parsers/sms.ts`: `parseAnySms()` for debits (expenses)
and `parseIncomingSms()` for credits (repayments). They are deliberately
separate, so a debit can never be read as money-in or vice versa. The full
expense path, in order:

| Step | Code | Result |
| --- | --- | --- |
| Classifier runs | `ProcessSMSIntent.perform()` (`app-intents/ProcessSMSIntent.swift`), background | `isRejected()` then `isExpense()`; for an expense, stashes the raw text for the Live Activity intent (no JS dispatch); returns the `Bool` |
| Capsule runs | `ShowExpenseCaptureIntent.perform()` (`app-intents/ShowExpenseCaptureIntent.swift`), background `LiveActivityIntent`, only when the classifier returned `true` | Starts the Dynamic Island / Lock Screen capsule (`amount` + `vendor` from `SmsDisplayParser`, category from the mirrored map) and records a **pending capture**; no app open |
| Edit tapped | capsule `Link` → `expensetracker://add?data=…` → `useAddExpenseIntent` (`src/hooks/useAddExpenseIntent.ts`) | Parses, drops the pending capture, sets the SMS intent; `AddExpenseIntentProvider` routes to `/add` pre-filled |
| Save tapped | `SaveExpenseCaptureIntent.perform()` (`app-intents/SaveExpenseCaptureIntent.swift`), background `LiveActivityIntent` | Ends the capsule, drops the pending capture, `dispatch("processSmsSave")` |
| Save handled | `autoSaveCapture()` (`src/lib/pending-captures.ts`) via `useAppIntentDispatcher()` | Parses, resolves category (remembered → else "Unsorted"), `insertExpense`; no navigation |
| Ignored/dismissed | `flushPendingCaptures()` (`src/lib/pending-captures.ts`) from `_layout.tsx` on foreground | Auto-logs every still-pending capture (iOS gives no swipe-away callback), then dismisses capsules |
| Parse | `parseAnySms(rawText)` (`src/parsers/sms.ts`) | Fills `amount`, `merchant`, `occurredAt`, `bankSource`, `parseSucceeded` |
| Route | `AddExpenseIntentProvider` (`src/hooks/add-expense-intent-provider.tsx`) | On an SMS intent, `router.navigate('/add')` from wherever the app was |
| Save (reviewed) | `add.tsx` (`confirmAndSave`) | Writes `merchant`, `bank_source`, `raw_sms_text`, `occurred_at`, and `source: 'sms'`; dismisses the capsule |

The credit path diverges only in the classifier and the JS handler; the receipt
is always reviewed, never auto-filed:

| Step | Code | Result |
| --- | --- | --- |
| Classifier runs | `ProcessSMSIntent.perform()` | `isRejected()` then `isExpense()`; if neither, `isCredit()` — for a credit, `dispatch(name: "processSmsIncoming", …)`; returns `false` so the app is not opened |
| JS handler receives | `useAppIntentDispatcher()` | Calls `parseIncomingSms(text)`, caches the raw text via `insertIncomingReceipt`, then `setReceiveIntent({ source: 'sms', … })` |
| Parse | `parseIncomingSms(rawText)` (`src/parsers/sms.ts`) | Fills `amount`, `senderName`, `upiId`, `occurredAt`, `bankSource`, `parseSucceeded` |
| Route | `AddExpenseIntentProvider` | On a receive intent, `router.navigate('/receive')` once a scene is active |
| Review & save | `receive.tsx` | Resolves the person (remembered handle — UPI id or name spelling — → parsed name), then `insertSettlement` + `rememberSender` (learns the UPI id and name spelling) |

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
  automations need **iOS 17 or later**, and the Live Activity capsule needs
  **iOS 17.2 or later** (`LiveActivityIntent`).
- A **development or release build** installed on the device — App Intents are
  registered at install time and **do not work in Expo Go**.
- The app **opened at least once** after install, so iOS registers the
  `Process Incoming SMS` and `Show Expense Capture` actions.

Confirm the app side works **before** touching Shortcuts, so that when something
breaks you know which half is at fault:

1. Build and run the app on device or simulator
   (`npx expo run:ios --device --configuration Release`) and open it once.
2. Build the `Log Expense` shortcut (§1), then run it manually with a test
   message (§1's test step).

A Dynamic Island / Lock Screen capsule should appear with the amount and vendor
(e.g. **₹49** · **HAIER APPLIANCES INDIA**); tapping **Edit** opens the Add sheet
pre-filled. (The parsed date isn't shown in the sheet; it lands on the saved
expense.)

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

This action is the background classifier. It returns `true` for expenses and
`false` for everything else, and never opens the app. An expense stashes its text
for the Live Activity intent that runs next (step 1c); a credit queues a
`processSmsIncoming` invocation for review (app stays closed); balances, OTPs,
statements and promos do nothing at all.

### 1b. If — gate on the classifier

Add an **If** action. Set the condition to
`Process Incoming SMS` **is** `true` (tap the left field and pick the result of
the Run App Intent action; type `true` in the equal-to field). Everything in step
1c goes **inside** this `If`.

### 1c. Run App Intent — Live Activity (inside the If)

Add a second **Run App Intent**. Search for **"Show Expense Capture"** (the
title from `ShowExpenseCaptureIntent`).

Leave its **Message Text** field **empty** — the classifier already stashed the
text natively. This action's job is to start the Dynamic Island / Lock Screen
capsule, during which the app stays closed.

> `Shortcut Input` in a Message automation is the incoming message body.
> The App Intent receives it as a typed `String` — no URL encoding, no `%`/`+`/`&`
> bugs, no double-decoding issues.
>
> The split exists because `openAppWhenRun` is static: the capsule appears only
> when the `If` above lets `Show Expense Capture` run. The text only has to be
> wired once, into the classifier; the Live Activity intent reads the stashed
> text instead of a second binding. Tapping the capsule's **Edit** link opens the
> app and routes to `/add`; tapping **Save** logs the expense without opening the
> app; ignoring it auto-logs on the next foreground.
>
> `Show Expense Capture` is a `LiveActivityIntent`, which is why it may start a
> Live Activity while the app is backgrounded. It requires **iOS 17.2 or later**.

### Also turn on the Share Sheet

Tap the shortcut's **(i)** → enable **Show in Share Sheet** → set the accepted
input to **Text**.

This gives you the same shortcut as a manual fallback. When the automation is
being flaky — and per §3 it sometimes will be — you can long-press the bank SMS,
Share, pick `Log Expense`, and get the identical result in two taps. It is also
how you test without waiting for a real bank SMS.

**Test the Shortcut before building the automation**: run the shortcut, choose
"Provide Input" → paste a real bank SMS (e.g. `Spent Rs.49 From HDFC Bank Card x1234 At HAIER APPLIANCES INDIA On 2026-08-10:09:17:38. Get 5% cashback. Call +919876543210`). A capsule should appear; tapping **Edit** should open the Add sheet pre-filled.

> **The `expensetracker://add?data=…` deep link is the capsule's own Edit route.**
> `ShowExpenseCaptureIntent` builds it from the raw SMS and the widget's Edit link
> opens it; `src/hooks/useAddExpenseIntent.ts` handles it. You do **not** wire this
> by hand in the Shortcut — the App Intent path above is what you build. The same
> handler also accepts a hand-built shortcut with a **URL Encode** step (an older
> route that still works), and it is the path that logs `[deep-link] Ignored …` in
> dev builds when a link carries no `data`.

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
3. **Add Action** *inside* the `If` → search **Show Expense Capture** (leave
   its Message Text empty; just adds the action). (Background Live Activity; the
   app stays closed until you tap the capsule.)

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
expense, the `If` passes and `Show Expense Capture` starts a Dynamic Island /
Lock Screen capsule; the app stays closed. Tap the capsule to **Edit** (Add sheet
pre-filled) or **Save** (logged with no app open); leave it alone and it is
auto-logged on the next foreground. If the phone is locked, no capsule is started
and the capture is auto-logged the same way (see §3). Credits, balances, OTPs,
statements and promos never produce a capsule. A credit is queued by the
classifier as a `processSmsIncoming` dispatch and surfaces on the next launch as a
`/receive` review (see §3).

---

## 3. What to expect, honestly

Verified against Apple's own documentation:

- Message automations **can** run with no confirmation tap. Apple lists Message
  among the triggers that support it, since iOS 17.
- The pair is deliberately split. `Process Incoming SMS` is declared
  `openAppWhenRun = false`, which Apple documents as running the app in the
  background **without bringing its scenes up**. `Show Expense Capture` is a
  `LiveActivityIntent`, which Apple documents as the one kind of App Intent that
  may start a Live Activity while the app is not in the foreground; the Shortcut
  runs it only when the classifier returned `true`, so an expense produces a
  capsule while a non-expense never does. `openAppWhenRun` is a static property
  the OS reads before `perform()` runs, so it cannot depend on the message — the
  Shortcut's `If` is what makes the decision.
- Delivery is at-least-once: the same invocation can reach the handler more than
  once (for example if the app dies before it is removed from the queue).
- A credit never opens the app. The classifier queues a `processSmsIncoming`
  invocation and returns `false`, so the repayment surfaces only when you next
  open the app (or bring it to the foreground) and `useAppIntentDispatcher`
  drains the queue into `/receive`. A credit that arrives while you are already
  using the app surfaces immediately; one that arrives while it is closed waits.
- Apple's own caveat: turning off "Ask Before Running" covers the *trigger*, and
  you "may also need to set individual actions to run automatically."

Reported by users, **not** confirmed by Apple — treat as things to test on your
device rather than facts:

- **A locked phone may not show the capsule; the capture is auto-logged instead.**
  `Show Expense Capture` runs in the background, but when the screen is locked (or
  Live Activities are disabled) it skips the capsule and records the capture, which
  the app auto-logs on the next foreground. A locked screen can also still hold a
  Message automation until you unlock. If you consistently trigger expenses with
  the phone in your pocket, check this early.
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
| No capsule appears for an expense SMS | Automation not firing, the Shortcut's `If` not passing, or Swift `isRejected()` / `isExpense()` returned false | Re-check **Run Immediately** (§3); confirm both `Process Incoming SMS` and `Show Expense Capture` appear in Shortcuts' App Intent list and the `If` wraps the second one; rebuild after intent changes; confirm the message has a debit verb (`Sent`/`Spent`/`Paid`/`debited`…) and an `Rs`/`INR`/`₹` amount |
| Capsule appears but tapping opens the app with no Add sheet | The tap foregrounded the app, but JS `parseAnySms` found no anchored amount, so `parseSucceeded === false` and nothing navigates | Add/widen a debit+amount regex in `DEBIT_AMOUNT_PATTERNS` (`src/parsers/sms.ts`, §6), then rebuild. The app opening without a sheet is silent by design |
| Automation runs, but the parser receives an empty or wrong message | `Run Shortcut` dropped the trigger variable before it reached the called shortcut's input | Inline both App Intent actions in the automation, or set the `Run Shortcut` action's input to **Shortcut Input** (§2) |
| A payment only logs when I later open the app | The phone was locked (or Live Activities disabled), so no capsule started; the capture was recorded and auto-logged on the next foreground | See §3; unlock, or enable **Privacy → Allow Running When Locked** if your iOS version exposes it |
| Nothing fires while the phone is locked | Automation held for unlock | Turn on **Run Immediately**; enable **Privacy → Allow Running When Locked** if your iOS version exposes it (§3) |
| Add Expense opens but merchant is blank | `MERCHANT_PATTERNS` didn't match this SMS shape | Add/widen a merchant regex in `src/parsers/sms.ts` (§6) |
| Saved date is "now" instead of the transaction date | `OCCURRED_AT_PATTERNS` didn't match, or the date was rejected as impossible/future, so `add.tsx` fell back to the save time | Add a date pattern in `src/parsers/sms.ts` (§6) |
| Add Expense opens for a promo/credit/balance SMS | Swift `isExpense()` found a debit verb + amount in it | The gate is default-deny; a false open means the text has both. Tighten the verb set or add a `REJECT_PATTERNS` entry in `src/parsers/sms.ts` and mirror it in `ProcessSMSIntent.isRejected()` |
| A credit/repayment never appears in `/receive` | Swift `isCredit()` didn't match, so no `processSmsIncoming` was queued — and a credit never opens the app, so there is nothing to see immediately | Add/widen a credit+amount regex in `CREDIT_AMOUNT_PATTERNS` (`src/parsers/sms.ts`) **and mirror it in `ProcessSMSIntent.isCredit()`** (§6); use **Show Result** on the classifier — a credit returns `false` *and* dispatches |
| Repayment review opens with a blank sender | The SMS carries no parsable name or UPI id, or it names the account holder | Name falls back to a remembered handle (the UPI id or a name spelling already learned for a person), then the parsed `senderName`; `"your A/c"` is deliberately suppressed (`parseIncomingSms`, `src/parsers/sms.ts`). Name the sender once in the review and both the UPI id and that spelling are remembered for next time |
| Repayment review opens with an oddly-spaced/wrong sender name | `SENDER_NAME_PATTERNS` didn't catch this bank's wording | Sender extraction trims and collapses whitespace; widen the patterns in `src/parsers/sms.ts` if a shape is missed |
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
leave Messages' sandbox and lands in the Shortcut's run history. It is also
carried in the Live Activity's state (for the capsule's Edit deep link), so it is
stored by the system while the capsule is alive. If that trade is not one you
want, use the Share Sheet fallback only and skip §2.

Treat the SMS as untrusted input: it is a pre-fill convenience, not an
authoritative record. The Add Expense flow always shows you the parsed result
and the raw text before anything is written to the database.

---

## 6. Adding a new bank format

**One parser per direction, all banks.** There is no per-bank parser and you
should not add one. `parseAnySms()` (debits/expenses) and `parseIncomingSms()`
(credits/repayments) in `src/parsers/sms.ts` are the two entry points, each
working by trying an ordered list of regexes. They are intentionally separate so
a debit can never be read as money-in.

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
   three `DEBIT_AMOUNT_PATTERNS` as anchored, case-insensitive regexes,
   `isCredit()` mirrors `CREDIT_AMOUNT_PATTERNS`, and `isRejected()` mirrors
   `REJECT_PATTERNS`. If you add or change a shape, update both sides — otherwise
   the classifier returns `false`, the Shortcut's `If` fails, and the message
   never reaches the JS parser (or, worse, Swift says `true` while `parseAnySms`
   finds nothing, so the capsule appears but tapping opens the app with no Add
   sheet). A credit missed here fails more quietly still: no invocation is
   queued, so nothing ever shows up in `/receive`. Both sides match
   case-insensitively; keep that consistent.
   The **display** amount/vendor shown in the capsule mirror
   `DEBIT_AMOUNT_PATTERNS` / `MERCHANT_PATTERNS` in
   `app-intents/SmsDisplayParser.swift`. That copy is cosmetic only — if it
   drifts, the capsule shows a blank or stale value, never a wrong save. Clearing
   the Swift gate is still not enough: the JS handler also requires
   `parseSucceeded` for an expense, and caches the receipt for review on the
   credit path.
5. Check the Shortcut filter still matches. The automation in §2 filters on
   `Message Contains: Rs.`, so a bank that never writes `Rs.` (or only `₹`) will
   not reach the parser at all until that filter — or a second automation — is
   widened.

### Adding a money-in (credit) format

Credits use the same workflow but a separate pair of pattern lists, because the
gate must stay default-deny in both directions:

1. Add a credit+amount regex to `CREDIT_AMOUNT_PATTERNS` in
   `src/parsers/sms.ts`. Like the debit side, every amount pattern must carry a
   credit verb (`credited`/`received`/`deposited`/`refunded`/`added`) alongside
   the figure — a bare `Rs.` figure or a balance is never money-in.
2. Sender attribution comes from `SENDER_NAME_PATTERNS` (a human name after
   `from`/`by`) and `UPI_ID_REGEX` (a `name@bank` VPA). Both are best-effort and
   may be `null`; the review flow lets the user name the sender, and a VPA is
   remembered as an alias.
3. **Mirror the credit pattern in `ProcessSMSIntent.isCredit()`** (Swift). This
   is the step that is easiest to forget: if Swift doesn't classify the message
   as a credit, it never dispatches `processSmsIncoming` and the repayment is
   silently lost — there is no log and no UI.
4. No new Shortcut is needed as long as the message carries `Rs.`; the same
   automation covers it. A message that writes only `₹` needs its own trigger
   (§2).

No Shortcut changes are needed for a new bank that uses standard `Rs.` wording —
the same automation covers it. A bank that writes `₹` without `Rs.` needs its own
automation trigger (§2).
