/* /vpn - Regen, Tropfen auf der Scheibe, Uhr und der Mini-Player.
   Der Player spielt die Dateien aus musik/ (Liste kommt von musik.php).
   Musik ist beim Laden immer an; sperrt der Browser den Ton, laeuft sie
   stumm, bis man irgendwo klickt oder tippt. Lautstaerke und die Stelle im
   Track merkt sich der Browser, Neuladen spielt also an derselben Stelle
   weiter. Pause gilt nur bis zum Neuladen. Die Tracks stammen von Pixabay
   (Pixabay Content License: frei nutzbar, keine Namensnennung noetig). */
'use strict';
(() => {
  // ---------- Regen und Tropfen ----------
  const zw = (a, b) => a + Math.random() * (b - a);
  // Beim Laden kann das Fenster noch 0x0 melden (Hintergrund-Tab) - dann Bildschirmgroesse.
  const flaeche = Math.max(innerWidth * innerHeight, screen.width * screen.height * .6, 300000);

  const regen = document.getElementById('regen');
  for (let i = 0, n = Math.round(Math.min(140, flaeche / 9000)); i < n; i++) {
    const s = document.createElement('span');
    const nah = Math.random() < .25;
    s.className = 'strich' + (nah ? ' nah' : '');
    s.style.left = zw(0, 100) + '%';
    s.style.height = (nah ? zw(70, 130) : zw(30, 80)) + 'px';
    s.style.opacity = nah ? zw(.25, .45) : zw(.15, .4);
    const dauer = nah ? zw(.55, .8) : zw(.9, 1.5);
    s.style.animationDuration = dauer + 's';
    s.style.animationDelay = -zw(0, dauer) + 's';   // negativ: von Anfang an verteilt
    regen.append(s);
  }

  const scheibe = document.getElementById('scheibe');
  function platziere(t) {
    t.style.left = zw(0, 100) + '%';
    t.style.top = zw(0, 92) + '%';
  }
  for (let i = 0, n = Math.round(Math.min(220, flaeche / 5000)); i < n; i++) {
    const t = document.createElement('span');
    const gross = Math.random() < .12;
    const d = gross ? zw(7, 12) : zw(2, 6);
    t.className = 'tropfen';
    t.style.width = d + 'px';
    t.style.height = d * zw(1, 1.2) + 'px';
    platziere(t);
    if (gross || Math.random() < .06) {
      t.classList.add('rinnt');
      t.style.setProperty('--zeit', zw(9, 18) + 's');
      t.style.setProperty('--weg', zw(80, 220) + 'px');
      t.style.animationDelay = -zw(0, 15) + 's';
      t.addEventListener('animationiteration', ev => { if (ev.target === t) platziere(t); });
    }
    scheibe.append(t);
  }

  // ---------- Uhr ----------
  const uhr = document.getElementById('uhr');
  const stelle = () => { uhr.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', light rain'; };
  stelle(); setInterval(stelle, 20000);

  // ---------- Mini-Player ----------
  const $ = id => document.getElementById(id);
  const merke = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privat: egal */ } };
  const lies = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const mmss = t => Number.isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00';

  const knopf = $('beats'), balken = [...$('balken').children], audio = new Audio();
  audio.preload = 'auto';
  let liste = [], nr = 0, ctx = null, analyse = null, wartet = false, fehlerInFolge = 0;

  // "Kuenstler - Titel.mp3" oder Pixabay-Art "kuenstler-titel-123456.mp3"
  function anzeige(datei) {
    const n = datei.replace(/\.[^.]+$/, '').replace(/[-_ ]\d{4,}$/, '');
    if (n.includes(' - ')) { const [k, ...t] = n.split(' - '); return { titel: t.join(' - '), kuenstler: k }; }
    return { titel: n.replace(/[-_]+/g, ' '), kuenstler: '' };
  }

  function lade(i, spielen) {
    nr = (i + liste.length) % liste.length;
    audio.src = '/vpn/musik/' + encodeURIComponent(liste[nr]);
    const a = anzeige(liste[nr]);
    $('track').textContent = a.titel;
    $('kuenstler').textContent = (a.kuenstler || 'tunnel radio') + ', track ' + (nr + 1) + ' of ' + liste.length;
    $('zeit-ganz').textContent = '0:00';
    // Titel fuer Medientasten, Sperrbildschirm und die Windows-Medienanzeige
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: a.titel, artist: a.kuenstler || 'tunnel radio', album: 'tunnel radio' });
    if (spielen) spiele();
  }

  // Ueber WebAudio, damit die Balken im Cover echte Pegel zeigen. Nur aus einer
  // Bedienung heraus aufrufen: ein vorher erzeugter AudioContext bleibt
  // gesperrt und wuerde den Ton des Elements verschlucken.
  function verbinde() {
    if (ctx) return;
    ctx = new AudioContext();
    analyse = ctx.createAnalyser(); analyse.fftSize = 256; analyse.smoothingTimeConstant = .8;
    ctx.createMediaElementSource(audio).connect(analyse).connect(ctx.destination);
    ctx.resume();
  }

  // Browser erlauben Ton erst nach einer Bedienung. Gesperrt? Dann laeuft die
  // Musik stumm weiter (stummes Autoplay ist erlaubt) und die erste Bedienung
  // schaltet nur noch den Ton dazu - sie spielt also nach dem Neuladen weiter.
  async function spiele() {
    if (!liste.length) return;
    try { await audio.play(); }
    catch { audio.muted = true; try { await audio.play(); } catch { /* auch stumm gesperrt */ } }
    zustand();
  }

  function tonAn() {
    verbinde();
    audio.muted = false;
    if (audio.paused) spiele(); else zustand();
  }

  const daten = new Uint8Array(128), BINS = [1, 2, 3, 5, 8, 12, 18, 26];
  function malen() {
    requestAnimationFrame(malen);
    if (audio.paused) return;
    if (analyse && !audio.muted) {
      analyse.getByteFrequencyData(daten);
      balken.forEach((b, i) => { b.style.transform = 'scaleY(' + Math.min(1, .08 + daten[BINS[i]] / 255 * (1 + i * .1)).toFixed(3) + ')'; });
    }
    if (audio.duration) $('fortschritt').style.transform = 'scaleX(' + (audio.currentTime / audio.duration).toFixed(4) + ')';
  }
  requestAnimationFrame(malen);

  // Pause gilt nur bis zum Neuladen: beim Laden ist die Musik immer an.
  let musikAn = true;
  const wunsch = () => musikAn;
  function zustand() {
    const laeuft = !audio.paused, stumm = laeuft && audio.muted;
    wartet = stumm || (!laeuft && liste.length > 0 && wunsch());
    knopf.setAttribute('aria-pressed', String(laeuft && !stumm));
    knopf.setAttribute('aria-label', laeuft && !stumm ? 'Pause music' : 'Play music');
    document.body.classList.toggle('spielt', laeuft);
    $('tippen').textContent = stumm ? 'muted by the browser, click anywhere for sound' : 'click anywhere to tune in';
    $('tippen').hidden = !wartet;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = laeuft ? 'playing' : 'paused';
  }

  // Stelle merken, damit Neuladen im selben Track an derselben Stelle weitermacht.
  function sichere() {
    if (liste.length) merke('lofi-stelle', JSON.stringify({ datei: liste[nr], zeit: audio.currentTime }));
  }
  setInterval(sichere, 2000);
  addEventListener('pagehide', sichere);

  audio.addEventListener('play', zustand);
  audio.addEventListener('pause', zustand);
  audio.addEventListener('volumechange', zustand);
  audio.addEventListener('playing', () => { fehlerInFolge = 0; });
  audio.addEventListener('ended', () => lade(nr + 1, true));
  audio.addEventListener('loadedmetadata', () => { $('zeit-ganz').textContent = mmss(audio.duration); });
  audio.addEventListener('timeupdate', () => { $('zeit-jetzt').textContent = mmss(audio.currentTime); });
  audio.addEventListener('error', () => {               // kaputte Datei: weiter, aber nicht endlos im Kreis
    if (++fehlerInFolge < liste.length) lade(nr + 1, wunsch());
  });

  knopf.addEventListener('click', () => {
    if (!audio.paused && audio.muted) { musikAn = true; tonAn(); return; }   // stumm: Klick heisst "Ton an"
    if (!audio.paused) { musikAn = false; audio.pause(); return; }
    musikAn = true;
    verbinde(); audio.muted = false; spiele();
  });
  $('weiter').addEventListener('click', () => liste.length && lade(nr + 1, !audio.paused));
  $('zurueck').addEventListener('click', () => {
    if (!liste.length) return;
    // wie bei jedem Player: erst an den Anfang, beim zweiten Klick ein Stueck zurueck
    if (audio.currentTime > 3) audio.currentTime = 0; else lade(nr - 1, !audio.paused);
  });
  $('lautstaerke').addEventListener('input', () => {
    merke('lofi-laut', $('lautstaerke').value);
    audio.volume = ($('lautstaerke').value / 100) ** 2;
  });
  // Klick auf den Fortschrittsbalken springt dorthin.
  document.querySelector('.fortschritt').addEventListener('click', ev => {
    if (!audio.duration) return;
    const r = ev.currentTarget.getBoundingClientRect();
    audio.currentTime = (ev.clientX - r.left) / r.width * audio.duration;
  });

  // Medientasten der Tastatur bzw. des Betriebssystems laufen ueber dieselben Knoepfe.
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => { if (audio.paused || audio.muted) knopf.click(); });
    ms.setActionHandler('pause', () => { if (!audio.paused) knopf.click(); });
    ms.setActionHandler('nexttrack', () => $('weiter').click());
    ms.setActionHandler('previoustrack', () => $('zurueck').click());
  }

  // Leertaste = Play/Pause, ausser beim Tippen oder auf einem Knopf (dort klickt sie ohnehin).
  const leertaste = ev => ev.type === 'keydown' && ev.code === 'Space' && !ev.repeat
    && !ev.target.closest?.('input, textarea, select, button, summary, a, [contenteditable]');
  document.addEventListener('keydown', ev => {
    if (!leertaste(ev) || !liste.length) return;
    ev.preventDefault();     // sonst scrollt die Seite
    knopf.click();
  });

  // Erste Bedienung irgendwo: Ton dazu (der Play-Knopf entscheidet selbst).
  function freischalten(ev) {
    if (ev.target.closest?.('#beats') || leertaste(ev)) return;
    if (wartet) tonAn();
    else if (!ctx && !audio.paused) verbinde();   // Ton lief schon: nur die Balken anschliessen
  }
  document.addEventListener('pointerdown', freischalten, true);
  document.addEventListener('keydown', freischalten, true);

  const laut = lies('lofi-laut');
  if (laut !== null) $('lautstaerke').value = laut;
  audio.volume = ($('lautstaerke').value / 100) ** 2;

  fetch('/vpn/musik.php', { cache: 'no-store' }).then(r => r.json()).then(l => {
    liste = Array.isArray(l) ? l : [];
    if (!liste.length) {
      $('track').textContent = 'no tracks yet';
      $('kuenstler').textContent = 'put mp3 files into vpn/musik';
      for (const id of ['beats', 'weiter', 'zurueck']) $(id).disabled = true;
      return;
    }
    let stelle = null;
    try { stelle = JSON.parse(lies('lofi-stelle')); } catch { /* nichts gemerkt */ }
    const i = stelle ? liste.indexOf(stelle.datei) : -1;
    lade(i >= 0 ? i : Math.floor(Math.random() * liste.length), false);   // sonst Radio: irgendwo einsteigen
    if (i >= 0 && stelle.zeit > 0) audio.addEventListener('loadedmetadata', () => { audio.currentTime = stelle.zeit; }, { once: true });
    if (wunsch()) spiele(); else zustand();
  }).catch(() => { $('track').textContent = 'radio offline'; });
})();
