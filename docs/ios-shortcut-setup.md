# iOS Automation Setup (Apple Shortcuts)

iOS does not let an app read your SMS. So the trigger lives outside the app:
a **Message automation** in Shortcuts builds a deep link and opens it.

```
bank SMS arrives
   → Message automation fires (no confirmation tap)
   → Shortcut URL-encodes the message body
   → builds expensetracker://add?data=<encoded text>
   → Open URLs launches the app
   → app parses the text, opens Add Expense pre-filled
```

Nothing is parsed inside the Shortcut. It is a dumb pipe, so a new bank's message
format is a code change, not a new Shortcut.

### Where the parsing actually happens

One parser handles every bank SMS: `parseAnySms()` in `src/parsers/sms.ts`.
The full path, in order:

| Step | Code | Result |
| --- | --- | --- |
| Deep link arrives | `useAddExpenseIntent` (`src/hooks/useAddExpenseIntent.ts`) | Pulls `?data=` off the raw URL and percent-decodes it **once** |
| Parse | `parseAnySms(rawText)` | Fills `amount`, `merchant`, `bankSource` |
| Route | `AddExpenseIntentProvider` | Navigates to `/add` from wherever the app was |
| Save | `add.tsx` | Writes `merchant`, `bank_source`, `raw_sms_text` |

Two details worth knowing before you debug anything:

- **`bankSource` is a label, not a parser.** `detectBankHint()` in `sms.ts` scans
  the text for `HDFC` / `FamApp` / `GPay` and returns a string that gets stored in
  the `bank_source` column. It does *not* select a different parser — see §6.
  There is no `bank=` query parameter; `data=` is the whole contract.
- **The SMS timestamp is discarded.** `parseAnySms` does not extract a date, and
  `add.tsx` writes `occurredAt: new Date().toISOString()`, so every expense is
  stamped with its capture time, not the time of the transaction.

This covers **one person's phone**. An automation cannot be exported, AirDropped
or shared — everyone sets up their own by hand. Only the Shortcut itself (§1) is
reusable.

---

## Before you start

The app must be installed and the `expensetracker://` scheme registered. A
release build (`npx expo run:ios --device --configuration Release`) has it.

Confirm the app side works **before** touching Shortcuts, so that when something
breaks you know which half is at fault:

```bash
# Booted simulator — adjust the bundle id if you changed it.
xcrun simctl openurl booted "expensetracker://add?data=$(python3 -c \
  'import urllib.parse; print(urllib.parse.quote("Spent Rs.49 From HDFC Bank Card x1234 At HAIER APPLIANCES INDIA On 2026-08-10:09:17:38. Get 5% cashback. Call +919876543210"))')"
```

The Add Expense sheet should open with **Rs.49** and **HAIER APPLIANCES INDIA**
pre-filled, and the full text at the top. The `%` and `+` in that string are
deliberate — they are the two characters that used to break this path.

On a physical device, paste the same `expensetracker://…` URL into Safari's
address bar instead.

If that works, the app is fine and anything below is Shortcuts config.

---

## 1. Build the Shortcut

Shortcuts app → **+** → name it `Log Expense`.

Three actions, in order:

### 1a. URL Encode

Add **URL Encode**. Set its input to **Shortcut Input**.

This is the whole trick. `Shortcut Input` in a Message automation is the incoming
message; the action percent-encodes its body so that characters like `&` and `%`
can survive inside a URL instead of terminating the query string early.

> If the action offers an encoding-style dropdown, pick the **component** (or
> query) option, not the whole-URL one.
>
> If `URL Encode` receives the message *object* rather than its text and refuses
> it, insert a **Get Text from Input** action before it and feed its output in.

### 1b. Text

Add **Text** and type exactly:

```
expensetracker://add?data=
```

then, **without a space after the `=`**, insert the `URL Encoded Text` variable
from the variable bar above the keyboard.

Do **not** put the whole assembled string through `URL Encode` — that would
encode the `://`, `?` and `&` and produce a URL the app cannot route.

### 1c. Open URLs

Add **Open URLs** and set its input to the **Text** from step 1b.

### Also turn on the Share Sheet

Tap the shortcut's **(i)** → enable **Show in Share Sheet** → set the accepted
input to **Text**.

