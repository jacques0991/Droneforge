/* =====================================================================
   DroneForge — noyau de calcul (aucune dépendance DOM ni Three.js)
   Modèle moteur/hélice, bilan de masse, nomenclature, simulation 6-DoF,
   pilote automatique et apprentissage PPO.
   ===================================================================== */
const DF = (() => {
  'use strict';
  const G = 9.81, RHO = 1.225, TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const fr = (x, d) => Number(x).toFixed(d).replace('.', ',');

  /* ---------- Catalogues ---------- */
  const PRESETS = {
    racing:    { label: 'Course 2306 (FPV Racing)', statorD: 23, statorH: 6,   kv: 2550, winding: '12N14P', cells: 4, capacity: 1300,  propD: 5.1, propP: 4.3, blades: 3, wheelbase: 220, frameMass: 115, esc: 55 },
    freestyle: { label: 'Freestyle 2207 (6S)',      statorD: 22, statorH: 7,   kv: 1950, winding: '12N14P', cells: 6, capacity: 1100,  propD: 5.1, propP: 3.6, blades: 3, wheelbase: 225, frameMass: 125, esc: 55 },
    longrange: { label: 'Longue portée 7" 2806.5',  statorD: 28, statorH: 6.5, kv: 1300, winding: '12N14P', cells: 6, capacity: 1800,  propD: 7,   propP: 4,   blades: 2, wheelbase: 315, frameMass: 165, esc: 45, gps: true, firmware: 'INAV' },
    micro:     { label: 'Micro 3" 1404',            statorD: 14, statorH: 4,   kv: 3800, winding: '9N12P',  cells: 4, capacity: 650,   propD: 3,   propP: 3,   blades: 3, wheelbase: 140, frameMass: 38,  esc: 25 },
    heavy:     { label: 'Cartographie 15" 4114',    statorD: 41, statorH: 14,  kv: 400,  winding: '24N22P', cells: 6, capacity: 10000, propD: 15,  propP: 5.5, blades: 2, wheelbase: 650, frameMass: 620, esc: 65, gps: true, firmware: 'ArduPilot', mcu: 'H743', video: 'hd' },
  };
  const WINDINGS = {
    '9N12P':  { slots: 9,  poles: 12, pattern: 'ABCABCABC' },
    '12N14P': { slots: 12, poles: 14, pattern: 'AabBCcaABbcC' },
    '24N22P': { slots: 24, poles: 22, pattern: 'AabBCcaABbcCaABbcCAabBCc' },
  };
  const ESC = {
    25: { maxS: 4, price: 30,  mass: 6 },
    35: { maxS: 6, price: 42,  mass: 9 },
    45: { maxS: 6, price: 55,  mass: 12 },
    55: { maxS: 6, price: 68,  mass: 15 },
    65: { maxS: 8, price: 85,  mass: 20 },
    80: { maxS: 8, price: 110, mass: 28 },
  };
  const MCU = {
    F405: { label: 'STM32F405', loopKHz: 8, uarts: 6, price: 35, mA: 120, size: 10, flashKB: 1024 },
    F722: { label: 'STM32F722', loopKHz: 8, uarts: 5, price: 45, mA: 140, size: 10, flashKB: 512 },
    H743: { label: 'STM32H743', loopKHz: 8, uarts: 8, price: 68, mA: 220, size: 14, flashKB: 2048 },
  };
  const IMU = {
    'ICM-42688-P': { gyroKHz: 8,   price: 0,  noise: 'faible' },
    'BMI270':      { gyroKHz: 3.2, price: -3, noise: 'moyen' },
    'MPU6000':     { gyroKHz: 8,   price: 4,  noise: 'moyen (composant en fin de vie)' },
  };
  const VIDEO = {
    none:   { label: 'Aucune', mass: 0, uart: 0, loads: [] },
    analog: { label: 'Analogique (caméra + VTX 400 mW)', mass: 14, uart: 1, loads: [{ rail: '5V', mA: 150, label: 'Caméra analogique' }, { rail: '10V', mA: 330, label: 'Émetteur vidéo 400 mW' }] },
    hd:     { label: 'Numérique HD', mass: 36, uart: 1, loads: [{ rail: 'VBAT', W: 9, label: 'Système vidéo HD' }] },
  };
  const FIRMWARES = ['Betaflight', 'INAV', 'ArduPilot'];
  const RAIL_LIMIT = { '5V': 2000, '10V': 2000 };

  const LIMITS = {
    statorD: [10, 50], statorH: [3, 20], kv: [150, 6000], cells: [2, 8], capacity: [300, 16000],
    propD: [2, 18], propP: [1, 10], blades: [2, 5], wheelbase: [80, 1000], frameMass: [15, 2000],
  };

  function defaultConfig() {
    const c = { preset: 'racing', mcu: 'F722', imu: 'ICM-42688-P', video: 'analog', gps: false, firmware: 'Betaflight' };
    applyPreset(c, 'racing');
    return c;
  }
  function applyPreset(c, key) {
    const p = PRESETS[key];
    if (!p) return c;
    for (const k of Object.keys(LIMITS)) c[k] = p[k];
    c.winding = p.winding; c.esc = p.esc;
    c.gps = !!p.gps; c.firmware = p.firmware || 'Betaflight';
    c.mcu = p.mcu || 'F722'; c.video = p.video || 'analog';
    c.preset = key;
    return c;
  }
  function sanitizeConfig(c) {
    const d = defaultConfig();
    const out = Object.assign({}, d, c || {});
    for (const [k, [a, b]] of Object.entries(LIMITS)) {
      const v = Number(out[k]);
      out[k] = Number.isFinite(v) ? clamp(v, a, b) : d[k];
    }
    out.cells = Math.round(out.cells); out.blades = Math.round(out.blades);
    if (!WINDINGS[out.winding]) out.winding = d.winding;
    if (!ESC[out.esc]) out.esc = d.esc;
    if (!MCU[out.mcu]) out.mcu = d.mcu;
    if (!IMU[out.imu]) out.imu = d.imu;
    if (!VIDEO[out.video]) out.video = d.video;
    if (!FIRMWARES.includes(out.firmware)) out.firmware = d.firmware;
    out.gps = !!out.gps;
    if (out.preset !== 'custom' && !PRESETS[out.preset]) out.preset = 'custom';
    return out;
  }
  function designation(c) {
    const h = c.statorH;
    const hs = Number.isInteger(h) ? String(h) : h.toFixed(1);
    return String(Math.round(c.statorD)).padStart(2, '0') + (h < 10 ? '0' : '') + hs;
  }

  /* ---------- Modèle moteur brushless + hélice ----------
     Équilibre : Kt·(Im − I0) = Q_hélice(ω),  Im = (V·d − Ke·ω)/R
     Hélice : T = Ct·ρ·n²·D⁴ ,  P = Cp·ρ·n³·D⁵                         */
  function motorParams(c) {
    const vol = c.statorD * c.statorD * c.statorH; // mm³ (indice de taille)
    const Rm = clamp(7.6e11 / (c.kv * c.kv * Math.pow(c.statorD, 4) * c.statorH), 0.008, 3);
    const Vnom = c.cells * 3.7;
    const I0 = 0.3 + c.kv * Vnom * 2e-5;
    const D = c.propD * 0.0254, pd = c.propP / c.propD;
    const bt = [0, 0.6, 1, 1.25, 1.42, 1.55][c.blades] || 1;
    const bp = [0, 0.55, 1, 1.32, 1.6, 1.85][c.blades] || 1;
    const Ct = (0.07 + 0.06 * pd) * bt;
    const Cp = (0.022 + 0.075 * pd * pd) * bp;
    const kvRad = c.kv * TAU / 60; // rad/s par volt
    const Ke = 1 / kvRad;
    const mass = vol < 3174 ? 32 * Math.pow(vol / 3174, 0.9) : 32 * Math.pow(vol / 3174, 0.68);
    return { vol, Rm, Rtot: Rm + 0.012, Vnom, I0, D, Ct, Cp, kvRad, Ke, mass, statorD: c.statorD, statorH: c.statorH };
  }
  function operatingPoint(mp, throttle, vbat) {
    vbat = vbat || mp.Vnom;
    throttle = clamp(throttle, 0, 1);
    const Vm = vbat * throttle;
    const zero = { throttle, rpm: 0, thrustN: 0, thrustG: 0, Im: 0, Ibat: 0, Pel: 0, Pmech: 0, eff: 0, gw: 0, tip: 0, cu: 0, iron: 0, temp: 25 };
    if (Vm < 0.05) return zero;
    const D5 = Math.pow(mp.D, 5);
    const Qp = w => { const n = w / TAU; return mp.Cp * RHO * n * n * D5 / TAU; };
    let lo = 0, hi = Vm * mp.kvRad;
    for (let i = 0; i < 60; i++) {
      const w = 0.5 * (lo + hi);
      const Im = (Vm - mp.Ke * w) / mp.Rtot;
      if (mp.Ke * (Im - mp.I0) > Qp(w)) lo = w; else hi = w;
    }
    const w = lo, n = w / TAU;
    const Im = Math.max(0, (Vm - mp.Ke * w) / mp.Rtot);
    const Ibat = Im * throttle;
    const thrustN = mp.Ct * RHO * n * n * Math.pow(mp.D, 4);
    const Pmech = Qp(w) * w;
    const Pel = vbat * Ibat;
    const cu = Im * Im * mp.Rm;
    const iron = mp.I0 * mp.Ke * w;
    const Rth = 75 / (mp.statorD * mp.statorH);
    return {
      throttle, rpm: w * 60 / TAU, thrustN, thrustG: thrustN / G * 1000, Im, Ibat, Pel, Pmech,
      eff: Pel > 0 ? Pmech / Pel : 0, gw: Pel > 0 ? (thrustN / G * 1000) / Pel : 0,
      tip: (w * mp.D / 2) / 343, cu, iron, temp: 25 + (cu + iron) * Rth,
    };
  }

  /* ---------- Électronique : charges par rail ---------- */
  function electronicsLoad(c) {
    const mcu = MCU[c.mcu];
    const loads = [
      { rail: '5V', mA: mcu.mA + 60, label: `Contrôleur de vol (${mcu.label}, IMU, baromètre, flash)` },
      { rail: '5V', mA: 110, label: 'Récepteur ExpressLRS' },
    ];
    if (c.gps) loads.push({ rail: '5V', mA: 55, label: 'Module GNSS + compas' });
    for (const l of VIDEO[c.video].loads) loads.push(Object.assign({}, l));
    const rails = { '5V': { mA: 0, limit: RAIL_LIMIT['5V'] }, '10V': { mA: 0, limit: RAIL_LIMIT['10V'] }, VBAT: { W: 0 } };
    for (const l of loads) { if (l.rail === 'VBAT') rails.VBAT.W += l.W; else rails[l.rail].mA += l.mA; }
    const watts = 5 * rails['5V'].mA / 1000 + 10 * rails['10V'].mA / 1000 + rails.VBAT.W;
    const ampsBat = (watts / 0.85) / (c.cells * 3.7);
    return { loads, rails, watts, ampsBat };
  }

  function wiring(totalA, motorA) {
    const conn = totalA < 35 ? 'XT30' : totalA < 75 ? 'XT60' : 'XT90';
    const awgB = totalA < 40 ? 16 : totalA < 80 ? 14 : totalA < 130 ? 12 : 10;
    const awgM = motorA < 15 ? 24 : motorA < 25 ? 22 : motorA < 40 ? 20 : motorA < 55 ? 18 : 16;
    return { conn, awgB, awgM };
  }

  /* ---------- Nomenclature (source unique des masses) ---------- */
  function buildBOM(c, mp, full) {
    const L = [];
    const add = (ref, cat, name, spec, qty, onboard, mass, price) => L.push({ ref, cat, name, spec, qty, onboard, mass, price });
    const esc = ESC[c.esc], mcu = MCU[c.mcu], imu = IMU[c.imu];
    const totalA = full.Ibat * 4 + 1;
    const w = wiring(totalA, full.Im);
    const shaft = c.statorD < 18 ? '1,5 mm' : c.statorD < 35 ? '5 mm' : '6 mm';
    const propMass = 0.055 * c.propD * c.propD * c.blades;
    const battMass = c.cells * (c.capacity * 0.024 + 8);
    const cRate = clamp(Math.ceil((totalA / (c.capacity / 1000)) * 1.2 / 5) * 5, 10, 150);
    const k = c.wheelbase / 220;
    add('FRM-01', 'Structure', `Châssis carbone X ${c.wheelbase} mm`, `Bras ${Math.max(3, Math.round(5 * Math.sqrt(k)))} mm, carbone 3K`, 1, 1, c.frameMass, 25 + 0.12 * c.wheelbase);
    add('MOT-01', 'Propulsion', `Moteur brushless ${designation(c)} ${c.kv} Kv`, `${c.winding}, arbre ${shaft}`, 4, 4, mp.mass, 6 + 0.27 * Math.sqrt(mp.vol));
    add('PRP-01', 'Propulsion', `Hélice ${c.propD}×${c.propP}×${c.blades}`, '2 CW + 2 CCW, 1 jeu de rechange', 8, 4, propMass, 0.2 + 0.03 * c.propD * c.propD * c.blades / 3);
    add('ESC-01', 'Électronique', `ESC 4-en-1 ${c.esc} A`, `${esc.maxS}S max, DShot bidirectionnel`, 1, 1, esc.mass, esc.price);
    add('FC-01', 'Électronique', `Contrôleur de vol ${mcu.label}`, `${c.imu}, baromètre, blackbox 16 Mo`, 1, 1, 8, mcu.price + imu.price);
    add('RX-01', 'Radio', 'Récepteur ExpressLRS 2,4 GHz', 'Antenne en T, télémétrie', 1, 1, 3, 15);
    if (c.video === 'analog') {
      add('CAM-01', 'Vidéo', 'Caméra analogique 1200 TVL', 'Capteur 1/3", 2,1 mm', 1, 1, 6, 25);
      add('VTX-01', 'Vidéo', 'Émetteur vidéo 5,8 GHz 400 mW', 'Contrôle SmartAudio', 1, 1, 8, 25);
    } else if (c.video === 'hd') {
      add('VID-01', 'Vidéo', 'Système vidéo numérique HD', 'Caméra + émetteur, enregistrement 4K', 1, 1, 36, 190);
    }
    if (c.gps) add('GPS-01', 'Navigation', 'Module GNSS M10 + compas', 'UART + I²C', 1, 1, 10, 22);
    add('BAT-01', 'Énergie', `Batterie LiPo ${c.cells}S ${c.capacity} mAh`, `${(c.cells * 3.7).toFixed(1)} V nominal, ${cRate}C`, 1, 1, battMass, 6 + 0.0048 * c.capacity * c.cells);
    add('CON-01', 'Énergie', `Connecteur ${w.conn}`, 'Paire mâle + femelle', 1, 1, w.conn === 'XT90' ? 9 : w.conn === 'XT60' ? 4 : 2, w.conn === 'XT90' ? 3.5 : 2);
    add('CBL-01', 'Énergie', `Câble silicone ${w.awgB} AWG`, '0,2 m rouge + noir', 1, 1, 0.012 * Math.pow(2, (16 - w.awgB) / 3) * 200 / 10, 3);
    add('CBL-02', 'Propulsion', `Câble moteur ${w.awgM} AWG`, '12 conducteurs, 0,1 m', 1, 1, 2 + 0.008 * c.wheelbase, 2);
    add('CAP-01', 'Énergie', `Condensateur low-ESR 1000 µF ${c.cells >= 5 ? 50 : 35} V`, 'Monté sur les pads batterie', 1, 1, 4, 1.5);
    add('HW-01', 'Structure', 'Kit visserie M3 / M2 inox', 'Vis, écrous nylstop, entretoises', 1, 1, 10 * Math.sqrt(k), 4);
    add('HW-02', 'Structure', 'Sangle batterie kevlar + pad', 'Une sangle de rechange', 2, 1, 4, 3.5);
    add('HW-03', 'Structure', 'Gaine thermo, colliers, silent-blocs', 'Lot', 1, 1, 3, 3);
    return { lines: L, wiring: w, cRate, battMass, propMass };
  }

  /* ---------- Synthèse complète d'une configuration ---------- */
  function summarize(cIn) {
    const c = sanitizeConfig(cIn);
    const mp = motorParams(c);
    const full = operatingPoint(mp, 1);
    const bom = buildBOM(c, mp, full);
    const auwG = bom.lines.reduce((s, l) => s + l.mass * l.onboard, 0);
    const thrustMaxG = full.thrustG * 4;
    const twr = thrustMaxG / auwG;
    let hover = null;
    if (twr > 1.0001) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (operatingPoint(mp, m).thrustG * 4 < auwG) lo = m; else hi = m; }
      hover = operatingPoint(mp, hi);
    }
    const elec = electronicsLoad(c);
    const hoverBatA = hover ? hover.Ibat * 4 + elec.ampsBat : null;
    const flightMin = hover ? (c.capacity / 1000 * 0.8) / hoverBatA * 60 : 0;
    const tau = 0.012 + 0.0004 * c.propD * c.propD * Math.sqrt(c.blades / 3);
    const kq = mp.Cp * mp.D / (TAU * mp.Ct);
    const armL = c.wheelbase / 2000;
    const m = auwG / 1000, mm = mp.mass / 1000;
    const mb = Math.max(0.01, m - 4 * mm);
    const sb = c.wheelbase / 1000 * 0.35;
    const Ib = mb * sb * sb / 6;
    const inertia = [2 * mm * armL * armL + Ib, 4 * mm * armL * armL + Ib * 1.2, 2 * mm * armL * armL + Ib];
    const table = [];
    for (let i = 0; i <= 40; i++) { const op = operatingPoint(mp, i / 40); table.push([op.thrustN, op.Ibat]); }
    return {
      cfg: c, mp, full, hover, bom, auwG, thrustMaxG, twr, elec, hoverBatA, flightMin,
      tau, kq, armL, inertia, table, CdA: 0.012 * Math.pow(c.wheelbase / 220, 2),
      Rint: c.cells * 0.008 * 1300 / c.capacity, capacityAh: c.capacity / 1000, cells: c.cells,
      elecA: elec.ampsBat, designation: designation(c),
      noiseHz: hover ? hover.rpm / 60 : 0, bpfHz: hover ? hover.rpm / 60 * c.blades : 0,
    };
  }

  /* ---------- Vérifications (moteur + électronique) ---------- */
  function motorChecks(s) {
    const c = s.cfg, out = [];
    const esc = ESC[c.esc];
    if (s.twr < 1) out.push(['bad', `Poussée insuffisante : ${fr(s.twr, 2)}:1. Le drone ne décolle pas.`]);
    else if (s.twr < 2) out.push(['warn', `Rapport poussée/poids faible (${fr(s.twr, 1)}:1). Visez au moins 2:1, 5:1 et plus pour la course.`]);
    else out.push(['good', `Rapport poussée/poids ${fr(s.twr, 1)}:1.`]);
    if (s.hover && s.hover.throttle > 0.7) out.push(['warn', `Gaz au stationnaire élevés (${Math.round(s.hover.throttle * 100)} %) : peu de marge de manœuvre.`]);
    if (s.full.Im > c.esc) out.push(['bad', `Courant moteur à plein gaz ${fr(s.full.Im, 1)} A > ESC ${c.esc} A.`]);
    else if (s.full.Im > c.esc * 0.85) out.push(['warn', `Courant moteur ${fr(s.full.Im, 1)} A proche de la limite ESC (${c.esc} A).`]);
    else out.push(['good', `Courant moteur ${fr(s.full.Im, 1)} A, ESC ${c.esc} A suffisant.`]);
    if (c.cells > esc.maxS) out.push(['bad', `Batterie ${c.cells}S au-dessus de la tension maximale de l'ESC (${esc.maxS}S).`]);
    if (s.full.tip > 0.75) out.push(['bad', `Bout de pale à Mach ${fr(s.full.tip, 2)} : pertes et bruit importants. Réduisez le Kv ou le diamètre.`]);
    else if (s.full.tip > 0.62) out.push(['warn', `Bout de pale à Mach ${fr(s.full.tip, 2)} : rendement dégradé.`]);
    if (s.full.temp > 110) out.push(['bad', `Échauffement à plein gaz continu ≈ ${Math.round(s.full.temp)} °C : bobinage en danger.`]);
    else if (s.full.temp > 90) out.push(['warn', `Échauffement à plein gaz continu ≈ ${Math.round(s.full.temp)} °C. Acceptable en rafales courtes seulement.`]);
    const noLoad = c.kv * c.cells * 4.2;
    if (noLoad > 50000) out.push(['warn', `Régime à vide ${Math.round(noLoad).toLocaleString('fr-FR')} tr/min : roulements très sollicités.`]);
    if (s.hover && s.flightMin < 3) out.push(['warn', `Autonomie au stationnaire courte (${fr(s.flightMin, 1)} min).`]);
    return out;
  }
  function boardChecks(s) {
    const c = s.cfg, out = [];
    const mcu = MCU[c.mcu], imu = IMU[c.imu], esc = ESC[c.esc];
    const ratio = s.full.Im / c.esc;
    out.push([ratio > 1 ? 'bad' : ratio > 0.85 ? 'warn' : 'good', `ESC ${c.esc} A pour ${fr(s.full.Im, 1)} A par moteur à plein gaz (${Math.round(ratio * 100)} %).`]);
    out.push([c.cells > esc.maxS ? 'bad' : 'good', `Tension : batterie ${c.cells}S, ESC limité à ${esc.maxS}S.`]);
    const loop = Math.min(mcu.loopKHz, imu.gyroKHz);
    out.push([loop < 4 ? 'warn' : 'good', `Boucle gyro/PID à ${loop.toLocaleString('fr-FR')} kHz${imu.gyroKHz < mcu.loopKHz ? ` (limitée par le ${c.imu})` : ''}.`]);
    const need = 1 + VIDEO[c.video].uart + (c.gps ? 1 : 0) + 1;
    out.push([need > mcu.uarts ? 'bad' : 'good', `Ports série : ${need} utilisés sur ${mcu.uarts} (récepteur${c.video !== 'none' ? ', vidéo' : ''}${c.gps ? ', GPS' : ''}, télémétrie).`]);
    for (const r of ['5V', '10V']) {
      const R = s.elec.rails[r];
      if (!R.mA) continue;
      const p = R.mA / R.limit;
      out.push([p > 1 ? 'bad' : p > 0.8 ? 'warn' : 'good', `Régulateur ${r} : ${R.mA} mA sur ${R.limit} mA (${Math.round(p * 100)} %).`]);
    }
    if (c.firmware === 'ArduPilot' && c.mcu === 'F405') out.push(['warn', 'ArduPilot sur F405 : mémoire limitée, préférez un H743.']);
    if (c.firmware === 'INAV' && !c.gps) out.push(['warn', 'INAV sans GPS : les modes de navigation (retour maison, missions) sont indisponibles.']);
    if (c.firmware === 'Betaflight' && c.gps) out.push(['info', 'Betaflight + GPS : le retour de secours GPS Rescue est disponible.']);
    if (c.cells >= 5) out.push(['info', `Batterie ${c.cells}S : condensateur 50 V low-ESR obligatoire sur l'entrée ESC.`]);
    if (s.hover) out.push(['info', `Bruit moteur au stationnaire : ${Math.round(s.noiseHz)} Hz, passage de pales ${Math.round(s.bpfHz)} Hz. Activez le filtre RPM (DShot bidirectionnel).`]);
    return out;
  }

  /* ---------- Production ---------- */
  const DISCOUNTS = [[1000, 0.30], [100, 0.20], [25, 0.12], [10, 0.06], [1, 0]];
  function discountFor(qty) { for (const [q, d] of DISCOUNTS) if (qty >= q) return d; return 0; }
  function assemblyHours(c, qty) {
    const t1 = 75 + (c.video !== 'none' ? 15 : 0) + (c.gps ? 12 : 0) + (c.wheelbase > 400 ? 40 : 0);
    const b = Math.log2(0.85);
    let total = 0;
    const n = Math.min(qty, 20000);
    for (let i = 1; i <= n; i++) total += Math.max(t1 * 0.35, t1 * Math.pow(i, b));
    return { firstMin: t1, totalH: total / 60 };
  }
  const CHECKLIST = [
    'Contrôle à réception : références, quantités, état visuel des composants',
    'Montage des moteurs sur les bras (vis de longueur vérifiée, frein-filet)',
    'Soudure des fils moteurs sur l\'ESC 4-en-1',
    'Soudure du connecteur batterie et du condensateur low-ESR',
    'Première mise sous tension derrière un limiteur de courant (smoke stopper)',
    'Montage de la pile FC/ESC sur silent-blocs, nappe 8 broches',
    'Câblage récepteur, vidéo et GPS sur les ports série',
    'Flash du firmware, configuration des ports et du protocole DShot',
    'Calibrage de l\'accéléromètre et contrôle de l\'orientation de l\'IMU',
    'Sens de rotation des moteurs vérifié, hélices démontées',
    'Appairage radio, modes de vol et failsafe testés',
    'Montage des hélices (sens CW / CCW) et serrage des écrous',
    'Vol de test stationnaire et lecture de la blackbox',
  ];

  /* ---------- Outils mathématiques ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng()); }
  function qMul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
  }
  function qNormalize(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; }
  function qToMat(q) {
    const [w, x, y, z] = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
      2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
      2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
    ];
  }
  const yawOf = R => Math.atan2(R[2], R[8]);
  const yawQuat = psi => [Math.cos(psi / 2), 0, Math.sin(psi / 2), 0];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => Math.hypot(a[0], a[1], a[2]);

  /* ---------- Simulation 6-DoF ----------
     Repère : y vers le haut, avant = −z, droite = +x.
     Moteurs : 0 avant-droit, 1 arrière-gauche, 2 avant-gauche, 3 arrière-droit. */
  class QuadSim {
    constructor(s) { this.configure(s); this.reset(); }
    configure(s) {
      this.m = s.auwG / 1000;
      const a = s.armL * Math.SQRT1_2;
      this.a = a; this.rx = [a, -a, -a, a]; this.rz = [-a, a, -a, a]; this.sp = [1, 1, -1, -1];
      this.kq = s.kq; this.I = s.inertia.slice(); this.Tmax = s.full.thrustN; this.tau = s.tau;
      this.CdA = s.CdA; this.cells = s.cells; this.Vnom = s.cells * 3.7; this.capAh = s.capacityAh;
      this.Rint = s.Rint; this.table = s.table; this.elecA = s.elecA;
    }
    reset(pos) {
      this.p = pos ? pos.slice() : [0, 0, 0];
      this.v = [0, 0, 0]; this.acc = [0, 0, 0]; this.q = [1, 0, 0, 0]; this.w = [0, 0, 0];
      this.T = [0, 0, 0, 0]; this.soc = 1; this.Ibat = 0; this.armed = false; this.crashed = false;
      this.time = 0; this.flightTime = 0; this.onGround = true; this.crashReason = '';
    }
    vbat() { return Math.max(0, this.cells * (3.5 + 0.7 * clamp(this.soc, 0, 1)) - this.Ibat * this.Rint); }
    tmaxNow() { if (this.soc <= 0) return this.Tmax * 0.25; const r = this.vbat() / this.Vnom; return this.Tmax * Math.min(1.12, r * r); }
    _interp(T, col) {
      const tb = this.table, n = tb.length;
      if (T <= 0) return 0;
      for (let i = 1; i < n; i++) if (tb[i][0] >= T) { const f = (T - tb[i - 1][0]) / ((tb[i][0] - tb[i - 1][0]) || 1); return col === 'th' ? (i - 1 + f) / (n - 1) : tb[i - 1][1] + f * (tb[i][1] - tb[i - 1][1]); }
      return col === 'th' ? 1 : tb[n - 1][1];
    }
    throttleOf(i) { return this._interp(this.T[i] * this.Vnom * this.Vnom / Math.max(1, this.vbat() * this.vbat()), 'th'); }
    step(h, cmd, wind, infBattery) {
      const Tm = this.tmaxNow();
      const k = 1 - Math.exp(-h / this.tau);
      const live = this.armed && !this.crashed;
      let F = 0, tx = 0, ty = 0, tz = 0, Ib = 0;
      for (let i = 0; i < 4; i++) {
        const c = live ? clamp(cmd[i], 0, Tm) : 0;
        this.T[i] += (c - this.T[i]) * k;
        const T = this.T[i];
        F += T; tx += -this.rz[i] * T; tz += this.rx[i] * T; ty += this.sp[i] * this.kq * T;
        Ib += this._interp(T, 'I');
      }
      this.Ibat = Ib + (this.armed ? this.elecA : this.elecA * 0.5);
      if (!infBattery) this.soc = Math.max(0, this.soc - this.Ibat * h / (this.capAh * 3600));
      const R = qToMat(this.q);
      const up = [R[1], R[4], R[7]];
      const vr = [this.v[0] - wind[0], this.v[1] - wind[1], this.v[2] - wind[2]];
      const sp = norm(vr);
      const kd = 0.5 * RHO * this.CdA * sp / this.m;
      for (let j = 0; j < 3; j++) this.acc[j] = up[j] * F / this.m - kd * vr[j] - (j === 1 ? G : 0);
      for (let j = 0; j < 3; j++) { this.v[j] += this.acc[j] * h; this.p[j] += this.v[j] * h; }
      const I = this.I, w = this.w;
      const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
      const gyr = cross(w, Iw);
      const tau = [tx, ty, tz];
      for (let j = 0; j < 3; j++) w[j] += ((tau[j] - gyr[j] - I[j] * 0.6 * w[j]) / I[j]) * h;
      const dq = qMul(this.q, [0, w[0], w[1], w[2]]);
      this.q = qNormalize([this.q[0] + 0.5 * dq[0] * h, this.q[1] + 0.5 * dq[1] * h, this.q[2] + 0.5 * dq[2] * h, this.q[3] + 0.5 * dq[3] * h]);
      // Contact sol
      this.onGround = false;
      if (this.p[1] <= 0) {
        this.p[1] = 0;
        const impact = -this.v[1];
        const tilt = Math.acos(clamp(up[1], -1, 1));
        const hspeed = Math.hypot(this.v[0], this.v[2]);
        if (!this.crashed && (impact > 4.5 || (tilt > 65 * DEG && (impact > 0.6 || hspeed > 1.5)))) {
          this.crashed = true;
          this.crashReason = impact > 4.5 ? `Impact vertical à ${impact.toFixed(1)} m/s` : `Contact au sol incliné à ${Math.round(tilt / DEG)}°`;
        }
        if (this.v[1] < 0) this.v[1] = 0;
        const f = Math.max(0, 1 - 10 * h);
        this.v[0] *= f; this.v[2] *= f;
        if (F < this.m * G * 1.02) {
          this.q = yawQuat(yawOf(qToMat(this.q)));
          this.w = [0, this.w[1] * f, 0];
        }
        this.onGround = true;
      }
      this.time += h;
      if (this.armed && !this.onGround) this.flightTime += h;
    }
    attitude() {
      const R = qToMat(this.q);
      return { roll: Math.asin(clamp(R[3], -1, 1)) / DEG, pitch: Math.asin(clamp(-R[5], -1, 1)) / DEG, yaw: yawOf(R) / DEG, R };
    }
  }

  function effectiveGains(g, tau) {
    const rate = Math.min(g.rate, 0.5 / tau);
    const att = Math.min(g.att, rate / 3);
    const vel = Math.min(g.vel, att / 2.2);
    const pos = Math.min(g.pos, vel / 2);
    return { rate, att, vel, pos };
  }

  /* Constante de temps de réponse en accélération, utilisée pour adapter l'entraînement au drone */
  function responseTau(s, gains) { const g = effectiveGains(gains, s.tau); return clamp(1.2 / g.att, 0.12, 0.8); }

  class Wind {
    constructor(seed) { this.g = [0, 0, 0]; this.rng = mulberry32(seed || 7); }
    step(h, mean, dirDeg, gust) {
      const d = dirDeg * DEG;
      const sigma = gust * (1 + 0.45 * mean);
      for (let j = 0; j < 3; j++) this.g[j] += -this.g[j] / 1.6 * h + sigma * (j === 1 ? 0.35 : 1) * Math.sqrt(h) * gauss(this.rng);
      return [Math.sin(d) * mean + this.g[0], this.g[1], -Math.cos(d) * mean + this.g[2]];
    }
  }

  /* Navigation par apprentissage : constantes partagées entre l'environnement d'entraînement et la simulation */
  const NAV = { AMAX: 6, DT: 0.05, TAU_A: 0.12, DRAG: 0.25, EP_LEN: 160, OBS: 9, ACT: 3 };
  function navObs(rel, v, accF) {
    const o = new Float64Array(9);
    for (let i = 0; i < 3; i++) { o[i] = clamp(rel[i] / 5, -3, 3); o[3 + i] = clamp(v[i] / 5, -3, 3); o[6 + i] = accF[i] / NAV.AMAX; }
    return o;
  }

  class Autopilot {
    constructor() { this.reset(); this.rng = mulberry32(99); }
    reset() {
      this.vint = [0, 0, 0]; this.yawDes = 0; this.accF = [0, 0, 0]; this.policyT = 0; this.policyCmd = [0, 0, 0];
      this.wp = 0; this.landing = false; this.altHold = 1.5; this.holdXZ = null;
    }
    takeoff(sim) {
      if (sim.crashed) return;
      sim.armed = true; this.landing = false; this.vint = [0, 0, 0]; this.assist = true; this.assistXZ = [sim.p[0], sim.p[2]];
      this.altHold = Math.max(1.5, sim.p[1]); this.yawDes = yawOf(qToMat(sim.q));
    }
    land(sim) { this.landing = true; this.holdXZ = [sim.p[0], sim.p[2]]; }
    step(sim, h, inp) {
      const g = effectiveGains(inp.gains, sim.tau);
      if (!sim.armed || sim.crashed) return [0, 0, 0, 0];
      // Mesures (bruit capteurs optionnel)
      const nz = inp.noise ? 1 : 0, r = this.rng;
      const p = sim.p.map(x => x + nz * 0.03 * gauss(r));
      const v = sim.v.map(x => x + nz * 0.05 * gauss(r));
      const w = sim.w.map(x => x + nz * 0.06 * gauss(r));
      const q = sim.q;
      let aCmd = null, vdes = null;
      const wps = inp.waypoints || [];
      const target = wps.length ? wps[this.wp % wps.length] : [0, 1.5, 0];
      if (inp.mode !== 'manual' && wps.length && !this.landing) {
        const d = Math.hypot(target[0] - sim.p[0], target[1] - sim.p[1], target[2] - sim.p[2]);
        if (d < inp.accept) this.wp = (this.wp + 1) % wps.length;
      }
      if (this.landing) {
        const hx = this.holdXZ || [p[0], p[2]];
        vdes = [g.pos * (hx[0] - p[0]), p[1] > 1.5 ? -1.4 : -0.6, g.pos * (hx[1] - p[2])];
        if (sim.onGround && Math.hypot(...sim.v) < 0.4) { sim.armed = false; this.landing = false; return [0, 0, 0, 0]; }
      } else if (inp.mode === 'manual') {
        const m = inp.manual;
        this.yawDes += m.yaw * 1.8 * h;
        const s = inp.vmax;
        const c = Math.cos(this.yawDes), sn = Math.sin(this.yawDes);
        const fwd = [-sn, 0, -c], right = [c, 0, -sn];
        if (m.up !== 0) this.altHold = Math.max(0.3, p[1]);
        vdes = [ (fwd[0] * m.fwd + right[0] * m.right) * s,
                 m.up !== 0 ? m.up * Math.min(3, s * 0.6) : g.pos * 1.5 * (this.altHold - p[1]),
                 (fwd[2] * m.fwd + right[2] * m.right) * s ];
      } else if (inp.mode === 'ai' && inp.policy && this.assist) {
        // Décollage assisté : la politique a été entraînée en l'air, le contrôleur classique la met en position
        const hx = this.assistXZ || [p[0], p[2]];
        vdes = [g.pos * (hx[0] - p[0]), 1.5, g.pos * (hx[1] - p[2])];
        if (sim.p[1] > 0.9) { this.assist = false; this.accF = [0, 0, 0]; this.policyT = 0; }
      } else if (inp.mode === 'ai' && inp.policy) {
        this.policyT -= h;
        if (this.policyT <= 0) {
          this.policyT += NAV.DT;
          const rel = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
          const a = inp.policy(navObs(rel, v, this.accF));
          for (let j = 0; j < 3; j++) this.policyCmd[j] = (Number.isFinite(a[j]) ? clamp(a[j], -1, 1) : 0) * (inp.amax || NAV.AMAX);
        }
        const k = 1 - Math.exp(-h / (inp.tauA || NAV.TAU_A));
        for (let j = 0; j < 3; j++) this.accF[j] += (this.policyCmd[j] - this.accF[j]) * k;
        aCmd = this.accF.slice();
        this.vint = [0, 0, 0];
      } else {
        const e = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
        vdes = e.map(x => x * g.pos);
        const hn = Math.hypot(vdes[0], vdes[2]);
        if (hn > inp.vmax) { vdes[0] *= inp.vmax / hn; vdes[2] *= inp.vmax / hn; }
        vdes[1] = clamp(vdes[1], -Math.min(2.5, inp.vmax * 0.5), Math.min(3.5, inp.vmax * 0.6));
        const dx = target[0] - p[0], dz = target[2] - p[2];
        if (Math.hypot(dx, dz) > 1.5) this.yawDes = Math.atan2(-dx, -dz);
      }
      if (!aCmd) {
        aCmd = [0, 0, 0];
        const ki = g.vel * 0.35;
        for (let j = 0; j < 3; j++) {
          const ev = vdes[j] - v[j];
          if (Math.abs(ev) < 1.2) this.vint[j] = clamp(this.vint[j] + ki * ev * h, -4, 4);
          aCmd[j] = g.vel * ev + this.vint[j];
        }
      }
      if (inp.mode !== 'ai') { const k = 1 - Math.exp(-h / 0.03); for (let j = 0; j < 3; j++) this.accF[j] += (aCmd[j] - this.accF[j]) * k; }
      // Vecteur de poussée désiré + limite d'inclinaison
      const f = [sim.m * aCmd[0], sim.m * (aCmd[1] + G), sim.m * aCmd[2]];
      f[1] = Math.max(f[1], 0.3 * sim.m * G);
      const maxTilt = Math.tan(inp.maxTilt * DEG);
      const fh = Math.hypot(f[0], f[2]);
      if (fh > f[1] * maxTilt) { const s = f[1] * maxTilt / fh; f[0] *= s; f[2] *= s; }
      // La consigne de cap est bornée autour du cap actuel : l'erreur reste petite et ne perturbe pas roulis/tangage
      const yawNow = yawOf(qToMat(q));
      let dy = this.yawDes - yawNow; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      return attitudeControl(sim, f, yawNow + clamp(dy, -0.35, 0.35), g, q, w);
    }
  }

  /* Contrôle géométrique d'attitude (Lee) + mixeur X avec gestion de la saturation */
  function attitudeControl(sim, f, yawDes, g, q, w) {
    const R = qToMat(q);
    const fn = norm(f) || 1e-6;
    const yd = [f[0] / fn, f[1] / fn, f[2] / fn];
    const hdg = [-Math.sin(yawDes), 0, -Math.cos(yawDes)];
    let xd = cross(hdg, yd); let xn = norm(xd);
    if (xn < 1e-6) { xd = [1, 0, 0]; xn = 1; }
    xd = [xd[0] / xn, xd[1] / xn, xd[2] / xn];
    const zd = cross(xd, yd);
    const Rd = [xd[0], yd[0], zd[0], xd[1], yd[1], zd[1], xd[2], yd[2], zd[2]];
    const E = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let a = 0, b = 0;
      for (let k = 0; k < 3; k++) { a += Rd[k * 3 + i] * R[k * 3 + j]; b += R[k * 3 + i] * Rd[k * 3 + j]; }
      E[i * 3 + j] = a - b;
    }
    const eR = [0.5 * E[7], 0.5 * E[2], 0.5 * E[3]];
    const I = sim.I;
    const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
    const gyr = cross(w, Iw);
    const tau = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      const kr = j === 1 ? g.att * 0.5 : g.att;
      const wdes = -kr * eR[j];
      tau[j] = I[j] * g.rate * (wdes - w[j]) + gyr[j];
    }
    const F = Math.max(0, f[0] * R[1] + f[1] * R[4] + f[2] * R[7]);
    return mix(sim, F, tau);
  }
  function mix(sim, F, tau) {
    const a = sim.a, kq = sim.kq;
    const rowX = [a, -a, a, -a], rowY = [kq, kq, -kq, -kq], rowZ = [a, -a, -a, a];
    const Tm = sim.tmaxNow(), Tmin = 0.03 * sim.Tmax;
    const drp = [0, 0, 0, 0], dy = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      drp[i] = rowX[i] * tau[0] / (4 * a * a) + rowZ[i] * tau[2] / (4 * a * a);
      dy[i] = rowY[i] * tau[1] / (4 * kq * kq);
    }
    const range = arr => Math.max(...arr) - Math.min(...arr);
    const avail = Tm - Tmin;
    let sRP = 1, sY = 1;
    const tot = drp.map((x, i) => x + dy[i]);
    if (range(tot) > avail) {
      const rr = range(drp);
      if (rr >= avail) { sY = 0; sRP = avail / rr; }
      else { sY = clamp((avail - rr) / Math.max(1e-9, range(tot) - rr), 0, 1); }
    }
    const d = drp.map((x, i) => x * sRP + dy[i] * sY);
    const base = clamp(F / 4, Tmin - Math.min(...d), Tm - Math.max(...d));
    return d.map(x => clamp(base + x, 0, Tm));
  }

  /* ---------- Apprentissage par renforcement : PPO ---------- */
  class MLP {
    constructor(sizes, rng, outScale) {
      this.sizes = sizes; this.L = sizes.length - 1;
      this.W = []; this.b = []; this.gW = []; this.gb = [];
      for (let l = 0; l < this.L; l++) {
        const ni = sizes[l], no = sizes[l + 1];
        const W = new Float64Array(ni * no);
        const s = (l === this.L - 1 ? outScale : 1) * Math.sqrt(1 / ni);
        for (let i = 0; i < W.length; i++) W[i] = gauss(rng) * s;
        this.W.push(W); this.b.push(new Float64Array(no));
        this.gW.push(new Float64Array(ni * no)); this.gb.push(new Float64Array(no));
      }
    }
    forward(x) {
      const acts = [x]; let h = x;
      for (let l = 0; l < this.L; l++) {
        const ni = this.sizes[l], no = this.sizes[l + 1], W = this.W[l], b = this.b[l];
        const out = new Float64Array(no);
        for (let o = 0; o < no; o++) {
          let s = b[o]; const off = o * ni;
          for (let i = 0; i < ni; i++) s += W[off + i] * h[i];
          out[o] = l < this.L - 1 ? Math.tanh(s) : s;
        }
        acts.push(out); h = out;
      }
      return acts;
    }
    backward(acts, dout) {
      let d = Float64Array.from(dout);
      for (let l = this.L - 1; l >= 0; l--) {
        const ni = this.sizes[l], no = this.sizes[l + 1], W = this.W[l], gW = this.gW[l], gb = this.gb[l];
        const hin = acts[l], hout = acts[l + 1];
        if (l < this.L - 1) for (let o = 0; o < no; o++) d[o] *= 1 - hout[o] * hout[o];
        const dp = new Float64Array(ni);
        for (let o = 0; o < no; o++) {
          const dd = d[o]; if (dd === 0) continue;
          gb[o] += dd; const off = o * ni;
          for (let i = 0; i < ni; i++) { gW[off + i] += dd * hin[i]; dp[i] += W[off + i] * dd; }
        }
        d = dp;
      }
    }
    params() { const p = []; for (let l = 0; l < this.L; l++) { p.push([this.W[l], this.gW[l]]); p.push([this.b[l], this.gb[l]]); } return p; }
    zeroGrad() { for (const g of this.gW) g.fill(0); for (const g of this.gb) g.fill(0); }
    toJSON() { return { sizes: this.sizes, W: this.W.map(a => Array.from(a, x => +x.toFixed(6))), b: this.b.map(a => Array.from(a, x => +x.toFixed(6))) }; }
    load(j) {
      if (!j || JSON.stringify(j.sizes) !== JSON.stringify(this.sizes)) throw new Error('Architecture du réseau incompatible');
      j.W.forEach((a, l) => { if (a.length !== this.W[l].length) throw new Error('Poids incomplets'); this.W[l].set(a); });
      j.b.forEach((a, l) => this.b[l].set(a));
    }
  }
  class Adam {
    constructor(params, lr) { this.p = params; this.lr = lr; this.t = 0; this.m = params.map(([w]) => new Float64Array(w.length)); this.v = params.map(([w]) => new Float64Array(w.length)); }
    step(maxNorm) {
      let n2 = 0;
      for (const [, g] of this.p) for (let i = 0; i < g.length; i++) n2 += g[i] * g[i];
      const n = Math.sqrt(n2), sc = maxNorm && n > maxNorm ? maxNorm / n : 1;
      this.t++;
      const b1 = 0.9, b2 = 0.999, c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
      this.p.forEach(([w, g], k) => {
        const m = this.m[k], v = this.v[k];
        for (let i = 0; i < w.length; i++) {
          const gi = g[i] * sc;
          m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi;
          w[i] -= this.lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
        }
      });
      return n;
    }
  }
  class PPOAgent {
    constructor(seed) {
      this.rng = mulberry32(seed || 1234);
      this.pi = new MLP([NAV.OBS, 64, 64, NAV.ACT], this.rng, 0.01);
      this.vf = new MLP([NAV.OBS, 64, 64, 1], this.rng, 1);
      this.logStd = new Float64Array(NAV.ACT).fill(Math.log(0.6));
      this.gLogStd = new Float64Array(NAV.ACT);
      this.optPi = new Adam([...this.pi.params(), [this.logStd, this.gLogStd]], 3e-4);
      this.optV = new Adam(this.vf.params(), 1e-3);
      this.tauA = NAV.TAU_A;
    }
    act(obs, det) {
      const acts = this.pi.forward(obs), mu = acts[acts.length - 1];
      const a = new Float64Array(NAV.ACT); let logp = 0;
      for (let j = 0; j < NAV.ACT; j++) {
        const e = det ? 0 : gauss(this.rng);
        a[j] = mu[j] + Math.exp(this.logStd[j]) * e;
        logp += -0.5 * e * e - this.logStd[j] - 0.5 * Math.log(TAU);
      }
      return { a, logp, mu, v: this.value(obs) };
    }
    value(obs) { const a = this.vf.forward(obs); return a[a.length - 1][0]; }
    policyMean(obs) { const a = this.pi.forward(obs); return a[a.length - 1]; }
    toJSON() { return { format: 'droneforge-ppo-1', tauA: this.tauA, pi: this.pi.toJSON(), vf: this.vf.toJSON(), logStd: Array.from(this.logStd) }; }
    load(j) {
      if (!j || j.format !== 'droneforge-ppo-1') throw new Error('Fichier de poids non reconnu');
      this.pi.load(j.pi); this.vf.load(j.vf); this.logStd.set(j.logStd); this.tauA = j.tauA || NAV.TAU_A;
    }
  }
  class NavEnv {
    constructor(rng, tauA) { this.rng = rng; this.tauA = tauA || NAV.TAU_A; this.p = [0, 0, 0]; this.v = [0, 0, 0]; this.acc = [0, 0, 0]; this.wind = [0, 0, 0]; this.reset(); }
    reset() {
      const r = this.rng;
      let d = [gauss(r), gauss(r) * 0.6, gauss(r)]; const n = norm(d) || 1;
      const dist = 1 + 5.5 * r();
      this.p = d.map(x => x / n * dist);
      this.v = [0, 0, 0].map(() => (r() - 0.5) * 2);
      this.acc = [0, 0, 0];
      this.wind = [(r() - 0.5) * 3, (r() - 0.5) * 1, (r() - 0.5) * 3];
      this.t = 0; this.prevD = norm(this.p); this.trail = [];
    }
    obs() { return navObs([-this.p[0], -this.p[1], -this.p[2]], this.v, this.acc); }
    step(a) {
      const k = 1 - Math.exp(-NAV.DT / this.tauA); let a2 = 0;
      for (let i = 0; i < 3; i++) {
        const ac = clamp(a[i], -1, 1); a2 += ac * ac;
        this.acc[i] += (ac * NAV.AMAX - this.acc[i]) * k;
        this.v[i] += (this.acc[i] - NAV.DRAG * this.v[i] + this.wind[i]) * NAV.DT;
        this.p[i] += this.v[i] * NAV.DT;
      }
      const d = norm(this.p), sp = norm(this.v);
      let r = 2 * (this.prevD - d) - 0.01 * a2 + 0.05 * Math.exp(-3 * d);
      if (d < 0.4 && sp < 0.6) r += 0.1;
      this.prevD = d; this.t++;
      let done = this.t >= NAV.EP_LEN;
      if (d > 16) { done = true; r -= 2; }
      return { r, done, success: done && d < 0.5 };
    }
  }
  class PPOStats {
    constructor() { this.updates = 0; this.steps = 0; this.recent = []; this.history = []; this.kl = 0; this.clipFrac = 0; }
    episode(ret, ok) { this.recent.push([ret, ok ? 1 : 0]); if (this.recent.length > 100) this.recent.shift(); }
    meanReturn() { return this.recent.length ? this.recent.reduce((s, x) => s + x[0], 0) / this.recent.length : 0; }
    successRate() { return this.recent.length ? this.recent.reduce((s, x) => s + x[1], 0) / this.recent.length : 0; }
  }
  /* Générateur d'entraînement : rend la main très souvent pour ne jamais figer l'interface. */
  function* ppoTrainer(agent, hp, stats, live, seed) {
    const rng = mulberry32(seed || 42);
    const N = 16, T = 128, B = N * T;
    agent.tauA = hp.tauA || NAV.TAU_A;
    const envs = Array.from({ length: N }, () => new NavEnv(rng, agent.tauA));
    live.envs = envs;
    const obs = new Array(B), act = new Array(B);
    const logp = new Float64Array(B), val = new Float64Array(B), rew = new Float64Array(B), done = new Uint8Array(B);
    const epRet = new Float64Array(N);
    while (true) {
      for (let t = 0; t < T; t++) {
        for (let e = 0; e < N; e++) {
          const i = t * N + e, env = envs[e];
          const o = env.obs(), r = agent.act(o, false);
          obs[i] = o; act[i] = r.a; logp[i] = r.logp; val[i] = r.v;
          const st = env.step(r.a);
          rew[i] = st.r; done[i] = st.done ? 1 : 0; epRet[e] += st.r;
          env.trail.push([env.p[0], env.p[1], env.p[2]]); if (env.trail.length > 30) env.trail.shift();
          if (st.done) { stats.episode(epRet[e], st.success); epRet[e] = 0; env.reset(); }
        }
        stats.steps += N;
        yield 0;
      }
      const gamma = hp.gamma, lam = 0.95;
      const lastV = envs.map(e => agent.value(e.obs()));
      const adv = new Float64Array(B), ret = new Float64Array(B);
      for (let e = 0; e < N; e++) {
        let gae = 0;
        for (let t = T - 1; t >= 0; t--) {
          const i = t * N + e;
          const nextV = t === T - 1 ? lastV[e] : val[(t + 1) * N + e];
          const nt = 1 - done[i];
          const delta = rew[i] + gamma * nextV * nt - val[i];
          gae = delta + gamma * lam * nt * gae;
          adv[i] = gae; ret[i] = gae + val[i];
        }
      }
      let mean = 0; for (let i = 0; i < B; i++) mean += adv[i]; mean /= B;
      let vr = 0; for (let i = 0; i < B; i++) vr += (adv[i] - mean) ** 2; const sd = Math.sqrt(vr / B) + 1e-8;
      for (let i = 0; i < B; i++) adv[i] = (adv[i] - mean) / sd;
      const idx = Array.from({ length: B }, (_, i) => i);
      const MB = 256, EPOCHS = 5;
      agent.optPi.lr = hp.lr; agent.optV.lr = hp.lr * 3;
      let klSum = 0, klN = 0, clipN = 0;
      for (let ep = 0; ep < EPOCHS; ep++) {
        for (let i = B - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
        for (let s = 0; s < B; s += MB) {
          agent.pi.zeroGrad(); agent.vf.zeroGrad(); agent.gLogStd.fill(0);
          for (let k = s; k < s + MB; k++) {
            const i = idx[k], o = obs[i], a = act[i];
            const acts = agent.pi.forward(o), mu = acts[acts.length - 1];
            let lp = 0;
            const z = new Float64Array(NAV.ACT);
            for (let j = 0; j < NAV.ACT; j++) { const sdj = Math.exp(agent.logStd[j]); z[j] = (a[j] - mu[j]) / sdj; lp += -0.5 * z[j] * z[j] - agent.logStd[j] - 0.5 * Math.log(TAU); }
            const ratio = Math.exp(lp - logp[i]);
            klSum += logp[i] - lp; klN++;
            const A = adv[i];
            const active = (A >= 0 && ratio <= 1 + hp.clip) || (A < 0 && ratio >= 1 - hp.clip);
            if (!active) clipN++;
            const c = active ? -ratio * A / MB : 0;
            const dmu = new Float64Array(NAV.ACT);
            if (c !== 0) for (let j = 0; j < NAV.ACT; j++) { const sdj = Math.exp(agent.logStd[j]); dmu[j] = c * z[j] / sdj; agent.gLogStd[j] += c * (z[j] * z[j] - 1); }
            agent.pi.backward(acts, dmu);
            const va = agent.vf.forward(o), v = va[va.length - 1][0];
            agent.vf.backward(va, [(v - ret[i]) / MB]);
          }
          for (let j = 0; j < NAV.ACT; j++) agent.gLogStd[j] -= hp.ent;
          agent.optPi.step(0.5); agent.optV.step(1.0);
          for (let j = 0; j < NAV.ACT; j++) agent.logStd[j] = clamp(agent.logStd[j], -3, 0.5);
          yield 1;
        }
      }
      stats.updates++;
      stats.kl = klSum / Math.max(1, klN); stats.clipFrac = clipN / Math.max(1, klN);
      stats.history.push({ u: stats.updates, ret: stats.meanReturn(), ok: stats.successRate(), std: Math.exp(agent.logStd.reduce((s, x) => s + x, 0) / NAV.ACT) });
      if (stats.history.length > 400) stats.history.shift();
      yield 2;
    }
  }

  return {
    G, RHO, TAU, DEG, clamp, PRESETS, WINDINGS, ESC, MCU, IMU, VIDEO, FIRMWARES, LIMITS, CHECKLIST, DISCOUNTS,
    defaultConfig, applyPreset, sanitizeConfig, designation, motorParams, operatingPoint, electronicsLoad, buildBOM,
    summarize, motorChecks, boardChecks, discountFor, assemblyHours,
    mulberry32, gauss, qToMat, yawOf, QuadSim, Autopilot, Wind, effectiveGains, responseTau, NAV, navObs,
    MLP, Adam, PPOAgent, NavEnv, PPOStats, ppoTrainer,
  };
})();
if (typeof module !== 'undefined') module.exports = DF;
