<?php
/**
 * /vpn/api.php - JSON-Schnittstelle fuer index.html (app.js).
 *
 * Die Schluessel erzeugt der Browser. Hier kommen nur Public Key und
 * Preshared Key an; der Private Key verlaesst das Geraet nie.
 *
 *   GET  ?a=status          -> {auth, setup}
 *   POST ?a=hash   {password}  nur solange kein Hash gesetzt ist
 *   POST ?a=login  {password}
 *   POST ?a=logout
 *   GET  ?a=peers
 *   POST ?a=add    {name, publicKey, presharedKey}
 *   POST ?a=del    {id}
 */
declare(strict_types=1);
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

session_name('vpn');
session_set_cookie_params(['lifetime' => 0, 'path' => '/vpn', 'secure' => true,
                           'httponly' => true, 'samesite' => 'Strict']);
session_start();

function antwort(array $d, int $code = 200): never {
    http_response_code($code);
    echo json_encode($d + ['ok' => $code < 400], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function fehler(string $text, int $code): never { antwort(['error' => $text], $code); }

function ros(string $methode, string $pfad, ?array $body = null): array {
    $ch = curl_init(VPN_ROUTER . $pfad);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $methode,
        CURLOPT_USERPWD        => MIKROTIK_USER . ':' . MIKROTIK_PASS,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($raw === false) {
        error_log('[vpn] router: ' . curl_error($ch));
        fehler('The router is not reachable.', 502);
    }
    $j = json_decode((string) $raw, true);
    if ($code >= 400) {
        error_log("[vpn] router $code: $raw");
        fehler('The router refused: ' . ($j['detail'] ?? $j['message'] ?? "HTTP $code"), 502);
    }
    return is_array($j) ? $j : [];
}

/** RouterOS-Dauer "1w2d3h4m5s" -> Sekunden. */
function sekunden(string $d): int {
    preg_match_all('/(\d+)([wdhms])/', $d, $m, PREG_SET_ORDER);
    $f = ['w' => 604800, 'd' => 86400, 'h' => 3600, 'm' => 60, 's' => 1];
    return array_sum(array_map(fn($x) => (int) $x[1] * $f[$x[2]], $m));
}

function interface_info(): array {
    $i = ros('GET', '/interface/wireguard?name=' . rawurlencode(VPN_IFACE))[0] ?? null;
    if (!$i) fehler('WireGuard interface ' . VPN_IFACE . ' is missing on the router.', 502);
    return $i;
}

$a    = (string) ($_GET['a'] ?? '');
$in   = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Eigener Header: ein fremdes Formular oder fetch ohne CORS kann ihn nicht setzen.
    if (($_SERVER['HTTP_X_VPN'] ?? '') !== '1') fehler('Bad request.', 400);
    $in = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($in)) fehler('Bad request.', 400);
} elseif (in_array($a, ['hash', 'login', 'logout', 'add', 'del'], true)) {
    fehler('Use POST.', 405);
}

$setup = VPN_PASSWORD_HASH === '';
$auth  = !$setup && !empty($_SESSION['vpn']);

switch ($a) {
case 'status':
    antwort(['auth' => $auth, 'setup' => $setup]);

case 'hash':
    if (!$setup) fehler('A password is already set.', 409);
    $pw = (string) ($in['password'] ?? '');
    if (strlen($pw) < 8) fehler('Use at least 8 characters.', 422);
    antwort(['hash' => password_hash($pw, PASSWORD_DEFAULT)]);

case 'login':
    if ($setup) fehler('No password is set yet.', 409);
    if (!password_verify((string) ($in['password'] ?? ''), VPN_PASSWORD_HASH)) {
        sleep(2);  // ponytail: nur Bremse pro Anfrage; echte Sperre (fail2ban/Zaehler) wenn je noetig
        fehler('Wrong password.', 401);
    }
    session_regenerate_id(true);
    $_SESSION['vpn'] = true;
    antwort(['auth' => true]);

case 'logout':
    $_SESSION = [];
    session_destroy();
    antwort([]);
}

