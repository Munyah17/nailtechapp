/* =========================================================
   Vercel serverless booking handler (Node.js, zero deps)
   - GET  → returns JSON array of booked "date|time" slots
   - POST → validates, reserves slot, emails the tech via Resend

   Environment variables (Vercel → Settings → Environment Variables):
     RESEND_API_KEY        required — resend.com API key (free tier)
     TECH_EMAIL            nail tech's inbox (falls back to below)
     FROM_EMAIL            verified sender, e.g. "Bookings <book@yourdomain.com>"
                           (default onboarding@resend.dev only reaches your
                           own Resend account email until a domain is verified)
     KV_REST_API_URL       optional — set automatically if you add Vercel KV;
     KV_REST_API_TOKEN     without these, slot sharing falls back to per-device
   ========================================================= */

const TECH_NAME = "Luxe Nails & Beauty";
const FEE_USD = 20;
const TECH_EMAIL = process.env.TECH_EMAIL || "bookings@luxenails.co.zw";
const FROM_EMAIL = process.env.FROM_EMAIL || "Bookings <onboarding@resend.dev>";

const MAX_POP_BYTES = 5 * 1024 * 1024;

// ---------- Upstash/Vercel KV over REST (optional) ----------
async function kv(cmd, ...args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()).result;
}

module.exports = async (req, res) => {
  // ---------- GET: booked slots ----------
  if (req.method === "GET") {
    const slots = (await kv("smembers", "booked-slots")) || [];
    return res.status(200).json(slots);
  }
  if (req.method !== "POST") return res.status(405).end();

  const b = req.body || {};
  const clean = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
  const name = clean(b.name);
  const phone = clean(b.phone);
  const email = clean(b.email);
  const service = clean(b.service);
  const date = clean(b.date);
  const time = clean(b.time);
  const ref = clean(b.reference);
  const notes = String(b.notes || "").trim();

  // Honeypot — bots fill the hidden "website" field; silently accept.
  if (b.website) return res.status(200).json({ ok: true });

  if (!name || !phone || !service || !date || !time || !ref)
    return res.status(422).json({ ok: false, error: "Missing required fields" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return res.status(422).json({ ok: false, error: "Invalid date or time" });

  // ---------- Optional PoP screenshot (client sends a data URL) ----------
  let pop = null;
  if (b.pop && b.pop.data) {
    const m = /^data:image\/(jpeg|png|gif|webp);base64,(.+)$/s.exec(b.pop.data);
    if (!m)
      return res.status(422).json({
        ok: false,
        error: "Screenshot must be an image (JPG, PNG or WebP)",
      });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_POP_BYTES)
      return res
        .status(422)
        .json({ ok: false, error: "Screenshot too large — max 5MB" });
    pop = { buf, ext: m[1] === "jpeg" ? "jpg" : m[1] };
  }

  const key = `${date}|${time}`;

  // ---------- Reserve slot (cross-device when KV is attached) ----------
  if (process.env.KV_REST_API_URL) {
    const added = await kv("sadd", "booked-slots", key);
    if (added === 0)
      return res.status(422).json({
        ok: false,
        conflict: true,
        error: "That time slot was just taken — please pick another",
      });
  }

  // ---------- Email the nail tech via Resend ----------
  const text =
    `NEW BOOKING — ${TECH_NAME}\n` +
    `--------------------------------\n` +
    `Name:    ${name}\n` +
    `Phone:   ${phone}\n` +
    `Email:   ${email || "—"}\n` +
    `Service: ${service}\n` +
    `Date:    ${date}\n` +
    `Time:    ${time}\n` +
    `Notes:   ${notes || "—"}\n` +
    `--------------------------------\n` +
    `Booking fee:      $${FEE_USD}\n` +
    `Transaction ref:  ${ref}\n` +
    `PoP screenshot:   ${pop ? "attached" : "not provided"}\n`;

  const payload = {
    from: FROM_EMAIL,
    to: [TECH_EMAIL],
    subject: `New booking: ${name} — ${date} ${time}`,
    text,
    ...(email ? { reply_to: email } : {}),
    ...(pop
      ? {
          attachments: [
            {
              filename: `pop-${date}-${name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .slice(0, 20)}.${pop.ext}`,
              content: pop.buf.toString("base64"),
            },
          ],
        }
      : {}),
  };

  let sent = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      sent = r.ok;
      if (!r.ok) console.error("Resend error:", await r.text());
    } catch (e) {
      console.error("Resend fetch failed:", e);
    }
  } else {
    console.error("RESEND_API_KEY is not set");
  }

  if (!sent && process.env.KV_REST_API_URL) {
    await kv("srem", "booked-slots", key); // release the reserved slot
  }

  return res
    .status(sent ? 200 : 422)
    .json({
      ok: sent,
      error: sent ? null : "Email could not be sent — please try again or use WhatsApp",
    });
};