This gives you the same shortcut as a manual fallback. When the automation is
being flaky — and per §3 it sometimes will be — you can long-press the bank SMS,
Share, pick `Log Expense`, and get the identical result in two taps. It is also
how you test without waiting for a real bank SMS.

**Test the Shortcut before building the automation**: share a real bank SMS to
it. If the Add sheet opens pre-filled, §1 is done.

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

**Run Immediately.** Turn it **on**, and confirm the **Don't Ask** prompt. This
is what removes the confirmation tap, and it is the difference between an
automation and a nag.

**Action.** Choose **Run Shortcut** → `Log Expense` from §1.

Keeping the actions in the named Shortcut rather than inlining them means the
automation, the Share Sheet fallback, and your testing all run one definition —
so an encoding fix lands everywhere at once.

> If the lock-screen behaviour in §3 turns out to be a problem for you, the
> fallback is to **New Blank Automation** and paste the same three actions
> directly into it, removing the `Run Shortcut` hop.

**Save.** Send yourself a text containing `Rs.` — or temporarily change the
filter to something you can trigger on demand, test, then change it back. The
Add sheet should open on its own.

---

## 3. What to expect, honestly

Verified against Apple's own documentation:

- Message automations **can** run with no confirmation tap. Apple lists Message
  among the triggers that support it, since iOS 17.
- Apple's own caveat: turning off "Ask Before Running" covers the *trigger*, and
  you "may also need to set individual actions to run automatically."

Reported by users, **not** confirmed by Apple — treat as things to test on your
device rather than facts:

- **A locked phone may still prompt.** iOS restricts background processes from
  opening URLs, and opening one always brings the app to the foreground; from a
  locked screen that plausibly requires an unlock. If you consistently trigger
  expenses with the phone in your pocket, check this early.
- **"Run Immediately" can silently revert to "Ask Before Running" after an iOS
  update.** This is widely described as the single most common reason an
  automation stops working. If it worked for months and then stopped, look here
  first.
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
| App never opens | Scheme typo, or the automation is not firing | Re-check `expensetracker://` spelling; re-check **Run Immediately** (§3) |
| App opens, but Add Expense has no raw text and no amount | `data` param is empty or the `Text` action is missing the encoded variable | Re-do §1b — the variable must sit immediately after `data=` |
| App opens, raw text shows at top, but amount/merchant are blank | The app worked; `parseAnySms` did not match this SMS shape | Add or widen a regex in `src/parsers/sms.ts` (§6), then rebuild |
| Worked, then stopped after an iOS update | Run Immediately reverted | Re-enable it in the automation |
| Nothing at all, ever | Filter never matches | Loosen to `Message Contains` → `Rs.`; remember filters are ANDed |
| Add sheet opens for SMS you did not want | Filter is too broad | Narrow with a Sender filter, or add a second condition |

When debugging the Shortcut itself, temporarily add **Show Result** just before
Open URLs and run it — you will see the exact URL being built, which tells you
immediately whether the encoding is right. Remove it when done.

The app logs the reason it ignored a link in development builds, so run a dev
build and watch the Metro console while testing.

---

## 5. Privacy note

The full text of every matching bank SMS is passed to the app through the URL.
It stays on-device — there is no backend — but the message body does leave
Messages' sandbox and lands in the Shortcut's run history. If that trade is not
one you want, use the Share Sheet fallback only and skip §2.

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

1. Add amount/merchant regex patterns to `AMOUNT_PATTERNS` / `MERCHANT_PATTERNS`
   in `src/parsers/sms.ts`. **Order matters** — the first regex that matches
   wins, so put the most specific pattern above the general `Rs.`/`₹` fallbacks
   at the bottom of each list.
2. Add a keyword to `detectBankHint()` if you want the row labelled with that
   bank in `bank_source`. This is cosmetic only; it changes no parsing.
3. Check the Shortcut filter still matches. The automation in §2 filters on
   `Message Contains: Rs.`, so a bank that never writes `Rs.` (or `₹`) will not
   reach the parser at all until that filter is widened.

No Shortcut changes are needed for a new bank that uses standard `Rs.`/`₹`
wording — the same automation covers them.
