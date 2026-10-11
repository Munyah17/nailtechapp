/* =========================================================
   CONFIG — replace these placeholders with real details
   ========================================================= */
const CONFIG = {
  techName: "Luxe Nails & Beauty",
  // Where booking notifications are sent (must match $TECH_EMAIL in booking.php):
  email: "bookings@luxenails.co.zw",
  whatsappNumber: "263771234567",             // nail tech's WhatsApp, international format, no '+'
  // Payment details shown to clients ($20 booking fee):
  ecocash: "0771 234 567",
  ecocashName: "Name Surname",
  innbucks: "0772 345 678",
  bank: "CBZ · 1234567890 · J. Doe",
  // Booking settings:
  bookingFeeUSD: 20,
  openHour: 9,                                // 09:00
  closeHour: 17,                              // last slot 16:00
  slotMinutes: 60,
  closedDays: [0],                            // 0 = Sunday
  horizonDays: 60,                            // how far ahead clients can book
};

/* =========================================================
   Inject configured payment/contact details into the page
   ========================================================= */
document.querySelector('[data-config="ecocash"]').textContent = CONFIG.ecocash;
document.querySelector('[data-config="ecocash"]').nextElementSibling.textContent = ` (${CONFIG.ecocashName})`;
document.querySelector('[data-config="innbucks"]').textContent = CONFIG.innbucks;
document.querySelector('[data-config="bank"]').textContent = CONFIG.bank;
document.querySelector('[data-config-link="phone"]').href = `tel:+${CONFIG.whatsappNumber}`;
document.querySelector('[data-config-link="phone"]').textContent = CONFIG.ecocash;
document.querySelector('[data-config-link="email"]').href = `mailto:${CONFIG.email}`;
document.querySelector('[data-config-link="email"]').textContent = CONFIG.email;

/* =========================================================
   Date & time-slot logic
   ========================================================= */
const form = document.getElementById("bookingForm");
const dateInput = form.elements.date;
const timeSelect = form.elements.time;

// Earliest bookable date = today; disable past dates.
const today = new Date();
const toISODate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
dateInput.min = toISODate(today);
const maxDate = new Date();
maxDate.setDate(maxDate.getDate() + CONFIG.horizonDays);
dateInput.max = toISODate(maxDate);

// Booked slots come from the server (shared across all clients).
// Tries the Vercel API first, then the cPanel PHP endpoint;
// localStorage is the fallback when neither is reachable.
const serverBooked = new Set();
(async () => {
  for (const url of ["api/booking", "booking.php?slots=1"]) {
    try {
      const slots = await (await fetch(url)).json();
      if (Array.isArray(slots)) return slots.forEach((s) => serverBooked.add(s));
    } catch (_) {}
  }
})();

const takenKey = (date, time) => `slot:${date}:${time}`;
const isTaken = (date, time) =>
  serverBooked.has(`${date}|${time}`) ||
  localStorage.getItem(takenKey(date, time)) === "1";

dateInput.addEventListener("change", () => {
  const d = new Date(`${dateInput.value}T00:00:00`);
  timeSelect.innerHTML = "";
  timeSelect.disabled = true;

  if (!dateInput.value) {
    timeSelect.innerHTML = '<option value="" disabled selected>Pick a date first</option>';
    return;
  }
  if (CONFIG.closedDays.includes(d.getDay())) {
    timeSelect.innerHTML = '<option value="" disabled selected>Closed on this day — pick another</option>';
    return;
  }

  const isToday = toISODate(d) === toISODate(new Date());
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  let any = false;

  for (let h = CONFIG.openHour; h < CONFIG.closeHour; h++) {
    for (let m = 0; m < 60; m += CONFIG.slotMinutes) {
      const mins = h * 60 + m;
      if (isToday && mins <= nowMinutes) continue;                 // no past slots today
      const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const opt = new Option(
        isTaken(dateInput.value, label) ? `${label} — booked` : label,
        label
      );
      if (isTaken(dateInput.value, label)) opt.disabled = true;
      else any = true;
      timeSelect.add(opt);
    }
  }

  timeSelect.disabled = false;
  if (!any) {
    timeSelect.innerHTML = '<option value="" disabled selected>Fully booked — pick another date</option>';
    timeSelect.disabled = true;
  } else {
    timeSelect.insertBefore(new Option("Select a time…", "", true, true), timeSelect.firstChild);
    timeSelect.options[0].disabled = true;
  }
});

/* =========================================================
   Submit → booking.php (email + slot store) + WhatsApp deep link
   ========================================================= */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Native validation + friendly messages.
  if (!form.reportValidity()) return;

  const data = Object.fromEntries(new FormData(form).entries());

  const summary =
    `NEW BOOKING — ${CONFIG.techName}\n` +
    `--------------------------------\n` +
    `Name: ${data.name}\n` +
    `Phone: ${data.phone}\n` +
    `Email: ${data.email || "—"}\n` +
    `Service: ${data.service}\n` +
    `Date: ${data.date}\n` +
    `Time: ${data.time}\n` +
    `Notes: ${data.notes || "—"}\n` +
    `--------------------------------\n` +
    `Booking fee: $${CONFIG.bookingFeeUSD}\n` +
    `Transaction ref: ${data.reference}` +
    (form.elements.pop?.files?.length ? `\nPoP screenshot: attached to booking email` : ``);

  // WhatsApp message to the nail tech (client taps "send").
  document.getElementById("whatsAppLink").href =
    `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(summary)}`;

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  // PoP screenshot → base64 data URL for the serverless API.
  const popFile = form.elements.pop?.files?.[0];
  const popData = popFile
    ? await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(popFile);
      })
    : null;

  // Try the Vercel serverless API first; fall back to the cPanel PHP endpoint.
  let json = null;
  try {
    const r = await fetch("api/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, pop: popData ? { data: popData } : null }),
    });
    if (r.status !== 404) json = await r.json();
  } catch (_) {}

  if (!json) {
    const body = new FormData(form);
    body.set("ajax", "1");
    try {
      const r = await fetch("booking.php", { method: "POST", body });
      json = await r.json();
    } catch (_) {
      // Both backends unreachable — WhatsApp fallback still delivers the booking.
    }
  }

  if (json && !json.ok) {
    if (json.error) alert(json.error);
    if (json.conflict) {
      // Slot just got taken — refresh options and let the client retry.
      btn.disabled = false;
      btn.textContent = "Submit Booking";
      dateInput.dispatchEvent(new Event("change"));
      return;
    }
    // Email send failed — continue to the success screen anyway so the
    // client can use the WhatsApp fallback button.
  }

  // Reserve the slot locally so it shows as booked next time.
  serverBooked.add(`${data.date}|${data.time}`);
  localStorage.setItem(takenKey(data.date, data.time), "1");

  form.hidden = true;
  document.querySelector(".section-lead").hidden = true;
  document.getElementById("successMsg").hidden = false;
  document.getElementById("successMsg").scrollIntoView({ behavior: "smooth" });
});

// Non-JS fallback: booking.php redirects back here after a plain form post.
const params = new URLSearchParams(location.search);
if (params.has("sent")) {
  form.hidden = true;
  document.querySelector(".section-lead").hidden = true;
  document.getElementById("successMsg").hidden = false;
}
if (params.has("error")) {
  document.getElementById("formError").hidden = false;
}
