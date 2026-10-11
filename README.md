# Luxe Nails & Beauty — Booking Site

Minimal one-page site for a nail & beauty technician with a booking system.
Static front end (HTML/CSS/JS) + one small PHP file for email and slot storage.
Designed for standard cPanel shared hosting — no frameworks, no build step.

## Deploy (cPanel)

1. In cPanel → **File Manager**, upload all files to `public_html/`
   (or use **Git Version Control** — `.cpanel.yml` is included; set `CPANELUSER` first).
2. Make sure PHP is enabled for the domain (default on cPanel).
3. Done — the site is live.

## Configure (2 files)

| File | Setting |
|------|---------|
| `script.js` → `CONFIG` | `whatsappNumber`, `ecocash`, `innbucks`, `bank`, `email`, hours, closed days |
| `booking.php` → top | `$TECH_EMAIL` — where booking emails are sent |

## How booking works

- Client fills details → picks date/time → sees **$20 fee** payment details
  (EcoCash / InnBucks / USD bank) → optionally uploads a payment screenshot →
  enters transaction reference → submits.
- The screenshot is validated server-side (JPG/PNG/WebP/GIF, max 5MB) and sent
  as a real attachment on the booking email — nothing is stored publicly.
- `booking.php` stores the slot in `bookings.json` (blocks it for all future
  clients) and emails the booking + reference via `mail()` — uses the hosting
  account's own mail, no third-party service.
- On success the client sees "booking submitted — you will be contacted," plus
  a button that opens **WhatsApp** with the booking prefilled to the tech.
- If PHP/mail is unreachable, the WhatsApp fallback still delivers the booking.
- With JS disabled the form still posts to `booking.php` and redirects back.

## Local preview

Any static server works for the front end (PHP won't run — that's fine,
submission falls back to WhatsApp). To test the full flow locally use a PHP
server: `php -S localhost:8010`

## Notes

- `bookings.json` is created automatically on first booking. Keep it writable.
- To clear all bookings, delete `bookings.json`.
- If emails land in spam, add SPF/DKIM for the domain in cPanel → Email
  Deliverability, or point `$TECH_EMAIL` at an address on the same domain.
