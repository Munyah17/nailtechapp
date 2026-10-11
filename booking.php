<?php
/* =========================================================
   Booking handler — cPanel compatible (PHP 7+, mail())
   - GET  ?slots=1  → returns JSON list of booked date|time pairs
   - POST           → validates, stores slot, emails the tech
   ========================================================= */

// ===== CONFIG — replace with real details =====
$TECH_EMAIL = 'bookings@luxenails.co.zw';   // nail tech's email
$TECH_NAME  = 'Luxe Nails & Beauty';
$FEE_USD    = 20;
$STORE      = __DIR__ . '/bookings.json';   // booked slots store
$REDIRECT   = 'index.html?sent=1#booking';  // non-JS form fallback
// ==============================================

// ---------- GET: return booked slots ----------
if (isset($_GET['slots'])) {
    header('Content-Type: application/json');
    $slots = file_exists($STORE)
        ? json_decode(file_get_contents($STORE), true)
        : [];
    echo json_encode(is_array($slots) ? $slots : []);
    exit;
}

// ---------- POST: new booking ----------
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method not allowed');
}

$isAjax = isset($_POST['ajax']);

// Respond helper: JSON for AJAX, redirect for plain form posts.
$respond = function ($ok, $error = null) use ($isAjax, $REDIRECT) {
    if ($isAjax) {
        header('Content-Type: application/json');
        if (!$ok) http_response_code(422);
        echo json_encode(['ok' => $ok, 'error' => $error]);
    } else {
        header('Location: ' . ($ok ? $REDIRECT : 'index.html?error=1#booking'));
    }
    exit;
};

// Strip CR/LF from single-line fields (email header-injection guard).
$field = function ($k) {
    return str_replace(["\r", "\n"], ' ', trim($_POST[$k] ?? ''));
};

$name     = $field('name');
$phone    = $field('phone');
$email    = $field('email');
$service  = $field('service');
$date     = $field('date');
$time     = $field('time');
$ref      = $field('reference');
$notes    = trim($_POST['notes'] ?? '');

// Honeypot — bots fill the hidden "website" field; silently discard.
if (!empty($_POST['website'])) {
    $respond(true);
}

if (!$name || !$phone || !$service || !$date || !$time || !$ref) {
    $respond(false, 'Missing required fields');
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !strtotime($date)
    || !preg_match('/^\d{2}:\d{2}$/', $time)) {
    $respond(false, 'Invalid date or time');
}

// ---------- Optional proof-of-payment screenshot ----------
$popData = null; $popName = null; $popMime = null;
if (!empty($_FILES['pop']) && $_FILES['pop']['error'] !== UPLOAD_ERR_NO_FILE) {
    if ($_FILES['pop']['error'] !== UPLOAD_ERR_OK) {
        $respond(false, 'Screenshot upload failed — please try again');
    }
    if ($_FILES['pop']['size'] > 5 * 1024 * 1024) {
        $respond(false, 'Screenshot too large — max 5MB');
    }
    $info = @getimagesize($_FILES['pop']['tmp_name']);
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'];
    if (!$info || !isset($allowed[$info['mime']])) {
        $respond(false, 'Screenshot must be an image (JPG, PNG or WebP)');
    }
    $popMime = $info['mime'];
    $popData = file_get_contents($_FILES['pop']['tmp_name']);
    $safeName = preg_replace('/[^a-z0-9]+/i', '-', $name);
    $popName = "pop-$date-" . substr($safeName, 0, 20) . '.' . $allowed[$popMime];
}

// ---------- Store the slot atomically (blocks it for all clients) ----------
$fp = fopen($STORE, 'c+');
if (!$fp) $respond(false, 'Storage unavailable');
flock($fp, LOCK_EX);
$slots = json_decode(stream_get_contents($fp) ?: '', true);
if (!is_array($slots)) $slots = [];

$key = "$date|$time";
if (in_array($key, $slots, true)) {
    flock($fp, LOCK_UN);
    fclose($fp);
    $respond(false, 'That time slot was just taken — please pick another');
}
$slots[] = $key;
ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($slots));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

// ---------- Email the nail tech ----------
$subject = "New booking: $name — $date $time";
$body =
    "NEW BOOKING — $TECH_NAME\n" .
    "--------------------------------\n" .
    "Name:    $name\n" .
    "Phone:   $phone\n" .
    "Email:   " . ($email ?: '—') . "\n" .
    "Service: $service\n" .
    "Date:    $date\n" .
    "Time:    $time\n" .
    "Notes:   " . ($notes ?: '—') . "\n" .
    "--------------------------------\n" .
    "Booking fee:      \${$FEE_USD}\n" .
    "Transaction ref:  $ref\n" .
    "PoP screenshot:   " . ($popName ? 'attached' : 'not provided') . "\n";

$host = preg_replace('/^www\./', '', $_SERVER['HTTP_HOST'] ?? 'localhost');
$headers = "From: $TECH_NAME <no-reply@$host>\r\n";
if ($email && filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $headers .= "Reply-To: $email\r\n";
}

// Attach the screenshot via MIME multipart when present.
$headers .= "MIME-Version: 1.0\r\n";
if ($popData !== null) {
    $boundary = '=_PoP_' . md5(uniqid());
    $headers .= "Content-Type: multipart/mixed; boundary=\"$boundary\"\r\n";
    $message  = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n$body\r\n";
    $message .= "--$boundary\r\n";
    $message .= "Content-Type: $popMime; name=\"$popName\"\r\n";
    $message .= "Content-Transfer-Encoding: base64\r\n";
    $message .= "Content-Disposition: attachment; filename=\"$popName\"\r\n\r\n";
    $message .= chunk_split(base64_encode($popData));
    $message .= "--$boundary--\r\n";
} else {
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $message = $body;
}

$sent = @mail($TECH_EMAIL, $subject, $message, $headers);

if (!$sent) {
    // Release the reserved slot so the client can retry.
    $fp = fopen($STORE, 'c+');
    if ($fp) {
        flock($fp, LOCK_EX);
        $cur = json_decode(stream_get_contents($fp) ?: '', true);
        if (is_array($cur)) {
            $cur = array_values(array_diff($cur, [$key]));
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($cur));
        }
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}
$respond($sent, $sent ? null : 'Email could not be sent — please try again or use WhatsApp');
