# Gmail SMTP for password-reset OTPs

The app already sends a one-time recovery OTP (`supabase/templates/recovery.html`).
Configure Supabase to deliver it through Gmail.

## 1. Create a Google App Password

1. Open your Google Account → **Security**.
2. Turn on **2-Step Verification** (required for App Passwords).
3. Go to **Security → App passwords** (or https://myaccount.google.com/apppasswords).
4. Create a password for “Mail” / “Other (Expense Tracker)”.
5. Copy the 16-character password. Use this — **not** your normal Google password.

## 2. Hosted Supabase project (recommended for real use)

1. Open the Supabase Dashboard → your project.
2. Go to **Authentication → Emails → SMTP Settings** (or **Project Settings → Auth → SMTP**).
3. Enable **Custom SMTP** and enter:
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your full Gmail address
   - Password: the 16-character Google App Password
   - Sender email: the same Gmail address
   - Sender name: `Expense Tracker`
4. Save.
5. Go to **Authentication → Email Templates → Recovery** and make sure the template contains:
   ```
   {{ .Token }}
   ```
   This is what turns the recovery email into a one-time OTP instead of only a link.
6. Set **Authentication → URL Configuration → Site URL** to your app scheme/site, and add this exact redirect URL:
   ```
   expensetracker://reset-password
   expensetracker://auth-callback
   ```
   Supabase will refuse to redirect the email link to the app without it.
7. In the app, update `.env.local`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
   ```
8. Rebuild the app.

Gmail limits: roughly 500 recipients/day for a free Gmail account. For production
volume, use a transactional provider (Resend, SendGrid, Postmark, etc.).

## 3. Local Supabase (development)

The local config is already wired to read credentials from environment variables:

```toml
[auth.email.smtp]
enabled = true
host = "smtp.gmail.com"
port = 465
user = "env(GMAIL_USER)"
pass = "env(GMAIL_APP_PASSWORD)"
admin_email = "env(GMAIL_USER)"
sender_name = "Expense Tracker"
```

Before starting local Supabase:

```bash
export GMAIL_USER="you@gmail.com"
export GMAIL_APP_PASSWORD="your-16-character-app-password"
npx supabase stop
npx supabase start
```

Do not commit the App Password. Keep it in your shell, a local secret manager, or
an untracked env file. The project’s `.gitignore` ignores `.env*.local`.

If Gmail SMTP is unreachable on port 465, change `port = 587` in
`supabase/config.toml` (STARTTLS).

## 4. Test

1. Open the app → **Forgot password?**
2. Enter the Gmail address used by the account.
3. Check the Gmail inbox for “Your Expense Tracker reset code”.
4. Enter the one-time code, set a new password, and sign in.

If no email arrives, check Supabase Auth logs and the Gmail “Sent” folder.