if (!$auth) fehler('Sign in first.', 401);

switch ($a) {
case 'peers':
    $iface = interface_info();
    $liste = [];
    foreach (ros('GET', '/interface/wireguard/peers?interface=' . rawurlencode(VPN_IFACE)) as $p) {
        $c   = (string) ($p['comment'] ?? '');
        $web = str_starts_with($c, VPN_MARKE);
        $hs  = isset($p['last-handshake']) ? sekunden((string) $p['last-handshake']) : null;
        // Nur ausgewaehlte Felder - der Peer-Datensatz enthaelt auch Schluessel.
        $liste[] = [
            'id'        => $p['.id'],
            'name'      => $web ? substr($c, strlen(VPN_MARKE)) : ($c !== '' ? $c : (string) ($p['name'] ?? '')),
            'web'       => $web,
            'address'   => (string) ($p['allowed-address'] ?? ''),
            'handshake' => $hs,
            'online'    => $hs !== null && $hs < 180,
            'disabled'  => ($p['disabled'] ?? '') === 'true',
            'rx'        => (int) ($p['rx'] ?? 0),
            'tx'        => (int) ($p['tx'] ?? 0),
        ];
    }
    antwort(['interface' => VPN_IFACE, 'running' => ($iface['running'] ?? '') === 'true', 'peers' => $liste]);

case 'add':
    $name = trim(mb_substr(preg_replace('/[^\p{L}\p{N} ._-]/u', '', (string) ($in['name'] ?? '')), 0, 40));
    if ($name === '') fehler('Give the device a name.', 422);
    foreach (['publicKey', 'presharedKey'] as $k) {
        if (!preg_match('~^[A-Za-z0-9+/]{43}=$~', (string) ($in[$k] ?? ''))) fehler('Invalid key.', 422);
    }
    $iface = interface_info();

    // ponytail: freie Adresse lesen-dann-schreiben, zwei gleichzeitige Klicks koennten
    // dieselbe bekommen; reicht fuer einen Benutzer.
    $belegt = array_flip(VPN_RESERVIERT);
    foreach (ros('GET', '/interface/wireguard/peers') as $p) {
        foreach (explode(',', (string) ($p['allowed-address'] ?? '')) as $adr) {
            if (preg_match('/^' . preg_quote(VPN_NETZ, '/') . '\.(\d+)\/32$/', trim($adr), $m)) $belegt[(int) $m[1]] = true;
        }
    }
    for ($n = 2; $n < 255 && isset($belegt[$n]); $n++);
    if ($n >= 255) fehler('No free address left in ' . VPN_NETZ . '.0/24.', 409);
    $adresse = VPN_NETZ . ".$n";

    $neu = ros('PUT', '/interface/wireguard/peers', [
        'interface'       => VPN_IFACE,
        'public-key'      => $in['publicKey'],
        'preshared-key'   => $in['presharedKey'],
        'allowed-address' => "$adresse/32",
        'comment'         => VPN_MARKE . $name,
    ]);
    antwort([
        'id'         => $neu['.id'] ?? '',
        'name'       => $name,
        'address'    => "$adresse/32",
        'dns'        => VPN_DNS,
        'serverKey'  => (string) $iface['public-key'],
        'endpoint'   => VPN_ENDPOINT . ':' . $iface['listen-port'],
        'allowedIps' => VPN_ALLOWED,
    ]);

case 'del':
    $id = (string) ($in['id'] ?? '');
    if (!preg_match('/^\*[0-9A-F]+$/', $id)) fehler('Invalid id.', 422);
    $p = ros('GET', '/interface/wireguard/peers/' . $id);
    if (($p['interface'] ?? '') !== VPN_IFACE || !str_starts_with((string) ($p['comment'] ?? ''), VPN_MARKE)) {
        fehler('Only connections created here can be removed here.', 403);
    }
    ros('DELETE', '/interface/wireguard/peers/' . $id);
    antwort([]);
}

fehler('Unknown action.', 400);
