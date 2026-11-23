/* /vpn - Logik fuer die Seite (Login, Peers anlegen/entfernen, Download).
   Erwartet die IDs aus index.html. Ereignisse fuer Zusaetze:
   "vpn:arbeit", "vpn:erstellt" und "vpn:fehler" auf document.

   Schluessel: X25519 per WebCrypto. Der Private Key bleibt im Browser,
   der Server bekommt nur Public Key und Preshared Key. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const b64 = s => s.replace(/-/g, '+').replace(/_/g, '/') + '=';  // base64url (43) -> base64 (44)

  async function api(a, body) {
    const opt = body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VPN': '1' },
      body: JSON.stringify(body),
    };
    const r = await fetch('/vpn/api.php?a=' + a, { credentials: 'same-origin', cache: 'no-store', ...opt });
    let j;
    try { j = await r.json(); } catch { throw new Error('The server did not answer (HTTP ' + r.status + ').'); }
    if (!r.ok || j.ok === false) {
      const e = new Error(j.error || 'HTTP ' + r.status);
      e.status = r.status;
      throw e;
    }
    return j;
  }

  async function schluessel() {
    const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const psk = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    return { privateKey: b64(jwk.d), publicKey: b64(jwk.x), presharedKey: psk };
  }

  // wg-quick nimmt den Dateinamen als Interface-Namen: max. 15 Zeichen, kein Leerzeichen.
  const dateiname = name => (name.normalize('NFKD').replace(/[^A-Za-z0-9_=+.-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 15) || 'wireguard') + '.conf';

  const konfig = (name, k, s) => [
    '[Interface]',
    '# ' + name,
    'PrivateKey = ' + k.privateKey,
    'Address = ' + s.address,
    'DNS = ' + s.dns,
    '',
    '[Peer]',
    'PublicKey = ' + s.serverKey,
    'PresharedKey = ' + k.presharedKey,
    'AllowedIPs = ' + s.allowedIps,
    'Endpoint = ' + s.endpoint,
    'PersistentKeepalive = 25',
    '',
  ].join('\n');

  function herunterladen(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // QR-Code fuer die WireGuard-App auf dem Handy (vendor/qrcode.js, laeuft nur im Browser).
  function qr(text) {
    const c = $('erg-qr');
    if (!c || !window.qrcode) return;
    const q = qrcode(0, 'L');               // 0 = Groesse automatisch
    q.addData(text);
    q.make();
    // Pixelgenau: Leinwand = Module + 4 Module Rand, je 4 px; CSS skaliert sie scharf (pixelated).
    const n = q.getModuleCount(), rand = 4, px = 4;
    c.width = c.height = (n + 2 * rand) * px;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#231c38';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect((rand + x) * px, (rand + y) * px, px, px);
  }

  const bytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB'
    : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
  const vor = s => s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm'
    : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- Ansichten ---------- */

  const ansichten = ['laden', 'setup', 'login', 'haupt'];
  function zeige(name) {
    for (const a of ansichten) if ($(a)) $(a).hidden = a !== name;
    document.body.dataset.ansicht = name;
    clearInterval(zeige.takt);
    if (name === 'haupt') { liste(); zeige.takt = setInterval(liste, 10000); }
  }

  function meldung(id, text) {
    const m = $(id);
    if (!m) return;
    m.textContent = text || '';
    m.hidden = !text;
  }

  async function start() {
    if (!window.isSecureContext || !crypto.subtle) {
      meldung('laden-text', 'This page needs a secure connection (HTTPS) to create keys.');
      return;
    }
    try {
      const s = await api('status');
      zeige(s.setup ? 'setup' : s.auth ? 'haupt' : 'login');
      (s.setup ? $('setup-pw') : s.auth ? $('neu-name') : $('login-pw'))?.focus();
    } catch (e) {
      meldung('laden-text', e.message);
    }
  }

  /* ---------- Liste ---------- */

  let letzteListe = '', allePeers = [];
  // Online zuerst, dann nach Name; ab 7 Geraeten gibt es ein Suchfeld.
  function zeichne() {
    const such = ($('suche')?.value || '').trim().toLowerCase();
    const sicht = allePeers
      .filter(p => !such || (p.name + ' ' + p.address).toLowerCase().includes(such))
      .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    $('liste').replaceChildren(...sicht.map(zeile));
    $('liste-leer').hidden = allePeers.length > 0;
    if ($('suche')) $('suche').hidden = allePeers.length < 7;
    if ($('anzahl')) $('anzahl').textContent = allePeers.length;
  }
  $('suche')?.addEventListener('input', zeichne);
  async function liste() {
    try {
      const d = await api('peers');
      meldung('liste-fehler', d.running ? '' : 'The WireGuard interface is not running on the router.');
      const json = JSON.stringify(d.peers);
      if (json === letzteListe) return;
      letzteListe = json;
      allePeers = d.peers;
      zeichne();
    } catch (e) {
      if (e.status === 401) return zeige('login');
      meldung('liste-fehler', e.message);
    }
  }

  function zeile(p) {
    const li = el('li', 'peer' + (p.online ? ' an' : '') + (p.disabled ? ' aus' : ''));
    const status = p.disabled ? 'Paused'
      : p.handshake === null ? 'Never connected'
      : p.online ? 'Connected' : 'Last seen ' + vor(p.handshake) + ' ago';
    li.append(
      el('span', 'peer-name', p.name || 'Unnamed'),
      el('span', 'peer-adr', p.address.split(',')[0]),
      el('span', 'peer-status', status),
      // rx/tx aus Sicht des Routers: was er sendet, laedt das Geraet herunter.
      el('span', 'peer-daten', bytes(p.tx) + ' down, ' + bytes(p.rx) + ' up'),
    );
    if (p.web) {
      const knopf = (text, label, fn) => {
        const b = el('button', 'peer-knopf', text);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.addEventListener('click', async () => {
          b.disabled = true;
          try { if (await fn() !== false) { letzteListe = ''; await liste(); } }
          catch (e) { meldung('liste-fehler', e.message); }
          finally { b.disabled = false; }
        });
        return b;
      };
      const k = el('span', 'peer-knoepfe');
      k.append(
        knopf('Rename', 'Rename ' + p.name, async () => {
          const neu = prompt('New name for "' + p.name + '":', p.name);
          if (neu === null || !neu.trim() || neu.trim() === p.name) return false;
          await api('rename', { id: p.id, name: neu.trim() });
        }),
        knopf(p.disabled ? 'Resume' : 'Pause', (p.disabled ? 'Resume ' : 'Pause ') + p.name,
          () => api('pause', { id: p.id, aus: !p.disabled })),
        knopf('Remove', 'Remove ' + p.name, async () => {
          if (!confirm('Remove "' + p.name + '"? The device loses access right away.')) return false;
          await api('del', { id: p.id });
        }),
      );
      k.lastChild.classList.add('weg');
      li.append(k);
    } else {
      li.append(el('span', 'peer-fremd', 'Set up on the router'));
    }
    return li;
  }

  /* ---------- Formulare ---------- */

  function formular(id, fn) {
    const f = $(id);
    if (!f) return;
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const knopf = f.querySelector('button[type=submit]');
      knopf.disabled = true;
      try { await fn(f); } finally { knopf.disabled = false; }
    });
  }

  formular('setup-form', async () => {
    meldung('setup-fehler', '');
    try {
      const d = await api('hash', { password: $('setup-pw').value });
      $('setup-hash').textContent = "const VPN_PASSWORD_HASH = '" + d.hash + "';";
      $('setup-ergebnis').hidden = false;
    } catch (e) { meldung('setup-fehler', e.message); }
  });

  formular('login-form', async () => {
    meldung('login-fehler', '');
    try {
      await api('login', { password: $('login-pw').value, merken: !!$('login-merken')?.checked });
      $('login-pw').value = '';
      zeige('haupt');
      $('neu-name').focus();
    } catch (e) { meldung('login-fehler', e.message); $('login-pw').select(); }
  });

  let letzte = null;
  formular('neu-form', async () => {
    meldung('neu-fehler', '');
    const name = $('neu-name').value.trim();
    document.dispatchEvent(new CustomEvent('vpn:arbeit', { detail: { name } }));
    try {
      const k = await schluessel();
      const modus = document.querySelector('input[name=modus]:checked')?.value || 'alles';
      const s = await api('add', { name, publicKey: k.publicKey, presharedKey: k.presharedKey, modus });
      letzte = { text: konfig(s.name, k, s), datei: dateiname(s.name) };
      $('erg-name').textContent = s.name;
      $('erg-adresse').textContent = s.address;
      $('erg-datei').textContent = letzte.datei;
      $('erg-text').textContent = letzte.text;
      qr(letzte.text);
      $('ergebnis').hidden = false;
      $('neu-name').value = '';
      herunterladen(letzte.text, letzte.datei);
      document.dispatchEvent(new CustomEvent('vpn:erstellt', { detail: { ...s, publicKey: k.publicKey, datei: letzte.datei } }));
      letzteListe = ''; liste();
    } catch (e) {
      document.dispatchEvent(new CustomEvent('vpn:fehler', { detail: { message: e.message } }));
      if (e.status === 401) return zeige('login');
      meldung('neu-fehler', e.name === 'NotSupportedError'
        ? 'This browser cannot create WireGuard keys (X25519). Use a current Chrome, Edge, Firefox or Safari.'
        : e.message);
    }
  });

  $('erg-laden')?.addEventListener('click', () => letzte && herunterladen(letzte.text, letzte.datei));
  $('erg-kopieren')?.addEventListener('click', async ev => {
    if (!letzte) return;
    const b = ev.currentTarget;
    try { await navigator.clipboard.writeText(letzte.text); b.textContent = 'copied'; }
    catch { b.textContent = 'copy failed'; }
    setTimeout(() => { b.textContent = 'copy'; }, 1800);
  });
  $('erg-zu')?.addEventListener('click', () => {
    $('ergebnis').hidden = true; letzte = null; $('erg-text').textContent = '';
    $('erg-qr')?.getContext('2d').clearRect(0, 0, 999, 999);   // Schluessel nicht im Bild stehen lassen
  });

  $('abmelden')?.addEventListener('click', async () => {
    try { await api('logout', {}); } catch { /* egal, Ansicht trotzdem zuruecksetzen */ }
    letzte = null; letzteListe = '';
    if ($('ergebnis')) $('ergebnis').hidden = true;
    $('erg-qr')?.getContext('2d').clearRect(0, 0, 999, 999);
    zeige('login');
  });

  start();
})();
