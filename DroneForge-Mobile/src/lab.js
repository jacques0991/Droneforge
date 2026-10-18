/* =====================================================================
   DroneForge — Laboratoire IA (aucune dépendance DOM)
   Réseaux configurables, 5 algorithmes d'apprentissage, 3 tâches,
   banc d'essai de fiabilité et exports (JSON, JavaScript, C, Python).
   ===================================================================== */
const DFLab = (() => {
  'use strict';
  const { clamp, mulberry32, gauss, Adam, NAV, navObs, TAU } = DF;
  const DT = NAV.DT, OBS = NAV.OBS, ACT = NAV.ACT;

  /* ---------- Fonctions d'activation ---------- */
  const ACTIVATIONS = {
    tanh:  { label: 'tanh',       f: x => Math.tanh(x),               d: (y, x) => 1 - y * y,          c: 'tanhf(x)',                       py: 'np.tanh(h)' },
    relu:  { label: 'ReLU',       f: x => (x > 0 ? x : 0),            d: (y, x) => (x > 0 ? 1 : 0),    c: '(x > 0.0f ? x : 0.0f)',          py: 'np.maximum(h, 0.0)' },
    leaky: { label: 'Leaky ReLU', f: x => (x > 0 ? x : 0.01 * x),     d: (y, x) => (x > 0 ? 1 : 0.01), c: '(x > 0.0f ? x : 0.01f * x)',     py: 'np.where(h > 0, h, 0.01 * h)' },
    elu:   { label: 'ELU',        f: x => (x > 0 ? x : Math.exp(x) - 1), d: (y, x) => (x > 0 ? 1 : y + 1), c: '(x > 0.0f ? x : expf(x) - 1.0f)', py: 'np.where(h > 0, h, np.exp(np.minimum(h, 0)) - 1.0)' },
  };

  /* ---------- Réseau dense configurable ---------- */
  class Net {
    constructor(sizes, act, rng, outScale) {
      this.sizes = sizes.slice(); this.act = ACTIVATIONS[act] ? act : 'tanh'; this.L = sizes.length - 1;
      this.W = []; this.b = []; this.gW = []; this.gb = [];
      const he = this.act !== 'tanh';
      for (let l = 0; l < this.L; l++) {
        const ni = sizes[l], no = sizes[l + 1];
        const W = new Float64Array(ni * no);
        const s = (l === this.L - 1 ? outScale : 1) * Math.sqrt((he && l < this.L - 1 ? 2 : 1) / ni);
        for (let i = 0; i < W.length; i++) W[i] = gauss(rng) * s;
        this.W.push(W); this.b.push(new Float64Array(no));
        this.gW.push(new Float64Array(ni * no)); this.gb.push(new Float64Array(no));
      }
    }
    forward(x) {
      const A = ACTIVATIONS[this.act], acts = [x], pre = [null];
      let h = x;
      for (let l = 0; l < this.L; l++) {
        const ni = this.sizes[l], no = this.sizes[l + 1], W = this.W[l], b = this.b[l];
        const z = new Float64Array(no), out = new Float64Array(no);
        for (let o = 0; o < no; o++) {
          let s = b[o]; const off = o * ni;
          for (let i = 0; i < ni; i++) s += W[off + i] * h[i];
          z[o] = s; out[o] = l < this.L - 1 ? A.f(s) : s;
        }
        pre.push(z); acts.push(out); h = out;
      }
      return { acts, pre };
    }
    out(x) { const c = this.forward(x); return c.acts[c.acts.length - 1]; }
    backward(cache, dout) {
      const A = ACTIVATIONS[this.act];
      let d = Float64Array.from(dout);
      for (let l = this.L - 1; l >= 0; l--) {
        const ni = this.sizes[l], no = this.sizes[l + 1], W = this.W[l], gW = this.gW[l], gb = this.gb[l];
        const hin = cache.acts[l];
        if (l < this.L - 1) { const y = cache.acts[l + 1], z = cache.pre[l + 1]; for (let o = 0; o < no; o++) d[o] *= A.d(y[o], z[o]); }
        const dp = l > 0 ? new Float64Array(ni) : null;
        for (let o = 0; o < no; o++) {
          const dd = d[o]; if (dd === 0) continue;
          gb[o] += dd; const off = o * ni;
          for (let i = 0; i < ni; i++) { gW[off + i] += dd * hin[i]; if (dp) dp[i] += W[off + i] * dd; }
        }
        if (!dp) break;
        d = dp;
      }
    }
    params() { const p = []; for (let l = 0; l < this.L; l++) { p.push([this.W[l], this.gW[l]]); p.push([this.b[l], this.gb[l]]); } return p; }
    zeroGrad() { for (const g of this.gW) g.fill(0); for (const g of this.gb) g.fill(0); }
    count() { let n = 0; for (let l = 0; l < this.L; l++) n += this.W[l].length + this.b[l].length; return n; }
    macs() { let n = 0; for (let l = 0; l < this.L; l++) n += this.W[l].length; return n; }
    flatten() {
      const out = new Float64Array(this.count()); let k = 0;
      for (let l = 0; l < this.L; l++) { out.set(this.W[l], k); k += this.W[l].length; out.set(this.b[l], k); k += this.b[l].length; }
      return out;
    }
    setFlat(v) {
      let k = 0;
      for (let l = 0; l < this.L; l++) { this.W[l].set(v.subarray(k, k + this.W[l].length)); k += this.W[l].length; this.b[l].set(v.subarray(k, k + this.b[l].length)); k += this.b[l].length; }
    }
    toStore() { return { sizes: this.sizes, act: this.act, data: f32ToB64(this.flatten()) }; }
    fromStore(s) {
      if (!s || JSON.stringify(s.sizes) !== JSON.stringify(this.sizes)) throw new Error('architecture du réseau incompatible');
      const v = s.data ? Float64Array.from(b64ToF32(s.data)) : Float64Array.from(s.flat || []);
      if (v.length !== this.count()) throw new Error('nombre de poids incorrect');
      this.setFlat(v);
    }
    layers() { return this.W.map((W, l) => ({ ni: this.sizes[l], no: this.sizes[l + 1], W, b: this.b[l] })); }
  }
  function f32ToB64(arr) {
    const u = new Uint8Array(new Float32Array(arr).buffer);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToF32(b) {
    const s = atob(b), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return new Float32Array(u.buffer);
  }

  /* ---------- Tâches et environnement d'entraînement ---------- */
  const TASKS = {
    reach:   { label: 'Rejoindre un point', desc: 'Atteindre la cible et s\'y stabiliser, quel que soit le point de départ.', err: 'Distance finale', deployable: true },
    pursuit: { label: 'Poursuite de cible mobile', desc: 'Suivre une cible qui se déplace en continu et changer de cap avec elle.', err: 'Erreur de suivi', deployable: true },
    landing: { label: 'Atterrissage de précision', desc: 'Descendre sur une plateforme au sol et toucher en douceur (vitesse verticale inférieure à 1,2 m/s).', err: 'Écart au point de pose', deployable: true },
  };
  function envDefaults(tauA) {
    return { task: 'reach', distMin: 1, distMax: 6.5, wind: 1.5, gust: 0.3, obsNoise: 0, tauA: tauA || NAV.TAU_A, amax: NAV.AMAX, randomize: 0.15, epSeconds: 8, thr: 0.5, targetSpeed: 1.5,
      wProgress: 2, wEffort: 0.01, wProx: 0.05, wSuccess: 0.1 };
  }

  class LabEnv {
    constructor(cfg, rng) { this.cfg = cfg; this.rng = rng; this.reset(); }
    reset() {
      const c = this.cfg, r = this.rng, rnd = c.randomize || 0;
      this.tau = Math.max(0.02, c.tauA * (1 + rnd * (2 * r() - 1)));
      this.drag = 0.25 * (1 + rnd * (2 * r() - 1));
      const wd = r() * TAU, ws = c.wind * r();
      this.wmean = [Math.cos(wd) * ws, (r() - 0.5) * 0.3 * ws, Math.sin(wd) * ws];
      this.wg = [0, 0, 0];
      const dist = c.distMin + (c.distMax - c.distMin) * r();
      this.tp = [0, 0, 0]; this.tv = [0, 0, 0];
      if (c.task === 'landing') {
        const a = r() * TAU, hd = dist * 0.6;
        this.p = [Math.cos(a) * hd, 1.5 + dist * 0.6, Math.sin(a) * hd];
        this.v = [(r() - 0.5), (r() - 0.5) * 0.5, (r() - 0.5)];
      } else {
        let d = [gauss(r), gauss(r) * 0.6, gauss(r)]; const n = Math.hypot(d[0], d[1], d[2]) || 1;
        this.p = d.map(x => x / n * dist);
        this.v = [0, 0, 0].map(() => (r() - 0.5) * 2);
      }
      this.heading = r() * TAU; this.turn = 0;
      if (c.task === 'pursuit') this.tv = [Math.cos(this.heading) * c.targetSpeed, 0, Math.sin(this.heading) * c.targetSpeed];
      this.acc = [0, 0, 0]; this.t = 0; this.epLen = Math.max(10, Math.round(c.epSeconds / DT));
      this.prevD = this.dist(); this.d0 = this.prevD; this.reached = -1; this.effort = 0; this.trackSum = 0; this.trackN = 0;
      this.done = false; this.outcome = null; this.trail = [];
    }
    dist() { return Math.hypot(this.tp[0] - this.p[0], this.tp[1] - this.p[1], this.tp[2] - this.p[2]); }
    obs() {
      const n = this.cfg.obsNoise || 0, r = this.rng;
      const rel = [0, 1, 2].map(i => this.tp[i] - this.p[i] + (n ? gauss(r) * n : 0));
      const v = [0, 1, 2].map(i => this.v[i] - this.tv[i] + (n ? gauss(r) * n : 0));
      return navObs(rel, v, this.acc);
    }
    step(a) {
      const c = this.cfg, r = this.rng;
      const k = 1 - Math.exp(-DT / this.tau);
      let a2 = 0;
      const sg = c.gust * (1 + 0.4 * Math.hypot(this.wmean[0], this.wmean[2])) * Math.sqrt(DT);
      for (let i = 0; i < 3; i++) {
        const ac = clamp(a[i], -1, 1); a2 += ac * ac;
        this.acc[i] += (ac * c.amax - this.acc[i]) * k;
        this.wg[i] += -this.wg[i] * DT / 1.5 + sg * (i === 1 ? 0.4 : 1) * gauss(r);
        this.v[i] += (this.acc[i] - this.drag * this.v[i] + this.wmean[i] + this.wg[i]) * DT;
        this.p[i] += this.v[i] * DT;
      }
      if (c.task === 'pursuit') {
        this.turn += (gauss(r) * 0.8 - this.turn * 0.5) * DT;
        this.heading += this.turn * DT * 4;
        this.tv = [Math.cos(this.heading) * c.targetSpeed, Math.sin(this.t * DT * 0.7) * 0.25, Math.sin(this.heading) * c.targetSpeed];
        for (let i = 0; i < 3; i++) this.tp[i] += this.tv[i] * DT;
      }
      this.effort += a2; this.t++;
      const d = this.dist();
      const sp = Math.hypot(this.v[0] - this.tv[0], this.v[1] - this.tv[1], this.v[2] - this.tv[2]);
      let rew = c.wProgress * (this.prevD - d) - c.wEffort * a2 + c.wProx * Math.exp(-3 * d);
      if (d < c.thr && sp < 0.6) rew += c.wSuccess;
      this.prevD = d;
      if (this.reached < 0 && d < c.thr) this.reached = this.t;
      if (this.t > this.epLen / 2) { this.trackSum += d; this.trackN++; }
      let done = this.t >= this.epLen, lost = false, crash = false, success = false, err = d;
      if (c.task === 'landing' && this.p[1] <= 0) {
        const vz = -this.v[1], horiz = Math.hypot(this.p[0], this.p[2]);
        this.p[1] = 0; done = true; err = horiz;
        crash = vz > 1.2;
        success = !crash && horiz < c.thr * 1.5;
        rew += success ? 5 : crash ? -3 : -1;
      } else if (d > Math.max(16, c.distMax * 2.2)) { done = true; lost = true; rew -= 2; }
      else if (done) {
        if (c.task === 'pursuit') { err = this.trackN ? this.trackSum / this.trackN : d; success = err < 2 * c.thr; }
        else if (c.task === 'landing') { err = Math.hypot(this.p[0], this.p[2]); success = false; }
        else success = d < c.thr;
      }
      if (done) {
        this.done = true;
        this.outcome = { success, lost, crash, err, ttr: this.reached >= 0 ? this.reached * DT : null, effort: this.effort / this.t, steps: this.t };
      }
      return { r: rew, done, success };
    }
  }

  /* ---------- Contrôleur de référence (PD classique) ---------- */
  function baselinePolicy(env) {
    const tau = env.tauA || NAV.TAU_A, amax = env.amax || NAV.AMAX;
    const kp = Math.min(2.2, 0.28 / tau), kd = 2 * Math.sqrt(kp) * 1.05;
    return o => {
      const a = new Float64Array(3);
      for (let i = 0; i < 3; i++) a[i] = clamp((kp * o[i] * 5 - kd * o[3 + i] * 5) / amax, -1, 1);
      return a;
    };
  }

  /* ---------- Algorithmes ---------- */
  const ALGOS = {
    ppo: { label: 'PPO', long: 'Proximal Policy Optimization', desc: 'Gradient de politique avec écrêtage du ratio. Stable et efficace en échantillons : le meilleur point de départ.', grad: true },
    a2c: { label: 'A2C', long: 'Advantage Actor-Critic', desc: 'Un seul pas de gradient par lot, sans écrêtage. Plus rapide par itération, plus sensible au taux d\'apprentissage.', grad: true },
    reinforce: { label: 'REINFORCE', long: 'REINFORCE avec ligne de base', desc: 'Gradient de politique sur épisodes complets (retours Monte-Carlo). Simple, variance élevée : sert de référence pédagogique.', grad: true },
    es: { label: 'ES', long: 'Stratégies d\'évolution (OpenAI ES)', desc: 'Sans gradient : perturbe tous les poids, garde la direction qui améliore le score. Robuste, parallélisable, moins économe en simulations.', grad: false },
    cem: { label: 'CEM', long: 'Méthode de l\'entropie croisée', desc: 'Sans gradient : tire une population de réseaux, garde l\'élite et recentre la distribution dessus. Efficace sur petits réseaux.', grad: false },
  };
  // Définition des hyperparamètres : [clé, libellé, min, max, pas, défaut, échelle ('log' ou rien), aide]
  const HP = {
    ppo: [
      ['lr', 'Taux d\'apprentissage', 1e-5, 3e-3, 0.05, 3e-4, 'log'], ['vfMult', 'Taux critique / acteur', 0.5, 10, 0.5, 3],
      ['gamma', 'Actualisation γ', 0.9, 0.999, 0.001, 0.99], ['lambda', 'GAE λ', 0.8, 1, 0.01, 0.95],
      ['clip', 'Écrêtage ε', 0.05, 0.4, 0.01, 0.2], ['ent', 'Bonus d\'entropie', 0, 0.02, 0.0005, 0.003],
      ['epochs', 'Époques par lot', 1, 15, 1, 5], ['minibatch', 'Taille de mini-lot', 32, 1024, 32, 256],
      ['envs', 'Environnements parallèles', 2, 32, 1, 16], ['rollout', 'Pas par environnement', 32, 512, 16, 128],
      ['initStd', 'Exploration initiale σ', 0.1, 1.5, 0.05, 0.6], ['stdMin', 'Exploration minimale σ', 0.02, 0.5, 0.01, 0.05],
      ['gradNorm', 'Norme max du gradient', 0.1, 5, 0.1, 0.5], ['targetKL', 'KL cible (0 = désactivé)', 0, 0.1, 0.005, 0.03],
    ],
    a2c: [
      ['lr', 'Taux d\'apprentissage', 1e-5, 3e-3, 0.05, 1.5e-3, 'log'], ['vfMult', 'Taux critique / acteur', 0.5, 10, 0.5, 2],
      ['gamma', 'Actualisation γ', 0.9, 0.999, 0.001, 0.99], ['lambda', 'GAE λ', 0.8, 1, 0.01, 0.95],
      ['ent', 'Bonus d\'entropie', 0, 0.02, 0.0005, 0.002], ['envs', 'Environnements parallèles', 2, 32, 1, 16],
      ['rollout', 'Pas par environnement', 8, 256, 8, 64], ['initStd', 'Exploration initiale σ', 0.1, 1.5, 0.05, 0.6],
      ['stdMin', 'Exploration minimale σ', 0.02, 0.5, 0.01, 0.05], ['gradNorm', 'Norme max du gradient', 0.1, 5, 0.1, 0.5],
    ],
    reinforce: [
      ['lr', 'Taux d\'apprentissage', 1e-5, 3e-3, 0.05, 5e-4, 'log'], ['vfMult', 'Taux ligne de base / politique', 0.5, 10, 0.5, 3],
      ['gamma', 'Actualisation γ', 0.9, 0.999, 0.001, 0.99], ['ent', 'Bonus d\'entropie', 0, 0.02, 0.0005, 0.002],
      ['envs', 'Épisodes par lot', 2, 32, 1, 16], ['initStd', 'Exploration initiale σ', 0.1, 1.5, 0.05, 0.6],
      ['stdMin', 'Exploration minimale σ', 0.02, 0.5, 0.01, 0.05], ['gradNorm', 'Norme max du gradient', 0.1, 5, 0.1, 0.5],
    ],
    es: [
      ['lr', 'Taux d\'apprentissage', 1e-4, 0.1, 0.05, 0.02, 'log'], ['sigma', 'Bruit de perturbation σ', 0.005, 0.3, 0.005, 0.05],
      ['pop', 'Population (paire)', 8, 128, 2, 40], ['episodes', 'Épisodes par candidat', 1, 6, 1, 2],
      ['wd', 'Pénalité de poids (L2)', 0, 0.05, 0.001, 0.005],
    ],
    cem: [
      ['pop', 'Population', 8, 128, 2, 40], ['elite', 'Fraction d\'élite', 0.05, 0.5, 0.01, 0.2],
      ['sigma', 'Écart-type initial', 0.01, 1, 0.01, 0.1], ['sigmaMin', 'Écart-type minimal', 0.001, 0.1, 0.001, 0.02],
      ['episodes', 'Épisodes par candidat', 1, 6, 1, 2],
    ],
  };
  const ENV_PARAMS = [
    ['distMin', 'Distance de départ min.', 0.2, 10, 0.1, 'm'], ['distMax', 'Distance de départ max.', 0.5, 15, 0.1, 'm'],
    ['wind', 'Perturbation vent max.', 0, 8, 0.1, 'm/s²'], ['gust', 'Turbulence', 0, 2, 0.05, ''],
    ['obsNoise', 'Bruit des capteurs', 0, 0.5, 0.01, 'm'], ['tauA', 'Temps de réponse du drone', 0.03, 0.8, 0.01, 's'],
    ['amax', 'Accélération maximale', 2, 15, 0.5, 'm/s²'], ['randomize', 'Randomisation du domaine', 0, 0.6, 0.01, '±'],
    ['epSeconds', 'Durée d\'un épisode', 3, 20, 0.5, 's'], ['thr', 'Rayon de réussite', 0.1, 2, 0.05, 'm'],
    ['targetSpeed', 'Vitesse de la cible (poursuite)', 0.2, 5, 0.1, 'm/s'],
    ['wProgress', 'Récompense : progression', 0, 5, 0.1, ''], ['wEffort', 'Pénalité : effort', 0, 0.2, 0.005, ''],
    ['wProx', 'Bonus : proximité', 0, 0.5, 0.01, ''], ['wSuccess', 'Bonus : stabilisé sur la cible', 0, 1, 0.01, ''],
  ];
  function hpDefaults(algo) { const o = {}; for (const p of HP[algo]) o[p[0]] = p[5]; return o; }
  function sanitizeModel(m) {
    if (!ALGOS[m.algo]) m.algo = 'ppo';
    const d = hpDefaults(m.algo);
    m.hp = Object.assign(d, m.hp || {});
    for (const p of HP[m.algo]) { const v = Number(m.hp[p[0]]); m.hp[p[0]] = Number.isFinite(v) ? clamp(v, p[2], p[3]) : p[5]; }
    if (m.algo === 'es' && m.hp.pop % 2) m.hp.pop += 1;
    m.env = Object.assign(envDefaults(), m.env || {});
    for (const p of ENV_PARAMS) { const v = Number(m.env[p[0]]); m.env[p[0]] = Number.isFinite(v) ? clamp(v, p[2], p[3]) : envDefaults()[p[0]]; }
    if (!TASKS[m.env.task]) m.env.task = 'reach';
    if (m.env.distMax < m.env.distMin) m.env.distMax = m.env.distMin;
    m.arch = m.arch || {};
    m.arch.layers = (Array.isArray(m.arch.layers) && m.arch.layers.length ? m.arch.layers : [64, 64]).slice(0, 4).map(n => clamp(Math.round(n) || 16, 4, 256));
    if (!ACTIVATIONS[m.arch.act]) m.arch.act = 'tanh';
    m.stop = Object.assign({ maxIter: 150, targetOk: 0.95, maxMinutes: 15 }, m.stop || {});
    m.seed = Math.round(Number(m.seed)) || 1;
    m.stats = Object.assign({ iter: 0, steps: 0, timeMs: 0 }, m.stats || {});
    m.history = Array.isArray(m.history) ? m.history : [];
    return m;
  }
  const MAX_ITER = { ppo: 150, a2c: 800, reinforce: 500, es: 150, cem: 150 };
  function newModel(opts) {
    opts = opts || {};
    if (!opts.stop) opts = Object.assign({}, opts, { stop: { maxIter: MAX_ITER[opts.algo] || 150 } });
    const m = sanitizeModel(Object.assign({ id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: 'Modèle', algo: 'ppo', created: new Date().toISOString(), seed: Math.floor(Math.random() * 1e6) + 1 }, opts || {}));
    return m;
  }
  function paramCount(arch, withCritic) {
    const s = [OBS, ...arch.layers, ACT]; let n = 0;
    for (let i = 0; i < s.length - 1; i++) n += s[i] * s[i + 1] + s[i + 1];
    if (withCritic) { const v = [OBS, ...arch.layers, 1]; for (let i = 0; i < v.length - 1; i++) n += v[i] * v[i + 1] + v[i + 1]; }
    return n;
  }

  /* ---------- État d'exécution d'un modèle ---------- */
  function makeRuntime(m) {
    const rng = mulberry32(m.seed);
    const pi = new Net([OBS, ...m.arch.layers, ACT], m.arch.act, rng, 0.01);
    const R = { rng, pi, vf: null, logStd: new Float64Array(ACT).fill(Math.log(m.hp.initStd || 0.6)), gLogStd: new Float64Array(ACT) };
    if (ALGOS[m.algo].grad) {
      R.vf = new Net([OBS, ...m.arch.layers, 1], m.arch.act, rng, 1);
      R.optPi = new Adam([...R.pi.params(), [R.logStd, R.gLogStd]], m.hp.lr);
      R.optV = new Adam(R.vf.params(), m.hp.lr * m.hp.vfMult);
    }
    if (m.weights) {
      R.pi.fromStore(m.weights.pi);
      if (R.vf && m.weights.vf) { try { R.vf.fromStore(m.weights.vf); } catch (e) { /* critique réinitialisé */ } }
      if (m.weights.logStd) R.logStd.set(m.weights.logStd);
    }
    R.policy = o => { const a = R.pi.out(o); return [clamp(a[0], -1, 1), clamp(a[1], -1, 1), clamp(a[2], -1, 1)]; };
    return R;
  }
  function storeWeights(m, R) { m.weights = { pi: R.pi.toStore(), vf: R.vf ? R.vf.toStore() : null, logStd: Array.from(R.logStd) }; }

  function pushHistory(m, h) {
    m.history.push(h);
    if (m.history.length > 600) m.history = m.history.filter((_, i) => i % 2 === 0 || i === m.history.length - 1);
  }
  function recentStats(buf) {
    if (!buf.length) return { ret: 0, ok: 0 };
    let r = 0, o = 0; for (const [a, b] of buf) { r += a; o += b; }
    return { ret: r / buf.length, ok: o / buf.length };
  }

  /* ---------- Entraînement par gradient : PPO, A2C, REINFORCE ---------- */
  function* gradTrainer(m, R, live) {
    const rng = R.rng, envs = [], recent = [];
    live.envs = envs;
    while (true) {
      const hp = m.hp, algo = m.algo;
      const N = Math.round(hp.envs);
      const T = algo === 'reinforce' ? Math.max(10, Math.round(m.env.epSeconds / DT)) : Math.round(hp.rollout);
      while (envs.length < N) { const e = new LabEnv(m.env, rng); e.ret = 0; envs.push(e); }
      envs.length = N;
      const B = N * T;
      const obs = new Array(B), act = new Array(B);
      const logp = new Float64Array(B), val = new Float64Array(B), rew = new Float64Array(B), done = new Uint8Array(B);
      for (let t = 0; t < T; t++) {
        for (let e = 0; e < N; e++) {
          const i = t * N + e, env = envs[e];
          const o = env.obs(), mu = R.pi.out(o);
          const a = new Float64Array(ACT); let lp = 0;
          for (let j = 0; j < ACT; j++) { const z = gauss(rng); a[j] = mu[j] + Math.exp(R.logStd[j]) * z; lp += -0.5 * z * z - R.logStd[j] - 0.5 * Math.log(TAU); }
          obs[i] = o; act[i] = a; logp[i] = lp; val[i] = R.vf.out(o)[0];
          const st = env.step(a);
          rew[i] = st.r; done[i] = st.done ? 1 : 0; env.ret += st.r;
          env.trail.push([env.p[0], env.p[1], env.p[2], env.tp[0], env.tp[2]]); if (env.trail.length > 40) env.trail.shift();
          if (st.done) { recent.push([env.ret, env.outcome.success ? 1 : 0]); if (recent.length > 100) recent.shift(); env.ret = 0; env.reset(); }
        }
        m.stats.steps += N;
        yield 0;
      }
      const lam = algo === 'reinforce' ? 1 : hp.lambda, gamma = hp.gamma;
      const lastV = envs.map(e => R.vf.out(e.obs())[0]);
      const adv = new Float64Array(B), ret = new Float64Array(B);
      for (let e = 0; e < N; e++) {
        let gae = 0;
        for (let t = T - 1; t >= 0; t--) {
          const i = t * N + e, nv = t === T - 1 ? lastV[e] : val[(t + 1) * N + e], nt = 1 - done[i];
          const delta = rew[i] + gamma * nv * nt - val[i];
          gae = delta + gamma * lam * nt * gae;
          adv[i] = gae; ret[i] = gae + val[i];
        }
      }
      let mean = 0; for (let i = 0; i < B; i++) mean += adv[i]; mean /= B;
      let vr = 0; for (let i = 0; i < B; i++) vr += (adv[i] - mean) ** 2;
      const sd = Math.sqrt(vr / B) + 1e-8;
      for (let i = 0; i < B; i++) adv[i] = (adv[i] - mean) / sd;
      const ppo = algo === 'ppo';
      const EPOCHS = ppo ? Math.round(hp.epochs) : 1, MB = ppo ? Math.min(Math.round(hp.minibatch), B) : B, clip = ppo ? hp.clip : Infinity;
      R.optPi.lr = hp.lr; R.optV.lr = hp.lr * hp.vfMult;
      const idx = Array.from({ length: B }, (_, i) => i);
      let klSum = 0, klN = 0, clipN = 0;
      for (let ep = 0; ep < EPOCHS; ep++) {
        for (let i = B - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
        let epKl = 0, epN = 0;
        for (let s = 0; s < B; s += MB) {
          const end = Math.min(B, s + MB), n = end - s;
          R.pi.zeroGrad(); R.vf.zeroGrad(); R.gLogStd.fill(0);
          for (let k = s; k < end; k++) {
            const i = idx[k], o = obs[i], a = act[i];
            const cache = R.pi.forward(o), mu = cache.acts[cache.acts.length - 1];
            const z = new Float64Array(ACT); let lp = 0;
            for (let j = 0; j < ACT; j++) { const sdj = Math.exp(R.logStd[j]); z[j] = (a[j] - mu[j]) / sdj; lp += -0.5 * z[j] * z[j] - R.logStd[j] - 0.5 * Math.log(TAU); }
            const ratio = Math.exp(lp - logp[i]);
            const kl = logp[i] - lp; klSum += kl; klN++; epKl += kl; epN++;
            const A = adv[i];
            const active = (A >= 0 && ratio <= 1 + clip) || (A < 0 && ratio >= 1 - clip);
            if (!active) clipN++;
            const c = active ? -ratio * A / n : 0;
            const dmu = new Float64Array(ACT);
            if (c !== 0) for (let j = 0; j < ACT; j++) { const sdj = Math.exp(R.logStd[j]); dmu[j] = c * z[j] / sdj; R.gLogStd[j] += c * (z[j] * z[j] - 1); }
            R.pi.backward(cache, dmu);
            const vc = R.vf.forward(o), v = vc.acts[vc.acts.length - 1][0];
            R.vf.backward(vc, [(v - ret[i]) / n]);
            if ((k - s) % 192 === 191) yield 1;
          }
          for (let j = 0; j < ACT; j++) R.gLogStd[j] -= hp.ent;
          R.optPi.step(hp.gradNorm); R.optV.step(hp.gradNorm * 2);
          const lo = Math.log(hp.stdMin);
          for (let j = 0; j < ACT; j++) R.logStd[j] = clamp(R.logStd[j], lo, 0.7);
          yield 1;
        }
        if (ppo && hp.targetKL > 0 && epN && epKl / epN > 1.5 * hp.targetKL) break;
      }
      m.stats.iter++;
      const rs = recentStats(recent);
      m.stats.kl = klSum / Math.max(1, klN); m.stats.clipFrac = clipN / Math.max(1, klN);
      pushHistory(m, { it: m.stats.iter, steps: m.stats.steps, ret: rs.ret, ok: rs.ok, std: Math.exp(R.logStd.reduce((s, x) => s + x, 0) / ACT), t: m.stats.timeMs / 1000 });
      m.stats.ret = rs.ret; m.stats.ok = rs.ok;
      storeWeights(m, R);
      yield 2;
    }
  }

  /* ---------- Entraînement sans gradient : ES et CEM ---------- */
  function runEpisode(policy, env, trail) {
    let ret = 0;
    while (!env.done) {
      const st = env.step(policy(env.obs()));
      ret += st.r;
      if (trail && env.t % 2 === 0) trail.push([env.p[0], env.p[1], env.p[2], env.tp[0], env.tp[2]]);
    }
    return ret;
  }
  function* evoTrainer(m, R, live) {
    const rng = R.rng, net = R.pi;
    const D = net.count();
    let theta = net.flatten();
    const grad = new Float64Array(D);
    const opt = new Adam([[theta, grad]], m.hp.lr);
    let std = null;
    const showEnvs = [];
    live.envs = showEnvs;
    const scoreCand = (vec, seeds) => {
      net.setFlat(vec);
      let ret = 0, ok = 0;
      for (const s of seeds) {
        const env = new LabEnv(m.env, mulberry32(s));
        ret += runEpisode(R.policy, env);
        ok += env.outcome.success ? 1 : 0;
      }
      return { ret: ret / seeds.length, ok: ok / seeds.length };
    };
    while (true) {
      const hp = m.hp, es = m.algo === 'es';
      const pop = es ? Math.max(2, Math.round(hp.pop / 2) * 2) : Math.round(hp.pop);
      const nEp = Math.round(hp.episodes);
      const seeds = Array.from({ length: nEp }, () => Math.floor(rng() * 2 ** 31));
      if (!es && (!std || std.length !== D)) std = new Float64Array(D).fill(hp.sigma);
      const eps = [], fit = [], cands = [];
      let okSum = 0;
      for (let k = 0; k < pop; k++) {
        let e, vec = new Float64Array(D);
        if (es) {
          if (k % 2 === 0) { e = new Float64Array(D); for (let i = 0; i < D; i++) e[i] = gauss(rng); }
          else { e = eps[k - 1].map(x => -x); }
          for (let i = 0; i < D; i++) vec[i] = theta[i] + hp.sigma * e[i];
        } else {
          e = null;
          for (let i = 0; i < D; i++) vec[i] = theta[i] + std[i] * gauss(rng);
        }
        eps.push(e); cands.push(vec);
        const sc = scoreCand(vec, seeds);
        fit.push(sc.ret); okSum += sc.ok;
        m.stats.steps += nEp * Math.round(m.env.epSeconds / DT);
        yield 0;
      }
      if (es) {
        const order = fit.map((f, i) => i).sort((a, b) => fit[a] - fit[b]);
        const shaped = new Float64Array(pop);
        order.forEach((i, r) => { shaped[i] = r / (pop - 1) - 0.5; });
        grad.fill(0);
        for (let k = 0; k < pop; k++) { const e = eps[k], w = shaped[k]; for (let i = 0; i < D; i++) grad[i] += w * e[i]; }
        for (let i = 0; i < D; i++) grad[i] = -grad[i] / (pop * hp.sigma) + hp.wd * theta[i];
        opt.lr = hp.lr; opt.step(0);
      } else {
        const nEl = Math.max(2, Math.round(pop * hp.elite));
        const order = fit.map((f, i) => i).sort((a, b) => fit[b] - fit[a]).slice(0, nEl);
        const mean = new Float64Array(D);
        for (const i of order) { const c = cands[i]; for (let j = 0; j < D; j++) mean[j] += c[j] / nEl; }
        for (let j = 0; j < D; j++) {
          let v = 0; for (const i of order) v += (cands[i][j] - mean[j]) ** 2;
          std[j] = Math.max(hp.sigmaMin, Math.sqrt(v / nEl));
        }
        theta.set(mean);
      }
      net.setFlat(theta);
      // Évaluation du réseau central sur des épisodes neufs (affichage de l'aperçu)
      const center = { ret: 0, ok: 0 };
      showEnvs.length = 0;
      const nC = 8;
      for (let k = 0; k < nC; k++) {
        const env = new LabEnv(m.env, mulberry32(Math.floor(rng() * 2 ** 31)));
        const tr = [];
        center.ret += runEpisode(R.policy, env, tr) / nC; center.ok += (env.outcome.success ? 1 : 0) / nC;
        env.trail = tr.slice(-40); showEnvs.push(env);
      }
      m.stats.steps += nC * Math.round(m.env.epSeconds / DT);
      m.stats.iter++;
      const sigmaNow = es ? hp.sigma : std.reduce((s, x) => s + x, 0) / D;
      pushHistory(m, { it: m.stats.iter, steps: m.stats.steps, ret: center.ret, ok: center.ok, popOk: okSum / pop, std: sigmaNow, t: m.stats.timeMs / 1000 });
      m.stats.ret = center.ret; m.stats.ok = center.ok; m.stats.kl = null;
      storeWeights(m, R);
      yield 2;
    }
  }
  function trainer(m, R, live) { return ALGOS[m.algo].grad ? gradTrainer(m, R, live) : evoTrainer(m, R, live); }

  /* ---------- Banc d'essai de fiabilité ---------- */
  const SCENARIOS = [
    { id: 'nominal', label: 'Nominal', w: 0.25, desc: 'Vent faible, capteurs parfaits', mod: { wind: 1, gust: 0.2 } },
    { id: 'wind', label: 'Vent fort', w: 0.15, desc: 'Perturbation 4 m/s² + rafales', mod: { wind: 4, gust: 0.8 } },
    { id: 'noise', label: 'Capteurs bruités', w: 0.15, desc: 'Bruit de 15 cm sur position et vitesse', mod: { obsNoise: 0.15 } },
    { id: 'slow', label: 'Drone lent', w: 0.15, desc: 'Temps de réponse multiplié par 1,8', mod: { tauMul: 1.8 } },
    { id: 'far', label: 'Longue distance', w: 0.15, desc: 'Départ entre 6 et 12 m', mod: { distMin: 6, distMax: 12, epSeconds: 12 } },
    { id: 'worst', label: 'Pire cas combiné', w: 0.15, desc: 'Vent, bruit, drone lent et distance', mod: { wind: 3, gust: 0.6, obsNoise: 0.1, tauMul: 1.4, distMin: 4, distMax: 10, epSeconds: 11 } },
  ];
  const SWEEP = [0, 1, 2, 3, 4, 5, 6, 8];
  function scenarioEnv(base, mod) {
    const e = Object.assign(envDefaults(base.tauA), { task: base.task, amax: base.amax, wind: 0, gust: 0, obsNoise: 0, randomize: 0, distMin: 1, distMax: 6.5, epSeconds: 8, thr: 0.5, targetSpeed: 1.5 });
    for (const k in mod) if (k !== 'tauMul') e[k] = mod[k];
    if (mod.tauMul) e.tauA = base.tauA * mod.tauMul;
    return e;
  }
  function wilson(k, n) {
    if (!n) return [0, 0];
    const z = 1.96, p = k / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  function summarize(eps) {
    const n = eps.length, k = eps.filter(e => e.success).length;
    const errs = eps.map(e => e.err).sort((a, b) => a - b);
    const ttr = eps.filter(e => e.ttr != null).map(e => e.ttr);
    const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    const m = mean(errs);
    return {
      n, success: k / n, ci: wilson(k, n), err: m, errP90: errs[Math.min(n - 1, Math.floor(n * 0.9))],
      errStd: Math.sqrt(mean(errs.map(x => (x - m) ** 2)) || 0), ttr: mean(ttr), effort: mean(eps.map(e => e.effort)),
      lost: eps.filter(e => e.lost).length / n, crash: eps.filter(e => e.crash).length / n,
    };
  }
  function scoreOf(scen) {
    let s = 0;
    for (const sc of scen) s += sc.w * clamp(sc.stats.success - 0.5 * sc.stats.lost - 0.5 * sc.stats.crash, 0, 1);
    return Math.round(s * 1000) / 10;
  }
  function grade(score) { return score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'E'; }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function* evaluateGen(policy, opts, out) {
    const base = { task: opts.task, tauA: opts.tauA, amax: opts.amax };
    const n = opts.n, seed = opts.seed || 2026;
    const ref = baselinePolicy(base);
    const nSweep = Math.max(10, Math.round(n / 4));
    const total = SCENARIOS.length * n + SWEEP.length * nSweep;
    let doneN = 0;
    out.progress = 0; out.scenarios = []; out.sweep = []; out.done = false;
    for (const sc of SCENARIOS) {
      const cfg = scenarioEnv(base, sc.mod);
      const eM = [], eB = [], trails = [];
      for (let e = 0; e < n; e++) {
        const s = (seed * 7919 + hashStr(sc.id) + e * 104729) >>> 0;
        const env = new LabEnv(cfg, mulberry32(s));
        const tr = e < 16 ? [[env.p[0], env.p[1], env.p[2], env.tp[0], env.tp[2]]] : null;
        runEpisode(policy, env, tr); eM.push(env.outcome);
        if (tr) trails.push({ pts: tr, ok: env.outcome.success, lost: env.outcome.lost || env.outcome.crash });
        const envB = new LabEnv(cfg, mulberry32(s));
        runEpisode(ref, envB); eB.push(envB.outcome);
        doneN++;
        if (e % 3 === 2) { out.progress = doneN / total; yield; }
      }
      out.scenarios.push({ id: sc.id, label: sc.label, desc: sc.desc, w: sc.w, stats: summarize(eM), base: summarize(eB), trails });
      yield;
    }
    for (const w of SWEEP) {
      const cfg = scenarioEnv(base, { wind: w, gust: 0.15 * w });
      let kM = 0, kB = 0;
      for (let e = 0; e < nSweep; e++) {
        const s = (seed * 31 + w * 1000 + e * 7907) >>> 0;
        const env = new LabEnv(cfg, mulberry32(s)); runEpisode(policy, env); if (env.outcome.success) kM++;
        const envB = new LabEnv(cfg, mulberry32(s)); runEpisode(ref, envB); if (envB.outcome.success) kB++;
        doneN++;
        if (e % 4 === 3) { out.progress = doneN / total; yield; }
      }
      out.sweep.push({ wind: w, model: kM / nSweep, base: kB / nSweep });
    }
    // Latence d'inférence mesurée
    const o = new Float64Array(OBS).fill(0.1);
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    for (let i = 0; i < 2000; i++) policy(o);
    out.inferUs = ((typeof performance !== 'undefined' ? performance : Date).now() - t0) / 2000 * 1000;
    out.score = scoreOf(out.scenarios);
    out.baseScore = scoreOf(out.scenarios.map(s => ({ w: s.w, stats: s.base })));
    out.grade = grade(out.score);
    out.n = n; out.task = opts.task; out.tauA = opts.tauA; out.amax = opts.amax; out.seed = seed; out.date = new Date().toISOString();
    out.progress = 1; out.done = true;
  }
  function verdict(ev) {
    if (!ev || !ev.scenarios) return '';
    const s = ev.scenarios;
    const worst = s.slice().sort((a, b) => a.stats.success - b.stats.success)[0];
    const better = s.filter(x => x.stats.success > x.base.success + 0.02).length;
    const worse = s.filter(x => x.stats.success < x.base.success - 0.02).length;
    const parts = [];
    parts.push(ev.score >= 90 ? 'Modèle fiable sur l\'ensemble du banc.' : ev.score >= 75 ? 'Modèle solide avec des faiblesses localisées.' : ev.score >= 55 ? 'Modèle utilisable en conditions favorables seulement.' : 'Modèle pas assez fiable pour un usage réel.');
    parts.push(`Point faible : ${worst.label.toLowerCase()} (${Math.round(worst.stats.success * 100)} % de réussite).`);
    parts.push(`Face au contrôleur PD de référence : meilleur sur ${better} scénario${better > 1 ? 's' : ''}, moins bon sur ${worse}.`);
    const lost = s.reduce((a, x) => a + x.stats.lost, 0) / s.length;
    if (lost > 0.02) parts.push(`Perte de contrôle dans ${Math.round(lost * 100)} % des épisodes en moyenne : à corriger avant tout vol réel.`);
    return parts.join(' ');
  }

  /* ---------- Exports ---------- */
  const fmtF = v => { const x = Math.abs(v) < 1e-9 ? 0 : v; return (+x.toPrecision(7)).toString(); };
  const OBS_DOC = [
    'obs[0..2] : (cible − drone) en mètres ÷ 5, borné à ±3',
    'obs[3..5] : (vitesse drone − vitesse cible) en m/s ÷ 5, borné à ±3',
    'obs[6..8] : accélération actuellement appliquée en m/s² ÷ 6',
  ];
  function header(m, prefix) {
    const ev = m.eval;
    return [
      `${prefix} DroneForge — politique « ${m.name} »`,
      `${prefix} Algorithme : ${ALGOS[m.algo].long} · Tâche : ${TASKS[m.env.task].label}`,
      `${prefix} Architecture : ${[OBS, ...m.arch.layers, ACT].join(' → ')} · activation ${ACTIVATIONS[m.arch.act].label} · ${paramCount(m.arch, false)} paramètres`,
      `${prefix} Entraînement : ${m.stats.iter} itérations, ${m.stats.steps} pas simulés`,
      ev ? `${prefix} Fiabilité : score ${ev.score}/100 (note ${ev.grade}), banc de ${ev.n} épisodes par scénario` : `${prefix} Fiabilité : non évaluée`,
      `${prefix} Généré le ${new Date().toISOString().slice(0, 10)}`,
      `${prefix}`,
      `${prefix} Entrées (9) :`,
      ...OBS_DOC.map(s => `${prefix}   ${s}`),
      `${prefix} Sorties (3) : accélération demandée x, y, z dans [−1, 1], à multiplier par AMAX = ${m.env.amax} m/s².`,
      `${prefix} Repère : y vers le haut. Appelez la politique toutes les ${DT * 1000} ms ; le contrôleur d'attitude convertit`,
      `${prefix} l'accélération demandée en inclinaison et en poussée.`,
    ].join('\n');
  }
  function weightsOf(m) {
    const R = makeRuntime(m);
    return R.pi.layers();
  }
  function exportJSON(m) {
    const layers = weightsOf(m);
    return JSON.stringify({
      format: 'droneforge-lab-model-1', name: m.name, algo: m.algo, task: m.env.task, created: m.created, exported: new Date().toISOString(),
      arch: m.arch, hp: m.hp, env: m.env, stop: m.stop, seed: m.seed, stats: m.stats,
      io: { obs: OBS_DOC, act: `accélération normalisée [-1, 1] × ${m.env.amax} m/s²`, dt: DT },
      eval: m.eval ? { score: m.eval.score, grade: m.eval.grade, n: m.eval.n, scenarios: m.eval.scenarios.map(s => ({ id: s.id, success: s.stats.success, ci: s.stats.ci, err: s.stats.err, lost: s.stats.lost })) } : null,
      weights: { layers: layers.map(L => ({ in: L.ni, out: L.no, W: Array.from(L.W, v => +fmtF(v)), b: Array.from(L.b, v => +fmtF(v)) })), logStd: m.weights ? m.weights.logStd : null, critic: m.weights && m.weights.vf ? m.weights.vf : null },
      history: m.history,
    });
  }
  function importJSON(text) {
    const j = JSON.parse(text);
    if (!j || j.format !== 'droneforge-lab-model-1') throw new Error('fichier non reconnu (format attendu : droneforge-lab-model-1)');
    const m = newModel({ name: (j.name || 'Modèle importé') + ' (importé)', algo: j.algo, arch: j.arch, hp: j.hp, env: j.env, stop: j.stop, seed: j.seed, stats: j.stats, history: j.history });
    const pi = new Net([OBS, ...m.arch.layers, ACT], m.arch.act, mulberry32(1), 1);
    const L = j.weights && j.weights.layers;
    if (!L || L.length !== pi.L) throw new Error('nombre de couches incohérent');
    L.forEach((l, i) => { if (l.W.length !== pi.W[i].length || l.b.length !== pi.b[i].length) throw new Error(`couche ${i + 1} : dimensions incorrectes`); pi.W[i].set(l.W); pi.b[i].set(l.b); });
    m.weights = { pi: pi.toStore(), vf: j.weights.critic || null, logStd: j.weights.logStd || null };
    if (j.eval) m.importedEval = j.eval;
    return m;
  }
  function exportJS(m) {
    const L = weightsOf(m), A = ACTIVATIONS[m.arch.act];
    const actJs = { tanh: 'Math.tanh(x)', relu: 'x > 0 ? x : 0', leaky: 'x > 0 ? x : 0.01 * x', elu: 'x > 0 ? x : Math.exp(x) - 1' }[m.arch.act];
    return `${header(m, '//')}

export const AMAX = ${m.env.amax};
export const DT = ${DT};

const LAYERS = [
${L.map(l => `  { ni: ${l.ni}, no: ${l.no}, W: new Float32Array([${Array.from(l.W, fmtF).join(',')}]), b: new Float32Array([${Array.from(l.b, fmtF).join(',')}]) }`).join(',\n')}
];

const act = x => (${actJs}); // ${A.label}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Construit le vecteur d'entrée à partir des grandeurs physiques (tableaux [x, y, z]). */
export function observe(relTarget, relVel, accApplied) {
  const o = new Float32Array(9);
  for (let i = 0; i < 3; i++) {
    o[i] = clamp(relTarget[i] / 5, -3, 3);
    o[3 + i] = clamp(relVel[i] / 5, -3, 3);
    o[6 + i] = accApplied[i] / 6;
  }
  return o;
}

/** Retourne l'accélération normalisée [ax, ay, az] dans [-1, 1]. */
export function policy(obs) {
  let h = obs;
  for (let l = 0; l < LAYERS.length; l++) {
    const { ni, no, W, b } = LAYERS[l], out = new Float32Array(no);
    for (let o = 0; o < no; o++) {
      let s = b[o];
      for (let i = 0; i < ni; i++) s += W[o * ni + i] * h[i];
      out[o] = l < LAYERS.length - 1 ? act(s) : s;
    }
    h = out;
  }
  return [clamp(h[0], -1, 1), clamp(h[1], -1, 1), clamp(h[2], -1, 1)];
}
`;
  }
  function cIdent(s) { return (s || 'policy').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'POLICY'; }
  function exportC(m) {
    const L = weightsOf(m), A = ACTIVATIONS[m.arch.act], G = 'DF_' + cIdent(m.name) + '_H';
    const maxW = Math.max(...L.map(l => l.no));
    const chunk = arr => { const s = Array.from(arr, v => { const t = fmtF(v); return (/[.e]/.test(t) ? t : t + '.0') + 'f'; }); const rows = []; for (let i = 0; i < s.length; i += 8) rows.push('  ' + s.slice(i, i + 8).join(', ')); return rows.join(',\n'); };
    const bytes = L.reduce((s, l) => s + (l.W.length + l.b.length) * 4, 0);
    return `${header(m, ' *').replace(/^ \*/, '/*')}
 *
 * Mémoire : ${bytes} octets de poids en flash (float32), ${maxW * 2 * 4} octets de pile.
 * Calcul : ${L.reduce((s, l) => s + l.W.length, 0)} multiplications-additions par décision.
 * Utilisation : #include "${cIdent(m.name).toLowerCase()}.h" puis df_policy(obs, out) toutes les ${DT * 1000} ms.
 */
#ifndef ${G}
#define ${G}

#include <math.h>

#define DF_OBS_DIM 9
#define DF_ACT_DIM 3
#define DF_AMAX ${m.env.amax.toFixed(2)}f
#define DF_DT ${DT.toFixed(3)}f
#define DF_MAX_WIDTH ${maxW}

${L.map((l, i) => `static const float df_w${i}[${l.no} * ${l.ni}] = {\n${chunk(l.W)}\n};\nstatic const float df_b${i}[${l.no}] = {\n${chunk(l.b)}\n};`).join('\n\n')}

static inline float df_act(float x) { return ${A.c}; } /* ${A.label} */
static inline float df_clamp(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }

static inline void df_dense(const float *W, const float *b, int ni, int no, const float *in, float *out, int activate) {
  for (int o = 0; o < no; o++) {
    float s = b[o];
    const float *w = W + o * ni;
    for (int i = 0; i < ni; i++) s += w[i] * in[i];
    out[o] = activate ? df_act(s) : s;
  }
}

/* Construit l'entrée du réseau à partir des grandeurs physiques. */
static inline void df_observe(const float rel_target[3], const float rel_vel[3], const float acc_applied[3], float obs[DF_OBS_DIM]) {
  for (int i = 0; i < 3; i++) {
    obs[i] = df_clamp(rel_target[i] / 5.0f, -3.0f, 3.0f);
    obs[3 + i] = df_clamp(rel_vel[i] / 5.0f, -3.0f, 3.0f);
    obs[6 + i] = acc_applied[i] / 6.0f;
  }
}

/* Accélération normalisée [-1, 1] ; multipliez par DF_AMAX pour obtenir des m/s². */
static inline void df_policy(const float obs[DF_OBS_DIM], float out[DF_ACT_DIM]) {
  float a[DF_MAX_WIDTH], b[DF_MAX_WIDTH];
  const float *in = obs;
${L.map((l, i) => {
      const dst = i % 2 === 0 ? 'a' : 'b', last = i === L.length - 1;
      return `  df_dense(df_w${i}, df_b${i}, ${l.ni}, ${l.no}, in, ${dst}, ${last ? 0 : 1});` + (last ? '' : `\n  in = ${dst};`);
    }).join('\n')}
  for (int j = 0; j < DF_ACT_DIM; j++) out[j] = df_clamp(${(L.length - 1) % 2 === 0 ? 'a' : 'b'}[j], -1.0f, 1.0f);
}

#endif /* ${G} */
`;
  }
  function exportPython(m) {
    const L = weightsOf(m), A = ACTIVATIONS[m.arch.act];
    const torchAct = { tanh: 'nn.Tanh()', relu: 'nn.ReLU()', leaky: 'nn.LeakyReLU(0.01)', elu: 'nn.ELU()' }[m.arch.act];
    return `${header(m, '#')}
import numpy as np

AMAX = ${m.env.amax}
DT = ${DT}

LAYERS = [
${L.map(l => `    (np.array([${Array.from(l.W, fmtF).join(', ')}], dtype=np.float32).reshape(${l.no}, ${l.ni}),\n     np.array([${Array.from(l.b, fmtF).join(', ')}], dtype=np.float32)),`).join('\n')}
]


def observe(rel_target, rel_vel, acc_applied):
    """Construit l'entrée du réseau à partir des grandeurs physiques."""
    rel_target, rel_vel, acc_applied = (np.asarray(v, dtype=np.float32) for v in (rel_target, rel_vel, acc_applied))
    return np.concatenate([np.clip(rel_target / 5, -3, 3), np.clip(rel_vel / 5, -3, 3), acc_applied / 6]).astype(np.float32)


def policy(obs):
    """Accélération normalisée [ax, ay, az] dans [-1, 1] (multipliez par AMAX)."""
    h = np.asarray(obs, dtype=np.float32)
    for i, (W, b) in enumerate(LAYERS):
        h = W @ h + b
        if i < len(LAYERS) - 1:
            h = ${A.py}
    return np.clip(h, -1.0, 1.0)


def to_torch():
    """Reconstruit le réseau en PyTorch (pour l'exporter ensuite en ONNX)."""
    import torch
    from torch import nn
    mods = []
    for i, (W, b) in enumerate(LAYERS):
        lin = nn.Linear(W.shape[1], W.shape[0])
        lin.weight.data = torch.from_numpy(W.copy())
        lin.bias.data = torch.from_numpy(b.copy())
        mods.append(lin)
        if i < len(LAYERS) - 1:
            mods.append(${torchAct})
    return nn.Sequential(*mods)


if __name__ == "__main__":
    o = observe([2.0, 1.0, -3.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0])
    print("Entrée :", o)
    print("Accélération demandée (m/s²) :", policy(o) * AMAX)
    # Export ONNX :
    # import torch; net = to_torch(); torch.onnx.export(net, torch.zeros(1, 9), "${cIdent(m.name).toLowerCase()}.onnx")
`;
  }
  function exportReport(m) {
    const ev = m.eval, pct = x => `${Math.round(x * 100)} %`, n2 = x => (x == null ? '—' : x.toFixed(2).replace('.', ','));
    const lines = [
      `# Rapport de fiabilité — ${m.name}`, '',
      `- Algorithme : ${ALGOS[m.algo].long}`,
      `- Tâche : ${TASKS[m.env.task].label}`,
      `- Architecture : ${[OBS, ...m.arch.layers, ACT].join(' → ')}, activation ${ACTIVATIONS[m.arch.act].label}, ${paramCount(m.arch, false)} paramètres`,
      `- Entraînement : ${m.stats.iter} itérations, ${m.stats.steps.toLocaleString('fr-FR')} pas simulés, ${Math.round(m.stats.timeMs / 1000)} s`,
      '',
    ];
    if (!ev) { lines.push('Le modèle n\'a pas encore été évalué.'); return lines.join('\n'); }
    lines.push(`## Résultat : ${String(ev.score).replace('.', ',')}/100, note ${ev.grade}`, '', `Contrôleur PD de référence : ${String(ev.baseScore).replace('.', ',')}/100.`, '', verdict(ev), '',
      `Banc : ${ev.n} épisodes par scénario, graine ${ev.seed}, drone testé avec un temps de réponse de ${Math.round(ev.tauA * 1000)} ms, évaluation du ${ev.date.slice(0, 10)}.`, '',
      `| Scénario | Réussite | IC 95 % | Référence PD | ${TASKS[ev.task].err} (m) | P90 (m) | Pertes de contrôle |`,
      '|---|---|---|---|---|---|---|');
    for (const s of ev.scenarios) lines.push(`| ${s.label} | ${pct(s.stats.success)} | ${pct(s.stats.ci[0])} – ${pct(s.stats.ci[1])} | ${pct(s.base.success)} | ${n2(s.stats.err)} | ${n2(s.stats.errP90)} | ${pct(s.stats.lost + s.stats.crash)} |`);
    lines.push('', '## Robustesse au vent', '', '| Perturbation (m/s²) | Modèle | Référence PD |', '|---|---|---|');
    for (const w of ev.sweep) lines.push(`| ${w.wind} | ${pct(w.model)} | ${pct(w.base)} |`);
    lines.push('', `Temps d'inférence mesuré dans le navigateur : ${n2(ev.inferUs)} µs par décision.`, '',
      'Les épisodes sont simulés avec un modèle de drone simplifié (accélération du premier ordre, traînée linéaire, vent). Ces résultats classent les modèles entre eux ; ils ne remplacent pas des essais en vol.');
    return lines.join('\n');
  }
  function exportCSV(m) {
    const rows = [['iteration', 'pas_simules', 'retour_moyen', 'taux_reussite', 'exploration_sigma', 'temps_s']];
    for (const h of m.history) rows.push([h.it, h.steps, h.ret.toFixed(4), h.ok.toFixed(4), (h.std || 0).toFixed(5), (h.t || 0).toFixed(1)]);
    return rows.map(r => r.join(';')).join('\n');
  }

  return {
    ACTIVATIONS, TASKS, ALGOS, HP, ENV_PARAMS, MAX_ITER, SCENARIOS, SWEEP, DT, Net, LabEnv, envDefaults, hpDefaults, newModel, sanitizeModel, paramCount,
    makeRuntime, storeWeights, trainer, baselinePolicy, runEpisode, evaluateGen, verdict, grade, wilson,
    exportJSON, importJSON, exportJS, exportC, exportPython, exportReport, exportCSV, cIdent,
  };
})();
if (typeof module !== 'undefined') module.exports = DFLab;
