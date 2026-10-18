/* =====================================================================
   DroneForge — interface, rendu 3D et orchestration des 5 modules
   ===================================================================== */
(() => {
  'use strict';
  const { clamp, TAU, DEG } = DF;
  const $ = (s, r = document) => r.querySelector(s);
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = {};
  ['bg', 'bg-2', 'panel', 'panel-2', 'line', 'line-2', 'fg', 'muted', 'dim', 'accent', 'cyan', 'good', 'warn', 'bad', 'phase-a', 'phase-b', 'phase-c'].forEach(k => { C[k.replace('-', '')] = cssv('--' + k) || '#888'; });
  const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NATIVE = window.DFNative || null;
  const IS_APP = !!(NATIVE && NATIVE.isNative);
  const TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const APP_VERSION = '1.0.0';
  const tap = () => { try { if (NATIVE) NATIVE.tap(); } catch (e) { /* retour haptique facultatif */ } };
  const fmtN = (x, d = 0) => Number(x).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

  /* ================= État & persistance ================= */
  const STORE_KEY = 'droneforge.project.v2', POLICY_KEY = 'droneforge.policy.v2';
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* stockage indisponible */ } },
  };
  const TABS = ['motor', 'simulation', 'ai', 'motherboard', 'production', 'lab'];
  function defaultState() {
    return {
      cfg: DF.defaultConfig(),
      ui: { tab: 'motor', throttle: 0.6, showProp: true, explode: false, cutaway: false, phases: true, boardExplode: false, signals: true, prodExplode: 0, autoRotate: !reducedMotion },
      sim: { mode: 'waypoints', wind: 2, windDir: 45, gust: 0.3, noise: true, infBattery: false, vmax: 6, maxTilt: 35, follow: true,
        gains: { pos: 1.2, vel: 3, att: 10, rate: 30 }, waypoints: [[0, 2, -4], [4, 3, 0], [0, 2.5, 4], [-4, 3, 0]], sel: 0 },
      ai: { lr: 3e-4, clip: 0.2, ent: 0.003, gamma: 0.99 },
      prod: { qty: 10, currency: 'XOF' },
      board: { selected: 'mcu' },
      checklist: {},
    };
  }
  function mergeState(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (!(k in saved)) continue;
      const b = base[k], s = saved[k];
      if (b && typeof b === 'object' && !Array.isArray(b) && s && typeof s === 'object' && !Array.isArray(s) && k !== 'checklist') base[k] = mergeState(b, s);
      else if (k === 'checklist' && s && typeof s === 'object') base[k] = s;
      else if (Array.isArray(b) ? Array.isArray(s) : typeof s === typeof b) base[k] = s;
    }
    return base;
  }
  function validateState(st) {
    st.cfg = DF.sanitizeConfig(st.cfg);
    if (!TABS.includes(st.ui.tab)) st.ui.tab = 'motor';
    const w = st.sim.waypoints.filter(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)).map(p => [clamp(p[0], -11, 11), clamp(p[1], 0.5, 12), clamp(p[2], -11, 11)]);
    st.sim.waypoints = w.length ? w.slice(0, 12) : defaultState().sim.waypoints;
    st.sim.sel = clamp(st.sim.sel | 0, 0, st.sim.waypoints.length - 1);
    if (!['waypoints', 'manual', 'ai'].includes(st.sim.mode)) st.sim.mode = 'waypoints';
    if (!['XOF', 'EUR', 'USD'].includes(st.prod.currency)) st.prod.currency = 'XOF';
    st.prod.qty = clamp(Math.round(st.prod.qty) || 1, 1, 10000);
    return st;
  }
  let S = validateState(mergeState(defaultState(), store.get(STORE_KEY)));
  const hashTab = (location.hash || '').slice(1);
  if (TABS.includes(hashTab)) S.ui.tab = hashTab;
  let saveTimer = 0;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(STORE_KEY, S), 300); }
  let SUM = DF.summarize(S.cfg);

  /* ================= Aides DOM ================= */
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const sec = (title, aside, ...kids) => el('section', { class: 'sec' }, el('h3', null, title, aside ? el('span', { class: 'aside' }, aside) : null), ...kids);
  const head = (title, text) => el('div', { class: 'panel-head' }, el('h2', null, title), text ? el('p', null, text) : null);
  function range(o) {
    const out = el('output', { class: 'val', for: o.id });
    const inp = el('input', { type: 'range', id: o.id, min: o.min, max: o.max, step: o.step, value: o.value });
    const show = () => { out.textContent = o.fmt(Number(inp.value)); };
    inp.addEventListener('input', () => { show(); o.onInput(Number(inp.value)); });
    show();
    const row = el('div', { class: 'ctl' }, el('div', { class: 'ctl-head' }, el('label', { for: o.id }, o.label), out), inp);
    row.set = v => { inp.value = v; show(); };
    return row;
  }
  function select(o) {
    const s = el('select', { id: o.id }, o.options.map(([v, t]) => el('option', { value: v }, t)));
    s.value = String(o.value);
    s.addEventListener('change', () => o.onChange(s.value));
    const f = el('div', { class: 'field' }, el('label', { for: o.id }, o.label), s);
    f.set = v => { s.value = String(v); };
    f.input = s;
    return f;
  }
  function toggle(o) {
    const i = el('input', { type: 'checkbox', id: o.id });
    i.checked = !!o.checked;
    i.addEventListener('change', () => o.onChange(i.checked));
    const l = el('label', { class: 'switch', for: o.id }, el('span', null, o.label), i);
    l.set = v => { i.checked = !!v; };
    return l;
  }
  function seg(o) {
    const wrap = el('div', { class: 'seg', role: 'group', 'aria-label': o.label });
    const btns = o.options.map(([v, t]) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(v === o.value) }, t);
      b.addEventListener('click', () => { wrap.set(v); o.onChange(v); });
      b.dataset.v = v; return b;
    });
    wrap.append(...btns);
    wrap.set = v => btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
    return wrap;
  }
  function kpiGrid(items, cls) {
    const g = el('div', { class: 'kpis ' + (cls || '') });
    const map = {};
    for (const it of items) {
      const v = el('div', { class: 'kpi-v' }, '—');
      const k = el('div', { class: 'kpi' }, el('div', { class: 'kpi-l', title: it.label }, it.label), v);
      map[it.id] = { k, v, unit: it.unit || '' };
      g.append(k);
    }
    g.setK = (id, value, state) => {
      const m = map[id]; if (!m) return;
      m.v.textContent = value;
      if (m.unit) m.v.append(el('small', null, m.unit));
      m.k.className = 'kpi' + (state ? ' ' + state : '');
    };
    return g;
  }
  function renderChecks(ul, list) { ul.replaceChildren(...list.map(([s, t]) => el('li', { class: s }, t))); }
  let toastTimer = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800); }
  async function copyText(text, okMsg) {
    try {
      if (IS_APP) await NATIVE.copy(text); else await navigator.clipboard.writeText(text);
      toast(okMsg || 'Copié dans le presse-papiers'); return true;
    } catch (e) { toast('Copie impossible : sélectionnez le texte et copiez-le manuellement.'); return false; }
  }
  async function download(name, text, mime) {
    if (IS_APP) {
      try { await NATIVE.saveAndShare(name, text, mime); }
      catch (e) { if (!/cancel/i.test(String(e && e.message))) toast(`Enregistrement impossible : ${e && e.message ? e.message : e}`); }
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
      const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`Téléchargement de ${name} demandé. S'il ne démarre pas, utilisez « Copier ».`);
    } catch (e) { toast('Téléchargement impossible ici : utilisez « Copier ».'); }
  }
  let modalClose = null;
  function modal(title, body, actions) {
    const root = $('#modal-root');
    const close = () => { root.replaceChildren(); document.removeEventListener('keydown', onKey); if (modalClose === close) modalClose = null; };
    modalClose = close;
    const onKey = e => { if (e.key === 'Escape') close(); };
    const acts = actions(close);
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, title ? el('h2', null, title) : null, body, acts === null ? null : el('div', { class: 'btn-row' }, ...acts, el('button', { class: 'btn', type: 'button', onclick: close }, 'Fermer')));
    const back = el('div', { class: 'modal-back', onclick: e => { if (e.target === back) close(); } }, box);
    root.replaceChildren(back);
    document.addEventListener('keydown', onKey);
    const f = TOUCH ? null : box.querySelector('textarea,button'); if (f) f.focus();
    return close;
  }
  // Bouton à double confirmation (les boîtes confirm() natives sont bloquées dans certains cadres)
  function confirmButton(label, confirmLabel, onConfirm, cls) {
    const b = el('button', { type: 'button', class: 'btn ' + (cls || '') }, label);
    let armed = 0;
    b.addEventListener('click', () => {
      if (armed) { clearTimeout(armed); armed = 0; b.textContent = label; onConfirm(); return; }
      b.textContent = confirmLabel;
      armed = setTimeout(() => { armed = 0; b.textContent = label; }, 3000);
    });
    return b;
  }

  /* ================= Graphiques 2D ================= */
  function drawChart(cv, o) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const padL = 38, padR = o.right ? 38 : 10, padT = 10, padB = 22;
    const pw = W - padL - padR, ph = H - padT - padB;
    const X = x => padL + (x - o.x[0]) / ((o.x[1] - o.x[0]) || 1) * pw;
    const Y = (y, ax) => padT + ph - (y - ax[0]) / ((ax[1] - ax[0]) || 1) * ph;
    g.font = '10px ' + (cssv('--font-mono') || 'monospace');
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + ph * i / 4;
      g.strokeStyle = C.line; g.beginPath(); g.moveTo(padL, y + 0.5); g.lineTo(W - padR, y + 0.5); g.stroke();
      g.fillStyle = C.muted; g.textAlign = 'right';
      g.fillText(o.left.fmt(o.left.range[1] - (o.left.range[1] - o.left.range[0]) * i / 4), padL - 5, y + 3);
      if (o.right) { g.textAlign = 'left'; g.fillText(o.right.fmt(o.right.range[1] - (o.right.range[1] - o.right.range[0]) * i / 4), W - padR + 5, y + 3); }
    }
    g.fillStyle = C.muted;
    for (let i = 0; i <= 4; i++) {
      const xv = o.x[0] + (o.x[1] - o.x[0]) * i / 4;
      g.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      g.fillText(o.xfmt(xv), X(xv), H - 6);
    }
    for (const s of o.series) {
      const ax = s.axis === 'right' ? o.right.range : o.left.range;
      if (!s.data.length) continue;
      if (s.fill) {
        g.beginPath(); g.moveTo(X(s.data[0][0]), Y(ax[0], ax));
        for (const [x, y] of s.data) g.lineTo(X(x), Y(clamp(y, ax[0], ax[1]), ax));
        g.lineTo(X(s.data[s.data.length - 1][0]), Y(ax[0], ax)); g.closePath();
        g.globalAlpha = 0.14; g.fillStyle = s.color; g.fill(); g.globalAlpha = 1;
      }
      g.beginPath(); g.strokeStyle = s.color; g.lineWidth = 1.8;
      s.data.forEach(([x, y], i) => { const px = X(x), py = Y(clamp(y, ax[0], ax[1]), ax); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke();
      const [lx, ly] = s.data[s.data.length - 1];
      if (s.dot !== false) { g.fillStyle = s.color; g.beginPath(); g.arc(X(lx), Y(clamp(ly, ax[0], ax[1]), ax), 2.8, 0, TAU); g.fill(); }
    }
    if (o.marker != null) {
      const mx = X(o.marker);
      g.strokeStyle = C.accent; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(mx + 0.5, padT); g.lineTo(mx + 0.5, padT + ph); g.stroke(); g.setLineDash([]);
    }
  }
  // Borne d'axe dont le quart est un pas « rond » (4 graduations lisibles)
  // Plage d'axe [bas, haut] en 4 pas « ronds »
  function niceRange(lo, hi) {
    if (hi - lo < 1e-9) hi = lo + 1;
    let step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)));
    for (const k of [1, 2, 2.5, 5, 10, 20, 25, 50]) { const st = step * k, a = Math.floor(lo / st) * st; if (a + 4 * st >= hi - 1e-9) return [a, a + 4 * st]; }
    return [lo, hi];
  }
  const niceMax = v => { if (v <= 0) return 1; const st = v / 4; const p = Math.pow(10, Math.floor(Math.log10(st))); const m = st / p; return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(x => x >= m - 1e-9) * p * 4; };

  /* ================= Moteur 3D ================= */
  let HAS3D = false;
  try { HAS3D = typeof THREE !== 'undefined' && !!(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')); } catch (e) { HAS3D = false; }
  const vp = $('#viewport-3d-container');
  let renderer = null, camera = null, controls = null, raycaster = null;
  const views = {};
  function showFallback(msg) {
    HAS3D = false;
    vp.append(el('div', { class: 'vp-fallback' }, el('div', null, el('strong', null, 'Vue 3D indisponible'), msg || 'WebGL ou la bibliothèque Three.js n\'a pas pu être chargé. Tous les calculs, la simulation et l\'entraînement restent utilisables dans le panneau.')));
  }
  function init3D() {
    if (!HAS3D) { showFallback(); return; }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) { showFallback(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TOUCH ? 1.75 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    vp.prepend(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Vue 3D interactive');
    camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08; controls.screenSpacePanning = true;
      controls.autoRotateSpeed = 0.8;
    }
    raycaster = new THREE.Raycaster();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(vp); else window.addEventListener('resize', resize);
    resize();
    renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); renderer = null; showFallback('Le contexte WebGL a été perdu (mémoire graphique saturée). Rechargez la page pour retrouver la vue 3D.'); });
    // Clic (distingué d'un glisser) et survol
    const resetBtn = el('button', { type: 'button', class: 'vp-reset', id: 'vp-reset', title: 'Revenir à la vue de départ (ou double-clic dans la vue)', onclick: () => { const v = views[S.ui.tab]; if (v) applyCam(v, true); } }, 'Recadrer la vue');
    vp.append(resetBtn);
    renderer.domElement.addEventListener('dblclick', () => { const v = views[S.ui.tab]; if (v) applyCam(v, true); });
    let down = null;
    const ndc = e => { const r = renderer.domElement.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, px: e.clientX - r.left, py: e.clientY - r.top }; };
    renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
      if (moved > 5 || e.button !== 0) return;
      const v = views[S.ui.tab]; if (v && v.onClick) { const p = ndc(e); raycaster.setFromCamera(p, camera); v.onClick(raycaster, p); }
    });
    let hoverQueued = false;
    renderer.domElement.addEventListener('pointermove', e => {
      const v = views[S.ui.tab]; if (!v || !v.onHover || hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => { hoverQueued = false; if (!renderer) return; const p = ndc(e); raycaster.setFromCamera(p, camera); v.onHover(raycaster, p); });
    });
    renderer.domElement.addEventListener('pointerleave', () => { const v = views[S.ui.tab]; if (v && v.onHover) v.onHover(null); });
  }
  function resize() {
    if (!renderer) return;
    const w = vp.clientWidth, h = vp.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const hex = c => new THREE.Color(c).convertSRGBToLinear();
  function mat(color, metal, rough, extra) { return new THREE.MeshStandardMaterial(Object.assign({ color: hex(color), metalness: metal == null ? 0.2 : metal, roughness: rough == null ? 0.6 : rough }, extra || {})); }
  function makeScene(fogNear, fogFar) {
    const s = new THREE.Scene();
    s.background = new THREE.Color('#121c2c');
    if (fogFar) s.fog = new THREE.Fog(0x121c2c, fogNear, fogFar);
    s.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a1410, 0.9));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(3, 6, 4); s.add(d);
    const r = new THREE.DirectionalLight(0x7fb8ff, 0.6); r.position.set(-5, 2, -4); s.add(r);
    return s;
  }
  function dispose(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    });
  }
  function label(text, color, size) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(9,14,22,.85)'; g.beginPath();
    if (g.roundRect) g.roundRect(8, 8, 112, 48, 12); else g.rect(8, 8, 112, 48);
    g.fill();
    g.fillStyle = color || '#fff'; g.font = '600 30px ' + (cssv('--font-mono') || 'monospace'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 33);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    sp.scale.set(size * 2, size, 1); sp.renderOrder = 10;
    return sp;
  }

  /* ---------- Hélice paramétrique (pales vrillées selon le pas) ---------- */
  function bladeGeometry(len, chord, thick, pitch, r0) {
    const span = len - r0;
    const geo = new THREE.BoxGeometry(span, thick, chord, 22, 1, 4);
    geo.translate(span / 2 + r0, 0, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const t = (x - r0) / span;
      const sc = t < 0.25 ? 0.6 + 1.6 * t : 1 - 0.75 * Math.pow((t - 0.25) / 0.75, 1.6);
      const z = pos.getZ(i) * sc, y = pos.getY(i) * (1 - 0.5 * t);
      const phi = clamp(Math.atan(pitch / (TAU * Math.max(x, r0 * 1.2))), -50 * DEG, 50 * DEG);
      pos.setY(i, z * Math.sin(phi) + y * Math.cos(phi));
      pos.setZ(i, z * Math.cos(phi) - y * Math.sin(phi) - 0.12 * chord * t * t);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function buildProp(c, scale, color, dir) {
    const R = c.propD * 1.27 * scale, chord = R * 0.22, thick = chord * 0.08, P = c.propP * 2.54 * scale;
    const hubR = Math.max(R * 0.09, 0.0035 * scale * 100);
    const g = new THREE.Group();
    const m = mat(color, 0.05, 0.4, { transparent: true, opacity: 0.93, side: THREE.DoubleSide });
    const geo = bladeGeometry(R, chord, thick, P * (dir < 0 ? -1 : 1), hubR);
    for (let b = 0; b < c.blades; b++) { const bl = new THREE.Mesh(geo, m); bl.rotation.y = b / c.blades * TAU; g.add(bl); }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, thick * 7, 24), m));
    return g;
  }

  /* ================= Vue 1 : moteur ================= */
  function buildMotor(c) {
    const W = DF.WINDINGS[c.winding];
    const R = c.statorD / 20, H = c.statorH / 10; // centimètres
    const g = new THREE.Group();
    const M = { base: mat('#2a3242', 0.7, 0.45), core: mat('#5b6576', 0.85, 0.38), bell: mat(C.accent, 0.7, 0.32, { side: THREE.DoubleSide, transparent: true, opacity: 1 }), magN: mat('#d6455d', 0.25, 0.5), magS: mat('#3f6fd8', 0.25, 0.5), shaft: mat('#cfd6df', 0.95, 0.18) };
    const baseR = R * 1.25 + 0.2, baseH = 0.25;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR * 1.04, baseH, 48), M.base); base.position.y = baseH / 2; g.add(base);
    for (let i = 0; i < 4; i++) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(baseR * 0.9, baseH * 0.8, baseR * 0.35), M.base);
      ear.position.set(Math.cos(i * TAU / 4 + TAU / 8) * baseR * 0.9, baseH * 0.4, Math.sin(i * TAU / 4 + TAU / 8) * baseR * 0.9);
      ear.rotation.y = -(i * TAU / 4 + TAU / 8); g.add(ear);
    }
    const stator = new THREE.Group(); stator.position.y = baseH; g.add(stator);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.4, R * 0.4, H, 32), M.core); hub.position.y = H / 2; stator.add(hub);
    const windings = [];
    const toothW = Math.max(0.04, TAU * R * 0.55 / W.slots * 0.42);
    const phaseCol = [C.phasea, C.phaseb, C.phasec];
    for (let i = 0; i < W.slots; i++) {
      const ang = i / W.slots * TAU;
      const t = new THREE.Group(); t.rotation.y = -ang; stator.add(t);
      const body = new THREE.Mesh(new THREE.BoxGeometry(R * 0.52, H, toothW), M.core); body.position.set(R * 0.64, H / 2, 0); t.add(body);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(R * 0.08, H, TAU * R * 0.95 / W.slots * 0.82), M.core); tip.position.set(R * 0.94, H / 2, 0); t.add(tip);
      const ch = W.pattern[i % W.pattern.length], ph = 'ABC'.indexOf(ch.toUpperCase());
      const wm = new THREE.MeshStandardMaterial({ color: hex('#b87333'), metalness: 0.85, roughness: 0.35, emissive: hex(phaseCol[ph]), emissiveIntensity: 0 });
      const coil = new THREE.Mesh(new THREE.BoxGeometry(R * 0.36, H * 1.12, toothW * 2.1), wm); coil.position.set(R * 0.66, H / 2, 0); t.add(coil);
      windings.push({ mat: wm, phase: ph, dir: ch === ch.toUpperCase() ? 1 : -1 });
    }
    const gap = 0.04, magT = Math.max(0.07, R * 0.09), wall = Math.max(0.06, R * 0.06);
    const rIn = R + gap, rOut = rIn + magT, rB = rOut + wall, bellH = H + 0.25;
    const rotor = new THREE.Group(); rotor.position.y = baseH; g.add(rotor);
    const bellG = new THREE.Group(); rotor.add(bellG);
    const bellWall = new THREE.Mesh(new THREE.CylinderGeometry(rB, rB, bellH, 64, 1, true), M.bell); bellWall.position.y = bellH / 2 + 0.02; bellG.add(bellWall);
    const bellTop = new THREE.Mesh(new THREE.CylinderGeometry(rB, rB, 0.16, 64), M.bell); bellTop.position.y = bellH + 0.1; bellG.add(bellTop);
    const rm = (rIn + rOut) / 2, arc = TAU * rm / W.poles * 0.8;
    for (let p = 0; p < W.poles; p++) {
      const ang = p / W.poles * TAU;
      const m = new THREE.Mesh(new THREE.BoxGeometry(magT, H * 0.96, arc), p % 2 ? M.magS : M.magN);
      m.position.set(Math.cos(ang) * rm, H / 2 + 0.02, Math.sin(ang) * rm); m.rotation.y = -ang; bellG.add(m);
    }
    const shaftR = c.statorD < 18 ? 0.075 : c.statorD < 35 ? 0.25 : 0.3;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, bellH + 1.0, 20), M.shaft); shaft.position.y = (bellH + 1.0) / 2 - 0.1; rotor.add(shaft);
    const propG = buildProp(c, 1, '#7fd3ff', 1); propG.position.y = bellH + 0.45;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(shaftR * 2.2, shaftR * 2.2, 0.35, 6), M.shaft); nut.position.y = 0.25; propG.add(nut);
    rotor.add(propG);
    return { group: g, rotor, stator, bellG, propG, bellMats: [M.bell], windings, R, H, propR: c.propD * 1.27, bellH };
  }
  const MV = { parts: null, angle: 0, explode: 0, needsFit: true };
  function setupMotorView() {
    const scene = makeScene();
    MV.scene = scene;
    MV.grid = null;
    views.motor = {
      scene, near: 0.05, far: 600, cam: null,
      hint: TOUCH ? 'Glisser : tourner · Pincer : zoomer · Deux doigts : déplacer' : 'Orbite : clic gauche · Déplacement : clic droit · Zoom : molette · Double-clic : recadrer',
      legend: () => [['Aimant N', '#d6455d'], ['Aimant S', '#3f6fd8'], ['Phase A', C.phasea], ['Phase B', C.phaseb], ['Phase C', C.phasec]],
      update: dt => {
        if (!MV.parts) return;
        const op = DF.operatingPoint(SUM.mp, S.ui.throttle);
        const visRate = Math.min(op.rpm / 60 * TAU / 140, 14);
        MV.angle += visRate * dt;
        MV.parts.rotor.rotation.y = MV.angle;
        const pp = DF.WINDINGS[S.cfg.winding].poles / 2;
        const th = MV.angle * pp;
        for (const w of MV.parts.windings) {
          const i = Math.sin(th - w.phase * TAU / 3) * w.dir;
          w.mat.emissiveIntensity = S.ui.phases && op.rpm > 0 ? 0.15 + 1.4 * Math.max(0, i) : 0;
        }
        const tgt = S.ui.explode ? 1 : 0;
        MV.explode += (tgt - MV.explode) * Math.min(1, dt * 6);
        const e = MV.explode, H = MV.parts.H;
        MV.parts.rotor.position.y = 0.25 + e * (H * 1.6 + 0.6);
        MV.parts.propG.position.y = MV.parts.bellH + 0.45 + e * (H * 1.2 + 0.8);
        MV.parts.stator.position.y = 0.25 + e * 0.3;
      },
    };
  }
  function rebuildMotor() {
    if (!HAS3D) return;
    if (MV.parts) { MV.scene.remove(MV.parts.group); dispose(MV.parts.group); }
    MV.parts = buildMotor(S.cfg);
    MV.scene.add(MV.parts.group);
    if (MV.grid) { MV.scene.remove(MV.grid); dispose(MV.grid); }
    const size = Math.ceil(MV.parts.propR * 2.4 / 2) * 2;
    MV.grid = new THREE.GridHelper(size, size, 0x2b3c56, 0x172235); MV.scene.add(MV.grid);
    applyMotorLook();
    if (MV.needsFit) {
      const d = S.ui.showProp === false ? MV.parts.R * 9 : Math.max(MV.parts.R * 11, MV.parts.propR * 1.15);
      views.motor.cam = { pos: [d * 0.62, d * 0.55, d * 0.72], target: [0, MV.parts.H * 0.8, 0] }; views.motor.home = null;
      if (S.ui.tab === 'motor') applyCam(views.motor);
      MV.needsFit = false;
    }
  }
  function applyMotorLook() {
    if (!MV.parts) return;
    for (const m of MV.parts.bellMats) { m.opacity = S.ui.cutaway ? 0.16 : 1; m.depthWrite = !S.ui.cutaway; m.needsUpdate = true; }
    MV.parts.propG.visible = S.ui.showProp !== false;
  }

  /* ---------- Modèle de drone complet (mètres) ---------- */
  function buildDrone(c, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const wb = c.wheelbase / 1000, L = wb / 2, a = L * Math.SQRT1_2, k = wb / 0.22;
    const carbon = mat('#1b2130', 0.35, 0.5), carbonTop = mat('#232b3b', 0.35, 0.45);
    const bellM = mat(C.accent, 0.7, 0.3), statorM = mat('#3a4354', 0.7, 0.4), pcb = mat('#141922', 0.2, 0.6), gold = mat('#c9a24a', 0.9, 0.3);
    const armT = 0.0045 * Math.sqrt(k), armW = 0.013 * k;
    const explode = [];
    const add = (obj, dy) => { g.add(obj); if (dy != null) explode.push({ obj, base: obj.position.clone(), dy }); return obj; };
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.05 * k, armT, 0.11 * k), carbon); bottom.position.y = armT / 2; add(bottom, 0);
    const pos = [[a, -a], [-a, a], [-a, -a], [a, a]];
    const spin = [1, 1, -1, -1];
    const props = [];
    const rM = c.statorD / 2000 * 1.38, hM = (c.statorH + 8) / 1000;
    pos.forEach(([x, z], i) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(L, armT, armW), carbon);
      arm.position.set(x / 2, armT / 2, z / 2); arm.rotation.y = -Math.atan2(z, x); add(arm, 0);
      const mg = new THREE.Group(); mg.position.set(x, armT, z);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(rM * 0.95, rM, hM * 0.35, 24), statorM); st.position.y = hM * 0.175; mg.add(st);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(rM, rM, hM * 0.65, 24), bellM); bell.position.y = hM * 0.35 + hM * 0.325; mg.add(bell);
      add(mg, 0.03 * k);
      const pg = new THREE.Group(); pg.position.set(x, armT + hM + 0.004, z);
      const blades = buildProp(c, 0.01, i < 2 ? '#7fd3ff' : '#9ef0c4', spin[i]); pg.add(blades);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(c.propD * 0.0127, 40), new THREE.MeshBasicMaterial({ color: i < 2 ? 0x7fd3ff : 0x9ef0c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2; pg.add(disc);
      add(pg, 0.07 * k);
      props.push({ g: blades, disc, dir: spin[i] });
    });
    const sw = c.wheelbase < 180 ? 0.025 : 0.036;
    const escB = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.0018, sw), pcb); escB.position.y = armT + 0.006; add(escB, 0.012 * k);
    const fcB = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.0016, sw), mat('#0f1d16', 0.2, 0.6)); fcB.position.y = armT + 0.016; add(fcB, 0.024 * k);
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.0015, 0.01), mat('#2a2f38', 0.3, 0.5)); chip.position.y = armT + 0.0175; add(chip, 0.024 * k);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.026, 10), gold); so.position.set(x * sw * 0.42, armT + 0.013, z * sw * 0.42); add(so, 0.03 * k);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.045 * k, armT * 0.8, 0.095 * k), carbonTop); top.position.y = armT + 0.028; add(top, 0.04 * k);
    const vol = SUM.bom.battMass / 1.9, bh = Math.cbrt(vol / 4.2) / 100;
    const batt = new THREE.Group(); batt.position.y = armT + 0.03 + bh / 2;
    batt.add(new THREE.Mesh(new THREE.BoxGeometry(bh * 1.4, bh, bh * 3), mat('#222935', 0.2, 0.7)));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(bh * 1.42, bh * 0.28, bh * 3.02), mat(C.accent, 0.3, 0.5)); batt.add(strip);
    add(batt, 0.065 * k);
    if (c.video !== 'none') {
      const cam = new THREE.Group(); cam.position.set(0, armT + 0.016, -0.05 * k);
      cam.add(new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.019, 0.016), mat('#1c2230', 0.4, 0.5)));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0065, 0.01, 18), mat('#0a0d12', 0.6, 0.2)); lens.rotation.x = Math.PI / 2; lens.position.z = -0.012; cam.add(lens);
      add(cam, 0.024 * k);
    }
    if (c.gps) {
      const gps = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 20), mat('#e6e9ee', 0.1, 0.6)); gps.position.set(0, armT + 0.045, 0.045 * k); add(gps, 0.09 * k);
    }
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.01 * k, 0.003, 0.004), new THREE.MeshBasicMaterial({ color: hex(C.accent) })); led.position.set(0, armT, -0.055 * k); add(led, 0);
    if (opts.scale) g.scale.setScalar(opts.scale);
    return { group: g, props, explode };
  }

  /* ================= Vue 2 : simulation de vol ================= */
  const SIMV = {};
  const sim = new DF.QuadSim(SUM), ap = new DF.Autopilot(), wind = new DF.Wind(11);
  let windVec = [0, 0, 0], simAcc = 0, simHist = [], simHistT = 0, simPaused = false;
  const keys = {};
  function setupSimView() {
    const scene = makeScene(30, 90);
    SIMV.scene = scene;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat('#0e1520', 0.1, 0.95)); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const grid = new THREE.GridHelper(24, 24, 0x2b3c56, 0x172235); grid.position.y = 0.002; scene.add(grid);
    const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(24, 0.01, 24)), new THREE.LineBasicMaterial({ color: hex(C.accent), transparent: true, opacity: 0.5 })); border.position.y = 0.01; scene.add(border);
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 48), new THREE.MeshBasicMaterial({ color: hex(C.accent), side: THREE.DoubleSide })); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.004; scene.add(pad);
    SIMV.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })); SIMV.shadow.rotation.x = -Math.PI / 2; SIMV.shadow.position.y = 0.006; scene.add(SIMV.shadow);
    SIMV.trailN = 600;
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SIMV.trailN * 3), 3)); tg.setDrawRange(0, 0);
    SIMV.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: hex(C.cyan), transparent: true, opacity: 0.7 })); SIMV.trail.frustumCulled = false; scene.add(SIMV.trail);
    SIMV.trailCount = 0; SIMV.trailT = 0;
    SIMV.wpGroup = new THREE.Group(); scene.add(SIMV.wpGroup);
    SIMV.windArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-10.5, 0.4, 10.5), 1.5, hex(C.warn).getHex(), 0.4, 0.25); scene.add(SIMV.windArrow);
    SIMV.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    views.simulation = {
      scene, near: 0.02, far: 300, zoomMax: 6, cam: { pos: [2.6, 1.8, 3.4], target: [0, 0.6, 0] },
      hint: () => S.sim.mode === 'manual' ? (TOUCH ? 'Manche gauche : altitude et cap · Manche droit : déplacement' : 'Manches à l\'écran, ou clavier ZQSD / WASD · R/F altitude · ←/→ cap') : (TOUCH ? 'Toucher le sol : déplacer le point sélectionné · Glisser : tourner' : 'Clic au sol : déplacer le point de passage sélectionné · Orbite : clic gauche'),
      legend: () => [['Trajectoire', C.cyan], ['Point actif', C.accent], ['Vent', C.warn]],
      update: dt => updateSimView(dt),
      onClick: (ray) => {
        const p = new THREE.Vector3();
        if (!ray.ray.intersectPlane(SIMV.plane, p)) return;
        const w = S.sim.waypoints[S.sim.sel]; if (!w) return;
        w[0] = +clamp(p.x, -11, 11).toFixed(2); w[2] = +clamp(p.z, -11, 11).toFixed(2);
        rebuildWaypoints(); renderWpList(); save();
      },
    };
  }
  function rebuildSimDrone() {
    if (!HAS3D) return;
    if (SIMV.drone) { SIMV.scene.remove(SIMV.drone.group); dispose(SIMV.drone.group); }
    SIMV.drone = buildDrone(S.cfg);
    SIMV.scene.add(SIMV.drone.group);
    SIMV.shadow.scale.setScalar(S.cfg.wheelbase / 1000 * 0.9);
  }
  function rebuildWaypoints() {
    if (!HAS3D) return;
    const G = SIMV.wpGroup;
    while (G.children.length) { const c = G.children.pop(); dispose(c); }
    const wps = S.sim.waypoints;
    wps.forEach((w, i) => {
      const sel = i === S.sim.sel;
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 14), new THREE.MeshStandardMaterial({ color: hex(sel ? C.accent : C.cyan), emissive: hex(sel ? C.accent : C.cyan), emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }));
      s.position.set(w[0], w[1], w[2]); s.userData.idx = i; G.add(s);
      const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(w[0], 0, w[2]), new THREE.Vector3(w[0], w[1], w[2])]), new THREE.LineDashedMaterial({ color: hex(C.muted), dashSize: 0.15, gapSize: 0.1 }));
      pole.computeLineDistances(); G.add(pole);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: hex(sel ? C.accent : C.cyan), side: THREE.DoubleSide, transparent: true, opacity: 0.6 })); ring.rotation.x = -Math.PI / 2; ring.position.set(w[0], 0.005, w[2]); G.add(ring);
      const lb = label(String(i + 1), sel ? C.accent : '#e8eef6', 0.35); lb.position.set(w[0], w[1] + 0.45, w[2]); G.add(lb);
    });
    if (wps.length > 1) {
      const pts = wps.concat([wps[0]]).map(w => new THREE.Vector3(w[0], w[1], w[2]));
      const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: hex(C.accent), dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.45 }));
      path.computeLineDistances(); G.add(path);
    }
    SIMV.wpMeshes = G.children.filter(c => c.userData.idx != null);
  }
  const STICK = { lx: 0, ly: 0, rx: 0, ry: 0 };
  const dz = v => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
  function simInputs() {
    const k = keys;
    const ax = (p, n) => (p ? 1 : 0) - (n ? 1 : 0);
    const mix = (key, stick) => clamp(key + dz(stick), -1, 1);
    return {
      mode: S.sim.mode, waypoints: S.sim.waypoints, accept: 0.5, vmax: S.sim.vmax, gains: S.sim.gains, noise: S.sim.noise, maxTilt: S.sim.maxTilt,
      tauA: AI.deployed ? AI.deployed.tauA : AI.agent.tauA, amax: AI.deployed ? AI.deployed.amax : DF.NAV.AMAX,
      policy: AI.deployed ? AI.deployed.fn : (o => AI.agent.policyMean(o)),
      manual: {
        fwd: mix(ax(k.KeyW || k.KeyZ, k.KeyS), -STICK.ry), right: mix(ax(k.KeyD, k.KeyA || k.KeyQ), STICK.rx),
        up: mix(ax(k.KeyR || k.Space || k.ArrowUp, k.KeyF || k.KeyC || k.ArrowDown || k.ShiftLeft), -STICK.ly), yaw: mix(ax(k.ArrowLeft, k.ArrowRight), -STICK.lx),
      },
    };
  }
  function simTick(dt) {
    if (simPaused) return;
    const H = 1 / 500;
    simAcc += dt;
    let n = 0;
    const inp = simInputs();
    while (simAcc >= H && n < 50) {
      windVec = wind.step(H, S.sim.wind, S.sim.windDir, S.sim.gust);
      const cmd = ap.step(sim, H, inp);
      sim.step(H, cmd, windVec, S.sim.infBattery);
      simAcc -= H; n++;
    }
    if (n >= 50) simAcc = 0;
    simHistT += dt;
    if (simHistT > 0.1) {
      simHistT = 0;
      simHist.push([sim.time, sim.p[1], Math.hypot(...sim.v)]);
      if (simHist.length > 200) simHist.shift();
    }
  }
  function updateSimView(dt) {
    if (!SIMV.drone) return;
    const d = SIMV.drone.group;
    d.position.set(sim.p[0], sim.p[1], sim.p[2]);
    d.quaternion.set(sim.q[1], sim.q[2], sim.q[3], sim.q[0]);
    SIMV.drone.props.forEach((p, i) => {
      const f = sim.T[i] / Math.max(1e-6, sim.Tmax);
      p.g.rotation.y += p.dir * Math.min(f * 120, 45) * dt;
      p.disc.material.opacity = clamp(f * 0.6, 0, 0.22);
      p.g.visible = f < 0.15;
    });
    SIMV.shadow.position.set(sim.p[0], 0.006, sim.p[2]);
    SIMV.shadow.material.opacity = clamp(0.5 - sim.p[1] * 0.04, 0.08, 0.5);
    SIMV.trailT += dt;
    if (sim.armed && SIMV.trailT > 0.05) {
      SIMV.trailT = 0;
      const arr = SIMV.trail.geometry.attributes.position.array;
      if (SIMV.trailCount < SIMV.trailN) SIMV.trailCount++; else arr.copyWithin(0, 3);
      const j = (SIMV.trailCount - 1) * 3; arr[j] = sim.p[0]; arr[j + 1] = sim.p[1]; arr[j + 2] = sim.p[2];
      SIMV.trail.geometry.attributes.position.needsUpdate = true; SIMV.trail.geometry.setDrawRange(0, SIMV.trailCount);
    }
    const wv = new THREE.Vector3(windVec[0], 0, windVec[2]); const wl = wv.length();
    SIMV.windArrow.visible = wl > 0.2;
    if (wl > 0.2) { SIMV.windArrow.setDirection(wv.normalize()); SIMV.windArrow.setLength(0.6 + wl * 0.3, 0.35, 0.22); }
    if (SIMV.wpMeshes) SIMV.wpMeshes.forEach(m => { const act = m.userData.idx === ap.wp % S.sim.waypoints.length && S.sim.mode !== 'manual'; m.scale.setScalar(act ? 1.35 + 0.15 * Math.sin(performance.now() / 180) : 1); });
    if (S.sim.follow && controls) {
      const t = new THREE.Vector3(sim.p[0], sim.p[1], sim.p[2]);
      const delta = t.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 4));
      controls.target.add(delta); camera.position.add(delta);
    }
  }
  function resetSim() {
    sim.configure(SUM); sim.reset(); ap.reset(); simHist = []; simAcc = 0;
    if (SIMV.trail) { SIMV.trailCount = 0; SIMV.trail.geometry.setDrawRange(0, 0); }
    updateBanner();
  }

  /* ================= Vue 3 : IA / PPO ================= */
  const AI = { agent: new DF.PPOAgent(1234), stats: new DF.PPOStats(), live: {}, gen: null, running: false, trained: false, hp: null, deployed: null };
  (function loadPolicy() {
    const j = store.get(POLICY_KEY);
    if (j && j.weights) { try { AI.agent.load(j.weights); AI.trained = true; AI.savedStats = j.stats || null; } catch (e) { store.del(POLICY_KEY); } }
  })();
  const AIV = { bots: [] };
  function setupAIView() {
    const scene = makeScene(35, 110);
    AIV.scene = scene;
    const grid = new THREE.GridHelper(16, 16, 0x2b3c56, 0x172235); scene.add(grid);
    AIV.origin = new THREE.Group(); AIV.origin.position.y = 4; scene.add(AIV.origin);
    const tgt = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 12, 48), new THREE.MeshBasicMaterial({ color: hex(C.accent) })); AIV.origin.add(tgt); AIV.target = tgt;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshBasicMaterial({ color: hex(C.accent) })); AIV.origin.add(core);
    const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -4, 0), new THREE.Vector3(0, 0, 0)]), new THREE.LineDashedMaterial({ color: hex(C.accent), dashSize: 0.2, gapSize: 0.15 })); beam.computeLineDistances(); AIV.origin.add(beam);
    for (let i = 0; i < 16; i++) {
      const col = new THREE.Color().setHSL(0.52 + i / 16 * 0.35, 0.7, 0.62);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 }));
      AIV.origin.add(b);
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 3), 3));
      const tr = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 })); tr.frustumCulled = false; AIV.origin.add(tr);
      AIV.bots.push({ b, tr });
    }
    views.ai = {
      scene, near: 0.05, far: 200, cam: { pos: [7, 7, 9], target: [0, 4, 0] },
      hint: '16 environnements en parallèle : chaque sphère apprend à rejoindre la cible orange',
      legend: () => [['Cible', C.accent], ['Agents (16 environnements)', C.cyan]],
      update: dt => {
        AIV.target.rotation.x += dt * 0.6; AIV.target.rotation.y += dt * 0.9;
        const envs = AI.live.envs;
        AIV.bots.forEach((o, i) => {
          const e = envs && envs[i];
          o.b.visible = o.tr.visible = !!e;
          if (!e) return;
          o.b.position.set(e.p[0], e.p[1], e.p[2]);
          const arr = o.tr.geometry.attributes.position.array, t = e.trail;
          for (let j = 0; j < t.length; j++) { arr[j * 3] = t[j][0]; arr[j * 3 + 1] = t[j][1]; arr[j * 3 + 2] = t[j][2]; }
          o.tr.geometry.setDrawRange(0, t.length); o.tr.geometry.attributes.position.needsUpdate = true;
        });
      },
    };
  }
  // Démo hors entraînement : la politique actuelle pilote les 16 agents
  const demo = { envs: null, rng: DF.mulberry32(5), t: 0 };
  function demoTick(dt) {
    if (AI.running) return;
    if (!demo.envs) { demo.envs = Array.from({ length: 16 }, () => new DF.NavEnv(demo.rng, AI.agent.tauA)); AI.live.envs = demo.envs; }
    demo.t += dt;
    while (demo.t >= DF.NAV.DT) {
      demo.t -= DF.NAV.DT;
      for (const e of demo.envs) {
        const r = e.step(AI.agent.policyMean(e.obs()));
        e.trail.push([e.p[0], e.p[1], e.p[2]]); if (e.trail.length > 30) e.trail.shift();
        if (r.done) e.reset();
      }
    }
  }
  function startTraining() {
    if (AI.running) return;
    if (!AI.gen) { if (AI.savedStats && !AI.stats.updates) AI.stats.updates = AI.savedStats.updates || 0; AI.hp = Object.assign({}, S.ai, { tauA: AI.trained ? AI.agent.tauA : DF.responseTau(SUM, S.sim.gains) }); AI.gen = DF.ppoTrainer(AI.agent, AI.hp, AI.stats, AI.live, (Date.now() & 0xffff) + 1); }
    AI.running = true; demo.envs = null;
    $('#tabbtn-ai').classList.add('busy');
    renderAIControls();
  }
  function pauseTraining() { AI.running = false; $('#tabbtn-ai').classList.remove('busy'); demo.envs = null; renderAIControls(); persistPolicy(); }
  function resetTraining() {
    AI.running = false; AI.gen = null; AI.agent = new DF.PPOAgent((Date.now() & 0xffff) + 7); AI.stats = new DF.PPOStats(); AI.live = {}; AI.trained = false; AI.savedStats = null; demo.envs = null;
    store.del(POLICY_KEY); $('#tabbtn-ai').classList.remove('busy');
    renderAIControls(); updateAIPanel(true); toast('Réseau réinitialisé');
  }
  function persistPolicy() { if (AI.stats.updates || AI.trained) store.set(POLICY_KEY, { weights: AI.agent.toJSON(), stats: { updates: AI.stats.updates || (AI.savedStats && AI.savedStats.updates) || 0, ok: AI.stats.successRate() } }); }
  function pumpTraining() {
    if (!AI.running || !AI.gen) return;
    if (AI.hp) Object.assign(AI.hp, S.ai);
    const end = performance.now() + (S.ui.tab === 'ai' ? 11 : 6);
    while (performance.now() < end) {
      const r = AI.gen.next();
      if (r.value === 2) {
        if (!AI.trained) { AI.trained = true; renderAIControls(); updateSimMode(); }
        if (AI.stats.updates % 5 === 0) persistPolicy();
      }
    }
  }

  /* ================= Vue 4 : carte mère ================= */
  const BV = { meshes: [], hovered: null, pulses: [] };
  function boardComponents(c) {
    const mcu = DF.MCU[c.mcu];
    const L = [
      { id: 'mcu', short: 'MCU', board: 'fc', label: `Microcontrôleur ${mcu.label}`, role: 'Exécute le firmware : fusion capteurs, boucle PID, mixage moteurs, OSD.', bus: `Cœur ARM Cortex-M, ${mcu.flashKB} Ko de flash`, power: `${mcu.mA} mA sous 3,3 V`, size: [mcu.size, 1.4, mcu.size], at: [-1, -1], color: '#2b313c', pins: true },
      { id: 'imu', short: 'IMU', board: 'fc', label: `Centrale inertielle ${c.imu}`, role: 'Gyroscope et accéléromètre 3 axes : mesure la rotation à chaque cycle de la boucle.', bus: `SPI 24 MHz, gyro jusqu'à ${fmtN(DF.IMU[c.imu].gyroKHz, 1)} kHz`, power: '1 mA sous 3,3 V', size: [3, 0.9, 3], at: [9, 8], color: '#3a414d' },
      { id: 'baro', short: 'Baromètre', board: 'fc', label: 'Baromètre DPS310', role: 'Mesure la pression pour le maintien d\'altitude.', bus: 'I²C 400 kHz', power: '0,5 mA', size: [2.5, 0.9, 2], at: [-10, 9], color: '#c7c9cc' },
      { id: 'flash', short: 'Blackbox', board: 'fc', label: 'Mémoire flash 16 Mo', role: 'Enregistre la blackbox (gyro, consignes, moteurs) pour le réglage des filtres.', bus: 'SPI', power: '15 mA en écriture', size: [8, 1, 6], at: [-9, -9], color: '#24292f' },
      { id: 'bec5', short: 'BEC 5 V', board: 'fc', label: 'Régulateur 5 V / 2 A', role: 'Alimente le récepteur, la caméra et le GPS depuis la batterie.', bus: 'Convertisseur abaisseur', power: `${SUM.elec.rails['5V'].mA} mA demandés`, size: [3, 1, 3], at: [13, 1], color: '#2b313c' },
      { id: 'ind5', short: 'Self 5 V', board: 'fc', label: 'Inductance 5 V', role: 'Stocke l\'énergie du convertisseur 5 V.', bus: '—', power: '—', size: [4, 2, 4], at: [13, -4], color: '#3b3f46' },
      { id: 'bec10', short: 'BEC 10 V', board: 'fc', label: 'Régulateur 10 V / 2 A', role: 'Alimente l\'émetteur vidéo avec une tension propre.', bus: 'Convertisseur abaisseur', power: `${SUM.elec.rails['10V'].mA} mA demandés`, size: [3, 1, 3], at: [-13, 1], color: '#2b313c' },
      { id: 'ind10', short: 'Self 10 V', board: 'fc', label: 'Inductance 10 V', role: 'Stocke l\'énergie du convertisseur 10 V.', bus: '—', power: '—', size: [4, 2, 4], at: [-13, -4], color: '#3b3f46' },
      { id: 'xtal', short: 'Quartz', board: 'fc', label: 'Quartz 8 MHz', role: 'Horloge de référence du microcontrôleur.', bus: '—', power: '—', size: [3.2, 0.8, 2.5], at: [5, -10], color: '#d6d9de' },
      { id: 'usb', short: 'USB-C', board: 'fc', label: 'Connecteur USB-C', role: 'Configuration et flash du firmware.', bus: 'USB 2.0 Full Speed', power: '—', size: [9, 3.2, 3.6], at: [0, 16], color: '#c8ccd3', metal: true },
      { id: 'jesc', short: 'Prise ESC', board: 'fc', label: 'Connecteur ESC 8 broches', role: 'Signaux DShot des 4 moteurs, télémétrie, mesure de courant et tension.', bus: 'DShot600 bidirectionnel', power: '—', size: [9, 4, 3], at: [0, -15.5], color: '#e9e4d6' },
      { id: 'jrx', short: 'Prise RX', board: 'fc', label: 'Connecteur récepteur', role: 'Liaison radio ExpressLRS.', bus: 'UART CRSF 420 kbit/s', power: '110 mA sous 5 V', size: [5, 4, 3], at: [-13, 14.5], color: '#e9e4d6' },
      { id: 'led', short: 'LED', board: 'fc', label: 'LED d\'état', role: 'Indique l\'armement et les erreurs.', bus: 'GPIO', power: '2 mA', size: [1.6, 0.6, 0.8], at: [6, 12.5], color: C.good, glow: true },
      { id: 'boot', short: 'BOOT', board: 'fc', label: 'Bouton BOOT', role: 'Force le mode DFU pour réinstaller le firmware.', bus: 'GPIO', power: '—', size: [3, 1.2, 2], at: [-5, 12.5], color: '#cfd3da' },
    ];
    if (c.video === 'analog') L.push({ id: 'osd', short: 'OSD', board: 'fc', label: 'Puce OSD AT7456E', role: 'Incruste la télémétrie dans l\'image analogique.', bus: 'SPI', power: '25 mA', size: [7, 1.2, 7], at: [9, -2], color: '#24292f' });
    if (c.video !== 'none') L.push({ id: 'jvtx', short: 'Prise vidéo', board: 'fc', label: 'Connecteur vidéo', role: c.video === 'hd' ? 'Liaison avec le système vidéo HD (OSD MSP).' : 'Caméra et émetteur vidéo, contrôle SmartAudio.', bus: c.video === 'hd' ? 'UART MSP DisplayPort' : 'Vidéo composite + UART', power: c.video === 'hd' ? '9 W sur la batterie' : '330 mA sous 10 V', size: [6.5, 4, 3], at: [13, 14.5], color: '#e9e4d6' });
    if (c.gps) L.push({ id: 'jgps', short: 'Prise GPS', board: 'fc', label: 'Connecteur GPS', role: 'Module GNSS et compas.', bus: 'UART + I²C', power: '55 mA sous 5 V', size: [5, 4, 3], at: [-13, -15], color: '#e9e4d6' });
    // Carte ESC 4-en-1
    const esc = DF.ESC[c.esc];
    [[1, -1], [-1, 1], [-1, -1], [1, 1]].forEach(([sx, sz], m) => {
      for (let i = 0; i < 6; i++) {
        L.push({ id: `fet-${m}-${i}`, short: 'MOSFET', group: 'fet', board: 'esc', label: `MOSFET moteur ${m + 1}`, role: 'Demi-pont de puissance : commute une phase du moteur entre + et − batterie.', bus: '3 phases × 2 transistors par moteur', power: `${c.esc} A continus par moteur`, size: [3.3, 1, 3.3], at: [sx * (7 + (i % 3) * 3.7), sz * (8.5 + Math.floor(i / 3) * 4.2)], color: '#1e2228' });
      }
      L.push({ id: `escmcu-${m}`, short: 'MCU ESC', group: 'escmcu', board: 'esc', label: `Contrôleur ESC moteur ${m + 1}`, role: 'Génère la commutation des phases à partir de la consigne DShot.', bus: 'Firmware AM32 / BLHeli_32', power: '15 mA', size: [4, 0.9, 4], at: [sx * 3, sz * 4], color: '#2b313c' });
    });
    L.push({ id: 'shunt', short: 'Shunt', board: 'esc', label: 'Shunt de mesure de courant', role: 'Mesure le courant total consommé.', bus: 'Analogique vers le contrôleur de vol', power: `${Math.round(SUM.full.Ibat * 4)} A en pointe`, size: [6, 0.6, 3], at: [0, 0], color: '#c9a24a', metal: true });
    L.push({ id: 'cap', short: 'Condensateur', board: 'esc', label: `Condensateur 1000 µF ${S.cfg.cells >= 5 ? 50 : 35} V`, role: 'Absorbe les pics de tension générés par la commutation des moteurs.', bus: '—', power: '—', cap: true, at: [0, 26], color: '#2d3442' });
    L.push({ id: 'escinfo', short: 'ESC', board: 'esc', label: `ESC 4-en-1 ${c.esc} A`, role: `Convertit la batterie ${c.cells}S en trois phases pour chaque moteur.`, bus: `${esc.maxS}S maximum`, power: `${c.esc} A par moteur`, hidden: true });
    return L;
  }
  function buildBoard(c) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    const s = 18, r = 3;
    shape.moveTo(-s + r, -s); shape.lineTo(s - r, -s); shape.quadraticCurveTo(s, -s, s, -s + r); shape.lineTo(s, s - r); shape.quadraticCurveTo(s, s, s - r, s); shape.lineTo(-s + r, s); shape.quadraticCurveTo(-s, s, -s, s - r); shape.lineTo(-s, -s + r); shape.quadraticCurveTo(-s, -s, -s + r, -s);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const h = new THREE.Path(); h.absarc(x * 15.25, z * 15.25, 1.6, 0, TAU, true); shape.holes.push(h); }
    const pcbGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 16 });
    pcbGeo.rotateX(-Math.PI / 2);
    const fc = new THREE.Group(), esc = new THREE.Group();
    fc.add(new THREE.Mesh(pcbGeo, mat('#0f1a14', 0.25, 0.55)));
    esc.add(new THREE.Mesh(pcbGeo.clone(), mat('#111823', 0.25, 0.55)));
    const gold = mat('#c9a24a', 0.95, 0.28);
    for (const grp of [fc, esc]) for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 24), gold); ring.rotation.x = -Math.PI / 2; ring.position.set(x * 15.25, 1.62, z * 15.25); grp.add(ring);
    }
    // Pads moteurs et batterie sur l'ESC
    [[1, -1], [-1, 1], [-1, -1], [1, 1]].forEach(([sx, sz]) => { for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 3.2), gold); p.position.set(sx * 16.4, 1.65, sz * (4 + i * 3.6)); esc.add(p); } });
    for (const x of [-4, 4]) { const p = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 4), gold); p.position.set(x, 1.68, 15); esc.add(p); }
    fc.position.y = 10; g.add(fc, esc);
    // Entretoises et silent-blocs
    const standMat = mat('#c9a24a', 0.9, 0.3), grom = mat('#3a2a26', 0.1, 0.8);
    const stands = [];
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 8.4, 16), standMat); st.position.set(x * 15.25, 5.8, z * 15.25); g.add(st); stands.push(st);
      const gr = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.6, 10, 24), grom); gr.rotation.x = Math.PI / 2; gr.position.set(x * 15.25, 11.9, z * 15.25); g.add(gr); stands.push(gr);
    }
    const comps = boardComponents(c), meshes = [];
    for (const cp of comps) {
      if (cp.hidden) continue;
      const parent = cp.board === 'fc' ? fc : esc;
      let m;
      if (cp.cap) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 16, 28), mat(cp.color, 0.4, 0.4));
        m.rotation.x = Math.PI / 2; m.position.set(0, 5, cp.at[1]);
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(5.05, 5.05, 3, 28), mat(C.accent, 0.3, 0.5)); sleeve.position.y = 6; m.add(sleeve);
      } else {
        m = new THREE.Mesh(new THREE.BoxGeometry(cp.size[0], cp.size[1], cp.size[2]), cp.glow ? new THREE.MeshStandardMaterial({ color: hex(cp.color), emissive: hex(cp.color), emissiveIntensity: 1.2 }) : mat(cp.color, cp.metal ? 0.9 : 0.25, cp.metal ? 0.3 : 0.55));
        m.position.set(cp.at[0], 1.6 + cp.size[1] / 2, cp.at[1]);
        if (cp.pins) {
          const pinM = mat('#b9c0c9', 0.95, 0.25), n = 16, sz = cp.size[0];
          for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
            const pin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 1.1), pinM);
            const off = -sz / 2 + (i + 0.5) * sz / n;
            if (side === 0) pin.position.set(off, -0.6, sz / 2 + 0.5); else if (side === 1) pin.position.set(off, -0.6, -sz / 2 - 0.5);
            else { pin.rotation.y = Math.PI / 2; pin.position.set(side === 2 ? sz / 2 + 0.5 : -sz / 2 - 0.5, -0.6, off); }
            m.add(pin);
          }
          const dot = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), mat('#4b5260')); dot.rotation.x = -Math.PI / 2; dot.position.set(-sz / 2 + 1.2, 0.71, -sz / 2 + 1.2); m.add(dot);
        }
      }
      m.userData.comp = cp; m.userData.baseEmissive = m.material.emissive ? m.material.emissive.clone() : null;
      parent.add(m); meshes.push(m);
    }
    // Liaisons de signaux (impulsions animées)
    const at = id => { const cp = comps.find(x => x.id === id); return cp ? new THREE.Vector3(cp.at[0], cp.board === 'fc' ? 13 : 3, cp.at[1]) : null; };
    const links = [['imu', 'mcu', C.cyan, 'SPI'], ['baro', 'mcu', C.good, 'I²C'], ['flash', 'mcu', C.cyan, 'SPI'], ['jrx', 'mcu', C.phasec, 'UART'], ['mcu', 'jesc', C.accent, 'DShot'], ['jvtx', 'mcu', C.phasec, 'UART'], ['jgps', 'mcu', C.phasec, 'UART'], ['osd', 'mcu', C.cyan, 'SPI'], ['usb', 'mcu', C.warn, 'USB']];
    const signals = new THREE.Group(); fc.add(signals);
    const pulses = [];
    for (const [a, b, col] of links) {
      const A = at(a), B = at(b); if (!A || !B) continue;
      A.y = 1.75; B.y = 1.75;
      const mid = A.clone().lerp(B, 0.5); mid.y = 4.5;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(30)), new THREE.LineBasicMaterial({ color: hex(col), transparent: true, opacity: 0.5 }));
      signals.add(line);
      for (let k = 0; k < 2; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: hex(col) })); signals.add(p); pulses.push({ p, curve, t: k / 2 + Math.random() * 0.1, speed: a === 'imu' || b === 'jesc' ? 0.9 : 0.4 }); }
    }
    // Liaison DShot vers l'ESC : suit l'écartement de la pile
    const ds = new THREE.Group(); g.add(ds);
    const dsLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: hex(C.accent), transparent: true, opacity: 0.5 }));
    dsLine.position.set(0, 1.7, -15.5); ds.add(dsLine);
    const dsP = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: hex(C.accent) })); ds.add(dsP);
    return { group: g, fc, esc, stands, meshes, comps, signals, pulses, ds: { g: ds, line: dsLine, p: dsP, t: 0 } };
  }
  function setupBoardView() {
    const scene = makeScene();
    BV.scene = scene;
    const grid = new THREE.GridHelper(80, 16, 0x2b3c56, 0x172235); grid.position.y = -0.2; scene.add(grid);
    BV.explode = 0;
    views.motherboard = {
      scene, near: 0.5, far: 2000, cam: { pos: [42, 48, 54], target: [0, 6, 0] },
      hint: TOUCH ? 'Touchez un composant pour l\'identifier' : 'Survolez ou cliquez un composant pour l\'identifier',
      legend: () => [['SPI', C.cyan], ['I²C', C.good], ['UART', C.phasec], ['DShot', C.accent], ['USB', C.warn]],
      update: dt => {
        if (!BV.parts) return;
        const tgt = S.ui.boardExplode ? 1 : 0;
        BV.explode += (tgt - BV.explode) * Math.min(1, dt * 5);
        BV.parts.fc.position.y = 10 + BV.explode * 16;
        BV.parts.stands.forEach(s => { s.visible = BV.explode < 0.5; });
        BV.parts.signals.visible = BV.parts.ds.g.visible = S.ui.signals;
        if (S.ui.signals) {
          for (const p of BV.parts.pulses) { p.t = (p.t + dt * p.speed) % 1; p.p.position.copy(p.curve.getPoint(p.t)); }
          const ds = BV.parts.ds, top = BV.parts.fc.position.y + 1.75;
          ds.line.scale.y = top - 1.7; ds.t = (ds.t + dt * 0.9) % 1;
          ds.p.position.set(0, top - (top - 1.7) * ds.t, -15.5);
        }
      },
      onHover: (ray, p) => {
        const tip = $('#vp-tip');
        const hit = ray ? ray.intersectObjects(BV.parts ? BV.parts.meshes : [], false)[0] : null;
        setHover(hit ? hit.object : null);
        if (hit) { const cp = hit.object.userData.comp; tip.replaceChildren(el('b', null, cp.label), el('span', null, cp.bus)); tip.style.left = p.px + 'px'; tip.style.top = p.py + 'px'; tip.hidden = false; renderer.domElement.style.cursor = 'pointer'; }
        else { tip.hidden = true; if (renderer) renderer.domElement.style.cursor = ''; }
      },
      onClick: ray => {
        const hit = ray.intersectObjects(BV.parts ? BV.parts.meshes : [], false)[0];
        if (hit) { const cp = hit.object.userData.comp; S.board.selected = cp.group || cp.id; save(); renderBoardInfo(); highlightSelected(); }
      },
    };
  }
  function setHover(m) {
    if (BV.hovered === m) return;
    const restore = x => { if (x && x.material.emissive) { const sel = isSelected(x); x.material.emissive.copy(sel ? hex(C.accent) : x.userData.baseEmissive); x.material.emissiveIntensity = sel ? 0.35 : (x.userData.comp.glow ? 1.2 : 1); } };
    restore(BV.hovered);
    BV.hovered = m;
    if (m && m.material.emissive) { m.material.emissive.set(hex(C.cyan)); m.material.emissiveIntensity = 0.45; }
  }
  const isSelected = m => { const cp = m.userData.comp; return (cp.group || cp.id) === S.board.selected; };
  function highlightSelected() {
    if (!BV.parts) return;
    for (const m of BV.parts.meshes) {
      if (!m.material.emissive) continue;
      const sel = isSelected(m);
      m.material.emissive.copy(sel ? hex(C.accent) : m.userData.baseEmissive);
      m.material.emissiveIntensity = sel ? 0.35 : (m.userData.comp.glow ? 1.2 : 1);
    }
  }
  function rebuildBoard() {
    if (!HAS3D) return;
    if (BV.parts) { BV.scene.remove(BV.parts.group); dispose(BV.parts.group); BV.hovered = null; }
    BV.parts = buildBoard(S.cfg);
    BV.scene.add(BV.parts.group);
    highlightSelected();
  }

  /* ================= Vue 5 : production ================= */
  const PV = {};
  function setupProdView() {
    const scene = makeScene();
    PV.scene = scene;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), mat('#111a27', 0.2, 0.9)); disc.rotation.x = -Math.PI / 2; disc.position.y = -0.001; scene.add(disc); PV.disc = disc;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 96), new THREE.MeshBasicMaterial({ color: hex(C.accent), side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; scene.add(ring); PV.ring = ring;
    PV.ex = 0;
    views.production = {
      scene, near: 0.005, far: 50, cam: null,
      hint: TOUCH ? 'Vue éclatée réglable dans le panneau · Glisser : tourner' : 'Vue éclatée réglable dans le panneau · Orbite : clic gauche',
      legend: () => [],
      update: dt => {
        if (!PV.drone) return;
        PV.ex += (S.ui.prodExplode - PV.ex) * Math.min(1, dt * 6);
        for (const e of PV.drone.explode) e.obj.position.y = e.base.y + e.dy * PV.ex * 2.2;
        PV.drone.props.forEach(p => { p.g.visible = true; p.disc.material.opacity = 0; });
        if (controls) controls.autoRotate = S.ui.autoRotate && S.ui.tab === 'production';
      },
    };
  }
  function rebuildProdDrone() {
    if (!HAS3D) return;
    if (PV.drone) { PV.scene.remove(PV.drone.group); dispose(PV.drone.group); }
    PV.drone = buildDrone(S.cfg);
    PV.scene.add(PV.drone.group);
    const wb = S.cfg.wheelbase / 1000;
    const r = wb * 0.5 + S.cfg.propD * 0.0127 + 0.02;
    PV.disc.scale.setScalar(r * 1.15); PV.ring.scale.setScalar(r * 1.15);
    const d = r * 3.2;
    const fresh = { pos: [d * 0.7, d * 0.6, d * 0.8], target: [0, wb * 0.12, 0] };
    if (!views.production.cam || PV.lastWb !== S.cfg.wheelbase) { views.production.cam = fresh; views.production.home = null; if (S.ui.tab === 'production') applyCam(views.production); }
    PV.lastWb = S.cfg.wheelbase;
  }

  /* ================= Caméra par onglet ================= */
  function applyCam(v, home) {
    if (!camera || !v) return;
    const okCam = c => c && Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]) > 1e-3;
    if (!v.home && okCam(v.cam)) v.home = JSON.parse(JSON.stringify(v.cam));
    if (!okCam(v.cam) && v.home) v.cam = JSON.parse(JSON.stringify(v.home));
    if (home && v.home) v.cam = JSON.parse(JSON.stringify(v.home));
    if (!v.cam) return;
    if (controls && v.home) {
      const d = Math.hypot(v.home.pos[0] - v.home.target[0], v.home.pos[1] - v.home.target[1], v.home.pos[2] - v.home.target[2]);
      controls.minDistance = d * 0.12; controls.maxDistance = d * (v.zoomMax || 4);
      controls.maxPolarAngle = Math.PI * 0.49;
    }
    camera.near = v.near; camera.far = v.far; camera.updateProjectionMatrix();
    camera.position.fromArray(v.cam.pos);
    if (controls) { controls.target.fromArray(v.cam.target); controls.update(); } else camera.lookAt(new THREE.Vector3().fromArray(v.cam.target));
  }
  let camTab = null; // onglet dont la caméra est réellement affichée
  function storeCam(v) { if (camera && v) v.cam = { pos: camera.position.toArray(), target: controls ? controls.target.toArray() : v.cam.target }; }

  /* ================= En-tête ================= */
  function updateHeader() {
    const c = S.cfg;
    $('#header-preset-name').textContent = c.preset !== 'custom' && DF.PRESETS[c.preset] ? DF.PRESETS[c.preset].label : `Personnalisé ${SUM.designation}`;
    $('#header-kv').textContent = `${SUM.designation} · ${fmtN(c.kv)} Kv`;
    $('#header-thrust').textContent = `${fmtN(SUM.thrustMaxG)} g`;
    const twr = $('#header-twr');
    twr.textContent = `${fmtN(SUM.twr, 1)} : 1 · ${fmtN(SUM.auwG)} g`;
    twr.style.color = SUM.twr < 1.4 ? C.bad : SUM.twr < 2 ? C.warn : C.fg;
    $('#header-voltage').textContent = `${fmtN(c.cells * 3.7, 1)} V (${c.cells}S) · ${fmtN(c.capacity)} mAh`;
  }

  /* ================= Panneau 1 : moteur ================= */
  const MP = {};
  function buildMotorPanel() {
    const root = $('#tab-motor');
    const c = S.cfg;
    const markCustom = () => { if (S.cfg.preset !== 'custom') { S.cfg.preset = 'custom'; MP.preset.set('custom'); } };
    const p = (key, label, min, max, step, fmt, scope) => range({ id: 'm-' + key, label, min, max, step, value: c[key], fmt, onInput: v => { S.cfg[key] = v; markCustom(); changed(scope || 'motor'); } });
    MP.preset = select({ id: 'm-preset', label: 'Préréglage', value: c.preset, options: Object.entries(DF.PRESETS).map(([k, v]) => [k, v.label]).concat([['custom', 'Personnalisé']]), onChange: v => { if (v === 'custom') return; DF.applyPreset(S.cfg, v); MV.needsFit = true; syncMotorControls(); changed('all'); toast(`Préréglage « ${DF.PRESETS[v].label} » chargé`); } });
    MP.ctl = {
      statorD: p('statorD', 'Diamètre du stator', 10, 50, 1, v => `${v} mm`),
      statorH: p('statorH', 'Hauteur du stator', 3, 20, 0.5, v => `${fmtN(v, 1)} mm`),
      kv: p('kv', 'Constante Kv', 150, 6000, 10, v => `${fmtN(v)} tr/min/V`),
      propD: p('propD', 'Diamètre d\'hélice', 2, 18, 0.1, v => `${fmtN(v, 1)} po · ${Math.round(v * 25.4)} mm`),
      propP: p('propP', 'Pas d\'hélice', 1, 10, 0.1, v => `${fmtN(v, 1)} po`),
      blades: p('blades', 'Nombre de pales', 2, 5, 1, v => `${v}`),
      cells: p('cells', 'Cellules LiPo', 2, 8, 1, v => `${v}S · ${fmtN(v * 3.7, 1)} V`, 'all'),
      capacity: p('capacity', 'Capacité', 300, 16000, 50, v => `${fmtN(v)} mAh`, 'all'),
      wheelbase: p('wheelbase', 'Empattement du châssis', 80, 1000, 5, v => `${v} mm`, 'all'),
      frameMass: p('frameMass', 'Masse du châssis', 15, 2000, 5, v => `${v} g`, 'all'),
    };
    MP.winding = select({ id: 'm-winding', label: 'Bobinage', value: c.winding, options: Object.keys(DF.WINDINGS).map(k => [k, `${k} (${DF.WINDINGS[k].slots} encoches, ${DF.WINDINGS[k].poles} aimants)`]), onChange: v => { S.cfg.winding = v; markCustom(); changed('motor'); } });
    MP.kpis = kpiGrid([
      { id: 'rpm', label: 'Régime', unit: 'tr/min' }, { id: 'thrust', label: 'Poussée / moteur', unit: 'g' },
      { id: 'cur', label: 'Courant moteur', unit: 'A' }, { id: 'pow', label: 'Puissance élec.', unit: 'W' },
      { id: 'gw', label: 'Rendement', unit: 'g/W' }, { id: 'eff', label: 'Rendement moteur', unit: '%' },
      { id: 'temp', label: 'Température régime', unit: '°C' }, { id: 'tip', label: 'Bout de pale', unit: 'Mach' },
    ]);
    MP.sumK = kpiGrid([
      { id: 'auw', label: 'Masse au décollage', unit: 'g' }, { id: 'twr', label: 'Poussée / poids', unit: ': 1' },
      { id: 'hover', label: 'Gaz stationnaire', unit: '%' }, { id: 'time', label: 'Autonomie stat.', unit: 'min' },
    ]);
    MP.chart = el('canvas', { class: 'chart', role: 'img', 'aria-label': 'Courbes de poussée et de courant selon les gaz' });
    MP.checks = el('ul', { class: 'checks' });
    MP.throttle = range({ id: 'm-throttle', label: 'Gaz appliqués', min: 0, max: 1, step: 0.01, value: S.ui.throttle, fmt: v => `${Math.round(v * 100)} %`, onInput: v => { S.ui.throttle = v; save(); updateMotorPanel(); } });
    root.append(
      head('Atelier moteur', 'Dimensionnez moteur, hélice et batterie. Le point de fonctionnement est calculé par équilibre entre le couple moteur et le couple résistant de l\'hélice.'),
      sec('Configuration', null, MP.preset),
      sec('Banc d\'essai', null, MP.throttle, MP.kpis, MP.chart,
        el('div', { class: 'legend-row' }, el('span', null, el('i', { style: `background:${C.good}` }), 'Poussée par moteur (g)'), el('span', null, el('i', { style: `background:${C.warn}` }), 'Courant batterie (A)'), el('span', null, el('i', { style: `background:${C.accent}` }), 'Gaz appliqués'))),
      sec('Bilan du drone', null, MP.sumK, MP.checks),
      sec('Stator & bobinage', null, MP.ctl.statorD, MP.ctl.statorH, MP.ctl.kv, MP.winding),
      sec('Hélice', null, MP.ctl.propD, MP.ctl.propP, MP.ctl.blades),
      sec('Batterie & châssis', null, MP.ctl.cells, MP.ctl.capacity, MP.ctl.wheelbase, MP.ctl.frameMass),
      sec('Affichage 3D', null,
        toggle({ id: 'm-explode', label: 'Vue éclatée', checked: S.ui.explode, onChange: v => { S.ui.explode = v; save(); } }),
        toggle({ id: 'm-prop', label: 'Afficher l\'hélice', checked: S.ui.showProp !== false, onChange: v => { S.ui.showProp = v; applyMotorLook(); save(); } }),
        toggle({ id: 'm-cutaway', label: 'Cloche transparente (coupe)', checked: S.ui.cutaway, onChange: v => { S.ui.cutaway = v; applyMotorLook(); save(); } }),
        toggle({ id: 'm-phases', label: 'Commutation des phases animée', checked: S.ui.phases, onChange: v => { S.ui.phases = v; save(); } }),
        el('p', { class: 'note' }, 'La rotation est ralentie environ 140 fois pour rester lisible. Les bobines s\'allument selon le courant de leur phase, synchronisé sur l\'angle électrique du rotor.')),
    );
  }
  function syncMotorControls() {
    for (const k in MP.ctl) MP.ctl[k].set(S.cfg[k]);
    MP.winding.set(S.cfg.winding); MP.preset.set(S.cfg.preset);
    if (BP.sel) { BP.sel.mcu.set(S.cfg.mcu); BP.sel.imu.set(S.cfg.imu); BP.sel.esc.set(S.cfg.esc); BP.sel.fw.set(S.cfg.firmware); BP.sel.video.set(S.cfg.video); BP.sel.gps.set(S.cfg.gps); }
  }
  function updateMotorPanel() {
    const op = DF.operatingPoint(SUM.mp, S.ui.throttle);
    const K = MP.kpis;
    K.setK('rpm', fmtN(op.rpm));
    K.setK('thrust', fmtN(op.thrustG));
    K.setK('cur', fmtN(op.Im, 1), op.Im > S.cfg.esc ? 'bad' : op.Im > S.cfg.esc * 0.85 ? 'warn' : '');
    K.setK('pow', fmtN(op.Pel));
    K.setK('gw', fmtN(op.gw, 2));
    K.setK('eff', fmtN(op.eff * 100));
    K.setK('temp', fmtN(op.temp), op.temp > 110 ? 'bad' : op.temp > 90 ? 'warn' : '');
    K.setK('tip', fmtN(op.tip, 2), op.tip > 0.75 ? 'bad' : op.tip > 0.62 ? 'warn' : '');
    const s = MP.sumK;
    s.setK('auw', fmtN(SUM.auwG));
    s.setK('twr', fmtN(SUM.twr, 1), SUM.twr < 1.4 ? 'bad' : SUM.twr < 2 ? 'warn' : 'good');
    s.setK('hover', SUM.hover ? fmtN(SUM.hover.throttle * 100) : '—', SUM.hover && SUM.hover.throttle > 0.7 ? 'warn' : '');
    s.setK('time', SUM.hover ? fmtN(SUM.flightMin, 1) : '—');
    renderChecks(MP.checks, DF.motorChecks(SUM));
    const thr = [], cur = [];
    for (let i = 0; i <= 40; i++) { const o = DF.operatingPoint(SUM.mp, i / 40); thr.push([i / 40 * 100, o.thrustG]); cur.push([i / 40 * 100, o.Ibat]); }
    drawChart(MP.chart, { x: [0, 100], xfmt: v => `${Math.round(v)} %`, marker: S.ui.throttle * 100,
      left: { range: [0, niceMax(SUM.full.thrustG * 1.05)], fmt: v => fmtN(v) }, right: { range: [0, niceMax(SUM.full.Ibat * 1.05)], fmt: v => fmtN(v) },
      series: [{ data: thr, color: C.good, fill: true }, { data: cur, color: C.warn, axis: 'right' }] });
  }

  /* ================= Panneau 2 : simulation ================= */
  const SP = {};
  function buildSimPanel() {
    const root = $('#tab-simulation');
    SP.mode = seg({ label: 'Mode de vol', value: S.sim.mode, options: [['waypoints', 'Points de passage'], ['manual', 'Manuel'], ['ai', 'IA (PPO)']], onChange: v => { S.sim.mode = v; ap.vint = [0, 0, 0]; ap.altHold = Math.max(1.5, sim.p[1]); save(); updateSimMode(); updateHint(); } });
    SP.armBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => { if (sim.crashed) return; if (sim.armed && !ap.landing) ap.land(sim); else ap.takeoff(sim); updateArmBtn(); } }, 'Décoller');
    SP.pauseBtn = el('button', { type: 'button', class: 'btn', onclick: () => { simPaused = !simPaused; SP.pauseBtn.textContent = simPaused ? 'Reprendre' : 'Pause'; } }, 'Pause');
    const gustBtn = el('button', { type: 'button', class: 'btn', onclick: () => { if (!sim.armed) return; const r = DF.mulberry32(Date.now() & 0xffff); for (let j = 0; j < 3; j++) { sim.w[j] += (r() - 0.5) * 6; sim.v[j] += (r() - 0.5) * 3; } toast('Perturbation appliquée : le contrôleur doit stabiliser le drone'); } }, 'Perturbation');
    const resetBtn = el('button', { type: 'button', class: 'btn', onclick: () => { resetSim(); updateArmBtn(); } }, 'Réinitialiser');
    SP.kpis = kpiGrid([
      { id: 'alt', label: 'Altitude', unit: 'm' }, { id: 'spd', label: 'Vitesse', unit: 'm/s' },
      { id: 'att', label: 'Roulis / tangage', unit: '°' }, { id: 'bat', label: 'Batterie', unit: '' },
      { id: 'cur', label: 'Courant', unit: 'A' }, { id: 'time', label: 'Temps de vol', unit: '' },
    ]);
    SP.bars = el('div', { class: 'bars' });
    SP.barFill = [];
    ['M1 AvD', 'M2 ArG', 'M3 AvG', 'M4 ArD'].forEach(n => { const f = el('div', { class: 'bar-fill', style: 'height:0%' }); const v = el('span', null, '0 %'); SP.barFill.push([f, v]); SP.bars.append(el('div', { class: 'bar' }, el('div', { class: 'bar-track' }, f), v, el('span', { class: 'bar-label' }, n))); });
    SP.chart = el('canvas', { class: 'chart', role: 'img', 'aria-label': 'Altitude et vitesse sur les 20 dernières secondes' });
    SP.wpList = el('div', { class: 'wp-list' });
    SP.wpAlt = range({ id: 's-wpalt', label: 'Altitude du point sélectionné', min: 0.5, max: 12, step: 0.1, value: (S.sim.waypoints[S.sim.sel] || [0, 2, 0])[1], fmt: v => `${fmtN(v, 1)} m`, onInput: v => { const w = S.sim.waypoints[S.sim.sel]; if (w) { w[1] = v; rebuildWaypoints(); renderWpList(); save(); } } });
    const addWp = el('button', { type: 'button', class: 'btn small', onclick: () => { if (S.sim.waypoints.length >= 12) return toast('12 points de passage au maximum'); const last = S.sim.waypoints[S.sim.waypoints.length - 1] || [0, 2, 0]; S.sim.waypoints.push([clamp(last[0] + 2, -11, 11), last[1], clamp(last[2] + 2, -11, 11)]); S.sim.sel = S.sim.waypoints.length - 1; rebuildWaypoints(); renderWpList(); save(); } }, 'Ajouter un point');
    const delWp = el('button', { type: 'button', class: 'btn small danger', onclick: () => { if (S.sim.waypoints.length <= 1) return toast('Il faut garder au moins un point'); S.sim.waypoints.splice(S.sim.sel, 1); S.sim.sel = Math.max(0, S.sim.sel - 1); ap.wp = 0; rebuildWaypoints(); renderWpList(); save(); } }, 'Supprimer le point');
    const r = (path, label, min, max, step, fmt) => range({ id: 's-' + path.join('-'), label, min, max, step, value: path.reduce((o, k) => o[k], S.sim), fmt, onInput: v => { const o = path.slice(0, -1).reduce((o, k) => o[k], S.sim); o[path[path.length - 1]] = v; save(); updateGainNote(); } });
    SP.gainNote = el('p', { class: 'note' });
    SP.manualBox = el('div', { class: 'sec' });
    const padBtn = (lbl, code) => { const b = el('button', { type: 'button', 'aria-label': lbl }, lbl); const on = e => { e.preventDefault(); keys[code] = true; b.classList.add('on'); }; const off = () => { keys[code] = false; b.classList.remove('on'); }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); return b; };
    SP.manualBox.append(el('h3', null, 'Commandes manuelles'),
      el('p', { class: 'note' }, el('kbd', null, 'Z'), ' ', el('kbd', null, 'Q'), ' ', el('kbd', null, 'S'), ' ', el('kbd', null, 'D'), ' (ou WASD) : déplacement · ', el('kbd', null, 'R'), '/', el('kbd', null, 'F'), ' ou ', el('kbd', null, '↑'), '/', el('kbd', null, '↓'), ' : altitude · ', el('kbd', null, '←'), '/', el('kbd', null, '→'), ' : cap'),
      el('div', { class: 'pad-wrap' },
        el('div', { class: 'pad' }, el('span'), padBtn('↑', 'KeyW'), el('span'), padBtn('←', 'KeyA'), el('span'), padBtn('→', 'KeyD'), el('span'), padBtn('↓', 'KeyS'), el('span')),
        el('div', { class: 'pad' }, el('span'), padBtn('Haut', 'KeyR'), el('span'), padBtn('↺', 'ArrowLeft'), el('span'), padBtn('↻', 'ArrowRight'), el('span'), padBtn('Bas', 'KeyF'), el('span'))));
    SP.wpBox = sec('Points de passage', 'clic au sol pour déplacer', SP.wpList, SP.wpAlt, el('div', { class: 'btn-row' }, addWp, delWp));
    SP.aiNote = el('p', { class: 'note' });
    SP.aiRevert = el('button', { type: 'button', class: 'btn small', hidden: true, onclick: () => { AI.deployed = null; updateSimMode(); toast('Retour à la politique PPO du module 3'); } }, 'Revenir au PPO du module 3');
    root.append(
      head('Simulation de vol 6-DoF', 'Dynamique complète du quadrirotor : poussée et couple de chaque moteur avec leur temps de réponse, traînée, vent, batterie qui se décharge. Contrôle géométrique d\'attitude en cascade à 500 Hz.'),
      sec('Pilotage', null, SP.mode, el('div', { class: 'btn-row' }, SP.armBtn, SP.pauseBtn, gustBtn, resetBtn), SP.aiNote, SP.aiRevert),
      sec('Télémétrie', null, SP.kpis, SP.bars, SP.chart, el('div', { class: 'legend-row' }, el('span', null, el('i', { style: `background:${C.cyan}` }), 'Altitude (m)'), el('span', null, el('i', { style: `background:${C.accent}` }), 'Vitesse (m/s)'))),
      SP.wpBox, SP.manualBox,
      sec('Environnement', null,
        r(['wind'], 'Vent moyen', 0, 12, 0.5, v => `${fmtN(v, 1)} m/s`),
        r(['windDir'], 'Provenance du vent', 0, 359, 1, v => `${v}°`),
        r(['gust'], 'Rafales', 0, 1.5, 0.05, v => `${Math.round(v * 100)} %`),
        toggle({ id: 's-noise', label: 'Bruit des capteurs (IMU, position)', checked: S.sim.noise, onChange: v => { S.sim.noise = v; save(); } }),
        toggle({ id: 's-infbat', label: 'Batterie illimitée', checked: S.sim.infBattery, onChange: v => { S.sim.infBattery = v; save(); } }),
        toggle({ id: 's-follow', label: 'Caméra qui suit le drone', checked: S.sim.follow, onChange: v => { S.sim.follow = v; save(); } })),
      sec('Réglage du contrôleur', null,
        r(['vmax'], 'Vitesse maximale', 1, 15, 0.5, v => `${fmtN(v, 1)} m/s`),
        r(['maxTilt'], 'Inclinaison maximale', 10, 60, 1, v => `${v}°`),
        r(['gains', 'pos'], 'Gain position', 0.2, 3, 0.05, v => fmtN(v, 2)),
        r(['gains', 'vel'], 'Gain vitesse', 0.5, 8, 0.1, v => fmtN(v, 1)),
        r(['gains', 'att'], 'Gain attitude', 2, 25, 0.5, v => fmtN(v, 1)),
        r(['gains', 'rate'], 'Gain vitesse angulaire', 5, 60, 1, v => fmtN(v)),
        SP.gainNote),
    );
    renderWpList(); updateSimMode(); updateGainNote();
  }
  function updateGainNote() {
    const g = DF.effectiveGains(S.sim.gains, SUM.tau);
    SP.gainNote.textContent = `Gains effectifs après limitation de stabilité (constante de temps moteur ${fmtN(SUM.tau * 1000)} ms) : position ${fmtN(g.pos, 2)}, vitesse ${fmtN(g.vel, 2)}, attitude ${fmtN(g.att, 1)}, angulaire ${fmtN(g.rate, 1)}.`;
  }
  function updateSimMode() {
    SP.mode.set(S.sim.mode);
    SP.manualBox.hidden = S.sim.mode !== 'manual';
    updateSticks();
    SP.wpBox.hidden = S.sim.mode === 'manual';
    SP.aiNote.hidden = S.sim.mode !== 'ai';
    if (S.sim.mode !== 'ai') { SP.aiRevert.hidden = true; return; }
    const st = AI.stats.updates || (AI.savedStats && AI.savedStats.updates) || 0;
    SP.aiRevert.hidden = !AI.deployed;
    if (AI.deployed) {
      const mis = Math.abs(AI.deployed.tauA - DF.responseTau(SUM, S.sim.gains)) > 0.05;
      SP.aiNote.textContent = `Modèle du laboratoire actif : « ${AI.deployed.name} », entraîné pour un temps de réponse de ${fmtN(AI.deployed.tauA * 1000)} ms.${mis ? ` Le drone simulé répond en ${fmtN(DF.responseTau(SUM, S.sim.gains) * 1000)} ms : attendez-vous à des écarts.` : ''}`;
      return;
    }
    SP.aiNote.textContent = AI.trained ? `Politique PPO après ${st} itérations d'entraînement. Elle choisit l'accélération à chaque 50 ms ; le contrôleur d'attitude l'exécute.` : 'La politique n\'est pas encore entraînée : le drone se comportera de façon erratique. Lancez l\'entraînement dans le module 3.';
  }
  function renderWpList() {
    SP.wpList.replaceChildren(...S.sim.waypoints.map((w, i) => {
      const b = el('button', { type: 'button', class: 'wp-item' + (i === ap.wp % S.sim.waypoints.length ? ' active' : ''), 'aria-pressed': String(i === S.sim.sel), onclick: () => { S.sim.sel = i; SP.wpAlt.set(w[1]); rebuildWaypoints(); renderWpList(); save(); } },
        el('span', { class: 'n' }, i + 1), `x ${fmtN(w[0], 1)}  z ${fmtN(w[2], 1)}`, el('span', { style: `color:${C.muted}` }, `${fmtN(w[1], 1)} m`));
      return b;
    }));
    const w = S.sim.waypoints[S.sim.sel]; if (w) SP.wpAlt.set(w[1]);
  }
  function updateArmBtn() {
    SP.armBtn.textContent = sim.crashed ? 'Réinitialiser d\'abord' : sim.armed ? (ap.landing ? 'Atterrissage…' : 'Atterrir') : 'Décoller';
    SP.armBtn.disabled = sim.crashed || ap.landing;
  }
  let lastWpShown = -1;
  function updateSimPanel() {
    const at = sim.attitude();
    const spd = Math.hypot(...sim.v);
    const K = SP.kpis;
    K.setK('alt', fmtN(sim.p[1], 2));
    K.setK('spd', fmtN(spd, 1));
    K.setK('att', `${fmtN(at.roll)} / ${fmtN(at.pitch)}`);
    const vb = sim.vbat();
    K.setK('bat', `${S.sim.infBattery ? '∞' : Math.round(sim.soc * 100) + ' %'} · ${fmtN(vb, 1)} V`, sim.soc < 0.1 ? 'bad' : sim.soc < 0.25 ? 'warn' : '');
    K.setK('cur', fmtN(sim.Ibat, 1));
    const ft = sim.flightTime; K.setK('time', `${Math.floor(ft / 60)}:${String(Math.floor(ft % 60)).padStart(2, '0')}`);
    SP.barFill.forEach(([f, v], i) => { const t = sim.armed ? sim.throttleOf(i) : 0; f.style.height = (t * 100).toFixed(1) + '%'; f.classList.toggle('hot', t > 0.9); v.textContent = Math.round(t * 100) + ' %'; });
    const t1 = sim.time, t0 = t1 - 20;
    const maxA = Math.max(3, ...simHist.map(h => h[1])), maxV = Math.max(3, ...simHist.map(h => h[2]));
    drawChart(SP.chart, { x: [t0, t1], xfmt: v => `${Math.round(v - t1)} s`, left: { range: [0, niceMax(maxA)], fmt: v => fmtN(v, 1) }, right: { range: [0, niceMax(maxV)], fmt: v => fmtN(v, 1) },
      series: [{ data: simHist.filter(h => h[0] >= t0).map(h => [h[0], h[1]]), color: C.cyan, fill: true }, { data: simHist.filter(h => h[0] >= t0).map(h => [h[0], h[2]]), color: C.accent, axis: 'right' }] });
    if (ap.wp !== lastWpShown) { lastWpShown = ap.wp; renderWpList(); }
    updateArmBtn();
    updateBanner();
    const hud = $('#vp-hud');
    if (S.ui.tab === 'simulation') {
      hud.hidden = false;
      hud.replaceChildren(...[['Mode', { waypoints: 'Points', manual: 'Manuel', ai: 'IA PPO' }[S.sim.mode]], ['État', sim.crashed ? 'Impact' : sim.armed ? (ap.landing ? 'Atterrissage' : 'En vol') : 'Désarmé'], ['Altitude', `${fmtN(sim.p[1], 1)} m`], ['Vitesse', `${fmtN(spd, 1)} m/s`], ['Cap', `${fmtN((at.yaw + 360) % 360)}°`], ['Vent', `${fmtN(Math.hypot(windVec[0], windVec[2]), 1)} m/s`]].map(([a, b]) => el('div', null, el('span', null, a), el('span', null, b))));
    }
  }
  function updateBanner() {
    const b = $('#vp-banner');
    if (S.ui.tab !== 'simulation') { b.hidden = true; return; }
    if (sim.crashed) {
      b.className = 'vp-banner'; b.hidden = false;
      b.replaceChildren(el('span', null, `Impact détecté : ${sim.crashReason}.`), el('button', { type: 'button', class: 'btn small', style: 'pointer-events:auto', onclick: () => { resetSim(); updateArmBtn(); } }, 'Réinitialiser'));
    } else if (!S.sim.infBattery && sim.soc < 0.15 && sim.armed) {
      b.className = 'vp-banner warn'; b.hidden = false; b.replaceChildren(el('span', null, `Batterie faible (${Math.round(sim.soc * 100)} %) : atterrissez.`));
    } else b.hidden = true;
  }

  /* ================= Panneau 3 : IA ================= */
  const AP = {};
  function buildAIPanel() {
    const root = $('#tab-ai');
    AP.ctrl = el('div', { class: 'btn-row' });
    AP.status = el('p', { class: 'note' });
    AP.kpis = kpiGrid([
      { id: 'upd', label: 'Itérations', unit: '' }, { id: 'steps', label: 'Pas simulés', unit: '' },
      { id: 'ret', label: 'Retour moyen', unit: '' }, { id: 'ok', label: 'Réussite', unit: '%' },
      { id: 'std', label: 'Exploration σ', unit: '' }, { id: 'kl', label: 'Divergence KL', unit: '' },
    ]);
    AP.chart = el('canvas', { class: 'chart', role: 'img', 'aria-label': 'Courbe d\'apprentissage' });
    AP.net = el('canvas', { class: 'chart tall', role: 'img', 'aria-label': 'Réseau de neurones de la politique' });
    const r = (key, label, min, max, step, fmt, map, inv) => range({ id: 'ai-' + key, label, min, max, step, value: inv ? inv(S.ai[key]) : S.ai[key], fmt: v => fmt(map ? map(v) : v), onInput: v => { S.ai[key] = map ? map(v) : v; save(); } });
    root.append(
      head('IA & entraînement PPO', 'Un réseau de neurones apprend à rejoindre une cible par essais et erreurs (Proximal Policy Optimization), directement dans votre navigateur. Il commande l\'accélération ; le contrôleur d\'attitude du module 2 l\'exécute.'),
      sec('Entraînement', null, AP.ctrl, AP.status, AP.kpis, AP.chart,
        el('div', { class: 'legend-row' }, el('span', null, el('i', { style: `background:${C.cyan}` }), 'Retour moyen par épisode'), el('span', null, el('i', { style: `background:${C.good}` }), 'Taux de réussite (%)'))),
      sec('Réseau de la politique', '9 → 64 → 64 → 3', AP.net,
        el('p', { class: 'note' }, 'Entrées : écart à la cible (x, y, z), vitesse, accélération en cours. Sorties : accélération demandée sur 3 axes. Orange : poids positifs, bleu : poids négatifs. Seuls 14 neurones par couche cachée sont affichés.')),
      sec('Hyperparamètres', 'appliqués à l\'itération suivante',
        r('lr', 'Taux d\'apprentissage', -4.5, -2.5, 0.05, v => { const e = Math.floor(Math.log10(v)); const sup = String(e).replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]); return `${fmtN(v / Math.pow(10, e), 1)} × 10${sup}`; }, v => Math.pow(10, v), v => Math.log10(v)),
        r('clip', 'Écrêtage ε', 0.05, 0.4, 0.01, v => fmtN(v, 2)),
        r('ent', 'Bonus d\'entropie', 0, 0.02, 0.0005, v => fmtN(v, 4)),
        r('gamma', 'Facteur d\'actualisation γ', 0.9, 0.999, 0.001, v => fmtN(v, 3))),
      sec('Poids du réseau', null,
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn', onclick: () => openWeightsExport() }, 'Exporter les poids'),
          el('button', { type: 'button', class: 'btn', onclick: () => openWeightsImport() }, 'Importer des poids'),
          confirmButton('Réinitialiser le réseau', 'Confirmer la réinitialisation', resetTraining, 'danger')),
        el('p', { class: 'note' }, 'Les poids sont enregistrés dans ce navigateur toutes les 5 itérations et à chaque pause.')),
    );
    renderAIControls(); updateAIPanel(true);
  }
  function renderAIControls() {
    AP.ctrl.replaceChildren(
      AI.running ? el('button', { type: 'button', class: 'btn', onclick: pauseTraining }, 'Mettre en pause') : el('button', { type: 'button', class: 'btn primary', onclick: startTraining }, AI.stats.updates ? 'Reprendre l\'entraînement' : 'Lancer l\'entraînement'),
      el('button', { type: 'button', class: 'btn', disabled: !AI.trained, onclick: () => { if (AI.running) pauseTraining(); AI.deployed = null; S.sim.mode = 'ai'; save(); setTab('simulation'); updateSimMode(); if (!sim.armed && !sim.crashed) { ap.takeoff(sim); updateArmBtn(); } toast('Politique déployée dans la simulation'); } }, 'Déployer en simulation'));
  }
  function updateAIPanel(force) {
    const st = AI.stats, sv = AI.savedStats;
    const upd = st.updates || (sv && sv.updates) || 0;
    const K = AP.kpis;
    K.setK('upd', fmtN(upd));
    K.setK('steps', st.steps ? fmtN(st.steps) : '—');
    K.setK('ret', st.recent.length ? fmtN(st.meanReturn(), 1) : '—');
    const ok = st.recent.length ? st.successRate() : sv ? sv.ok : null;
    K.setK('ok', ok == null ? '—' : fmtN(ok * 100), ok == null ? '' : ok > 0.9 ? 'good' : ok > 0.5 ? '' : 'warn');
    K.setK('std', fmtN(Math.exp(AI.agent.logStd.reduce((s, x) => s + x, 0) / 3), 2));
    K.setK('kl', st.updates ? fmtN(st.kl, 4) : '—', st.kl > 0.05 ? 'warn' : '');
    const tauNow = DF.responseTau(SUM, S.sim.gains);
    const mismatch = AI.trained && Math.abs(tauNow - AI.agent.tauA) > 0.05;
    AP.status.textContent = AI.running ? `Entraînement en cours sur 16 environnements, 2 048 pas par itération. Comptez 40 à 60 itérations pour dépasser 90 % de réussite.`
      : AI.trained ? `Politique prête, entraînée pour un temps de réponse de ${fmtN(AI.agent.tauA * 1000)} ms.${mismatch ? ` Le drone actuel répond en ${fmtN(tauNow * 1000)} ms : réinitialisez puis réentraînez pour l'adapter.` : ''} La vue montre la politique en démonstration.`
      : 'Réseau non entraîné. Lancez l\'entraînement : les sphères partent au hasard puis convergent vers la cible.';
    if (force || S.ui.tab === 'ai') {
      const h = st.history;
      if (h.length) {
        const maxR = Math.max(5, ...h.map(x => x.ret)), minR = Math.min(0, ...h.map(x => x.ret));
        drawChart(AP.chart, { x: [h[0].u, Math.max(h[0].u + 1, h[h.length - 1].u)], xfmt: v => `it. ${Math.round(v)}`, left: { range: niceRange(minR, maxR), fmt: v => fmtN(v) }, right: { range: [0, 100], fmt: v => fmtN(v) + '%' },
          series: [{ data: h.map(x => [x.u, x.ret]), color: C.cyan, fill: true }, { data: h.map(x => [x.u, x.ok * 100]), color: C.good, axis: 'right' }] });
      } else drawChart(AP.chart, { x: [0, 10], xfmt: v => `it. ${Math.round(v)}`, left: { range: [-20, 25], fmt: v => fmtN(v) }, right: { range: [0, 100], fmt: v => fmtN(v) + '%' }, series: [] });
      drawNet();
    }
  }
  function drawNet() {
    const cv = AP.net, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const pi = AI.agent.pi, show = [9, 14, 14, 3];
    const inL = ['Δx', 'Δy', 'Δz', 'vx', 'vy', 'vz', 'ax', 'ay', 'az'], outL = ['ax', 'ay', 'az'];
    const xs = show.map((_, i) => 34 + i * (W - 68) / 3);
    const ys = n => Array.from({ length: n }, (_, i) => 14 + (i + 0.5) * (H - 28) / n);
    const Ys = show.map(ys);
    for (let l = 0; l < 3; l++) {
      const ni = pi.sizes[l], Wl = pi.W[l];
      let mx = 1e-6; for (let o = 0; o < show[l + 1]; o++) for (let i = 0; i < show[l]; i++) mx = Math.max(mx, Math.abs(Wl[o * ni + i]));
      for (let o = 0; o < show[l + 1]; o++) for (let i = 0; i < show[l]; i++) {
        const w = Wl[o * ni + i], a = Math.abs(w) / mx;
        if (a < 0.15) continue;
        g.strokeStyle = w > 0 ? C.accent : C.cyan; g.globalAlpha = a * 0.55; g.lineWidth = 0.4 + a * 1.4;
        g.beginPath(); g.moveTo(xs[l], Ys[l][i]); g.lineTo(xs[l + 1], Ys[l + 1][o]); g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.font = '10px ' + (cssv('--font-mono') || 'monospace');
    Ys.forEach((col, l) => col.forEach((y, i) => {
      g.fillStyle = C.panel2; g.strokeStyle = C.fg; g.lineWidth = 1; g.beginPath(); g.arc(xs[l], y, 3.6, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = C.muted;
      if (l === 0) { g.textAlign = 'right'; g.fillText(inL[i], xs[l] - 8, y + 3); }
      if (l === 3) { g.textAlign = 'left'; g.fillText(outL[i], xs[l] + 8, y + 3); }
    }));
  }
  function openWeightsExport() {
    const txt = JSON.stringify(AI.agent.toJSON());
    const ta = el('textarea', { readonly: true, 'aria-label': 'Poids au format JSON' }, txt);
    modal('Exporter les poids PPO', el('div', { class: 'field' }, el('p', { class: 'note' }, `${fmtN(txt.length / 1024, 0)} Ko. Conservez ce fichier pour réutiliser la politique.`), ta), close => [
      el('button', { type: 'button', class: 'btn primary', onclick: () => { ta.select(); copyText(txt, 'Poids copiés'); } }, 'Copier'),
      el('button', { type: 'button', class: 'btn', onclick: () => download('droneforge-politique.json', txt, 'application/json') }, 'Télécharger'),
    ]);
  }
  function openWeightsImport() {
    const ta = el('textarea', { placeholder: 'Collez ici le JSON exporté', 'aria-label': 'Poids au format JSON' });
    const file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Fichier de poids' });
    file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ta.value = r.result; }; r.readAsText(f); });
    modal('Importer des poids PPO', el('div', { class: 'field' }, file, ta), close => [el('button', { type: 'button', class: 'btn primary', onclick: () => {
      try { const j = JSON.parse(ta.value); if (AI.running) pauseTraining(); AI.agent.load(j); AI.gen = null; AI.stats = new DF.PPOStats(); AI.trained = true; AI.savedStats = null; demo.envs = null; persistPolicy(); renderAIControls(); updateAIPanel(true); updateSimMode(); close(); toast('Poids chargés'); }
      catch (e) { toast(`Import impossible : ${e.message}`); }
    } }, 'Charger')]);
  }

  /* ================= Panneau 4 : carte mère ================= */
  const BP = {};
  function buildBoardPanel() {
    const root = $('#tab-motherboard');
    const c = S.cfg;
    BP.info = el('div', { class: 'info-card' });
    BP.chips = el('div', { class: 'chips' });
    BP.checks = el('ul', { class: 'checks' });
    BP.power = el('div', { style: 'display:grid;gap:10px' });
    const ch = (key, scope) => v => { S.cfg[key] = key === 'esc' ? Number(v) : v; S.cfg.preset = 'custom'; MP.preset.set('custom'); changed(scope || 'board'); };
    BP.sel = {
      mcu: select({ id: 'b-mcu', label: 'Microcontrôleur', value: c.mcu, options: Object.entries(DF.MCU).map(([k, v]) => [k, `${v.label} · ${v.uarts} UART`]), onChange: ch('mcu') }),
      imu: select({ id: 'b-imu', label: 'Centrale inertielle', value: c.imu, options: Object.entries(DF.IMU).map(([k, v]) => [k, `${k} · bruit ${v.noise.split(' ')[0]}`]), onChange: ch('imu') }),
      esc: select({ id: 'b-esc', label: 'ESC 4-en-1', value: c.esc, options: Object.entries(DF.ESC).map(([k, v]) => [k, `${k} A · ${v.maxS}S max`]), onChange: ch('esc', 'all') }),
      fw: select({ id: 'b-fw', label: 'Firmware', value: c.firmware, options: DF.FIRMWARES.map(f => [f, f]), onChange: ch('firmware') }),
      video: select({ id: 'b-video', label: 'Vidéo', value: c.video, options: Object.entries(DF.VIDEO).map(([k, v]) => [k, v.label]), onChange: ch('video', 'all') }),
      gps: toggle({ id: 'b-gps', label: 'Module GPS + compas', checked: c.gps, onChange: v => { S.cfg.gps = v; S.cfg.preset = 'custom'; MP.preset.set('custom'); changed('all'); } }),
    };
    root.append(
      head('Carte mère & électronique', 'Pile contrôleur de vol + ESC 4-en-1 au format 30,5 × 30,5 mm. Les composants, les bus et le bilan d\'alimentation suivent la configuration.'),
      sec('Composant sélectionné', null, BP.info, BP.chips),
      sec('Vérifications', null, BP.checks),
      sec('Bilan d\'alimentation', null, BP.power),
      sec('Configuration', null, el('div', { class: 'grid2' }, BP.sel.mcu, BP.sel.imu, BP.sel.esc, BP.sel.fw), BP.sel.video, BP.sel.gps),
      sec('Affichage 3D', null,
        toggle({ id: 'b-explode', label: 'Séparer la pile FC / ESC', checked: S.ui.boardExplode, onChange: v => { S.ui.boardExplode = v; save(); } }),
        toggle({ id: 'b-signals', label: 'Afficher les signaux', checked: S.ui.signals, onChange: v => { S.ui.signals = v; save(); } })),
    );
  }
  function boardCompList() { const seen = new Set(); return boardComponents(S.cfg).filter(cp => { if (['ind5', 'ind10'].includes(cp.id)) return false; if (!cp.group) return true; if (seen.has(cp.group)) return false; seen.add(cp.group); return true; }); }
  function renderBoardInfo() {
    const comps = boardComponents(S.cfg);
    let cp = comps.find(x => (x.group || x.id) === S.board.selected) || comps[0];
    if ((cp.group || cp.id) !== S.board.selected) S.board.selected = cp.group || cp.id;
    const name = cp.group ? cp.label.replace(/ moteur \d$/, '') + (cp.group === 'fet' ? ' (6 par moteur, 24 au total)' : ' (un par moteur)') : cp.label;
    BP.info.replaceChildren(el('h4', null, name), el('p', { class: 'note' }, cp.role), el('dl', null, el('dt', null, 'Interface'), el('dd', null, cp.bus), el('dt', null, 'Consommation'), el('dd', null, cp.power), el('dt', null, 'Carte'), el('dd', null, cp.board === 'fc' ? 'Contrôleur de vol (haut)' : 'ESC 4-en-1 (bas)')));
    BP.chips.replaceChildren(...boardCompList().map(x => { const key = x.group || x.id; const short = x.short || x.label; return el('button', { type: 'button', class: 'chip', 'aria-pressed': String(key === S.board.selected), onclick: () => { S.board.selected = key; save(); renderBoardInfo(); highlightSelected(); } }, short); }));
  }
  function updateBoardPanel() {
    renderBoardInfo();
    renderChecks(BP.checks, DF.boardChecks(SUM));
    const e = SUM.elec;
    const meters = [];
    for (const r of ['5V', '10V']) {
      const R = e.rails[r], p = R.mA / R.limit;
      meters.push(el('div', { class: 'meter' }, el('div', { class: 'meter-head' }, el('span', null, `Régulateur ${r}`), el('span', null, `${fmtN(R.mA)} / ${fmtN(R.limit)} mA`)), el('div', { class: 'meter-track' }, el('div', { class: 'meter-fill' + (p > 1 ? ' bad' : p > 0.8 ? ' warn' : ''), style: `width:${Math.min(100, p * 100)}%` }))));
    }
    const list = el('ul', { class: 'checks' }, e.loads.map(l => el('li', { class: 'info' }, `${l.label} : ${l.rail === 'VBAT' ? fmtN(l.W, 1) + ' W sur la batterie' : fmtN(l.mA) + ' mA sur ' + l.rail}`)));
    BP.power.replaceChildren(...meters, list, el('p', { class: 'note' }, `Électronique embarquée : ${fmtN(e.watts, 1)} W, soit ${fmtN(e.ampsBat, 2)} A prélevés sur la batterie.`));
  }

  /* ================= Panneau 5 : production ================= */
  const PP = {};
  const RATES = { EUR: 1, XOF: 655.957, USD: 1.08 };
  const money = (eur, cur) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur || S.prod.currency, maximumFractionDigits: (cur || S.prod.currency) === 'XOF' ? 0 : 2, minimumFractionDigits: (cur || S.prod.currency) === 'XOF' ? 0 : 2 }).format(eur * RATES[cur || S.prod.currency]);
  function buildProdPanel() {
    const root = $('#tab-production');
    const qty = el('input', { type: 'number', id: 'p-qty', min: 1, max: 10000, step: 1, value: S.prod.qty });
    qty.addEventListener('input', () => { const v = clamp(Math.round(Number(qty.value)) || 1, 1, 10000); S.prod.qty = v; save(); updateProdPanel(); });
    qty.addEventListener('blur', () => { qty.value = S.prod.qty; });
    PP.kpis = kpiGrid([
      { id: 'unit', label: 'Coût matière / drone' }, { id: 'batch', label: 'Coût matière du lot' },
      { id: 'auw', label: 'Masse au décollage', unit: 'g' }, { id: 'twr', label: 'Poussée / poids', unit: ': 1' },
      { id: 'flight', label: 'Autonomie stat.', unit: 'min' }, { id: 'hours', label: 'Assemblage du lot', unit: 'h' },
    ]);
    PP.stack = el('div', { class: 'stack', role: 'img', 'aria-label': 'Répartition des masses' });
    PP.stackLegend = el('div', { class: 'legend-row' });
    PP.table = el('div', { class: 'table-wrap' });
    PP.note = el('p', { class: 'note' });
    PP.progress = el('div', { class: 'progress' }, el('div', { style: 'width:0%' }));
    PP.progressText = el('span', { class: 'aside' });
    PP.checklist = el('div', { class: 'checklist' });
    root.append(
      head('Production & nomenclature', 'Nomenclature générée depuis la configuration des modules 1 et 4, avec masses, coûts et temps d\'assemblage du lot.'),
      sec('Lot de production', null,
        el('div', { class: 'grid2' }, el('div', { class: 'field' }, el('label', { for: 'p-qty' }, 'Quantité à produire'), qty),
          el('div', { class: 'field' }, el('label', null, 'Devise'), seg({ label: 'Devise', value: S.prod.currency, options: [['XOF', 'FCFA'], ['EUR', 'EUR'], ['USD', 'USD']], onChange: v => { S.prod.currency = v; save(); updateProdPanel(); } }))),
        PP.kpis, PP.note),
      sec('Répartition des masses', null, PP.stack, PP.stackLegend),
      sec('Nomenclature (BOM)', null, PP.table,
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn', onclick: () => copyText(bomCSV(), 'Nomenclature copiée au format CSV') }, 'Copier en CSV'),
          el('button', { type: 'button', class: 'btn', onclick: () => download(`droneforge-bom-${SUM.designation}-x${S.prod.qty}.csv`, '﻿' + bomCSV(), 'text/csv') }, 'Télécharger le CSV'))),
      el('section', { class: 'sec' }, el('h3', null, 'Procédure d\'assemblage', PP.progressText), PP.progress, PP.checklist,
        el('div', { class: 'btn-row' }, confirmButton('Tout décocher', 'Confirmer', () => { S.checklist = {}; save(); renderChecklist(); }))),
      sec('Affichage 3D', null,
        range({ id: 'p-explode', label: 'Vue éclatée', min: 0, max: 1, step: 0.01, value: S.ui.prodExplode, fmt: v => `${Math.round(v * 100)} %`, onInput: v => { S.ui.prodExplode = v; save(); } }),
        toggle({ id: 'p-rotate', label: 'Rotation automatique', checked: S.ui.autoRotate, onChange: v => { S.ui.autoRotate = v; save(); } })),
    );
    renderChecklist();
  }
  function bomCSV() {
    const cur = S.prod.currency, rate = RATES[cur], d = DF.discountFor(S.prod.qty);
    const rows = [['Référence', 'Catégorie', 'Désignation', 'Spécification', 'Qté / drone', 'Qté lot', 'Masse unitaire (g)', `Prix unitaire (${cur})`, `Total lot (${cur})`]];
    for (const l of SUM.bom.lines) rows.push([l.ref, l.cat, l.name, l.spec, l.qty, l.qty * S.prod.qty, l.mass.toFixed(1), (l.price * rate * (1 - d)).toFixed(2), (l.price * rate * (1 - d) * l.qty * S.prod.qty).toFixed(2)]);
    return rows.map(r => r.map(v => { const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\n');
  }
  function updateProdPanel() {
    const q = S.prod.qty, d = DF.discountFor(q);
    const unit = SUM.bom.lines.reduce((s, l) => s + l.price * l.qty, 0) * (1 - d);
    const asm = DF.assemblyHours(S.cfg, q);
    const K = PP.kpis;
    K.setK('unit', money(unit)); K.setK('batch', money(unit * q));
    K.setK('auw', fmtN(SUM.auwG)); K.setK('twr', fmtN(SUM.twr, 1), SUM.twr < 1.4 ? 'bad' : SUM.twr < 2 ? 'warn' : 'good');
    K.setK('flight', SUM.hover ? fmtN(SUM.flightMin, 1) : '—'); K.setK('hours', fmtN(asm.totalH, asm.totalH < 10 ? 1 : 0));
    PP.note.textContent = `Remise volume ${Math.round(d * 100)} % (paliers à 10, 25, 100 et 1 000 unités). Premier drone assemblé en ${asm.firstMin} min, puis courbe d'apprentissage à 85 %. Prix indicatifs${S.prod.currency === 'USD' ? ', taux USD approximatif' : ''}.`;
    const cats = {};
    for (const l of SUM.bom.lines) cats[l.cat] = (cats[l.cat] || 0) + l.mass * l.onboard;
    const palette = { 'Énergie': C.warn, 'Propulsion': C.accent, 'Structure': C.dim, 'Électronique': C.cyan, 'Vidéo': C.phasec, 'Radio': C.good, 'Navigation': C.good };
    const tot = SUM.auwG;
    const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    PP.stack.replaceChildren(...entries.map(([k, v]) => el('div', { title: `${k} : ${fmtN(v)} g`, style: `width:${v / tot * 100}%;background:${palette[k] || C.muted}` })));
    PP.stackLegend.replaceChildren(...entries.map(([k, v]) => el('span', null, el('i', { style: `background:${palette[k] || C.muted};height:8px;width:8px` }), `${k} ${fmtN(v)} g (${Math.round(v / tot * 100)} %)`)));
    const rows = SUM.bom.lines.map(l => {
      const m = l.mass * l.onboard;
      return el('tr', null,
        el('td', null, l.name, el('span', { class: 'sub' }, el('span', { class: 'ref' }, l.ref), ` · ${l.spec} · ${fmtN(m, m < 10 ? 1 : 0)} g`)),
        el('td', { class: 'num' }, `×${l.qty}`),
        el('td', { class: 'num' }, money(l.price * (1 - d) * l.qty)));
    });
    PP.table.replaceChildren(el('table', { class: 'bom' },
      el('thead', null, el('tr', null, el('th', null, 'Désignation'), el('th', { class: 'num' }, 'Qté'), el('th', { class: 'num' }, 'Coût / drone'))),
      el('tbody', null, rows),
      el('tfoot', null, el('tr', null, el('td', null, `Total par drone · ${fmtN(tot)} g`), el('td'), el('td', { class: 'num' }, money(unit))))));
  }
  function renderChecklist() {
    const items = DF.CHECKLIST;
    PP.checklist.replaceChildren(...items.map((t, i) => {
      const cb = el('input', { type: 'checkbox', id: 'chk-' + i });
      cb.checked = !!S.checklist[i];
      cb.addEventListener('change', () => { S.checklist[i] = cb.checked; save(); updateChecklistProgress(); });
      return el('label', { for: 'chk-' + i }, cb, el('span', null, `${i + 1}. ${t}`));
    }));
    updateChecklistProgress();
  }
  function updateChecklistProgress() {
    const n = DF.CHECKLIST.length, done = DF.CHECKLIST.filter((_, i) => S.checklist[i]).length;
    PP.progress.firstChild.style.width = (done / n * 100) + '%';
    PP.progressText.textContent = `${done} / ${n}`;
  }

  /* ================= Onglet 6 : laboratoire IA ================= */
  const LAB_KEY = 'droneforge.lab.v1';
  const LAB = { models: [], rt: new Map(), evals: new Map(), sel: null, sub: 'config', view: 'model', saveT: 0, evalOpts: { n: 100, drone: 'train', seed: 2026 }, traj: 'nominal', listSig: '' };
  const LB = {};
  const seriesColors = () => [C.cyan, C.accent, C.good, C.phasec, C.warn, C.bad, C.phasea, C.fg];
  const gradeColor = g => ({ A: C.good, B: C.cyan, C: C.warn, D: C.bad, E: C.bad }[g] || C.muted);
  (function loadLab() {
    const j = store.get(LAB_KEY);
    if (j && Array.isArray(j.models)) for (const raw of j.models) { try { LAB.models.push(DFLab.sanitizeModel(raw)); } catch (e) { /* modèle illisible ignoré */ } }
    if (j && j.sel) LAB.sel = j.sel;
    if (j && j.evalOpts) Object.assign(LAB.evalOpts, j.evalOpts);
    if (!LAB.models.find(m => m.id === LAB.sel)) LAB.sel = LAB.models[0] ? LAB.models[0].id : null;
  })();
  function labSave(now) {
    if (!now && performance.now() - LAB.saveT < 4000) { LAB.dirty = true; return; }
    LAB.saveT = performance.now(); LAB.dirty = false;
    const models = LAB.models.map(m => {
      const c = Object.assign({}, m);
      if (c.eval && c.eval.scenarios) c.eval = Object.assign({}, c.eval, { scenarios: c.eval.scenarios.map(s => Object.assign({}, s, { trails: null })) });
      return c;
    });
    if (!store.set(LAB_KEY, { models, sel: LAB.sel, evalOpts: LAB.evalOpts }) && !LAB.warned) {
      LAB.warned = true;
      toast('Stockage du navigateur plein : exportez puis supprimez des modèles pour continuer à sauvegarder.');
    }
  }
  const curModel = () => LAB.models.find(m => m.id === LAB.sel) || null;
  function rtOf(m) {
    let r = LAB.rt.get(m.id);
    if (!r) {
      let R;
      try { R = DFLab.makeRuntime(m); }
      catch (e) { toast(`${m.name} : poids illisibles (${e.message}), réseau réinitialisé.`); m.weights = null; R = DFLab.makeRuntime(m); }
      r = { R, gen: null, live: {}, running: false };
      LAB.rt.set(m.id, r);
    }
    return r;
  }
  const isRunning = m => { const r = LAB.rt.get(m.id); return !!(r && r.running); };
  const isEvaluating = m => { const e = LAB.evals.get(m.id); return !!(e && !e.out.done); };
  const shortTask = t => ({ reach: 'Point', pursuit: 'Poursuite', landing: 'Atterrissage' }[t] || t);
  const droneTau = () => DF.responseTau(SUM, S.sim.gains);

  /* ----- Création ----- */
  const TEMPLATES = [
    { label: 'PPO standard', desc: '64 × 64 neurones tanh. Le meilleur point de départ.', make: () => ({ algo: 'ppo' }) },
    { label: 'Stratégies d\'évolution', desc: 'Sans gradient, 32 × 32. Souvent plus robuste au vent.', make: () => ({ algo: 'es', arch: { layers: [32, 32], act: 'tanh' } }) },
    { label: 'Petit réseau embarqué', desc: '16 × 16 ReLU : tient sur n\'importe quel microcontrôleur.', make: () => ({ algo: 'ppo', arch: { layers: [16, 16], act: 'relu' } }) },
    { label: 'PPO robuste', desc: 'Vent, bruit et randomisation renforcés pendant l\'entraînement.', make: () => ({ algo: 'ppo', env: { wind: 3.5, gust: 0.6, obsNoise: 0.08, randomize: 0.35 } }) },
    { label: 'Comparatif des 5 algorithmes', desc: 'Un modèle par algorithme, même tâche, même architecture.', multi: true },
  ];
  function createModel(spec, silent) {
    const n = LAB.models.length + 1;
    const env = Object.assign(DFLab.envDefaults(droneTau()), spec.env || {});
    const m = DFLab.newModel(Object.assign({}, spec, { env }));
    m.name = spec.name || `${DFLab.ALGOS[m.algo].label} ${shortTask(m.env.task).toLowerCase()} n° ${n}`;
    LAB.models.push(m); LAB.sel = m.id; LAB.view = 'model'; LAB.mobileDetail = true;
    if (!silent) { LAB.sub = 'config'; labSave(true); renderLab(); }
    return m;
  }
  function createFromTemplate(t) {
    if (t.multi) {
      for (const a of Object.keys(DFLab.ALGOS)) createModel({ algo: a, arch: { layers: [32, 32], act: 'tanh' } }, true);
      LAB.view = 'board'; labSave(true); renderLab();
      toast('5 modèles créés. Lancez leur entraînement depuis le classement, puis évaluez-les.');
      return;
    }
    createModel(t.make());
  }
  function openNewModel() {
    modal('Nouveau modèle', el('div', { class: 'tpl-grid' }, TEMPLATES.map(t => el('button', { type: 'button', class: 'tpl', onclick: () => { document.querySelector('#modal-root').replaceChildren(); createFromTemplate(t); } }, el('b', null, t.label), el('span', null, t.desc)))), () => []);
  }
  function openImportModel() {
    const ta = el('textarea', { placeholder: 'Collez ici un modèle exporté au format JSON', 'aria-label': 'Modèle JSON' });
    const file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Fichier modèle' });
    file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ta.value = r.result; }; r.readAsText(f); });
    modal('Importer un modèle', el('div', { class: 'field' }, file, ta), close => [el('button', { type: 'button', class: 'btn primary', onclick: () => {
      try { const m = DFLab.importJSON(ta.value); LAB.models.push(m); LAB.sel = m.id; LAB.view = 'model'; LAB.sub = 'eval'; labSave(true); close(); renderLab(); toast(`« ${m.name} » importé. Lancez une évaluation pour mesurer sa fiabilité ici.`); }
      catch (e) { toast(`Import impossible : ${e.message}`); }
    } }, 'Importer')]);
  }
  function duplicateModel(m) {
    const c = createModel({ algo: m.algo, arch: JSON.parse(JSON.stringify(m.arch)), hp: Object.assign({}, m.hp), env: Object.assign({}, m.env), stop: Object.assign({}, m.stop), name: `${m.name} (copie)` }, true);
    LAB.sub = 'config'; labSave(true); renderLab();
    toast(`Configuration copiée dans « ${c.name} », sans les poids.`);
  }
  function deleteModel(m) {
    const r = LAB.rt.get(m.id); if (r) r.running = false;
    LAB.rt.delete(m.id); LAB.evals.delete(m.id);
    if (AI.deployed && AI.deployed.id === m.id) { AI.deployed = null; updateSimMode(); }
    LAB.models = LAB.models.filter(x => x !== m);
    LAB.sel = LAB.models[0] ? LAB.models[0].id : null;
    labSave(true); renderLab(); toast(`« ${m.name} » supprimé`);
  }
  function deployModel(m) {
    const r = rtOf(m);
    AI.deployed = { id: m.id, name: m.name, fn: r.R.policy, tauA: m.env.tauA, amax: m.env.amax };
    S.sim.mode = 'ai'; save();
    setTab('simulation'); updateSimMode();
    if (!sim.armed && !sim.crashed) { ap.takeoff(sim); updateArmBtn(); }
    toast(`« ${m.name} » pilote maintenant le drone de la simulation`);
  }

  /* ----- Entraînement ----- */
  function startTrain(m) {
    if (isEvaluating(m)) return toast('Attendez la fin de l\'évaluation de ce modèle.');
    if (m.stats.iter >= m.stop.maxIter) return toast('Nombre maximal d\'itérations atteint : augmentez-le dans la configuration.');
    const r = rtOf(m);
    if (!r.gen) r.gen = DFLab.trainer(m, r.R, r.live);
    r.running = true; m.stopReason = null;
    refreshLabState();
  }
  function stopTrain(m, reason) {
    const r = LAB.rt.get(m.id); if (!r) return;
    r.running = false; m.stopReason = reason || 'mis en pause';
    DFLab.storeWeights(m, r.R);
    labSave(true); refreshLabState();
  }
  function resetModel(m) {
    stopTrain(m, null);
    LAB.rt.delete(m.id); LAB.evals.delete(m.id);
    m.weights = null; m.stats = { iter: 0, steps: 0, timeMs: 0 }; m.history = []; m.eval = null; m.stopReason = null; m.importedEval = null;
    if (AI.deployed && AI.deployed.id === m.id) { AI.deployed = null; updateSimMode(); }
    labSave(true); renderLab(); toast('Poids réinitialisés');
  }
  function onIteration(m) {
    const s = m.stop, h = m.history;
    let reason = null;
    if (m.stats.iter >= s.maxIter) reason = `${s.maxIter} itérations atteintes`;
    else if (h.length >= 3 && h.slice(-3).every(x => x.ok >= s.targetOk)) reason = `objectif de ${Math.round(s.targetOk * 100)} % de réussite atteint`;
    else if (m.stats.timeMs / 60000 >= s.maxMinutes) reason = `durée maximale de ${s.maxMinutes} min atteinte`;
    if (reason) { stopTrain(m, reason); toast(`${m.name} : entraînement terminé, ${reason}.`); }
    else labSave();
  }
  function startEval(m) {
    if (isRunning(m)) stopTrain(m, 'mis en pause pour l\'évaluation');
    const r = rtOf(m), o = LAB.evalOpts;
    const opts = { task: m.env.task, tauA: o.drone === 'drone' ? droneTau() : m.env.tauA, amax: m.env.amax, n: o.n, seed: o.seed };
    const out = {};
    LAB.evals.set(m.id, { gen: DFLab.evaluateGen(r.R.policy, opts, out), out, m });
    refreshLabState();
  }
  function finishEval(id) {
    const e = LAB.evals.get(id); if (!e) return;
    LAB.evals.delete(id);
    e.m.eval = e.out; e.m.importedEval = null;
    labSave(true);
    toast(`${e.m.name} : fiabilité ${fmtN(e.out.score, 1)}/100, note ${e.out.grade}`);
    if (S.ui.tab === 'lab') renderLab();
  }
  function pumpLab() {
    const jobs = [];
    for (const m of LAB.models) { const r = LAB.rt.get(m.id); if (r && r.running) jobs.push({ m, r }); }
    for (const [id, e] of LAB.evals) if (!e.out.done) jobs.push({ id, e });
    $('#tabbtn-lab').classList.toggle('busy', jobs.length > 0);
    if (!jobs.length) return;
    const slice = (S.ui.tab === 'lab' ? 13 : 6) / jobs.length;
    for (const j of jobs) {
      const t0 = performance.now(), end = t0 + slice;
      if (j.r) {
        while (performance.now() < end && j.r.running) { if (j.r.gen.next().value === 2) onIteration(j.m); }
        j.m.stats.timeMs += performance.now() - t0;
      } else {
        while (performance.now() < end && !j.e.out.done) j.e.gen.next();
        if (j.e.out.done) finishEval(j.id);
      }
    }
  }

  /* ----- Rendu : structure ----- */
  function renderLab() {
    const root = $('#tab-lab');
    LAB.mobileDetail = !!LAB.mobileDetail;
    LB.list = el('aside', { class: 'lab-list', 'aria-label': 'Modèles' });
    LB.main = el('section', { class: 'lab-main' });
    root.replaceChildren(el('div', { class: 'lab' + (LAB.mobileDetail ? ' show-detail' : '') + (LAB.models.length ? '' : ' is-empty') }, LB.list, LB.main));
    renderLabList(); renderLabMain();
  }
  function statusOf(m) {
    if (isEvaluating(m)) return ['run', `Évaluation ${Math.round((LAB.evals.get(m.id).out.progress || 0) * 100)} %`];
    if (isRunning(m)) return ['run', `Entraînement · it. ${m.stats.iter}`];
    if (m.stats.iter) return ['', `${m.stats.iter} it. · ${Math.round((m.stats.ok || 0) * 100)} % réussite`];
    if (m.weights) return ['', 'Importé'];
    return ['idle', 'Non entraîné'];
  }
  function renderLabList() {
    const list = LB.list;
    const items = LAB.models.map(m => {
      const [cls, txt] = statusOf(m);
      const ev = m.eval || m.importedEval;
      return el('button', { type: 'button', class: 'lab-card', 'aria-pressed': String(LAB.view === 'model' && m.id === LAB.sel), onclick: () => { LAB.sel = m.id; LAB.view = 'model'; LAB.mobileDetail = true; labSave(true); renderLab(); $('#side-panel').scrollTop = 0; } },
        el('div', { class: 'lab-card-top' }, el('span', { class: 'lab-card-name' }, m.name),
          ev ? el('span', { class: 'grade', style: `--g:${gradeColor(ev.grade)}` }, ev.grade) : null),
        el('div', { class: 'lab-card-meta' }, el('span', { class: 'tag' }, DFLab.ALGOS[m.algo].label), el('span', { class: 'tag' }, shortTask(m.env.task)), el('span', null, `${m.arch.layers.join('×')}`)),
        el('div', { class: 'lab-card-status ' + cls }, el('i'), txt));
    });
    list.replaceChildren(
      el('div', { class: 'lab-list-head' }, el('h2', null, 'Laboratoire IA'), el('span', { class: 'aside' }, `${LAB.models.length} modèle${LAB.models.length > 1 ? 's' : ''}`)),
      el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn primary', onclick: openNewModel }, 'Nouveau modèle'), el('button', { type: 'button', class: 'btn', onclick: openImportModel }, 'Importer')),
      el('button', { type: 'button', class: 'lab-board-btn', 'aria-pressed': String(LAB.view === 'board'), onclick: () => { LAB.view = 'board'; LAB.mobileDetail = true; renderLab(); $('#side-panel').scrollTop = 0; } }, 'Classement et comparaison'),
      el('div', { class: 'lab-cards' }, items));
    LAB.listSig = LAB.models.map(m => statusOf(m)[1] + (m.eval ? m.eval.grade : '')).join('|');
  }
  function labBackBtn() { return el('button', { type: 'button', class: 'btn small lab-back', onclick: () => { LAB.mobileDetail = false; renderLab(); } }, '‹ Tous les modèles'); }
  function renderLabMain() {
    const main = LB.main;
    LB.live = null;
    if (LAB.view === 'board') return renderBoard(main);
    const m = curModel();
    if (!m) {
      main.replaceChildren(el('div', { class: 'lab-empty' },
        el('h2', null, 'Entraînez et comparez vos propres modèles'),
        el('p', null, 'Choisissez un algorithme, dessinez le réseau, réglez l\'environnement, puis mesurez la fiabilité de chaque modèle sur un banc d\'essai commun avant de l\'exporter vers votre drone.'),
        el('div', { class: 'tpl-grid' }, TEMPLATES.map(t => el('button', { type: 'button', class: 'tpl', onclick: () => createFromTemplate(t) }, el('b', null, t.label), el('span', null, t.desc))))));
      return;
    }
    const nameIn = el('input', { type: 'text', id: 'lab-name', value: m.name, maxlength: 60, 'aria-label': 'Nom du modèle', class: 'lab-name' });
    nameIn.addEventListener('change', () => { m.name = nameIn.value.trim() || m.name; nameIn.value = m.name; labSave(true); renderLabList(); });
    const trained = m.stats.iter > 0 || !!m.weights;
    const subs = [['config', 'Configuration'], ['train', 'Entraînement'], ['eval', 'Fiabilité'], ['export', 'Export']];
    const body = el('div', { class: 'lab-body' });
    main.replaceChildren(
      el('div', { class: 'lab-head' },
        el('div', { class: 'lab-title' }, labBackBtn(), nameIn,
          el('div', { class: 'lab-card-meta' }, el('span', { class: 'tag' }, DFLab.ALGOS[m.algo].long), el('span', { class: 'tag' }, DFLab.TASKS[m.env.task].label),
            el('span', null, `${fmtN(DFLab.paramCount(m.arch, false))} paramètres · graine ${m.seed}`))),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn', disabled: !trained, onclick: () => deployModel(m) }, 'Piloter la simulation'),
          el('button', { type: 'button', class: 'btn', onclick: () => duplicateModel(m) }, 'Dupliquer'),
          confirmButton('Supprimer', 'Confirmer la suppression', () => deleteModel(m), 'danger'))),
      seg({ label: 'Section du modèle', value: LAB.sub, options: subs, onChange: v => { LAB.sub = v; renderLabBody(m, body); } }),
      body);
    renderLabBody(m, body);
  }
  function renderLabBody(m, body) {
    LB.live = null;
    const f = { config: labConfig, train: labTrain, eval: labEval, export: labExport }[LAB.sub] || labConfig;
    body.replaceChildren(...[].concat(f(m)).filter(Boolean));
    if (LAB.sub === 'train') updateLabTrain(m);
  }
  function refreshLabState() {
    if (S.ui.tab !== 'lab') return;
    renderLabList();
    const m = curModel();
    if (LAB.view === 'model' && m && (LAB.sub === 'train' || LAB.sub === 'eval')) renderLabMain();
    if (LAB.view === 'board') renderLabMain();
  }

  /* ----- Configuration ----- */
  const fmtHp = v => (v !== 0 && Math.abs(v) < 0.01 ? v.toExponential(1).replace('.', ',').replace('e', ' × 10^') : Number.isInteger(v) ? fmtN(v) : fmtN(v, Math.abs(v) < 1 ? 3 : 2));
  function ctlRange(obj, key, label, min, max, step, log, unit, onChange, disabled) {
    const toS = v => (log ? Math.log10(v) : v), fromS = v => (log ? +Math.pow(10, v).toPrecision(3) : v);
    const r = range({ id: `lab-${key}-${Math.random().toString(36).slice(2, 7)}`, label, min: toS(min), max: toS(max), step: log ? 0.05 : step, value: toS(obj[key]),
      fmt: v => `${fmtHp(fromS(v))}${unit ? ' ' + unit : ''}`, onInput: v => { obj[key] = fromS(v); if (onChange) onChange(); labSave(); } });
    if (disabled) r.querySelector('input').disabled = true;
    return r;
  }
  function labConfig(m) {
    const locked = m.stats.iter > 0 || !!m.weights;
    const relock = () => { LAB.rt.delete(m.id); m.weights = null; };
    const algoSel = select({ id: 'lab-algo', label: 'Algorithme', value: m.algo, options: Object.entries(DFLab.ALGOS).map(([k, a]) => [k, `${a.label} · ${a.long}`]),
      onChange: v => { m.algo = v; m.hp = DFLab.hpDefaults(v); m.stop.maxIter = DFLab.MAX_ITER[v]; relock(); labSave(true); renderLabMain(); renderLabListSoon(); } });
    const taskSel = select({ id: 'lab-task', label: 'Tâche', value: m.env.task, options: Object.entries(DFLab.TASKS).map(([k, t]) => [k, t.label]),
      onChange: v => { m.env.task = v; relock(); labSave(true); renderLabMain(); } });
    const seedIn = el('input', { type: 'number', id: 'lab-seed', min: 1, max: 999999999, step: 1, value: m.seed });
    seedIn.addEventListener('change', () => { m.seed = Math.max(1, Math.round(Number(seedIn.value)) || 1); seedIn.value = m.seed; relock(); labSave(true); renderLabMain(); });
    if (locked) { algoSel.input.disabled = true; taskSel.input.disabled = true; seedIn.disabled = true; }
    // Architecture
    const archBox = el('div', { class: 'lab-arch' });
    const drawArch = () => {
      const a = m.arch;
      const nSeg = seg({ label: 'Couches cachées', value: String(a.layers.length), options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
        onChange: v => { const n = Number(v); while (a.layers.length < n) a.layers.push(a.layers[a.layers.length - 1] || 32); a.layers.length = n; relock(); labSave(true); drawArch(); renderLabListSoon(); } });
      const actSeg = seg({ label: 'Activation', value: a.act, options: Object.entries(DFLab.ACTIVATIONS).map(([k, v]) => [k, v.label]), onChange: v => { a.act = v; relock(); labSave(true); drawArch(); } });
      if (locked) { nSeg.querySelectorAll('button').forEach(b => { b.disabled = true; }); actSeg.querySelectorAll('button').forEach(b => { b.disabled = true; }); }
      const layerCtl = a.layers.map((n, i) => ctlRange(a.layers, i, `Couche ${i + 1}`, 4, 256, 4, false, 'neurones', () => { relock(); updateInfo(); }, locked));
      const info = el('p', { class: 'note' });
      const updateInfo = () => {
        const p = DFLab.paramCount(a, false), macs = [9, ...a.layers, 3].reduce((s, x, i, arr) => s + (i ? arr[i - 1] * x : 0), 0);
        const neurons = a.layers.reduce((s, x) => s + x, 0);
        const cycles = macs * 3 + neurons * (a.act === 'tanh' || a.act === 'elu' ? 60 : 2);
        info.textContent = `${[9, ...a.layers, 3].join(' → ')} · ${fmtN(p)} paramètres (${fmtN(p * 4 / 1024, 1)} Ko en float32) · ${fmtN(macs)} multiplications par décision · environ ${fmtN(cycles / 216, 0)} µs sur un STM32F722.${DFLab.ALGOS[m.algo].grad ? ` Le critique ajoute ${fmtN(DFLab.paramCount(a, true) - p)} paramètres, utilisés seulement pendant l'entraînement.` : ''}`;
      };
      updateInfo();
      archBox.replaceChildren(el('div', { class: 'grid2' }, el('div', { class: 'field' }, el('label', null, 'Couches cachées'), nSeg), el('div', { class: 'field' }, el('label', null, 'Activation'), actSeg)), el('div', { class: 'lab-grid' }, layerCtl), info);
    };
    drawArch();
    // Hyperparamètres
    const hpCtl = DFLab.HP[m.algo].map(([k, label, min, max, step, def, scale]) => ctlRange(m.hp, k, label, min, max, step, scale === 'log', '', () => { if (m.algo === 'es' && k === 'pop' && m.hp.pop % 2) m.hp.pop += 1; }));
    // Environnement
    const units = {};
    const envCtl = DFLab.ENV_PARAMS.filter(p => p[0] !== 'targetSpeed' || m.env.task === 'pursuit').map(([k, label, min, max, step, unit]) => {
      const r = ctlRange(m.env, k, label, min, max, step, false, unit, () => { if (m.env.distMax < m.env.distMin) m.env.distMax = m.env.distMin; });
      units[k] = r; return r;
    });
    const useDrone = el('button', { type: 'button', class: 'btn small', onclick: () => { m.env.tauA = +droneTau().toFixed(3); units.tauA.set(m.env.tauA); labSave(true); toast(`Temps de réponse du drone actuel appliqué : ${fmtN(m.env.tauA * 1000)} ms`); } }, `Utiliser le drone actuel (${fmtN(droneTau() * 1000)} ms)`);
    const stopCtl = [
      ctlRange(m.stop, 'maxIter', 'Itérations maximales', 5, 3000, 5, false, ''),
      ctlRange(m.stop, 'targetOk', 'Arrêt si réussite ≥', 0.5, 1, 0.01, false, '', null),
      ctlRange(m.stop, 'maxMinutes', 'Durée maximale', 1, 180, 1, false, 'min'),
    ];
    stopCtl[1].querySelector('output').textContent = `${Math.round(m.stop.targetOk * 100)} %`;
    stopCtl[1].querySelector('input').addEventListener('input', () => { stopCtl[1].querySelector('output').textContent = `${Math.round(m.stop.targetOk * 100)} %`; });
    const resetHp = confirmButton('Rétablir les hyperparamètres par défaut', 'Confirmer', () => { m.hp = DFLab.hpDefaults(m.algo); labSave(true); renderLabMain(); });
    return [
      locked ? el('p', { class: 'lab-lock' }, 'Algorithme, tâche, graine et architecture sont figés car le modèle a des poids. Réinitialisez-les dans « Entraînement » ou dupliquez le modèle pour les changer. Les hyperparamètres, l\'environnement et les critères d\'arrêt restent modifiables pendant l\'entraînement.') : null,
      sec('Identité', null, el('div', { class: 'lab-grid' }, algoSel, taskSel, el('div', { class: 'field' }, el('label', { for: 'lab-seed' }, 'Graine aléatoire'), seedIn)),
        el('p', { class: 'note' }, DFLab.ALGOS[m.algo].desc, ' ', DFLab.TASKS[m.env.task].desc)),
      sec('Architecture du réseau', null, archBox),
      sec(`Hyperparamètres ${DFLab.ALGOS[m.algo].label}`, 'modifiables en cours d\'entraînement', el('div', { class: 'lab-grid' }, hpCtl), el('div', { class: 'btn-row' }, resetHp)),
      sec('Environnement d\'entraînement', 'appliqué aux épisodes suivants', el('div', { class: 'lab-grid' }, envCtl), el('div', { class: 'btn-row' }, useDrone),
        el('p', { class: 'note' }, 'La randomisation du domaine fait varier le temps de réponse et la traînée à chaque épisode : le modèle devient plus robuste aux différences entre la simulation et le vrai drone. Les poids de récompense définissent ce que le modèle cherche à optimiser.')),
      sec('Arrêt automatique', null, el('div', { class: 'lab-grid' }, stopCtl)),
    ];
  }
  let listSoon = 0;
  function renderLabListSoon() { clearTimeout(listSoon); listSoon = setTimeout(renderLabList, 150); }

  /* ----- Entraînement ----- */
  function labTrain(m) {
    const r = LAB.rt.get(m.id), running = isRunning(m);
    LB.live = { m };
    LB.kpis = kpiGrid([
      { id: 'iter', label: 'Itérations' }, { id: 'steps', label: 'Pas simulés' }, { id: 'time', label: 'Durée' },
      { id: 'ret', label: 'Retour moyen' }, { id: 'ok', label: 'Réussite', unit: '%' }, { id: 'std', label: m.algo === 'es' ? 'Bruit σ' : m.algo === 'cem' ? 'Écart-type moyen' : 'Exploration σ' },
    ], 'three');
    LB.prog = el('div', { class: 'progress' }, el('div', { style: 'width:0%' }));
    LB.progTxt = el('span', { class: 'aside' });
    LB.curve = el('canvas', { class: 'chart', role: 'img', 'aria-label': 'Courbe d\'apprentissage' });
    LB.preview = el('canvas', { class: 'chart tall', role: 'img', 'aria-label': 'Aperçu des épisodes en cours' });
    LB.status = el('p', { class: 'note' });
    return [
      sec('Pilotage', null,
        el('div', { class: 'btn-row' },
          running ? el('button', { type: 'button', class: 'btn', onclick: () => stopTrain(m, 'mis en pause') }, 'Mettre en pause')
            : el('button', { type: 'button', class: 'btn primary', disabled: isEvaluating(m), onclick: () => startTrain(m) }, m.stats.iter ? 'Reprendre l\'entraînement' : 'Lancer l\'entraînement'),
          confirmButton('Réinitialiser les poids', 'Confirmer : effacer l\'apprentissage', () => resetModel(m), 'danger')),
        el('div', { class: 'ctl-head' }, el('span', { class: 'note' }, 'Progression'), LB.progTxt), LB.prog, LB.status),
      el('div', { class: 'lab-two' },
        sec('Courbe d\'apprentissage', null, LB.kpis, LB.curve, el('div', { class: 'legend-row' }, el('span', null, el('i', { style: `background:${C.cyan}` }), 'Retour moyen'), el('span', null, el('i', { style: `background:${C.good}` }), 'Réussite (%)'))),
        sec('Aperçu en direct', m.env.task === 'landing' ? 'vue de côté' : 'vue de dessus', LB.preview,
          el('p', { class: 'note' }, ALGOSNOTE[DFLab.ALGOS[m.algo].grad ? 'grad' : 'evo']))),
    ];
  }
  const ALGOSNOTE = {
    grad: 'Chaque trait est un environnement parallèle : le drone (bleu) part d\'un point aléatoire et doit rejoindre la cible (orange). Les actions sont bruitées pour explorer ; le bruit diminue à mesure que le modèle progresse.',
    evo: 'Trajectoires du réseau moyen après la dernière génération, sur 8 épisodes neufs. Chaque génération évalue toute la population avant de mettre à jour les poids.',
  };
  function updateLabTrain(m) {
    if (!LB.kpis || !LB.kpis.isConnected) return;
    const h = m.history, last = h[h.length - 1], K = LB.kpis;
    K.setK('iter', fmtN(m.stats.iter));
    K.setK('steps', fmtN(m.stats.steps));
    const t = m.stats.timeMs / 1000;
    K.setK('time', t < 60 ? `${Math.round(t)} s` : `${Math.floor(t / 60)} min ${String(Math.round(t % 60)).padStart(2, '0')}`);
    K.setK('ret', last ? fmtN(last.ret, 1) : '—');
    K.setK('ok', last ? fmtN(last.ok * 100) : '—', last ? (last.ok >= m.stop.targetOk ? 'good' : '') : '');
    K.setK('std', last ? fmtN(last.std, 3) : '—');
    const p = Math.min(1, m.stats.iter / m.stop.maxIter);
    LB.prog.firstChild.style.width = (p * 100) + '%';
    let eta = '';
    if (isRunning(m) && m.stats.iter > 2) { const per = m.stats.timeMs / m.stats.iter; const left = (m.stop.maxIter - m.stats.iter) * per / 1000; eta = ` · reste au plus ${left < 90 ? Math.round(left) + ' s' : Math.round(left / 60) + ' min'}`; }
    LB.progTxt.textContent = `${m.stats.iter} / ${m.stop.maxIter} itérations${eta}`;
    LB.status.textContent = isRunning(m) ? `Entraînement en cours. La réussite affichée inclut le bruit d'exploration ; le banc de fiabilité la mesure sans bruit. Arrêt automatique à ${Math.round(m.stop.targetOk * 100)} % de réussite sur 3 itérations, à ${m.stop.maxIter} itérations ou après ${m.stop.maxMinutes} min.`
      : m.stopReason ? `Arrêté : ${m.stopReason}.` : m.stats.iter ? 'En pause.' : 'Prêt. L\'entraînement continue même si vous changez d\'onglet ; plusieurs modèles peuvent s\'entraîner en même temps.';
    if (h.length) {
      const maxR = Math.max(5, ...h.map(x => x.ret)), minR = Math.min(0, ...h.map(x => x.ret));
      drawChart(LB.curve, { x: [h[0].it, Math.max(h[0].it + 1, last.it)], xfmt: v => `it. ${Math.round(v)}`, left: { range: niceRange(minR, maxR), fmt: v => fmtN(v) }, right: { range: [0, 100], fmt: v => fmtN(v) + '%' },
        series: [{ data: h.map(x => [x.it, x.ret]), color: C.cyan, fill: true }, { data: h.map(x => [x.it, x.ok * 100]), color: C.good, axis: 'right' }] });
    } else drawChart(LB.curve, { x: [0, 10], xfmt: v => `it. ${Math.round(v)}`, left: { range: [-20, 25], fmt: v => fmtN(v) }, right: { range: [0, 100], fmt: v => fmtN(v) + '%' }, series: [] });
    const r = LAB.rt.get(m.id);
    drawPreview(LB.preview, m, r && r.live.envs);
  }
  function drawPreview(cv, m, envs) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const side = m.env.task === 'landing';
    const span = Math.max(4, m.env.distMax * 1.25);
    const sc = Math.min(W, H) / (2 * span) * 0.92;
    const cx = W / 2, cy = side ? H - 18 : H / 2;
    const P = (x, y, z) => side ? [cx + x * sc, cy - y * sc] : [cx + x * sc, cy + z * sc];
    g.strokeStyle = C.line; g.lineWidth = 1;
    const kx = Math.ceil(W / 2 / sc / 2) * 2, kz = Math.ceil(H / 2 / sc / 2) * 2;
    for (let k = -kx; k <= kx; k += 2) { const [x1] = P(k, 0, 0); g.beginPath(); g.moveTo(x1 + 0.5, 0); g.lineTo(x1 + 0.5, H); g.stroke(); }
    if (!side) for (let k = -kz; k <= kz; k += 2) { const [, y1] = P(0, 0, k); g.beginPath(); g.moveTo(0, y1 + 0.5); g.lineTo(W, y1 + 0.5); g.stroke(); }
    if (side) { g.strokeStyle = C.muted; g.beginPath(); g.moveTo(0, cy + 0.5); g.lineTo(W, cy + 0.5); g.stroke(); }
    g.font = '10px ' + (cssv('--font-mono') || 'monospace'); g.fillStyle = C.muted; g.textAlign = 'left';
    g.fillText(side ? 'x (m) / altitude (m)' : 'x / z (m), quadrillage 2 m', 8, 14);
    if (!envs || !envs.length) {
      g.fillStyle = C.muted; g.textAlign = 'center'; g.font = '12px ' + (cssv('--font-ui') || 'sans-serif');
      g.fillText('Lancez l\'entraînement pour voir les épisodes', W / 2, H / 2);
      return;
    }
    for (const e of envs) {
      const t = e.trail; if (!t || t.length < 2) continue;
      if (m.env.task === 'pursuit') {
        g.strokeStyle = C.accent; g.globalAlpha = 0.35; g.beginPath();
        t.forEach((q, i) => { const [x, y] = P(q[3], 0, q[4]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      }
      g.strokeStyle = C.cyan; g.globalAlpha = 0.55; g.lineWidth = 1.2; g.beginPath();
      t.forEach((q, i) => { const [x, y] = P(q[0], q[1], q[2]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      g.globalAlpha = 1;
      const q = t[t.length - 1], [x, y] = P(q[0], q[1], q[2]);
      g.fillStyle = C.cyan; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
      if (m.env.task === 'pursuit') { const [tx, ty] = P(q[3], 0, q[4]); g.fillStyle = C.accent; g.beginPath(); g.arc(tx, ty, 2.5, 0, TAU); g.fill(); }
    }
    if (m.env.task !== 'pursuit') {
      const [tx, ty] = P(0, 0, 0);
      g.strokeStyle = C.accent; g.lineWidth = 2; g.beginPath(); g.arc(tx, ty, Math.max(4, m.env.thr * sc), 0, TAU); g.stroke();
    }
  }

  /* ----- Fiabilité ----- */
  function labEval(m) {
    const ev = m.eval, running = isEvaluating(m), o = LAB.evalOpts;
    const nSeg = seg({ label: 'Épisodes par scénario', value: String(o.n), options: [['30', '30 (rapide)'], ['100', '100'], ['300', '300 (précis)']], onChange: v => { o.n = Number(v); labSave(true); } });
    const dSel = select({ id: 'lab-evdrone', label: 'Drone testé', value: o.drone, options: [['train', `Celui de l'entraînement (${fmtN(m.env.tauA * 1000)} ms)`], ['drone', `Drone actuel du module 1 (${fmtN(droneTau() * 1000)} ms)`]], onChange: v => { o.drone = v; labSave(true); } });
    const seedIn = el('input', { type: 'number', id: 'lab-evseed', min: 1, step: 1, value: o.seed });
    seedIn.addEventListener('change', () => { o.seed = Math.max(1, Math.round(Number(seedIn.value)) || 1); seedIn.value = o.seed; labSave(true); });
    const progress = el('div', { class: 'progress' }, el('div', { style: 'width:0%' }));
    LB.evProg = progress; LB.live = { m, eval: true };
    const head = sec('Banc d\'essai', `${DFLab.SCENARIOS.length} scénarios + courbe de vent`,
      el('div', { class: 'lab-grid' }, el('div', { class: 'field' }, el('label', null, 'Épisodes par scénario'), nSeg), dSel, el('div', { class: 'field' }, el('label', { for: 'lab-evseed' }, 'Graine du banc'), seedIn)),
      el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn primary', disabled: running, onclick: () => startEval(m) }, running ? 'Évaluation en cours…' : ev ? 'Relancer l\'évaluation' : 'Évaluer la fiabilité')),
      running ? progress : null,
      el('p', { class: 'note' }, 'Chaque scénario rejoue les mêmes épisodes (même graine) pour le modèle et pour un contrôleur PD classique de référence : la comparaison est appariée. Les actions sont déterministes, sans bruit d\'exploration. Pour comparer des modèles entre eux, gardez les mêmes réglages de banc.'));
    if (!ev) {
      const imp = m.importedEval;
      return [head, imp ? sec('Résultat déclaré dans le fichier importé', null, el('p', { class: 'note' }, `Score ${fmtN(imp.score, 1)}/100, note ${imp.grade}, mesuré ailleurs sur ${imp.n} épisodes par scénario. Relancez l'évaluation pour le vérifier sur ce banc.`)) : null].filter(Boolean);
    }
    const ref = ev.baseScore;
    const scoreBox = el('div', { class: 'lab-score' },
      el('div', { class: 'lab-score-big', style: `--g:${gradeColor(ev.grade)}` }, el('span', null, fmtN(ev.score, 1)), el('small', null, '/100'), el('b', null, ev.grade)),
      el('div', null, el('p', { class: 'lab-verdict' }, DFLab.verdict(ev)),
        el('p', { class: 'note' }, `Référence PD : ${fmtN(ref, 1)}/100 · ${ev.n} épisodes par scénario · drone à ${fmtN(ev.tauA * 1000)} ms · graine ${ev.seed} · ${new Date(ev.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`)));
    const pct = x => `${Math.round(x * 100)} %`, errL = DFLab.TASKS[ev.task].err;
    const rows = ev.scenarios.map(s => {
      const d = s.stats.success - s.base.success;
      return el('tr', null,
        el('td', null, s.label, el('span', { class: 'sub' }, s.desc)),
        el('td', { class: 'num' }, el('div', { class: 'ci' }, el('div', { class: 'ci-bar' }, el('i', { style: `left:${s.stats.ci[0] * 100}%;width:${(s.stats.ci[1] - s.stats.ci[0]) * 100}%` }), el('b', { style: `left:${s.stats.success * 100}%` })), el('span', null, pct(s.stats.success))), el('span', { class: 'sub' }, `IC 95 % ${pct(s.stats.ci[0])}–${pct(s.stats.ci[1])}`)),
        el('td', { class: 'num' }, pct(s.base.success), el('span', { class: 'sub', style: `color:${d > 0.02 ? C.good : d < -0.02 ? C.bad : C.muted}` }, `${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} pts`)),
        el('td', { class: 'num' }, fmtN(s.stats.err, 2), el('span', { class: 'sub' }, `P90 ${fmtN(s.stats.errP90, 2)}`)),
        el('td', { class: 'num' }, s.stats.ttr == null ? '—' : `${fmtN(s.stats.ttr, 1)} s`),
        el('td', { class: 'num', style: s.stats.lost + s.stats.crash > 0.02 ? `color:${C.bad}` : '' }, pct(s.stats.lost + s.stats.crash)));
    });
    const table = el('div', { class: 'table-wrap' }, el('table', { class: 'bom lab-table' },
      el('thead', null, el('tr', null, el('th', null, 'Scénario'), el('th', { class: 'num' }, 'Réussite'), el('th', { class: 'num' }, 'Référence PD'), el('th', { class: 'num' }, `${errL} (m)`), el('th', { class: 'num' }, 'Temps d\'atteinte'), el('th', { class: 'num' }, ev.task === 'landing' ? 'Pertes / chocs' : 'Pertes de contrôle'))),
      el('tbody', null, rows)));
    const sweepCv = el('canvas', { class: 'chart', role: 'img', 'aria-label': 'Réussite selon la force du vent' });
    const trajCv = el('canvas', { class: 'chart tall', role: 'img', 'aria-label': 'Trajectoires d\'évaluation' });
    const hasTrails = ev.scenarios.some(s => s.trails && s.trails.length);
    const trajChips = seg({ label: 'Scénario affiché', value: LAB.traj, options: ev.scenarios.map(s => [s.id, s.label]), onChange: v => { LAB.traj = v; drawTraj(trajCv, m, ev); } });
    const macs = [9, ...m.arch.layers, 3].reduce((s, x, i, arr) => s + (i ? arr[i - 1] * x : 0), 0);
    const neurons = m.arch.layers.reduce((s, x) => s + x, 0);
    const cycles = macs * 3 + neurons * (m.arch.act === 'tanh' || m.arch.act === 'elu' ? 60 : 2);
    const emb = kpiGrid([{ id: 'p', label: 'Paramètres' }, { id: 'mem', label: 'Mémoire flash', unit: 'Ko' }, { id: 'mac', label: 'Calcul / décision', unit: 'MAC' }, { id: 'js', label: 'Mesuré ici', unit: 'µs' }, { id: 'mcu', label: 'Estimé STM32F722', unit: 'µs' }, { id: 'budget', label: 'Budget utilisé', unit: '%' }], 'three');
    emb.setK('p', fmtN(DFLab.paramCount(m.arch, false))); emb.setK('mem', fmtN(DFLab.paramCount(m.arch, false) * 4 / 1024, 1)); emb.setK('mac', fmtN(macs));
    emb.setK('js', fmtN(ev.inferUs || 0, 1)); emb.setK('mcu', fmtN(cycles / 216)); emb.setK('budget', fmtN(cycles / 216 / (DFLab.DT * 1e6) * 100, 2));
    requestAnimationFrame(() => {
      const sw = ev.sweep;
      drawChart(sweepCv, { x: [0, sw[sw.length - 1].wind], xfmt: v => `${fmtN(v)} m/s²`, left: { range: [0, 100], fmt: v => fmtN(v) + '%' },
        series: [{ data: sw.map(w => [w.wind, w.model * 100]), color: C.cyan, fill: true }, { data: sw.map(w => [w.wind, w.base * 100]), color: C.muted }] });
      drawTraj(trajCv, m, ev);
    });
    return [head, scoreBox,
      sec('Résultats par scénario', null, table),
      el('div', { class: 'lab-two' },
        sec('Robustesse au vent', null, sweepCv, el('div', { class: 'legend-row' }, el('span', null, el('i', { style: `background:${C.cyan}` }), m.name), el('span', null, el('i', { style: `background:${C.muted}` }), 'Référence PD'))),
        sec('Trajectoires', '16 premiers épisodes', hasTrails ? trajChips : null, trajCv,
          el('div', { class: 'legend-row' }, el('span', null, el('i', { style: `background:${C.good}` }), 'Réussite'), el('span', null, el('i', { style: `background:${C.warn}` }), 'Échec'), el('span', null, el('i', { style: `background:${C.bad}` }), 'Perte de contrôle')))),
      sec('Faisabilité embarquée', 'décision toutes les 50 ms', emb, el('p', { class: 'note' }, 'L\'estimation STM32 suppose environ 3 cycles par multiplication-addition à 216 MHz et une activation tanh ou ELU logicielle. Mesurez sur la cible réelle avant de valider.')),
    ];
  }
  function drawTraj(cv, m, ev) {
    const s = ev.scenarios.find(x => x.id === LAB.traj) || ev.scenarios[0];
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!s || !s.trails || !s.trails.length) {
      g.fillStyle = C.muted; g.textAlign = 'center'; g.font = '12px ' + (cssv('--font-ui') || 'sans-serif');
      g.fillText('Relancez l\'évaluation pour afficher les trajectoires', W / 2, H / 2); return;
    }
    const side = ev.task === 'landing';
    let span = 4; for (const t of s.trails) for (const q of t.pts) span = Math.max(span, Math.abs(q[0]), side ? q[1] : Math.abs(q[2]));
    span = Math.min(span * 1.08, 25);
    const sc = Math.min(W, H) / (2 * span) * 0.92, cx = W / 2, cy = side ? H - 14 : H / 2;
    const P = q => side ? [cx + q[0] * sc, cy - q[1] * sc] : [cx + q[0] * sc, cy + q[2] * sc];
    g.strokeStyle = C.line; if (side) { g.beginPath(); g.moveTo(0, cy + 0.5); g.lineTo(W, cy + 0.5); g.stroke(); }
    for (const t of s.trails) {
      g.strokeStyle = t.lost ? C.bad : t.ok ? C.good : C.warn; g.globalAlpha = 0.75; g.lineWidth = 1.3; g.beginPath();
      t.pts.forEach((q, i) => { const [x, y] = P(q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      const [x0, y0] = P(t.pts[0]); g.globalAlpha = 1; g.fillStyle = C.muted; g.beginPath(); g.arc(x0, y0, 2.2, 0, TAU); g.fill();
      if (ev.task === 'pursuit') { g.strokeStyle = C.accent; g.globalAlpha = 0.3; g.beginPath(); t.pts.forEach((q, i) => { const x = cx + q[3] * sc, y = cy + q[4] * sc; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.globalAlpha = 1; }
    }
    if (ev.task !== 'pursuit') { const [tx, ty] = P([0, 0, 0]); g.strokeStyle = C.accent; g.lineWidth = 2; g.beginPath(); g.arc(tx, ty, Math.max(4, 0.5 * sc), 0, TAU); g.stroke(); }
    g.fillStyle = C.muted; g.font = '10px ' + (cssv('--font-mono') || 'monospace'); g.textAlign = 'left';
    g.fillText(`${s.label} · ${side ? 'vue de côté' : 'vue de dessus'} · ±${fmtN(span, 0)} m`, 8, 14);
  }

  /* ----- Export ----- */
  const slug = s => (s || 'modele').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'modele';
  const FORMATS = [
    { id: 'json', label: 'Modèle DroneForge', ext: 'json', mime: 'application/json', desc: 'Poids, configuration, courbe d\'apprentissage et résultats de fiabilité. Se réimporte dans le laboratoire.', make: m => DFLab.exportJSON(m) },
    { id: 'c', label: 'C embarqué', ext: 'h', mime: 'text/x-c', desc: 'En-tête autonome pour STM32, ESP32 ou Arduino : poids en flash, aucune allocation dynamique, fonctions df_observe() et df_policy().', make: m => DFLab.exportC(m), name: m => DFLab.cIdent(m.name).toLowerCase() + '.h' },
    { id: 'py', label: 'Python / NumPy', ext: 'py', mime: 'text/x-python', desc: 'Inférence NumPy, plus une fonction to_torch() pour passer à PyTorch puis ONNX.', make: m => DFLab.exportPython(m) },
    { id: 'js', label: 'JavaScript', ext: 'mjs', mime: 'text/javascript', desc: 'Module ES autonome pour navigateur ou Node.js.', make: m => DFLab.exportJS(m) },
    { id: 'md', label: 'Rapport de fiabilité', ext: 'md', mime: 'text/markdown', desc: 'Score, verdict, tableau par scénario et courbe de vent, au format Markdown.', make: m => DFLab.exportReport(m) },
    { id: 'csv', label: 'Courbe d\'apprentissage', ext: 'csv', mime: 'text/csv', desc: 'Retour, réussite et exploration à chaque itération, séparateur point-virgule.', make: m => DFLab.exportCSV(m) },
  ];
  function labExport(m) {
    const trained = m.stats.iter > 0 || !!m.weights;
    const cards = FORMATS.map(f => {
      const fname = () => (f.name ? f.name(m) : `${slug(m.name)}.${f.ext}`);
      return el('div', { class: 'info-card' },
        el('h4', null, f.label, ' ', el('span', { class: 'ref' }, '.' + f.ext)),
        el('p', { class: 'note' }, f.desc),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', class: 'btn small primary', onclick: () => download(fname(), f.make(m), f.mime) }, 'Télécharger'),
          el('button', { type: 'button', class: 'btn small', onclick: () => copyText(f.make(m), `${f.label} copié`) }, 'Copier'),
          el('button', { type: 'button', class: 'btn small', onclick: () => { const txt = f.make(m); modal(`${f.label} · ${fname()}`, el('textarea', { readonly: true, style: 'min-height:320px', 'aria-label': f.label }, txt), () => [el('button', { type: 'button', class: 'btn primary', onclick: () => copyText(txt, 'Copié') }, 'Copier')]); } }, 'Aperçu')));
    });
    return [
      !trained ? el('p', { class: 'lab-lock' }, 'Ce modèle n\'est pas encore entraîné : les exports contiendront des poids aléatoires.') : null,
      !m.eval && trained ? el('p', { class: 'lab-lock' }, 'Ce modèle n\'a pas été évalué : le rapport de fiabilité sera vide. Passez par « Fiabilité » avant de l\'exporter vers un drone.') : null,
      sec('Formats d\'export', null, el('div', { class: 'lab-grid wide' }, cards)),
      sec('Contrat d\'interface', 'identique dans tous les formats',
        el('ul', { class: 'checks' },
          el('li', { class: 'info' }, 'Entrée 1 à 3 : position de la cible moins celle du drone, en mètres, divisée par 5 et bornée à ±3.'),
          el('li', { class: 'info' }, 'Entrée 4 à 6 : vitesse du drone moins celle de la cible, en m/s, divisée par 5 et bornée à ±3.'),
          el('li', { class: 'info' }, 'Entrée 7 à 9 : accélération actuellement appliquée, en m/s², divisée par 6.'),
          el('li', { class: 'info' }, `Sortie : accélération demandée sur x, y, z entre −1 et 1, à multiplier par ${fmtN(m.env.amax, 1)} m/s². Axe y vers le haut.`),
          el('li', { class: 'info' }, `Fréquence : une décision toutes les ${DFLab.DT * 1000} ms. Le contrôleur d'attitude du drone transforme cette accélération en inclinaison et en poussée.`))),
    ];
  }

  /* ----- Classement ----- */
  function renderBoard(main) {
    const ms = LAB.models;
    if (!ms.length) { LAB.view = 'model'; return renderLabMain(); }
    const evald = ms.filter(m => m.eval).sort((a, b) => b.eval.score - a.eval.score);
    const others = ms.filter(m => !m.eval);
    const colors = seriesColors(), colorOf = m => colors[ms.indexOf(m) % colors.length];
    const trainAll = () => { let n = 0; for (const m of ms) if (!isRunning(m) && m.stats.iter < m.stop.maxIter && !isEvaluating(m)) { startTrain(m); n++; } toast(n ? `${n} entraînement${n > 1 ? 's' : ''} lancé${n > 1 ? 's' : ''} en parallèle` : 'Rien à lancer'); };
    const evalAll = () => { let n = 0; for (const m of ms) if ((m.stats.iter || m.weights) && !isEvaluating(m)) { startEval(m); n++; } toast(n ? `${n} évaluation${n > 1 ? 's' : ''} lancée${n > 1 ? 's' : ''} avec les mêmes réglages de banc` : 'Aucun modèle entraîné à évaluer'); };
    const anyRun = ms.some(isRunning);
    const row = (m, rank) => {
      const ev = m.eval, [, st] = statusOf(m);
      return el('tr', { class: 'clickable', onclick: () => { LAB.sel = m.id; LAB.view = 'model'; LAB.sub = ev ? 'eval' : 'train'; renderLab(); } },
        el('td', { class: 'num' }, rank || '—'),
        el('td', null, el('span', { class: 'dotc', style: `background:${colorOf(m)}` }), m.name, el('span', { class: 'sub' }, `${DFLab.ALGOS[m.algo].label} · ${shortTask(m.env.task)} · ${m.arch.layers.join('×')} ${DFLab.ACTIVATIONS[m.arch.act].label}`)),
        el('td', { class: 'num' }, fmtN(DFLab.paramCount(m.arch, false))),
        el('td', { class: 'num' }, st),
        el('td', { class: 'num' }, ev ? fmtN(ev.score, 1) : '—', ev ? el('span', { class: 'sub' }, `PD ${fmtN(ev.baseScore, 1)}`) : null),
        el('td', { class: 'num' }, ev ? el('span', { class: 'grade', style: `--g:${gradeColor(ev.grade)}` }, ev.grade) : '—'),
        el('td', { class: 'num' }, ev ? `${ev.n} × ${fmtN(ev.tauA * 1000)} ms` : '—'));
    };
    const table = el('div', { class: 'table-wrap' }, el('table', { class: 'bom lab-table' },
      el('thead', null, el('tr', null, el('th', { class: 'num' }, 'Rang'), el('th', null, 'Modèle'), el('th', { class: 'num' }, 'Paramètres'), el('th', { class: 'num' }, 'État'), el('th', { class: 'num' }, 'Score'), el('th', { class: 'num' }, 'Note'), el('th', { class: 'num' }, 'Banc'))),
      el('tbody', null, evald.map((m, i) => row(m, i + 1)), others.map(m => row(m, 0)))));
    const sameBench = evald.length < 2 || evald.every(m => m.eval.n === evald[0].eval.n && Math.abs(m.eval.tauA - evald[0].eval.tauA) < 1e-6 && m.eval.seed === evald[0].eval.seed && m.eval.task === evald[0].eval.task);
    let heat = null;
    if (evald.length) {
      heat = el('div', { class: 'table-wrap' }, el('table', { class: 'bom lab-table heat' },
        el('thead', null, el('tr', null, el('th', null, 'Modèle'), DFLab.SCENARIOS.map(s => el('th', { class: 'num' }, s.label)))),
        el('tbody', null, evald.map(m => el('tr', null, el('td', null, el('span', { class: 'dotc', style: `background:${colorOf(m)}` }), m.name),
          m.eval.scenarios.map(s => el('td', { class: 'num heat-cell', style: `--h:${Math.round(s.stats.success * 120)}`, title: `IC 95 % ${Math.round(s.stats.ci[0] * 100)}–${Math.round(s.stats.ci[1] * 100)} %` }, `${Math.round(s.stats.success * 100)} %`)))),
          el('tr', null, el('td', null, el('span', { class: 'dotc', style: `background:${C.muted}` }), 'Référence PD'), (evald[0].eval.scenarios).map(s => el('td', { class: 'num heat-cell', style: `--h:${Math.round(s.base.success * 120)}` }, `${Math.round(s.base.success * 100)} %`))))));
    }
    const curves = el('canvas', { class: 'chart tall', role: 'img', 'aria-label': 'Courbes d\'apprentissage comparées' });
    const wind = el('canvas', { class: 'chart tall', role: 'img', 'aria-label': 'Robustesse au vent comparée' });
    const legend = el('div', { class: 'legend-row' }, ms.map(m => el('span', null, el('i', { style: `background:${colorOf(m)}` }), m.name)));
    main.replaceChildren(...[
      el('div', { class: 'lab-head' }, el('div', { class: 'lab-title' }, labBackBtn(), el('h2', null, 'Classement et comparaison'), el('p', { class: 'note' }, 'Classement par score de fiabilité, mesuré sans bruit d\'exploration sur le banc d\'essai. La réussite affichée pendant l\'entraînement inclut ce bruit : elle est normalement plus basse. Cliquez une ligne pour ouvrir le modèle.')),
        el('div', { class: 'btn-row' },
          anyRun ? el('button', { type: 'button', class: 'btn', onclick: () => ms.forEach(m => isRunning(m) && stopTrain(m, 'mis en pause')) }, 'Tout mettre en pause') : el('button', { type: 'button', class: 'btn primary', onclick: trainAll }, 'Entraîner tous les modèles'),
          el('button', { type: 'button', class: 'btn', onclick: evalAll }, 'Évaluer tous les modèles'))),
      !sameBench ? el('p', { class: 'lab-lock' }, 'Les modèles n\'ont pas été évalués avec les mêmes réglages de banc (épisodes, drone testé, graine ou tâche) : leurs scores ne sont pas directement comparables. Relancez « Évaluer tous les modèles ».') : null,
      sec('Classement', null, table),
      heat ? sec('Réussite par scénario', null, heat) : null,
      el('div', { class: 'lab-two' },
        sec('Apprentissage', 'réussite selon les pas simulés', curves, legend),
        sec('Robustesse au vent', 'modèles évalués', wind, el('div', { class: 'legend-row' }, evald.map(m => el('span', null, el('i', { style: `background:${colorOf(m)}` }), m.name)), evald.length ? el('span', null, el('i', { style: `background:${C.muted}` }), 'Référence PD') : null))),
    ].filter(Boolean));
    LB.live = { board: true };
    requestAnimationFrame(() => drawBoardCharts(curves, wind, ms, evald, colorOf));
    LB.boardCharts = () => drawBoardCharts(curves, wind, ms, evald, colorOf);
  }
  function drawBoardCharts(curves, wind, ms, evald, colorOf) {
    const withH = ms.filter(m => m.history.length);
    const maxS = Math.max(1000, ...withH.map(m => m.history[m.history.length - 1].steps));
    drawChart(curves, { x: [0, maxS], xfmt: v => (v >= 1e6 ? fmtN(v / 1e6, 1) + ' M' : fmtN(v / 1000) + ' k'), left: { range: [0, 100], fmt: v => fmtN(v) + '%' },
      series: withH.map(m => ({ data: m.history.map(h => [h.steps, h.ok * 100]), color: colorOf(m) })) });
    const sw = evald.length ? evald[0].eval.sweep : DFLab.SWEEP.map(w => ({ wind: w, base: 0 }));
    drawChart(wind, { x: [0, DFLab.SWEEP[DFLab.SWEEP.length - 1]], xfmt: v => `${fmtN(v)} m/s²`, left: { range: [0, 100], fmt: v => fmtN(v) + '%' },
      series: evald.map(m => ({ data: m.eval.sweep.map(w => [w.wind, w.model * 100]), color: colorOf(m) })).concat(evald.length ? [{ data: sw.map(w => [w.wind, w.base * 100]), color: C.muted, dot: false }] : []) });
  }

  /* ----- Mise à jour en direct ----- */
  let labT = 0;
  function updateLabLive(dt) {
    labT += dt;
    if (labT < 0.25) return;
    labT = 0;
    const sig = LAB.models.map(m => statusOf(m)[1] + (m.eval ? m.eval.grade : '')).join('|');
    if (sig !== LAB.listSig && LB.list) renderLabList();
    if (!LB.live) return;
    if (LB.live.board) { if (LAB.models.some(isRunning) && LB.boardCharts) LB.boardCharts(); return; }
    const m = LB.live.m; if (!m || !LAB.models.includes(m)) return;
    if (LAB.sub === 'train') updateLabTrain(m);
    if (LAB.sub === 'eval' && LB.evProg) { const e = LAB.evals.get(m.id); if (e) LB.evProg.firstChild.style.width = Math.round((e.out.progress || 0) * 100) + '%'; }
  }

  /* ================= Propagation des changements ================= */
  let rebuildTimer = 0, pendingScopes = new Set();
  function changed(scope) {
    SUM = DF.summarize(S.cfg);
    S.cfg = SUM.cfg;
    save();
    updateHeader(); updateMotorPanel(); updateBoardPanel(); updateProdPanel(); updateGainNote(); updateAIPanel(true);
    sim.configure(SUM);
    pendingScopes.add(scope);
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      const all = pendingScopes.has('all');
      if (all || pendingScopes.has('motor')) { rebuildMotor(); rebuildSimDrone(); rebuildProdDrone(); }
      if (all || pendingScopes.has('board') || pendingScopes.has('motor')) rebuildBoard();
      if (all && !pendingScopes.has('motor')) { rebuildSimDrone(); rebuildProdDrone(); }
      pendingScopes.clear();
    }, 120);
  }

  /* ================= Onglets ================= */
  function updateHint() {
    const v = views[S.ui.tab];
    const hint = v ? (typeof v.hint === 'function' ? v.hint() : v.hint) : '';
    $('#vp-hint').textContent = hint;
    $('#vp-hint').hidden = !hint || !HAS3D;
    $('#vp-legend').replaceChildren(...(HAS3D && v && v.legend ? v.legend() : []).map(([t, c]) => el('span', null, el('i', { style: `background:${c}` }), t)));
  }
  const SCREEN_TITLES = { motor: 'Atelier moteur', simulation: 'Simulation de vol', ai: 'IA · entraînement PPO', motherboard: 'Carte mère', production: 'Production', lab: 'Laboratoire IA' };
  const tabHistory = [];
  function setTab(tab, fromBack) {
    if (!TABS.includes(tab)) return;
    if (!fromBack && S.ui.tab !== tab) { tabHistory.push(S.ui.tab); if (tabHistory.length > 20) tabHistory.shift(); }
    const prev = S.ui.tab;
    if (camTab && views[camTab]) storeCam(views[camTab]);
    S.ui.tab = tab; save();
    TABS.forEach(t => {
      const b = $('#tabbtn-' + t), p = $('#tab-' + t);
      b.setAttribute('aria-selected', String(t === tab)); b.tabIndex = t === tab ? 0 : -1; p.hidden = t !== tab;
    });
    if (controls) controls.autoRotate = false;
    $('#workspace-body').classList.toggle('lab-mode', tab === 'lab');
    $('#screen-title').textContent = SCREEN_TITLES[tab];
    if (tab === 'lab') renderLab();
    updateSticks();
    if (views[tab]) { applyCam(views[tab]); camTab = tab; }
    $('#vp-tip').hidden = true; $('#vp-hud').hidden = tab !== 'simulation';
    if (renderer) renderer.domElement.style.cursor = '';
    updateHint(); updateBanner();
    $('#side-panel').scrollTop = 0;
    if (history.replaceState) history.replaceState(null, '', '#' + tab);
    requestAnimationFrame(() => { if (tab === 'motor') updateMotorPanel(); if (tab === 'ai') updateAIPanel(true); if (tab === 'simulation') updateSimPanel(); });
  }
  function initTabs() {
    const btns = TABS.map(t => $('#tabbtn-' + t));
    btns.forEach((b, i) => {
      b.addEventListener('click', () => { if (S.ui.tab !== TABS[i]) tap(); setTab(TABS[i]); });
      b.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        setTab(TABS[j]); btns[j].focus();
      });
    });
  }

  /* ================= Projet : export / import ================= */
  function initProjectButtons() {
    $('#btn-export').addEventListener('click', () => {
      const txt = JSON.stringify({ format: 'droneforge-project-2', savedAt: new Date().toISOString(), state: S }, null, 2);
      const ta = el('textarea', { readonly: true, 'aria-label': 'Projet au format JSON' }, txt);
      modal('Exporter le projet', el('div', { class: 'field' }, el('p', { class: 'note' }, 'Configuration, points de passage, réglages et liste d\'assemblage. Les poids de l\'IA s\'exportent depuis le module 3.'), ta), () => [
        el('button', { type: 'button', class: 'btn primary', onclick: () => { ta.select(); copyText(txt, 'Projet copié'); } }, 'Copier'),
        el('button', { type: 'button', class: 'btn', onclick: () => download(`droneforge-${SUM.designation}.json`, txt, 'application/json') }, 'Télécharger'),
      ]);
    });
    $('#btn-import').addEventListener('click', () => {
      const ta = el('textarea', { placeholder: 'Collez ici un projet DroneForge (JSON)', 'aria-label': 'Projet au format JSON' });
      const file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Fichier projet' });
      file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ta.value = r.result; }; r.readAsText(f); });
      modal('Importer un projet', el('div', { class: 'field' }, file, ta), close => [
        el('button', { type: 'button', class: 'btn primary', onclick: () => {
          try {
            const j = JSON.parse(ta.value);
            if (!j || j.format !== 'droneforge-project-2' || !j.state) throw new Error('fichier non reconnu');
            S = validateState(mergeState(defaultState(), j.state));
            store.set(STORE_KEY, S);
            close(); toast('Projet importé, rechargement…');
            setTimeout(() => location.reload(), 600);
          } catch (e) { toast(`Import impossible : ${e.message}`); }
        } }, 'Importer'),
        confirmButton('Réinitialiser le projet', 'Confirmer : tout effacer', () => { store.del(STORE_KEY); location.reload(); }, 'danger'),
      ]);
    });
  }

  /* ================= Clavier ================= */
  function initKeys() {
    const typing = e => /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') && e.target.type !== 'range' && e.target.type !== 'checkbox';
    document.addEventListener('keydown', e => {
      if (typing(e) || $('#modal-root').firstChild) return;
      const flying = S.ui.tab === 'simulation' && S.sim.mode === 'manual';
      if (!flying && !e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-6]$/.test(e.code)) { setTab(TABS[Number(e.code.slice(5)) - 1]); return; }
      if (flying) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
        keys[e.code] = true;
      }
    });
    document.addEventListener('keyup', e => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  }

  /* ================= Boucle principale ================= */
  let last = performance.now(), panelT = 0, diagT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    pumpTraining();
    pumpLab();
    if (S.ui.tab === 'lab') updateLabLive(dt);
    if (S.ui.tab === 'simulation') simTick(dt);
    if (S.ui.tab === 'ai') demoTick(dt);
    const v = views[S.ui.tab];
    if (renderer && v) {
      // Garde-fous : taille du rendu toujours à jour, caméra jamais perdue (NaN ou trop loin)
      const cw = vp.clientWidth, ch = vp.clientHeight, sz = renderer.getSize(new THREE.Vector2());
      if (cw && ch && (Math.abs(sz.x - cw) > 1 || Math.abs(sz.y - ch) > 1)) resize();
      const p = camera.position;
      if (!Number.isFinite(p.x + p.y + p.z) || (controls && (!Number.isFinite(controls.target.x + controls.target.y + controls.target.z) || p.distanceTo(controls.target) < 1e-3))) applyCam(v, true);
      else if (controls && controls.maxDistance < Infinity && p.distanceTo(controls.target) > controls.maxDistance * 1.05) applyCam(v, true);
      v.update(dt); if (controls) controls.update(); renderer.render(v.scene, camera);
    }
    panelT += dt;
    if (panelT > 0.1) {
      panelT = 0;
      if (S.ui.tab === 'simulation') updateSimPanel();
      if (S.ui.tab === 'ai' || AI.running) updateAIPanel(false);
    }
  }

  /* ================= Manches virtuels ================= */
  function updateSticks() {
    const box = $('#vp-sticks'); if (!box) return;
    box.hidden = !(HAS3D && S.ui.tab === 'simulation' && S.sim.mode === 'manual');
    vp.classList.toggle('sticks-on', !box.hidden);
    if (box.hidden) { STICK.lx = STICK.ly = STICK.rx = STICK.ry = 0; box.querySelectorAll('.stick-knob').forEach(k => { k.style.transform = ''; }); }
  }
  function initSticks() {
    const bind = (id, kx, ky) => {
      const st = $('#' + id), knob = st.querySelector('.stick-knob');
      let pid = null;
      const set = (x, y) => { STICK[kx] = x; STICK[ky] = y; const r = st.clientWidth * 0.32; knob.style.transform = `translate(${x * r}px, ${y * r}px)`; };
      const move = e => {
        const b = st.getBoundingClientRect(), r = b.width * 0.32;
        let x = (e.clientX - (b.left + b.width / 2)) / r, y = (e.clientY - (b.top + b.height / 2)) / r;
        const n = Math.hypot(x, y); if (n > 1) { x /= n; y /= n; }
        set(x, y);
      };
      st.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; st.setPointerCapture(pid); st.classList.add('on'); tap(); move(e); });
      st.addEventListener('pointermove', e => { if (e.pointerId === pid) { e.preventDefault(); move(e); } });
      const end = e => { if (e.pointerId !== pid) return; pid = null; st.classList.remove('on'); set(0, 0); };
      st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end); st.addEventListener('lostpointercapture', end);
    };
    bind('stick-left', 'lx', 'ly'); bind('stick-right', 'rx', 'ry');
  }

  /* ================= Menu, présentation, informations légales ================= */
  const ICONS = {
    export: '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V13"/>',
    import: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 13v6.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V13"/>',
    tour: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
    privacy: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
    licenses: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  };
  const svgIco = k => { const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); t.setAttribute('viewBox', '0 0 24 24'); t.setAttribute('aria-hidden', 'true'); t.innerHTML = ICONS[k]; return t; };
  function openMenu() {
    const item = (ico, label, sub, fn) => el('button', { type: 'button', class: 'sheet-item', onclick: () => { if (modalClose) modalClose(); fn(); } }, svgIco(ico), el('span', null, label, sub ? el('small', null, sub) : null));
    modal('DroneForge', el('div', { class: 'sheet-list' },
      item('export', 'Exporter le projet', 'Enregistrer ou partager votre configuration', () => $('#btn-export').click()),
      item('import', 'Importer un projet', 'Ouvrir un fichier .json DroneForge', () => $('#btn-import').click()),
      item('tour', 'Revoir la présentation', null, () => openOnboarding()),
      item('privacy', 'Confidentialité', 'Aucune donnée collectée', () => openPrivacy()),
      item('licenses', 'Licences', 'Logiciels libres utilisés', () => openLicenses()),
      item('about', 'À propos', `Version ${APP_VERSION}`, () => openAbout())), () => []);
  }
  const ONB = [
    { t: 'Concevez votre drone', p: 'Choisissez moteur, hélice, batterie et châssis. DroneForge calcule la poussée, le courant, la température et l\'autonomie en temps réel.', art: 'motor' },
    { t: 'Pilotez-le en simulation', p: 'Faites voler votre configuration avec du vent et des rafales : points de passage, pilotage aux manches ou pilote automatique.', art: 'flight' },
    { t: 'Entraînez une IA', p: 'Un réseau de neurones apprend à piloter directement sur votre téléphone. Comparez plusieurs modèles, mesurez leur fiabilité et exportez-les.', art: 'ai' },
  ];
  function onbArt(kind) {
    const W = 320, H = 140, c = { a: C.accent, c: C.cyan, g: C.good, l: C.line2, m: C.muted };
    const k = {
      motor: `<circle cx="160" cy="70" r="46" fill="none" stroke="${c.l}" stroke-width="2"/><circle cx="160" cy="70" r="30" fill="${c.a}" opacity=".9"/><circle cx="160" cy="70" r="9" fill="#0a0f18"/>` + Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return `<rect x="${160 + Math.cos(a) * 38 - 4}" y="${70 + Math.sin(a) * 38 - 4}" width="8" height="8" rx="2" fill="${[c.a, c.c, '#c98bff'][i % 3]}" opacity=".85"/>`; }).join(''),
      flight: `<path d="M20 120 Q 100 30 160 70 T 300 40" fill="none" stroke="${c.c}" stroke-width="2" stroke-dasharray="5 5"/><g transform="translate(160 70)"><rect x="-10" y="-5" width="20" height="10" rx="3" fill="${c.a}"/><g stroke="${c.m}" stroke-width="2"><line x1="-24" y1="-12" x2="24" y2="12"/><line x1="-24" y1="12" x2="24" y2="-12"/></g><g fill="none" stroke="${c.c}" stroke-width="2"><ellipse cx="-24" cy="-12" rx="11" ry="3"/><ellipse cx="24" cy="12" rx="11" ry="3"/><ellipse cx="-24" cy="12" rx="11" ry="3"/><ellipse cx="24" cy="-12" rx="11" ry="3"/></g></g><circle cx="300" cy="40" r="7" fill="none" stroke="${c.a}" stroke-width="2"/>`,
      ai: (() => { const L = [[3, 60], [5, 130], [5, 190], [3, 260]]; let o = ''; const pos = L.map(([n, x]) => Array.from({ length: n }, (_, i) => [x, 70 + (i - (n - 1) / 2) * 24])); for (let l = 0; l < 3; l++) for (const a of pos[l]) for (const b of pos[l + 1]) o += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${(a[1] + b[1]) % 3 > 1 ? c.a : c.c}" stroke-opacity=".35"/>`; for (const col of pos) for (const q of col) o += `<circle cx="${q[0]}" cy="${q[1]}" r="6" fill="#16202f" stroke="${c.g}" stroke-width="2"/>`; return o; })(),
    }[kind];
    const d = el('div', { class: 'onb-art' }); d.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${k}</svg>`; return d;
  }
  function openOnboarding() {
    let i = 0;
    const body = el('div', { class: 'onb' });
    const draw = () => {
      const s = ONB[i];
      body.replaceChildren(...[onbArt(s.art), el('h2', null, s.t), el('p', null, s.p),
        el('div', { class: 'onb-dots' }, ONB.map((_, j) => el('i', { class: j === i ? 'on' : '' }))),
        el('div', { class: 'btn-row' },
          i > 0 ? el('button', { type: 'button', class: 'btn', onclick: () => { i--; draw(); } }, 'Précédent') : el('button', { type: 'button', class: 'btn', onclick: done }, 'Passer'),
          el('button', { type: 'button', class: 'btn primary', onclick: () => { if (i < ONB.length - 1) { i++; draw(); } else done(); } }, i < ONB.length - 1 ? 'Suivant' : 'Commencer')),
        i === ONB.length - 1 ? el('p', { class: 'note', style: 'font-size:11.5px' }, 'Les résultats sont des estimations issues d\'un modèle simplifié. Ils aident à comparer des configurations et ne remplacent pas des essais réels.') : null].filter(Boolean));
    };
    const done = () => { try { localStorage.setItem('droneforge.onboarded', '1'); } catch (e) { /* stockage indisponible */ } if (modalClose) modalClose(); };
    draw();
    modal(null, body, () => null);
  }
  function openPrivacy() {
    modal('Confidentialité', el('div', { class: 'legal' },
      el('p', null, el('b', null, 'DroneForge ne collecte, ne transmet et ne partage aucune donnée personnelle.')),
      el('h3', null, 'Données enregistrées'),
      el('p', null, 'Vos configurations, réglages, modèles d\'IA et résultats sont enregistrés uniquement sur cet appareil, dans le stockage de l\'application. Ils ne quittent l\'appareil que si vous les exportez vous-même.'),
      el('h3', null, 'Aucun compte, aucune publicité, aucun suivi'),
      el('p', null, 'L\'application ne demande pas de compte, n\'affiche pas de publicité, n\'utilise pas d\'outil de mesure d\'audience et fonctionne entièrement hors ligne.'),
      el('h3', null, 'Permissions'),
      el('p', null, 'Aucune permission sensible (position, caméra, micro, contacts, fichiers) n\'est demandée. Le partage d\'un export passe par le menu de partage d\'Android, que vous déclenchez vous-même.'),
      el('h3', null, 'Effacer vos données'),
      el('p', null, 'Désinstallez l\'application, ou effacez ses données dans Paramètres > Applications > DroneForge > Stockage.'),
      el('h3', null, 'Éditeur'),
      el('p', null, 'HK Studio, Abidjan, Côte d\'Ivoire · hkstudio-ci.com')), () => []);
  }
  function openLicenses() {
    const lic = [
      ['Three.js r128', 'MIT', 'Copyright © 2010-2021 three.js authors'],
      ['Capacitor', 'MIT', 'Copyright © 2017-present Ionic'],
      ['Inter', 'SIL Open Font License 1.1', 'Copyright © 2016 The Inter Project Authors'],
      ['JetBrains Mono', 'SIL Open Font License 1.1', 'Copyright © 2020 The JetBrains Mono Project Authors'],
    ];
    modal('Licences', el('div', { class: 'legal' },
      el('p', null, 'DroneForge utilise les logiciels libres suivants. Leurs licences autorisent la redistribution sous réserve de conserver ces mentions.'),
      el('ul', null, lic.map(([n, l, c]) => el('li', null, el('b', null, n), ` — ${l}. ${c}.`))),
      el('p', null, 'Le texte complet de la licence MIT : la permission est accordée, gratuitement, à toute personne obtenant une copie de ce logiciel, de l\'utiliser, le copier, le modifier, le fusionner, le publier et le distribuer, sous réserve d\'inclure l\'avis de copyright et cet avis de permission. Le logiciel est fourni « tel quel », sans garantie d\'aucune sorte.')), () => []);
  }
  function openAbout() {
    modal('À propos', el('div', { class: 'legal' },
      el('p', null, el('b', null, `DroneForge ${APP_VERSION}`), ' · jumeau numérique de drone multirotor.'),
      el('p', null, 'Dimensionnement moteur et hélice, simulation de vol en 6 degrés de liberté, entraînement d\'IA par renforcement, électronique embarquée et nomenclature de production.'),
      el('h3', null, 'Limites'),
      el('p', null, 'Les calculs reposent sur des modèles physiques simplifiés et des valeurs typiques du marché. Ils servent à comparer des choix de conception ; ils ne remplacent ni un banc d\'essai, ni des essais en vol, ni les règles de sécurité et la réglementation aérienne de votre pays.'),
      el('h3', null, 'Éditeur'),
      el('p', null, 'HK Studio · Abidjan, Côte d\'Ivoire · hkstudio-ci.com')), () => []);
  }

  /* ================= Bouton retour Android ================= */
  function handleBack() {
    if (modalClose) { modalClose(); return true; }
    if (S.ui.tab === 'lab' && LAB.mobileDetail && window.matchMedia('(max-width:900px), (orientation:landscape) and (max-height:540px)').matches) { LAB.mobileDetail = false; renderLab(); return true; }
    const prev = tabHistory.pop();
    if (prev && prev !== S.ui.tab) { setTab(prev, true); return true; }
    return false;
  }

  /* ================= Erreurs visibles ================= */
  function showError(msg) {
    let b = document.getElementById('err-banner');
    if (!b) { b = el('div', { id: 'err-banner', role: 'alert', style: 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:80;max-width:min(720px,calc(100% - 32px));background:var(--panel-2);border:1px solid var(--bad);color:var(--fg);border-radius:8px;padding:10px 14px;font:12px/1.45 var(--font-mono);box-shadow:0 8px 30px rgba(0,0,0,.5)' }); document.body.append(b); }
    b.replaceChildren(el('b', { style: 'color:var(--bad);font-family:var(--font-ui)' }, 'Erreur DroneForge : '), String(msg).slice(0, 400), ' ', el('button', { type: 'button', class: 'btn small', onclick: () => b.remove() }, 'Fermer'));
  }
  window.addEventListener('error', e => showError(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', e => showError(e.reason && e.reason.message || e.reason));

  /* ================= Démarrage ================= */
  function boot() {
    init3D();
    if (HAS3D) {
      try { setupMotorView(); setupSimView(); setupAIView(); setupBoardView(); setupProdView(); }
      catch (e) { console.error(e); renderer = null; showFallback('Erreur lors de la construction des scènes 3D. Les calculs restent disponibles.'); }
    }
    buildMotorPanel(); buildSimPanel(); buildAIPanel(); buildBoardPanel(); buildProdPanel();
    initTabs(); initProjectButtons(); initKeys(); initSticks();
    $('#btn-menu').addEventListener('click', openMenu);
    updateHeader(); updateMotorPanel(); updateBoardPanel(); updateProdPanel();
    if (HAS3D) { rebuildMotor(); rebuildSimDrone(); rebuildWaypoints(); rebuildBoard(); rebuildProdDrone(); }
    setTab(S.ui.tab);
    updateArmBtn();
    window.addEventListener('resize', () => { updateMotorPanel(); updateAIPanel(true); if (S.ui.tab === 'lab' && LB.live) { if (LB.live.board && LB.boardCharts) LB.boardCharts(); else if (LB.live.m && LAB.sub === 'train') updateLabTrain(LB.live.m); } });
    window.addEventListener('beforeunload', () => { store.set(STORE_KEY, S); if (AI.running) persistPolicy(); for (const [id, r] of LAB.rt) { const m = LAB.models.find(x => x.id === id); if (m && r.running) DFLab.storeWeights(m, r.R); } labSave(true); });
    const persistAll = () => { store.set(STORE_KEY, S); if (AI.running || AI.trained) persistPolicy(); for (const [id, r] of LAB.rt) { const m = LAB.models.find(x => x.id === id); if (m && r.running) DFLab.storeWeights(m, r.R); } labSave(true); };
    document.addEventListener('visibilitychange', () => { last = performance.now(); if (document.hidden) persistAll(); });
    if (IS_APP) {
      NATIVE.onBack(handleBack);
      NATIVE.onPause(persistAll);
      NATIVE.onResume(() => { last = performance.now(); });
    }
    requestAnimationFrame(frame);
    requestAnimationFrame(() => { if (IS_APP) NATIVE.hideSplash(); });
    let onb = null; try { onb = localStorage.getItem('droneforge.onboarded'); } catch (e) { /* stockage indisponible */ }
    if (!onb) setTimeout(openOnboarding, 350);
  }
  boot();
})();
