(() => {
  const $ = (id) => document.getElementById(id);
  const PIN_KEY = 'phonedrop.pin';
  const RING = 295.31; // circumference of the progress ring (r = 47)
  let pin = localStorage.getItem(PIN_KEY) || '';
  let toastTimer;

  function toast(msg, bad = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 5500 : 2600);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'x-pin': pin, ...(opts.headers || {}) } });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
    return data;
  }

  const pasteText = (text) =>
    api('/api/text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });

  // ---------- connect / PIN ----------
  function showGate(msg = '') {
    $('app').hidden = true;
    $('gate').hidden = false;
    $('pinError').textContent = msg;
    $('pinInput').focus();
  }

  async function connect() {
    try {
      const { host, canPaste } = await api('/api/ping');
      $('gate').hidden = true;
      $('app').hidden = false;
      $('dot').className = canPaste === false ? 'dot off' : 'dot on';
      $('hostLabel').textContent = canPaste === false ? `${host}: paste blocked` : host;
      if (canPaste === false) {
        toast('Your Mac is not allowed to paste yet. On the Mac: System Settings > Privacy & Security > Accessibility, then allow "node".', true);
      }
    } catch (e) {
      if (e.status === 401) {
        localStorage.removeItem(PIN_KEY);
        pin = '';
        showGate($('pinInput').value ? 'Wrong PIN. Check the terminal on your Mac.' : '');
      } else if (e.status === 429) {
        showGate(e.message);
      } else if (pin) {
        $('gate').hidden = true;
        $('app').hidden = false;
        $('dot').className = 'dot off';
        $('hostLabel').textContent = 'Mac not reachable';
      } else {
        showGate("Can't reach your Mac. Is PhoneDrop running and Tailscale on?");
      }
    }
  }

  $('pinForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    pin = $('pinInput').value.trim();
    if (!pin) return;
    localStorage.setItem(PIN_KEY, pin);
    connect();
  });

  $('forget').addEventListener('click', () => {
    localStorage.removeItem(PIN_KEY);
    pin = '';
    $('pinInput').value = '';
    showGate();
  });

  // ---------- progress ring ----------
  function setRing(orb, fraction) {
    orb.querySelector('.ring-fg').style.strokeDashoffset = String(RING * (1 - fraction));
  }

  // ---------- file + video uploads ----------
  function fileName(file) {
    if (file.name) return file.name;
    const ext = (file.type.split('/')[1] || 'bin').replace('quicktime', 'mov');
    return `${file.type.startsWith('video') ? 'video' : 'file'}.${ext}`;
  }

  function uploadOne(file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/upload');
      x.setRequestHeader('x-pin', pin);
      x.setRequestHeader('x-filename', encodeURIComponent(fileName(file)));
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onerror = () => reject(new Error('Lost connection to your Mac'));
      x.onload = () => {
        let data = {};
        try { data = JSON.parse(x.responseText); } catch {}
        x.status === 200 ? resolve(data) : reject(new Error(data.error || `Error ${x.status}`));
      };
      x.send(file);
    });
  }

  async function sendFiles(fileList, orb) {
    const files = [...fileList];
    if (!files.length) return;
    orb.classList.add('busy');
    setRing(orb, 0.02);
    const paths = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const r = await uploadOne(files[i], (p) => setRing(orb, (i + p) / files.length));
        paths.push(r.path);
      }
      setRing(orb, 1);
      await pasteText(paths.join(' ') + ' ');
      toast(files.length === 1 ? 'Sent. Path pasted on your Mac' : `Sent ${files.length} files. Paths pasted`);
    } catch (e) {
      toast(paths.length ? `Saved, but paste failed: ${e.message}` : e.message, true);
    } finally {
      setTimeout(() => {
        orb.classList.remove('busy');
        setRing(orb, 0);
      }, 450);
    }
  }

  for (const [inputId, orbId] of [['fileInput', 'fileOrb'], ['videoInput', 'videoOrb']]) {
    const input = $(inputId);
    input.addEventListener('change', () => {
      sendFiles(input.files, $(orbId));
      input.value = ''; // allow picking the same file again
    });
  }

  // ---------- Speak: tap to start, tap to stop, text is pasted on the Mac ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micOrb = $('micOrb');
  let rec = null;
  let listening = false;
  let finalText = '';
  let interimText = '';
  let micError = '';

  // ----- the dictation box -----
  // iPhones with a Dynamic Island report a top safe area of about 59pt or more
  // (14 Pro, 15, 16 series). Notch and older phones report less.
  // Add ?island or ?drop to the address to force one style.
  function detectKind() {
    const forced = new URLSearchParams(location.search);
    if (forced.has('island')) return 'island';
    if (forced.has('drop')) return 'drop';
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)';
    document.body.appendChild(probe);
    const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    return top >= 51 ? 'island' : 'drop';
  }

  const sheet = $('sheet');
  const sheetInner = $('sheetInner');
  const sheetText = $('sheetText');
  const sheetTitle = $('sheetTitle');
  let sheetTimer;
  sheet.dataset.kind = detectKind();

  // the island pill animates its height, so it needs a pixel value
  function fitSheet() {
    if (sheet.dataset.kind === 'island' && sheet.classList.contains('open')) {
      sheet.style.height = `${sheetInner.offsetHeight}px`;
    }
  }

  function openSheet() {
    clearTimeout(sheetTimer);
    sheet.classList.remove('done');
    sheetText.classList.remove('dim');
    sheetText.textContent = '';
    sheetTitle.textContent = 'Listening';
    sheet.setAttribute('aria-hidden', 'false');
    sheet.classList.add('open', 'live');
    fitSheet();
  }

  function setSheetText(text) {
    sheetText.textContent = text;
    sheetText.scrollTop = sheetText.scrollHeight; // keep the newest words in view
    fitSheet();
  }

  function closeSheet(delay = 0) {
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(() => {
      sheet.classList.remove('open', 'live');
      sheet.style.height = '';
      sheet.setAttribute('aria-hidden', 'true');
    }, delay);
  }

  function setListening(on) {
    listening = on;
    micOrb.classList.toggle('listening', on);
    $('micLabel').textContent = on ? 'Listening' : 'Speak';
    micOrb.setAttribute('aria-pressed', String(on));
  }

  function micErrorMessage(code) {
    switch (code) {
      case 'not-allowed':
        return 'Microphone is blocked. Allow it in iPhone Settings > Safari > Microphone.';
      case 'service-not-allowed':
        return 'Turn on Dictation: iPhone Settings > General > Keyboard > Enable Dictation. If that is on, open PhoneDrop in Safari instead of the Home Screen icon.';
      case 'no-speech':
        return "Didn't hear anything. Tap and speak.";
      case 'network':
        return 'Voice needs an internet connection on the phone.';
      case 'audio-capture':
        return 'No microphone found.';
      default:
        return code ? `Voice problem: ${code}` : '';
    }
  }

  async function finishMic() {
    const text = `${finalText} ${interimText}`.replace(/\s+/g, ' ').trim();
    const err = micError;
    setListening(false);
    rec = null;
    if (text) {
      setSheetText(text);
      sheetText.classList.add('dim');
      sheetTitle.textContent = 'Pasting';
      try {
        await pasteText(text);
        sheet.classList.remove('live');
        sheet.classList.add('done');
        sheetTitle.textContent = 'Pasted on your Mac';
        closeSheet(1300);
      } catch (e) {
        closeSheet(0);
        toast(e.message, true);
      }
    } else {
      closeSheet(0);
      if (err && err !== 'aborted') toast(micErrorMessage(err), true);
    }
  }

  function startMic() {
    if (!SR) {
      toast('Voice is not available in this browser. Open PhoneDrop in Safari.', true);
      return;
    }
    finalText = '';
    interimText = '';
    micError = '';
    rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let f = '';
      let i = '';
      for (let k = 0; k < e.results.length; k++) {
        const r = e.results[k];
        if (r.isFinal) f += r[0].transcript + ' ';
        else i += r[0].transcript;
      }
      finalText = f;
      interimText = i;
      setSheetText(`${f}${i}`.trim());
    };
    rec.onerror = (e) => { micError = e.error; };
    rec.onend = () => { if (listening) finishMic(); };
    try {
      rec.start();
      setListening(true);
      openSheet();
    } catch {
      toast('Could not start the microphone. Try again.', true);
      rec = null;
    }
  }

  micOrb.addEventListener('click', () => {
    if (listening && rec) rec.stop(); // onend -> finishMic -> paste
    else if (!listening) startMic();
  });

  // ---------- Return key ----------
  $('enterBtn').addEventListener('click', async () => {
    try {
      await api('/api/enter', { method: 'POST' });
    } catch (e) {
      toast(e.message, true);
    }
  });

  // re-check the link whenever the app comes back to the foreground
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pin) connect();
  });

  pin ? connect() : showGate();
})();
