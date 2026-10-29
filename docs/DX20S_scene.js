/* =====================================================================
 * DX-20S 使用场景模拟引擎
 * ---------------------------------------------------------------------
 * 城市 / 郊区双场景：建筑遮挡、地形绕射与衰减、800MHz 手机基站干扰、
 * 棒状天线极化失配，逐帧计算链路预算，把"收得到 / 收不到"的结果
 * 直接反馈到设备屏幕。
 *
 * 射频取值依据：
 *   工作频点 821.2375MHz            src/utilities.h TARGET_FREQ
 *   FSK 4.8kbps / 频偏 5.0kHz / 带宽 12.5kHz   src/main.cpp radio.beginFSK
 *   RSSI 量程 -120~-70dBm、过滤档 -100~-80dBm   src/ScreenWrapper.cpp / Menu.cpp
 * ===================================================================== */
(function () {
'use strict';

/* ============================ 0. 基础工具 ============================ */
const NS = 'http://www.w3.org/2000/svg';
const $  = s => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd  = (a, b) => a + Math.random() * (b - a);
const rndI = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const c = Math.round(lerp(pa & 255, pb & 255, t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | c).toString(16).slice(1);
}

/* ============================ 1. 射频参数 ============================ */
const RF = {
  freq:    821.2375,   // MHz 工作频点
  pTx:     20,         // dBm  车载台发射功率
  gTx:     2,          // dBi  车顶天线增益
  gRx:     2,          // dBi  设备棒状天线增益
  sens:    -106,       // dBm  接收灵敏度
  decSnr:  8,          // dB   解码门限
  noise:   -115,       // dBm  本底噪声
  plRef:   96,         // dB   1 km 参考路径损耗
  emitGap: 4.0,        // s    车载台信息播发周期
  lambda:  0.364       // m    821MHz 波长（用于绕射计算）
};

/* 路径损耗指数 n（对数距离模型） */
const N_PATH = { urban: 3.2, suburb: 3.0 };

/* ============================ 2. 场景预设 ============================ */
const PRESETS = {
  wheat: {
    name: '秋收麦田', region: '华北平原 · 9 月',
    ground: '#d9b45f', ground2: '#c69f4c', stripe: '#e6c877',
    band: '#e3c06a', hill: 'none', forest: 0, sea: 0, ridge: 0,
    note: '地势平坦、无遮挡，接收距离最理想'
  },
  desert: {
    name: '西北沙漠', region: '河西走廊 · 戈壁',
    ground: '#e3ca95', ground2: '#d3b87e', stripe: '#efdcb0',
    band: '#e7d3a4', hill: 'dune', forest: 0, sea: 0, ridge: 0,
    note: '极度开阔，衰减小但沙尘天气会额外吸收高频'
  },
  mountain: {
    name: '西南山区', region: '云贵高原 · 河谷',
    ground: '#7f9166', ground2: '#6c8058', stripe: '#93a878',
    band: '#7c8f64', hill: 'ridge', forest: 0.15, sea: 0, ridge: 1,
    note: '山体遮挡视线，仅在谷口方向能收到'
  },
  coast: {
    name: '东南沿海', region: '闽粤海岸线',
    ground: '#e6d8ae', ground2: '#d6c394', stripe: '#f0e3bd',
    band: '#dcd0a6', hill: 'none', forest: 0, sea: 1, ridge: 0,
    note: '海面反射开阔，条件接近平原'
  },
  forest: {
    name: '东北密林', region: '长白山林区',
    ground: '#4f6d47', ground2: '#41603c', stripe: '#5d7c52',
    band: '#496644', hill: 'none', forest: 1, sea: 0, ridge: 0.35,
    note: '林带对 800MHz 额外吸收，通信距离明显缩短'
  },
  paddy: {
    name: '中原稻田', region: '豫南 · 淮河两岸',
    ground: '#8cbb58', ground2: '#78a84b', stripe: '#a3cb6d',
    band: '#87b656', hill: 'none', forest: 0.05, sea: 0, ridge: 0,
    note: '水田反射强、地形平坦，接收稳定'
  }
};

/* ============================ 3. 世界与投影 ============================ */
const VW = 1200, VH = 620, OX = 600;

/* 统一仿射（等轴斜）投影 —— 世界坐标 (x 沿线路, y 纵深, z 高度) → 屏幕：
 *     屏幕 X = OX + x * WS
 *     屏幕 Y = GROUND_Y - y * DY - z * WS
 * 水平与竖向共用同一比例 WS，所以建筑不会被拉伸变形；
 * 纵深单独按 DY 压缩，形成"越远越靠上"的层次。
 * 建筑、列车、基站、设备全部使用这一套比例 —— 画面上"谁挡住谁"
 * 与链路预算算出的遮挡结果严格一致。 */
const WS       = 1.55;    // 世界比例：1 m = 1.55 px
const DY       = 2.0333;  // 纵深比例：1 m 纵深 = 2.03 px（透视压缩）
const GROUND_Y = 574;     // 深度 0 / 高度 0 的屏幕纵坐标

/* 三条景深带（决定绘制层次与地面基准线）
 * 纵深 120 m 处是铁轨，60 m 处是建筑带，0 m 处是本机。
 * DY 与上面的物理纵深一一对应 —— 画面上的远近就是真实的远近。 */
const BAND = {
  far:  { gy: GROUND_Y - 120 * DY, s: WS, y: 120 },   // 轨道层（最远）
  mid:  { gy: GROUND_Y - 60 * DY,  s: WS, y: 60  },   // 建筑 / 山体层
  near: { gy: GROUND_Y,             s: WS, y: 0   }   // 设备层（最近）
};
const Y_TRACK = 120;    // 铁轨距本机的横向距离（米）
const Y_DEV   = 0;      // 本机所在纵深（米）
const Y_MID   = 60;     // 建筑带 / 山体带所在的纵深（米）

/* 沿线路方向：米 → 像素（1 屏 1200px ≈ ±387 m，可缩放 / 平移） */
function X(x) { return OX + x * WS; }
/* 世界点 → 屏幕纵坐标 */
function Ys(depth, z) { return GROUND_Y - depth * DY - z * WS; }
function bandOf(y) { return y >= 220 ? BAND.far : y >= 55 ? BAND.mid : BAND.near; }
function Y(y, z) { return Ys(y, z); }

/* 列车尺寸：车长按真实尺度换算（与 WS 同比例），车高适度夸张以便辨认 */
const CAR_W_PAX = 39, CAR_H_PAX = 11;   // 客车车厢 25.5 m × 4.0 m
const CAR_W_FRT = 22, CAR_H_FRT = 8;    // 货车敞车 14 m × 2.9 m
const LOCO_W = 44, LOCO_H = 15;         // 机车 20 m / 动车头车 25.5 m
const CAR_GAP = 2.5;
/* 设备举高高度 → 竖向像素（1 m = 11 px，夸张以便观察效果） */
const DEV_HS = 11;
const DEV_H_MAX = 30;    // 最高举到 10 层楼顶

/* ============================ 4. 运行状态 ============================ */
const SC = {
  mode: 'urban',
  preset: 'wheat',
  anim: true,
  wave: true,
  t: 0,
  last: 0,
  trains: [],
  waves: [],
  nextTrain: 2.5,
  seq: 1,
  buildings: [],
  bs: null,            // 基站 {x,y,h}
  ridge: null,         // 山脊剖面函数
  forestBand: null,    // 林带 {y0,y1}
  device: { x: 0, h: 1.5, tilt: 0 },
  view: { x: 0, y: 0, w: VW },
  stat: {
    dist: 0, pr: -115, snr: 0, pl: 0, obs: 0, pol: 0, noise: RF.noise,
    inter: -115, ok: false, state: 'idle', sent: 0, got: 0, hit: 0
  },
  phase: null
};

/* ============================ 5. 昼夜 ============================ */
/* ?hour=14 可强制显示指定时刻，用于查看白天/黄昏效果 */
const HOUR_OVR = (() => {
  const m = /[?&]hour=(\d{1,2})(?:\.\d+)?/.exec(location.search);
  return m ? clamp(parseFloat(m[1]), 0, 23.99) : null;
})();
/* ?still=1 —— 渲染一帧后停机（截图 / 说明书配图用） */
const STILL = /[?&]still=1/.test(location.search);
function nowHour() {
  if (HOUR_OVR !== null) return HOUR_OVR;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

const SKY = [
  [ 0.0, '#070c1c', '#111a33', '#e8ecff', '#232c47', 1.00],
  [ 4.2, '#0d1428', '#1e2440', '#f0f2ff', '#2a3350', 0.90],
  [ 5.6, '#26375f', '#6b5578', '#ffd7a8', '#5a5470', 0.35],
  [ 6.8, '#4a6c9e', '#e8a778', '#ffcf92', '#8a8496', 0.05],
  [ 8.5, '#5f9bd0', '#b9d7ec', '#fff4d6', '#adb4bb', 0.00],
  [12.0, '#4a8ccd', '#a6cbe6', '#ffffff', '#b6bec6', 0.00],
  [15.8, '#5488c4', '#c8c0b0', '#ffeccb', '#b0a89a', 0.00],
  [17.6, '#3f5f9a', '#e79a62', '#ff9d55', '#8a7468', 0.10],
  [19.2, '#22305c', '#c4704f', '#ffb877', '#5a5570', 0.45],
  [20.6, '#0c142c', '#26304f', '#e4e9ff', '#2e3856', 0.90],
  [24.0, '#070c1c', '#111a33', '#e8ecff', '#232c47', 1.00]
];
function skyAt(hour) {
  let i = 0;
  while (i < SKY.length - 2 && hour > SKY[i + 1][0]) i++;
  const a = SKY[i], b = SKY[i + 1];
  const t = clamp((hour - a[0]) / (b[0] - a[0]), 0, 1);
  return {
    top: mixHex(a[1], b[1], t), bot: mixHex(a[2], b[2], t),
    sun: mixHex(a[3], b[3], t), amb: mixHex(a[4], b[4], t),
    star: lerp(a[5], b[5], t)
  };
}

/* ============================ 6. 场景生成 ============================ */
function genBuildings() {
  const out = [];
  let x = -660;
  const kinds = [
    { k: 'old',  w: [16, 34], floors: [4, 7],  p: 0.30 },
    { k: 'mid',  w: [18, 30], floors: [7, 12], p: 0.28 },
    { k: 'new',  w: [20, 34], floors: [13, 17], p: 0.18 },
    { k: 'shop', w: [12, 24], floors: [1, 3],  p: 0.24 }
  ];
  const tot = kinds.reduce((s, k) => s + k.p, 0);
  while (x < 660) {
    let r = Math.random() * tot, kind = kinds[0];
    for (const k of kinds) { r -= k.p; if (r <= 0) { kind = k; break; } }
    const w  = rnd(kind.w[0], kind.w[1]);
    const d  = rnd(14, 24);            // 楼体进深（米）
    const y  = rnd(45, 70);            // 距本机的纵深（米，0 = 本机，120 = 铁轨）
    let fl = rndI(kind.floors[0], kind.floors[1]);
    let h  = fl * 3.0 + (kind.k === 'shop' ? 0.6 : 1.2);
    // 楼顶不得越过轨道带，否则会把列车挡住
    const cap = (Ys(y, 0) - (BAND.far.gy + 24)) / WS;
    if (h > cap) { h = cap; fl = Math.max(1, Math.floor(h / 3.0)); }
    out.push({
      x0: x, x1: x + w, y0: y, y1: y + d, h, kind: kind.k, floors: fl,
      tint: Math.random(), win: Math.random() > 0.45, seed: Math.random()
    });
    x += w + rnd(5, 24);
  }
  return out;
}

function genRidge() {
  // 山脊剖面：几座高斯峰的叠加
  const peaks = [];
  const n = rndI(3, 5);
  for (let i = 0; i < n; i++) {
    peaks.push({ x: rnd(-700, 700), h: rnd(28, 82), w: rnd(150, 340) });
  }
  return x => {
    let s = 0;
    for (const p of peaks) s += p.h * Math.exp(-((x - p.x) ** 2) / (2 * p.w * p.w));
    return s;
  };
}

function genScene(regen) {
  SC.buildings = [];
  SC.ridge = null;
  SC.forestBand = null;
  SC.bs = null;

  if (SC.mode === 'urban') {
    SC.buildings = genBuildings();
    // 800MHz 手机基站：随机落在城市中，距离本机 140~820 m
    const ang = rnd(0, Math.PI * 2);
    const dd  = rnd(140, 820);
    SC.bs = { x: Math.cos(ang) * dd, y: rnd(40, 105), h: rnd(30, 42) };
  } else {
    const p = PRESETS[SC.preset];
    if (p.ridge) SC.ridge = genRidge();
    if (p.forest >= 0.5) SC.forestBand = { y0: 50, y1: 92 };
    SC.bs = null;
  }
  if (regen) {
    SC.trains.length = 0;
    SC.waves.length = 0;
    SC.nextTrain = 1.2;
    SC.stat.sent = 0; SC.stat.got = 0; SC.stat.hit = 0;
  }
}

/* ============================ 7. 链路预算 ============================ */
function pathLoss(d, n) {
  return RF.plRef + 10 * n * Math.log10(Math.max(d, 1) / 1000);
}

/* 建筑遮挡：沿射线采样，统计被楼体挡住的采样比例 */
function buildingLoss(tx, rx) {
  const N = 60;
  let inBand = 0, blocked = 0, hitB = null, hitP = null;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px_ = tx.x + (rx.x - tx.x) * t;
    const py_ = tx.y + (rx.y - tx.y) * t;
    const pz_ = tx.z + (rx.z - tx.z) * t;
    if (py_ < 25 || py_ > 95) continue;
    inBand++;
    for (const b of SC.buildings) {
      if (px_ >= b.x0 && px_ <= b.x1 && py_ >= b.y0 && py_ <= b.y1 && pz_ < b.h) {
        blocked++;
        if (!hitB) { hitB = b; hitP = { x: px_, y: py_, z: pz_ }; }
        break;
      }
    }
  }
  if (!inBand || !blocked) return { loss: 0, frac: 0, hit: null, hitP: null };
  const frac = blocked / inBand;
  return { loss: Math.min(36, 10 + 26 * frac), frac, hit: hitB, hitP };
}

/* 山体绕射：ITU-R P.526 单 Knife-edge（山脊位于本机与铁轨之间的纵深 60 m 处） */
function ridgeLoss(tx, rx) {
  if (!SC.ridge) return { loss: 0, h: 0 };
  const YR = Y_MID;
  const t = (tx.y - YR) / (tx.y - rx.y);
  const px_ = tx.x + (rx.x - tx.x) * t;
  const pz_ = tx.z + (rx.z - tx.z) * t;
  const rz = SC.ridge(px_);
  const h = rz - pz_;
  if (h <= 0) return { loss: 0, h: 0 };
  const seg = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
  const d1 = seg * (1 - t), d2 = seg * t;
  const v = h * Math.sqrt(2 / RF.lambda * (1 / Math.max(d1, 1) + 1 / Math.max(d2, 1)));
  const J = 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
  return { loss: clamp(J, 0, 45), h };
}

/* 林带衰减：路径在林带内的长度 × 吸收系数 */
function forestLoss(tx, rx) {
  if (!SC.forestBand) return { loss: 0, len: 0 };
  const N = 60;
  const seg = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
  let inside = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const py_ = tx.y + (rx.y - tx.y) * t;
    if (py_ >= SC.forestBand.y0 && py_ <= SC.forestBand.y1) inside++;
  }
  const len = seg * inside / (N + 1);
  return { loss: Math.min(22, 0.34 * len), len };
}

/* 天线极化失配：棒状天线竖直为最佳匹配 */
function polLoss(tiltDeg) {
  const c = Math.cos(tiltDeg * Math.PI / 180);
  return c <= 0.02 ? 20 : Math.max(0, -20 * Math.log10(c));
}

/* 基站带内干扰（800MHz 邻频，落在 LBJ 的 12.5kHz 接收带内）
 * 标定依据：近距离基站会把城市可用距离从"无干扰 ~3km"压到"1~2km"，
 * 与实际城市环境中手机基站对 LBJ 预警终端的影响量级一致。 */
function interference(tx, rx) {
  if (!SC.bs) return { level: RF.noise, dist: 0 };
  const d = Math.hypot(SC.bs.x - rx.x, SC.bs.y - rx.y, SC.bs.h - rx.z);
  const level = -95 - 10 * 2.5 * Math.log10(Math.max(d, 40) / 600);
  return { level: Math.max(RF.noise, level), dist: d };
}

/* 综合链路预算 */
function linkBudget(tx, rx) {
  const d = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
  const n = N_PATH[SC.mode];
  const pl  = pathLoss(d, n);
  const bl  = buildingLoss(tx, rx);
  const rl  = ridgeLoss(tx, rx);
  const fl  = forestLoss(tx, rx);
  const pol = polLoss(SC.device.tilt);
  const itf = interference(tx, rx);
  const obs = bl.loss + rl.loss + fl.loss;
  const pr  = RF.pTx + RF.gTx + RF.gRx - pl - obs - pol;
  const noise = Math.max(RF.noise, itf.level);
  const snr = pr - noise;
  const ok = pr >= RF.sens && snr >= RF.decSnr;
  return { d, pl, obs, bl, rl, fl, pol, pr, noise, itf, snr, ok };
}

/* ============================ 8. 列车生成 ============================ */
const LOCO_POOL = ['HXD1D', 'HXD3D', 'HXD2B', 'DF4D', 'SS4', 'CRH380A', 'CR400BF', 'CRH1A', 'CRH2A', 'SS9', 'DF11'];
const PAX_SPECS = [
  { cls: 'D', r: [[1, 1998], [2001, 2998], [3001, 9998]], v: [175, 250], cars: [8, 16], loco: ['CRH1A', 'CRH2A', 'CRH380A', 'CR400BF'], emu: true },
  { cls: 'T', r: [[1, 4998], [5001, 9998]], v: [120, 165], cars: [9, 15], loco: ['SS9', 'SS7'], emu: false },
  { cls: 'K', r: [[1, 4998], [5001, 9998]], v: [100, 140], cars: [15, 20], loco: ['SS7', 'DF11'], emu: false },
  { cls: 'Z', r: [[1, 998], [1001, 1998]], v: [130, 160], cars: [16, 18], loco: ['HXD3D', 'SS9'], emu: false },
  { cls: 'Y', r: [[1, 998], [1001, 1998]], v: [115, 145], cars: [12, 16], loco: ['HXD1D'], emu: false },
  { cls: 'L', r: [[1, 9999]], v: [95, 130], cars: [10, 16], loco: ['DF4D'], emu: false },
  { cls: 'N', r: [[1, 998], [1001, 1998]], v: [115, 145], cars: [12, 16], loco: ['HXD1D'], emu: false },
  { cls: 'V', r: [[1, 2998], [3001, 5998], [6001, 6998], [7001, 7998]], v: [100, 140], cars: [14, 18], loco: ['SS9'], emu: false }
];
/* 高铁 / 城际：线路装备完善，不发预警 */
const EMU_SPECS = [
  { cls: 'G', r: [[1, 4998], [5001, 9998]], v: [285, 350], cars: [8, 16], loco: ['CR400BF', 'CR400AF', 'CRH380A'], emu: true, warn: false },
  { cls: 'C', r: [[1, 2998]], v: [195, 300], cars: [4, 8], loco: ['CRH2A', 'CRH6A'], emu: true, warn: false }
];
const FRT_SPECS = [
  { num: [[20001, 29998], [30001, 39998], [40001, 44998], [45001, 49998], [51001, 51998], [57001, 57998]],
    v: [55, 95], cars: [18, 46], loco: ['HXD1D', 'HXD3D', 'DF4D', 'SS4'] },
  { cls: 'B', r: [[8001, 8998], [9001, 9500]], v: [80, 120], cars: [28, 46], loco: ['HXD1D', 'HXD2B'] }
];

function numIn(ranges) {
  const rg = ranges[Math.floor(Math.random() * ranges.length)];
  return rndI(rg[0], rg[1]);
}

function makeTrain() {
  const r = Math.random();
  let spec, warn, kind, cls, num, isFreight = false;
  if (r < 0.26) {                       // 高铁 / 城际 —— 不发预警
    spec = pick(EMU_SPECS); warn = false; kind = 'emu';
    cls = spec.cls; num = String(numIn(spec.r));
  } else if (r < 0.62) {                // 普速客车
    spec = pick(PAX_SPECS); warn = true; kind = spec.emu ? 'emu' : 'pax';
    cls = spec.cls; num = String(numIn(spec.r));
  } else {                               // 货物列车
    spec = pick(FRT_SPECS); warn = true; kind = 'freight'; isFreight = true;
    if (spec.cls) { cls = spec.cls; num = String(numIn(spec.r)); }
    else { cls = '--'; num = String(numIn(spec.num)); }
  }
  const cars = rndI(spec.cars[0], spec.cars[1]);
  const dir  = Math.random() < 0.5 ? 1 : -1;
  const line = (kind === 'freight') ? '测试线路'
             : (SC.mode === 'suburb' && Math.random() < 0.65) ? '测试客专' : '测试线路';
  const speed = Math.round(rnd(spec.v[0], spec.v[1]));
  // 首列车近一点出场，避免长时间空场；其余列车从远处驶来
  const spawn = SC.seq === 1 ? rnd(430, 560) : rnd(560, 880);
  // 列车实际长度（米）：机车 20 m，客车 25.5 m，货车 14 m
  const carLen = kind === 'freight' ? 14 : 25.5;
  return {
    id: SC.seq++, spec, kind, cls, num, dir, line, speed, cars, warn,
    isFreight, ltype: pick(spec.loco),
    loco: String(rndI(23500000, 23505999)),
    x: dir > 0 ? -spawn : spawn,
    kilo: 1000 + rndI(0, 900) / 10,
    nextEmit: SC.t + rnd(0.2, RF.emitGap),
    len: 20 + cars * carLen,
    antX: 0, antY: 0,
    warnCount: 0
  };
}

/* ============================ 9. 静态场景绘制 ============================ */
let svg, gSky, gFar, gMid, gNear, gDyn, gRadar, gRadarStat;
let gWave, gShadow, gLos, gTrain, gDev;

function buildDefs() {
  const defs = el('defs', null, svg);
  const g1 = el('linearGradient', { id: 'skyGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%',  'stop-color': '#4a8ccd' }, g1);
  el('stop', { offset: '70%', 'stop-color': '#a6cbe6' }, g1);
  el('stop', { offset: '100%','stop-color': '#d8e6f0' }, g1);
  const g2 = el('linearGradient', { id: 'groundGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%',  'stop-color': '#6b8a55' }, g2);
  el('stop', { offset: '100%','stop-color': '#43573a' }, g2);
  const g3 = el('linearGradient', { id: 'seaGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%',  'stop-color': '#2f6f96' }, g3);
  el('stop', { offset: '100%','stop-color': '#1d4f70' }, g3);
  const f = el('filter', { id: 'softGlow', x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
  el('feGaussianBlur', { stdDeviation: '2.4', result: 'b' }, f);
  const m = el('feMerge', null, f);
  el('feMergeNode', { in: 'b' }, m);
  el('feMergeNode', { in: 'SourceGraphic' }, m);
  const f2 = el('filter', { id: 'blur8', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
  el('feGaussianBlur', { stdDeviation: '8' }, f2);
}

function drawSky(sk) {
  gSky.textContent = '';
  const grad = el('linearGradient', { id: 'skyGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, gSky);
  el('stop', { offset: '0%', 'stop-color': sk.top }, grad);
  el('stop', { offset: '72%', 'stop-color': sk.bot }, grad);
  el('stop', { offset: '100%', 'stop-color': mixHex(sk.bot, '#ffffff', 0.18) }, grad);
  el('rect', { x: -2000, y: -200, width: 5000, height: 700, fill: 'url(#skyGrad)' }, gSky);

  // 星星
  if (sk.star > 0.02) {
    const sg = el('g', { opacity: sk.star.toFixed(3) }, gSky);
    for (let i = 0; i < 120; i++) {
      const x = rnd(-300, 1500), y = rnd(-150, 380), r = rnd(0.6, 1.9);
      el('circle', { cx: x, cy: y, r, fill: '#fff', opacity: rnd(0.25, 1).toFixed(2) }, sg);
    }
  }
  // 日 / 月
  const h = nowHour();
  const dayT = clamp((h - 5.6) / 13.6, 0, 1);
  const isDay = h > 5.6 && h < 19.2;
  const cx = 120 + dayT * 1000;
  const cy = 400 - Math.sin(dayT * Math.PI) * 330;
  const body = el('g', null, gSky);
  el('circle', { cx, cy, r: isDay ? 26 : 18, fill: sk.sun, opacity: 0.22, filter: 'url(#blur8)' }, body);
  el('circle', { cx, cy, r: isDay ? 15 : 12, fill: sk.sun }, body);
  if (!isDay) {
    el('circle', { cx: cx + 5, cy: cy - 4, r: 10, fill: sk.top, opacity: 0.92 }, body);
  }
  // 远山剪影
  const hills = el('path', { fill: mixHex(sk.amb, '#000000', 0.35), opacity: 0.5 }, gSky);
  let d = 'M-2000,430';
  for (let x = -2000; x <= 2000; x += 120) {
    d += ` L${x},${430 - Math.sin(x * 0.0021) * 26 - Math.sin(x * 0.0071 + 1.7) * 15}`;
  }
  d += ' L2000,470 L-2000,470 Z';
  hills.setAttribute('d', d);
}

function drawFar(sk) {
  gFar.textContent = '';
  const gy = BAND.far.gy;

  if (SC.mode === 'suburb') {
    const p = PRESETS[SC.preset];
    // 远景地面（山体画在中景层 —— 它位于本机与铁轨之间，才会真正遮挡信号）
    el('rect', { x: -2000, y: gy - 4, width: 5000, height: 260, fill: mixHex(p.ground, sk.amb, 0.42) }, gFar);
    // 地平线上的远处树带
    if (!SC.ridge) {
      const tg = el('g', null, gFar);
      const treeCol = mixHex(p.ground2, '#2f4a30', 0.42);
      for (let x = -2000; x < 2000; x += 11) {
        const h = rnd(5, 13);
        el('path', { d: `M${x},${gy + 2} L${x + h * 0.42},${gy - h} L${x + h * 0.84},${gy + 2} Z`,
                     fill: treeCol, opacity: 0.55 }, tg);
      }
    }
  } else {
    // 城市远景：低矮建筑剪影
    const g = el('g', { opacity: 0.5 }, gFar);
    let x = -2000;
    while (x < 2000) {
      const w = rnd(14, 40), h = rnd(6, 34);
      el('rect', { x, y: gy - h, width: w, height: h + 6, fill: mixHex(sk.amb, '#0e1626', 0.45) }, g);
      x += w + rnd(3, 14);
    }
    el('rect', { x: -2000, y: gy - 2, width: 5000, height: 8, fill: mixHex(sk.amb, '#0e1626', 0.6) }, g);
  }

  // 轨道层地面
  el('rect', { x: -2000, y: gy, width: 5000, height: 300, fill: mixHex(SC.mode === 'urban' ? '#4b5560' : PRESETS[SC.preset].ground, sk.amb, 0.30) }, gFar);

  // 轨道（道砟 · 轨枕 · 钢轨 · 接触网立柱）
  const tg = el('g', null, gFar);
  el('rect', { x: -2000, y: gy, width: 5000, height: 13, fill: mixHex('#6b6154', sk.amb, 0.32), opacity: 0.95 }, tg);
  for (let x = -2000; x < 2000; x += 9) {
    el('rect', { x, y: gy + 1, width: 5.4, height: 10, fill: '#4c4335', opacity: 0.85 }, tg);
  }
  el('rect', { x: -2000, y: gy + 1.4, width: 5000, height: 1.6, fill: '#9aa2ad' }, tg);
  el('rect', { x: -2000, y: gy + 9, width: 5000, height: 1.6, fill: '#9aa2ad' }, tg);
  for (let x = -2000; x < 2000; x += 128) {
    el('rect', { x, y: gy - 46, width: 2.4, height: 50, fill: mixHex(sk.amb, '#3b4353', 0.5), opacity: 0.8 }, tg);
    el('rect', { x, y: gy - 46, width: 128, height: 2, fill: mixHex(sk.amb, '#3b4353', 0.5), opacity: 0.6 }, tg);
  }
}

function drawMid(sk) {
  gMid.textContent = '';
  const gy = BAND.mid.gy;

  if (SC.mode === 'urban') {
    // 地面
    el('rect', { x: -2000, y: gy, width: 5000, height: 300, fill: '#3c4149' }, gMid);
    // 楼体
    for (const b of SC.buildings) {
      const x = X(b.x0), w = (b.x1 - b.x0) * WS;
      const base = Ys(b.y0, 0);          // 前立面落地线
      const h = b.h * WS;                // 楼高（与世界比例一致，不变形）
      const y = base - h;
      const baseCol = b.kind === 'shop' ? '#6b5c4c'
                    : b.kind === 'old'  ? '#8d8477'
                    : b.kind === 'mid'  ? '#77808c'
                    :                      '#69737f';
      const col = mixHex(baseCol, sk.amb, 0.30);
      const g = el('g', null, gMid);
      el('rect', { x, y, width: w, height: h + 10, fill: col }, g);
      // 侧面（伪厚度）
      el('rect', { x: x + w, y: y + 5, width: Math.max(2, w * 0.11), height: h + 5, fill: mixHex(col, '#000000', 0.32) }, g);
      // 屋顶
      if (b.kind === 'shop') {
        el('path', { d: `M${x - 2},${y} L${x + w / 2},${y - 9} L${x + w + 2},${y} Z`, fill: mixHex(col, '#8a4b3c', 0.4) }, g);
      } else {
        el('rect', { x: x - 1.5, y: y - 3, width: w + 3, height: 3.4, fill: mixHex(col, '#ffffff', 0.16) }, g);
        if (b.kind === 'old') {   // 屋顶水箱 / 太阳能
          el('rect', { x: x + w * 0.22, y: y - 12, width: 9, height: 9, fill: mixHex(col, '#6d7480', 0.5) }, g);
          el('rect', { x: x + w * 0.60, y: y - 8, width: 13, height: 5, fill: mixHex(col, '#2f4f7a', 0.55) }, g);
        }
        if (b.kind === 'new') {   // 高层退台 + 电梯机房
          el('rect', { x: x + w * 0.34, y: y - 8, width: w * 0.3, height: 8, fill: mixHex(col, '#ffffff', 0.08) }, g);
        }
      }
      // 窗户
      const rows = Math.max(1, b.floors), cols = Math.max(1, Math.floor(w / 11));
      const lit = sk.star > 0.15 && b.win;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = x + 4 + c * (w - 8) / cols;
          const wy = y + 7 + r * ((h - 10) / rows);
          const on = lit && ((b.seed * 97 + r * 13 + c * 7) % 10) < 3;
          el('rect', {
            x: wx, y: wy, width: Math.max(2.4, (w - 8) / cols - 3.2), height: Math.max(2.6, (h - 10) / rows - 4),
            fill: on ? '#ffd98a' : mixHex(col, '#101722', 0.42),
            opacity: on ? 0.95 : 0.85
          }, g);
        }
      }
    }
    // 路灯
    for (let x = -1400; x < 1400; x += 92) {
      const px_ = X(x);
      const g = el('g', null, gMid);
      el('rect', { x: px_, y: gy - 44, width: 2, height: 44, fill: '#3f4652' }, g);
      el('circle', { cx: px_ + 5, cy: gy - 45, r: 2.6, fill: sk.star > 0.15 ? '#ffd98a' : '#59606d' }, g);
    }
    // 基站（按真实纵深定位）
    if (SC.bs) {
      const bx = X(SC.bs.x), by = Ys(SC.bs.y, 0);
      const hgt = SC.bs.h * WS * 0.5;
      const g = el('g', null, gMid);
      el('rect', { x: bx - 1.6, y: by - hgt, width: 3.2, height: hgt, fill: '#6b7280' }, g);
      el('rect', { x: bx - 9, y: by - hgt - 5, width: 18, height: 6, fill: '#8b93a1' }, g);
      el('rect', { x: bx - 13, y: by - hgt + 6, width: 26, height: 3, fill: '#8b93a1' }, g);
      el('circle', { cx: bx, cy: by - hgt - 12, r: 3.4, fill: '#ff6b5e' }, g);
    }
  } else {
    // 郊区地形
    const p = PRESETS[SC.preset];
    el('rect', { x: -2000, y: gy - 26, width: 5000, height: 320, fill: p.band }, gMid);
    el('rect', { x: -2000, y: gy - 26, width: 5000, height: 320, fill: sk.amb, opacity: 0.16 }, gMid);
    // 山体：位于本机（纵深 0）与铁轨（纵深 120 m）之间，会真实遮挡信号
    if (SC.ridge) {
      const ridgeG = el('g', null, gMid);
      for (let layer = 0; layer < 3; layer++) {
        const col = mixHex(p.ground2, '#3d4a63', 0.26 + layer * 0.17);
        let dd = `M-2000,${gy + 8}`;
        for (let x = -2000; x <= 2000; x += 22) {
          const h = SC.ridge(x - layer * 210) * (1 - layer * 0.06);
          dd += ` L${x},${gy - Math.max(0, h) * WS}`;
        }
        dd += ` L2000,${gy + 60} L-2000,${gy + 60} Z`;
        el('path', { d: dd, fill: col, opacity: (0.88 + layer * 0.04).toFixed(2) }, ridgeG);
      }
    }
    if (p.sea) {
      el('rect', { x: -2000, y: gy - 26, width: 5000, height: 46, fill: 'url(#seaGrad)', opacity: 0.85 }, gMid);
      for (let i = 0; i < 26; i++) {
        el('rect', { x: rnd(-1900, 1900), y: gy - 24 + rnd(0, 40), width: rnd(14, 46), height: 1.4, fill: '#bfe3f2', opacity: 0.45 }, gMid);
      }
    }
    // 地面纹理
    if (p.hill === 'dune') {
      for (let i = 0; i < 34; i++) {
        const x = rnd(-1900, 1900);
        el('path', { d: `M${x},${gy + 40 + rnd(0, 60)} q${rnd(30, 90)},-${rnd(14, 40)} ${rnd(110, 220)},0 Z`, fill: p.stripe, opacity: 0.4 }, gMid);
      }
    } else if (p.hill === 'ridge') {
      let dd = `M-2000,${gy + 60}`;
      for (let x = -2000; x <= 2000; x += 60) {
        dd += ` L${x},${gy + 60 - Math.abs(Math.sin(x * 0.0016)) * 46 - (SC.ridge ? Math.min(70, SC.ridge(x) * 0.3) : 0)}`;
      }
      dd += ' L2000,700 L-2000,700 Z';
      el('path', { d: dd, fill: p.ground }, gMid);
    } else {
      // 田块 / 垄行
      for (let i = 0; i < 13; i++) {
        const y = gy - 22 + i * 9.5;
        el('rect', { x: -2000, y, width: 5000, height: 9.5, fill: i % 2 ? p.stripe : p.band, opacity: 0.55 }, gMid);
      }
      // 不同作物的地块
      for (let i = 0; i < 16; i++) {
        const x = rnd(-1900, 1900), w = rnd(70, 240);
        el('rect', { x, y: gy + rnd(-16, 88), width: w, height: rnd(14, 38),
                     fill: mixHex(p.stripe, p.ground, rnd(0.2, 0.8)), opacity: 0.45 }, gMid);
      }
      if (SC.preset === 'paddy') {
        for (let i = 0; i < 16; i++) {
          el('rect', { x: rnd(-1900, 1900), y: gy + rnd(-18, 86), width: rnd(50, 150), height: rnd(12, 34), fill: '#9ec6d8', opacity: 0.6 }, gMid);
        }
      }
    }
    // 林带
    if (SC.forestBand) {
      const fg = el('g', null, gMid);
      for (let i = 0; i < 150; i++) {
        const x = rnd(-1900, 1900);
        const y = gy + rnd(-14, 26);
        const h = rnd(16, 40);
        const col = mixHex('#2f4a30', sk.amb, 0.22);
        el('path', { d: `M${x},${y} L${x - h * 0.34},${y + h} L${x + h * 0.34},${y + h} Z`, fill: col, opacity: 0.9 }, fg);
        el('rect', { x: x - 1, y: y + h - 2, width: 2, height: 5, fill: '#3a2c22' }, fg);
      }
    }
  }
}

function drawNear(sk) {
  gNear.textContent = '';
  const gy = BAND.near.gy;
  el('rect', { x: -2000, y: gy, width: 5000, height: 320, fill: SC.mode === 'urban' ? '#2f343c' : mixHex(PRESETS[SC.preset].ground, '#2a2f28', 0.45) }, gNear);
  el('rect', { x: -2000, y: gy, width: 5000, height: 320, fill: sk.amb, opacity: 0.14 }, gNear);
}

/* ============================ 10. 动态层 ============================ */
function drawTrains(sk) {
  gTrain.querySelectorAll('.trainG').forEach(n => n.remove());
  for (const t of SC.trains) {
    const g = el('g', { class: 'trainG' }, gTrain);
    const gy = BAND.far.gy;                    // 轨面（纵深 300 m）
    const isEmu = t.kind === 'emu';
    const isFrt = t.kind === 'freight';
    const carW  = isFrt ? CAR_W_FRT : CAR_W_PAX;
    const carH  = isFrt ? CAR_H_FRT : CAR_H_PAX;
    const headX = X(t.x);                      // 车头位置（与链路预算取自同一点）

    // 编组：从车头向车尾依次排布（机车在最前，与现实一致）
    const segs = [];
    if (t.dir > 0) {
      segs.push({ x: headX - LOCO_W, w: LOCO_W, h: LOCO_H, loco: true });
      let x = headX - LOCO_W - CAR_GAP;
      for (let i = 0; i < t.cars; i++) { x -= carW; segs.push({ x, w: carW, h: carH, loco: false }); x -= CAR_GAP; }
    } else {
      segs.push({ x: headX, w: LOCO_W, h: LOCO_H, loco: true });
      let x = headX + LOCO_W + CAR_GAP;
      for (let i = 0; i < t.cars; i++) { segs.push({ x, w: carW, h: carH, loco: false }); x += carW + CAR_GAP; }
    }

    // —— 车厢 ——
    const bodyCol = isEmu ? '#f2f5f8' : isFrt ? '#4b5563' : '#5b6675';
    const stripe  = isEmu ? '#2f6fd0' : isFrt ? '#7a4a2c' : '#7b3f2e';
    for (const s of segs) {
      if (s.loco) continue;
      const y = gy - s.h;
      el('rect', { x: s.x, y, width: s.w, height: s.h, rx: 2.4, fill: bodyCol }, g);
      el('rect', { x: s.x + 1, y, width: s.w - 2, height: 2.2, rx: 1.1, fill: mixHex(bodyCol, '#ffffff', 0.20) }, g);
      el('rect', { x: s.x, y: y + s.h * 0.60, width: s.w, height: s.h * 0.40, fill: stripe, opacity: 0.92 }, g);
      if (isFrt) {
        // 敞车：开口 + 货物
        el('rect', { x: s.x + 1.6, y: y + 1.2, width: s.w - 3.2, height: s.h * 0.46, fill: '#242a33' }, g);
        el('path', { d: `M${s.x + 2.2},${y + 2.6} L${s.x + s.w - 2.2},${y + 2.6} L${s.x + s.w - 4},${y - 1.4} L${s.x + 4},${y - 1.4} Z`,
                     fill: mixHex('#3c4149', sk.amb, 0.25) }, g);
      } else {
        const nw = Math.max(2, Math.round(s.w / 7));
        const ww = (s.w - 5) / nw;
        for (let i = 0; i < nw; i++) {
          el('rect', { x: s.x + 2.5 + i * ww, y: y + 3.4, width: Math.max(1.6, ww - 1.9), height: Math.max(1.8, s.h * 0.30),
                       fill: sk.star > 0.2 ? '#ffd98a' : '#2b3a4a', opacity: 0.9 }, g);
        }
      }
      el('rect', { x: s.x + 2, y: gy - 1.6, width: s.w - 4, height: 3.2, fill: '#2b3038' }, g);
    }

    // —— 车头（机车 / 动车头车）——
    const hseg = segs[0];
    const hx0 = hseg.x, hx1 = hseg.x + hseg.w;
    const hy = gy - hseg.h;
    const nose = t.dir > 0
      ? `${hx0},${gy} ${hx0},${hy} ${hx1 - 7},${hy} ${hx1},${hy + 6} ${hx1},${gy}`
      : `${hx0},${gy} ${hx0},${hy + 6} ${hx0 + 7},${hy} ${hx1},${hy} ${hx1},${gy}`;
    el('polygon', { points: nose, fill: isEmu ? '#eef2f7' : '#3f4753' }, g);
    el('rect', { x: t.dir > 0 ? hx0 : hx1 - hseg.w + 7, y: hy + hseg.h * 0.58, width: hseg.w - 7, height: hseg.h * 0.42,
                 fill: isEmu ? '#2f6fd0' : '#7a4a2c', opacity: 0.9 }, g);
    // 司机室窗
    el('rect', { x: t.dir > 0 ? hx1 - 11 : hx0 + 2.5, y: hy + 3, width: 7, height: 4.4, rx: 1, fill: '#16202c' }, g);
    // 前照灯
    el('circle', { cx: t.dir > 0 ? hx1 - 2.2 : hx0 + 2.2, cy: gy - 3.6, r: 1.8, fill: '#ffe9a8' }, g);

    // 受电弓（非货运）
    if (!isFrt) {
      const s2 = segs[1] || hseg;
      const px = s2.x + s2.w * 0.5, py = gy - s2.h;
      el('path', { d: `M${px - 7},${py} L${px - 3},${py - 6} L${px + 3},${py - 3} L${px + 7},${py - 9}`,
                   stroke: '#6b7280', 'stroke-width': 1.1, fill: 'none' }, g);
      el('rect', { x: px - 8, y: py - 10.5, width: 16, height: 1.6, fill: '#6b7280' }, g);
    }

    // —— 车头顶端：LBJ 车载台天线（现实中即由此发射）——
    const antX = t.dir > 0 ? hx1 - 4 : hx0 + 4;
    const antY = hy - 9;
    el('rect', { x: antX - 1, y: antY + 2.5, width: 2, height: 7, fill: '#79828f' }, g);
    el('circle', { cx: antX, cy: antY, r: 2.6, fill: t.warn ? '#7fd1ff' : '#6b7280' }, g);
    if (t.warn) {
      el('circle', { cx: antX, cy: antY, r: 5.4, fill: 'none', stroke: '#7fd1ff', 'stroke-width': 0.9, opacity: 0.55 }, g);
    }
    t.antX = antX; t.antY = antY;

    // —— 车次牌 ——
    const bw = 38, bh = 11;
    const bx = t.dir > 0 ? hx1 - 46 : hx0 + 8;
    const by = hy - 12;
    el('rect', { x: bx, y: by, width: bw, height: bh, rx: 2, fill: 'rgba(8,12,18,.82)',
                 stroke: t.warn ? 'rgba(155,231,255,.45)' : 'rgba(255,255,255,.12)', 'stroke-width': 0.8 }, g);
    el('text', { x: bx + bw / 2, y: by + bh - 2.8, 'text-anchor': 'middle', 'font-size': 8.4,
                 fill: t.warn ? '#a8ecff' : '#9aa4b2',
                 'font-family': 'ui-monospace,Menlo,Consolas,monospace' }, g).textContent = t.cls + t.num;
  }
}

/* 波前可视化：LBJ 车载台从车头顶端发出的同心波纹。
 * 被建筑遮挡时，在建筑背向来车的一侧绘制"信号阴影楔形"，
 * 楔形覆盖范围内的波纹被压暗 —— 直观表现"波形被建筑物挡住"。 */
function ellipsePts(cx, cy, rx, ry, n) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return p;
}

function drawWaves(st) {
  gWave.querySelectorAll('.waveG').forEach(n => n.remove());
  gShadow.textContent = '';
  if (!SC.wave) return;

  const lbjW = SC.waves.filter(w => w.kind === 'lbj');
  const bsW  = SC.waves.filter(w => w.kind === 'bs');

  for (const w of SC.waves) {
    const g = el('g', { class: 'waveG' }, gWave);
    const cx = X(w.x), cy = w.cy;
    const rx = w.r, ry = w.r * 0.30;
    const a = clamp(1 - w.r / w.max, 0, 1);
    const col = w.kind === 'bs' ? '#ff7a5c' : '#54d6ff';
    const fade = Math.pow(a, 1.7);
    el('ellipse', { cx, cy, rx, ry, fill: 'none', stroke: col, 'stroke-width': w.kind === 'bs' ? 1.3 : 1.8,
                    opacity: (fade * (w.kind === 'bs' ? 0.42 : 0.50)).toFixed(3),
                    'stroke-dasharray': w.kind === 'bs' ? '5 5' : null }, g);
  }

  // —— 基站干扰与 LBJ 波前相遇 → 干涉点 ——
  if (bsW.length && lbjW.length) {
    const b = bsW[bsW.length - 1];
    const bp = ellipsePts(X(b.x), b.cy, b.r, b.r * 0.30, 30);
    const marks = [];
    for (let k = lbjW.length - 1; k >= 0 && marks.length < 3; k--) {
      const w = lbjW[k];
      const wp = ellipsePts(X(w.x), w.cy, w.r, w.r * 0.30, 30);
      for (const p of wp) {
        for (const q of bp) {
          if (Math.abs(p[0] - q[0]) < 7 && Math.abs(p[1] - q[1]) < 7) {
            marks.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
            break;
          }
        }
        if (marks.length >= 3) break;
      }
    }
    for (const m of marks) {
      el('path', { d: `M${m[0] - 4},${m[1] - 4} L${m[0] + 4},${m[1] + 4} M${m[0] + 4},${m[1] - 4} L${m[0] - 4},${m[1] + 4}`,
                   stroke: '#ffd166', 'stroke-width': 1.6, opacity: 0.9 }, gShadow);
      el('circle', { cx: m[0], cy: m[1], r: 6, fill: 'none', stroke: '#ffd166', 'stroke-width': 0.8, opacity: 0.5 }, gShadow);
    }
  }

  // —— 建筑造成的信号阴影 ——
  const link = st.link, t = st.train;
  if (link && link.bl && link.bl.hit && t) {
    const b = link.bl.hit;
    const bx0 = X(b.x0), bx1 = X(b.x1);
    const bTop = Ys(b.y0, b.h);
    const dirS = Math.sign(X(SC.device.x) - X(t.x)) || 1;      // 阴影背离来车
    const dist = Math.abs(X(SC.device.x) - X(t.x));
    const spread = Math.max(14, (bx1 - bx0) * (1 + dist / 320));
    const d = dirS > 0
      ? `M${bx0},${bTop} L${bx1},${bTop} L${bx1 + spread},${GROUND_Y + 14} L${bx0 + spread},${GROUND_Y + 14} Z`
      : `M${bx0},${bTop} L${bx1},${bTop} L${bx1 - spread},${GROUND_Y + 14} L${bx0 - spread},${GROUND_Y + 14} Z`;
    el('path', { d, fill: '#8a1f2c', opacity: 0.22 }, gShadow);
    el('path', { d, fill: 'none', stroke: '#f87171', 'stroke-width': 1, 'stroke-dasharray': '6 5', opacity: 0.42 }, gShadow);
    el('text', { x: (bx0 + bx1) / 2 + dirS * spread * 0.55, y: (bTop + GROUND_Y) / 2 + 4, 'text-anchor': 'middle',
                 'font-size': 10, fill: '#ff9aa4', opacity: 0.95,
                 'font-family': 'ui-monospace,Menlo,Consolas,monospace' }, gShadow).textContent = '信号阴影区';
  }
}

/* 设备天线顶端在屏幕上的纵坐标（举高高度 + 天线长度） */
function devTipY() { return BAND.near.gy - SC.device.h * DEV_HS - 48; }

function drawDevice(sk) {
  gDev.querySelectorAll('.devG').forEach(n => n.remove());
  const g = el('g', { class: 'devG' }, gDev);
  const gy = BAND.near.gy;
  const bx = X(SC.device.x);
  const baseY = gy - SC.device.h * DEV_HS;   // 举高后的底座位置

  // 高度标尺
  el('line', { x1: bx + 30, y1: gy, x2: bx + 30, y2: baseY, stroke: '#7fd1ff', 'stroke-width': 1,
               'stroke-dasharray': '3 3', opacity: 0.55 }, g);
  el('text', { x: bx + 35, y: baseY + 4, 'font-size': 9.5, fill: '#7fd1ff', opacity: 0.85,
               'font-family': 'ui-monospace,Menlo,Consolas,monospace' }, g).textContent = SC.device.h.toFixed(1) + ' m';

  // 地面阴影
  el('ellipse', { cx: bx, cy: gy + 2, rx: 15, ry: 3.4, fill: '#000', opacity: 0.35 }, g);

  // 设备本体（按倾角旋转）
  const rg = el('g', { transform: `translate(${bx},${baseY}) rotate(${SC.device.tilt})`, style: 'cursor:move' }, g);
  el('rect', { x: -12, y: -30, width: 24, height: 30, rx: 4, fill: '#171a20', stroke: '#3d4552', 'stroke-width': 1 }, rg);
  el('rect', { x: -8.5, y: -25, width: 17, height: 11, rx: 1.4, fill: '#0a1220' }, rg);
  el('rect', { x: -7, y: -23.6, width: 14, height: 4, fill: '#54d6ff', opacity: 0.85 }, rg);
  el('rect', { x: -7, y: -18, width: 9, height: 2, fill: '#54d6ff', opacity: 0.5 }, rg);
  el('rect', { x: -1.6, y: -47, width: 3.2, height: 18, rx: 1.4, fill: '#2c313a' }, rg);
  el('circle', { cx: 0, cy: -48, r: 2.4, fill: '#4ade80' }, rg);
  el('circle', { cx: 6.5, cy: -12, r: 1.8, fill: '#ef4444' }, rg);
  el('text', { x: 0, y: -33.5, 'text-anchor': 'middle', 'font-size': 5, fill: '#7b8494',
               'font-family': 'ui-monospace,Menlo,Consolas,monospace' }, rg).textContent = 'DX-20S';
  // 抓取热区
  const hit = el('rect', { x: -22, y: -56, width: 44, height: 62, fill: 'transparent', style: 'cursor:move' }, rg);
  hit.setAttribute('data-devhit', '1');
}

/* 视线：车头顶端天线 → 设备天线（折线经过建筑带，真实反映高度关系） */
function drawLOS(st) {
  gLos.querySelectorAll('.losG').forEach(n => n.remove());
  const t = st.train;
  if (!t) return;
  const g = el('g', { class: 'losG' }, gLos);
  const link = st.link;
  const ax = t.antX || X(t.x), ay = t.antY || (BAND.far.gy - 24);
  const bx = X(SC.device.x), by = devTipY();
  // 线的颜色反映"路径是否被挡住"，解码是否成功由右侧状态徽标显示
  const blocked = !!(link && ((link.bl && link.bl.hit) || (link.rl && link.rl.h > 0)));
  const col = !link ? '#8b95a5' : blocked ? '#f87171' : '#4ade80';

  // 折点：与建筑带（纵深 140 m）的交点 —— 被楼体挡住时取真实碰撞点
  const pts = [[ax, ay]];
  const hitP = link && link.bl ? link.bl.hitP : null;
  if (hitP) {
    pts.push([X(hitP.x), Ys(hitP.y, hitP.z)]);
  } else if (link) {
    const tm = (Y_TRACK - Y_MID) / Y_TRACK;
    const px = t.x + (SC.device.x - t.x) * tm;
    const pz = 4.3 + (SC.device.h + 0.35 - 4.3) * tm;
    pts.push([X(px), Ys(Y_MID, pz)]);
  }
  pts.push([bx, by]);
  el('polyline', { points: pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '),
                   fill: 'none', stroke: col, 'stroke-width': 1.8,
                   'stroke-dasharray': blocked ? '6 4' : null, opacity: 0.9 }, g);
  el('circle', { cx: ax, cy: ay, r: 3, fill: col }, g);
  el('circle', { cx: bx, cy: by, r: 3, fill: col }, g);

  // 被遮挡的楼体高亮
  if (hitP && link.bl.hit) {
    const b = link.bl.hit;
    const bx0 = X(b.x0), bw = (b.x1 - b.x0) * WS;
    const bTop = Ys(b.y0, b.h);
    el('rect', { x: bx0 - 2, y: bTop - 2, width: bw + 4, height: (Ys(b.y0, 0) - bTop) + 8,
                 fill: 'none', stroke: '#f87171', 'stroke-width': 1.4, 'stroke-dasharray': '3 3', rx: 3 }, g);
  }
  // 山脊绕射：标出山脊高出视线的部分
  if (link && link.rl && link.rl.h > 0 && SC.ridge) {
    const tm = (Y_TRACK - Y_MID) / Y_TRACK;
    const px = t.x + (SC.device.x - t.x) * tm;
    const pz = 4.3 + (SC.device.h + 0.35 - 4.3) * tm;
    const rz = SC.ridge(px);
    const cy = Ys(Y_MID, pz), ry = Ys(Y_MID, rz);
    el('line', { x1: X(px), y1: cy, x2: X(px), y2: ry, stroke: '#f59e0b', 'stroke-width': 1.4, 'stroke-dasharray': '3 2' }, g);
    el('circle', { cx: X(px), cy: ry, r: 3.4, fill: '#f59e0b' }, g);
    el('text', { x: X(px) + 7, y: (cy + ry) / 2, 'font-size': 9, fill: '#fcd34d',
                 'font-family': 'ui-monospace,Menlo,Consolas,monospace' }, g).textContent =
      '山脊高出视线 ' + (rz - pz).toFixed(1) + ' m';
  }
  // 视野外的来车：在画面边缘给出方向指示
  const v0 = SC.view.x, v1 = SC.view.x + SC.view.w;
  if (ax < v0 || ax > v1) {
    const left = ax < v0;
    const ex = left ? v0 + 26 : v1 - 26;
    const d = left ? 'M' + (ex + 12) + ',' + ay + ' L' + ex + ',' + ay + ' L' + (ex + 7) + ',' + (ay - 6) + ' L' + (ex + 7) + ',' + (ay + 6) + ' Z'
                    : 'M' + (ex - 12) + ',' + ay + ' L' + ex + ',' + ay + ' L' + (ex - 7) + ',' + (ay - 6) + ' L' + (ex - 7) + ',' + (ay + 6) + ' Z';
    el('path', { d, fill: col, opacity: 0.95 }, g);
    el('text', { x: ex, y: ay - 12, 'text-anchor': 'middle', 'font-size': 9, fill: col,
                 'font-family': 'ui-monospace,Menlo,Consolas,monospace' }, g).textContent =
      (left ? '◀ ' : '▶ ') + t.cls + t.num + ' ' + (st.link ? Math.round(st.link.d) + 'm' : '');
  }
}

/* ============================ 11. 测距带 ============================ */
const RW = 1200, RH = 108, RMAX = 3000;
function drawRadar(st) {
  if (!gRadar) return;
  gRadar.textContent = '';
  const g = gRadar;
  el('rect', { x: 0, y: 0, width: RW, height: RH, fill: '#0c0f14' }, g);
  const cx = RW / 2;
  const px_ = m => cx + (m / RMAX) * (RW / 2 - 20);

  // 可靠接收区（当前环境，无遮挡）
  const n = N_PATH[SC.mode];
  const rx0 = -RMAX, rx1 = RMAX;
  el('line', { x1: px_(rx0), y1: RH - 26, x2: px_(rx1), y2: RH - 26, stroke: '#2a3040', 'stroke-width': 1 }, g);
  for (let m = -3000; m <= 3000; m += 500) {
    el('line', { x1: px_(m), y1: RH - 26, x2: px_(m), y2: RH - 21, stroke: '#3a4354', 'stroke-width': 1 }, g);
    el('text', { x: px_(m), y: RH - 9, 'text-anchor': 'middle', 'font-size': 9, fill: '#6b7484',
                 'font-family': 'ui-monospace,Menlo,Consolas,monospace' }, g).textContent = (m > 0 ? '+' : '') + m;
  }
  el('text', { x: 10, y: 14, 'font-size': 10, fill: '#7b8494' }, g).textContent = '距离标尺（米）';

  // 信号强度曲线
  let dd = '';
  for (let m = 20; m <= RMAX; m += 20) {
    const pr = RF.pTx + RF.gTx + RF.gRx - pathLoss(m, n);
    const y = RH - 26 - clamp((pr + 120) / 55, 0, 1) * 52;
    dd += (dd ? ' L' : 'M') + px_(m) + ',' + y.toFixed(1);
  }
  el('path', { d: dd, fill: 'none', stroke: '#54d6ff', 'stroke-width': 1.6, opacity: 0.85 }, g);

  // 门限线
  const ySens = RH - 26 - clamp((RF.sens + 120) / 55, 0, 1) * 52;
  el('line', { x1: 10, y1: ySens, x2: RW - 10, y2: ySens, stroke: '#f87171', 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.7 }, g);
  el('text', { x: RW - 12, y: ySens - 4, 'text-anchor': 'end', 'font-size': 9, fill: '#f87171' }, g).textContent = '灵敏度 -106dBm';

  // 设备
  el('rect', { x: cx - 7, y: RH - 46, width: 14, height: 20, rx: 2, fill: '#54d6ff' }, g);
  el('text', { x: cx, y: RH - 50, 'text-anchor': 'middle', 'font-size': 9, fill: '#9fd8ff' }, g).textContent = '本机';

  // 基站
  if (SC.bs) {
    const bx = px_(SC.bs.x);
    el('path', { d: `M${bx},${RH - 44} L${bx - 6},${RH - 26} L${bx + 6},${RH - 26} Z`, fill: '#ff7a5c' }, g);
    el('text', { x: bx, y: RH - 50, 'text-anchor': 'middle', 'font-size': 9, fill: '#ff9a80' }, g).textContent = '基站';
  }
  // 列车
  const t = st.train;
  if (t) {
    const tx = px_(t.x);
    el('rect', { x: tx - 9, y: 34, width: 18, height: 10, rx: 2, fill: t.warn ? '#9be7ff' : '#7b8494' }, g);
    el('text', { x: tx, y: 30, 'text-anchor': 'middle', 'font-size': 9, fill: t.warn ? '#c9f0ff' : '#8b95a5' }, g).textContent = t.cls + t.num;
    el('line', { x1: tx, y1: 44, x2: cx, y2: RH - 40, stroke: st.link && st.link.ok ? '#4ade80' : '#f87171',
                 'stroke-width': 1.4, 'stroke-dasharray': st.link && st.link.ok ? null : '5 4', opacity: 0.8 }, g);
  }
}

/* ============================ 12. 消息投递 ============================ */
let lineCounter = 100;
function deliver(t, link) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const msg = {
    line: ++lineCounter,
    type: t.isFreight ? 0 : 1,
    cls:  t.isFreight ? '--' : t.cls,
    train: t.num,
    dir:  t.dir > 0 ? 3 : 1,
    speed: String(t.speed),
    pos:  t.kilo.toFixed(1),
    route: t.line,
    ltype: t.ltype,
    loco: t.loco,
    time: pad(now.getHours()) + ':' + pad(now.getMinutes())
  };
  rx.rssi = clamp(link.pr, -120, -40);
  history.push(msg);
  current = msg;
  st.alwaysNew = false;
  st.isMenu = false;
  // 注意：这里的 S 必须取模拟器主脚本的页面枚举（全局 const S）。
  // 本文件曾用 const S = 1.55（世界比例）遮蔽它，导致 st.page 被写成
  // undefined、render() 的 switch 落空 —— 表现为"消息收到但屏幕不刷新"。
  // 世界比例已改名为 WS，两者不再冲突。
  st.page = (typeof S !== 'undefined' && S.CLOSED) ? S.CLOSED : 'MENU_CLOSED';
  render();
  broadcastFeedback(msg.dir);
}

/* ============================ 13. 主循环 ============================ */
function step(dt) {
  SC.t += dt;

  // 列车生成
  SC.nextTrain -= dt;
  if (SC.nextTrain <= 0) {
    SC.trains.push(makeTrain());
    SC.nextTrain = rnd(9, 22);
  }
  // 列车运动
  for (let i = SC.trains.length - 1; i >= 0; i--) {
    const t = SC.trains[i];
    const ms = t.speed / 3.6;
    t.x += t.dir * ms * dt;
    t.kilo += t.dir * ms * dt / 1000;
    if (t.x * t.dir > 2400 || t.x * t.dir < -2400) { SC.trains.splice(i, 1); continue; }

    // 车载台播发
    if (t.warn && SC.t >= t.nextEmit) {
      t.nextEmit = SC.t + RF.emitGap;
      t.warnCount++;
      const tx = { x: t.x, y: Y_TRACK, z: 4.3 };
      const rxP = { x: SC.device.x, y: Y_DEV, z: SC.device.h + 0.35 };
      const link = linkBudget(tx, rxP);
      SC.stat.sent++;
      // 设备已关机时不再接收（关机 = 电台不工作）
      if (typeof DEVICE !== 'undefined' && DEVICE && !DEVICE.powered) continue;
      if (link.ok) {
        SC.stat.got++;
        deliver(t, link);
      }
    }
  }

  // 波纹
  for (const t of SC.trains) {
    if (!t.warn) continue;
    const last = SC.waves.filter(w => w.id === t.id).pop();
    if (!last || SC.t - last.t > 0.8) {
      SC.waves.push({ id: t.id, x: t.x, cy: BAND.far.gy - LOCO_H - 9, r: 6, max: 760, t: SC.t, kind: 'lbj' });
    }
  }
  for (let i = SC.waves.length - 1; i >= 0; i--) {
    const w = SC.waves[i];
    w.r += dt * 210;
    if (w.r > w.max) SC.waves.splice(i, 1);
  }
  // 基站干扰波纹
  if (SC.bs && SC.wave) {
    const last = SC.waves.filter(w => w.kind === 'bs').pop();
    if (!last || SC.t - last.t > 0.9) {
      SC.waves.push({ id: 'bs', x: SC.bs.x, cy: Ys(SC.bs.y, 0) - SC.bs.h * WS * 0.5 - 12, r: 8, max: 760, t: SC.t, kind: 'bs' });
    }
  }
}

function nearestTrain() {
  let best = null, bd = 1e9;
  for (const t of SC.trains) {
    const d = Math.abs(t.x - SC.device.x);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function updateStat() {
  const t = nearestTrain();
  let link = null;
  if (t) {
    const tx = { x: t.x, y: Y_TRACK, z: 4.3 };
    const rxP = { x: SC.device.x, y: Y_DEV, z: SC.device.h + 0.35 };
    link = linkBudget(tx, rxP);
  }
  const st = { train: t, link };
  SC.stat.train = t;
  SC.stat.link = link;
  SC.cur = st;
  return st;
}

/* ============================ 14. HUD 刷新 ============================ */
function fmtTime() {
  const hnow = nowHour();
  const hh = Math.floor(hnow), mm = Math.round((hnow - hh) * 60) % 60;
  const phaseName = hh < 4.5 ? '深夜' : hh < 6.8 ? '黎明' : hh < 8.5 ? '清晨'
                  : hh < 16 ? '白昼' : hh < 18.6 ? '黄昏' : hh < 20.6 ? '暮色' : '夜间';
  return { txt: `${pad2(hh)}:${pad2(mm)} · ${phaseName}`, phase: phaseName };
}
function pad2(n) { return String(n).padStart(2, '0'); }

let hudAcc = 1;   // 置 1 保证首帧即刷新一次 HUD
function refreshHUD(st) {
  const ck = $('#clock');
  if (ck) {
    const ft = fmtTime();
    ck.innerHTML = `本机时间 <b>${ft.txt}</b>`;
  }
  const t = st.train, link = st.link;
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  if (t) {
    set('#hud-train', `${t.cls === '--' ? '' : t.cls}${t.num} · ${t.line}${t.warn ? '' : '（不发预警）'}`);
    const d = link ? link.d : 0;
    set('#hud-dist', d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d.toFixed(0) + ' m');
    const lead = d / (t.speed / 3.6);
    set('#hud-lead', lead > 90 ? '—' : lead.toFixed(0) + ' 秒');
    set('#hud-rssi', link ? link.pr.toFixed(1) + ' dBm' : '—');
    set('#s-loss', link ? link.pl.toFixed(1) + ' dB' : '—');
    const obsTxt = link
      ? `${link.obs.toFixed(1)} dB` + (link.bl.hit ? '（建筑）' : link.rl.h > 0 ? '（山体）' : link.fl.loss > 0 ? '（林带）' : '')
      : '—';
    set('#s-obs', obsTxt);
    set('#s-pol', link ? link.pol.toFixed(1) + ' dB' : '—');
    set('#s-pr', link ? link.pr.toFixed(1) + ' dBm' : '—');
    set('#s-noise', link ? link.noise.toFixed(1) + ' dBm' + (link.itf.level > RF.noise ? '（含干扰）' : '（本底）') : '—');
    set('#s-snr', link ? link.snr.toFixed(1) + ' dB' : '—');
    set('#s-rate', SC.stat.sent ? Math.round(SC.stat.got / SC.stat.sent * 100) + ' %　(' + SC.stat.got + '/' + SC.stat.sent + ')' : '—');
  } else {
    ['#hud-train', '#hud-dist', '#hud-lead', '#hud-rssi', '#s-loss', '#s-obs', '#s-pol', '#s-pr', '#s-noise', '#s-snr']
      .forEach(id => set(id, '—'));
    set('#s-rate', '—');
  }

  // 状态徽标
  const badge = $('#sig-state');
  const bar = $('#s-bar');
  if (badge) {
    let cls = 'idle', txt = '等待来车';
    if (link) {
      if (link.ok) { cls = 'ok'; txt = '可正常解码'; }
      else if (link.snr >= 2 && link.pr >= RF.sens - 8) { cls = 'mid'; txt = '临界 · 易丢包'; }
      else { cls = 'bad'; txt = '信号不足'; }
    }
    badge.className = 'sigstate ' + cls;
    badge.textContent = txt;
  }
  if (bar) {
    const pct = link ? clamp((link.snr + 6) / 30, 0, 1) : 0;
    bar.style.width = (pct * 100).toFixed(1) + '%';
    bar.style.background = pct > 0.55 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#f87171';
  }
}

/* ============================ 15. 视图缩放 / 拖动 ============================ */
function applyView() {
  const v = SC.view;
  const h = v.w * VH / VW;
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${h.toFixed(2)}`);
}
function zoomBy(f, cx, cy) {
  const v = SC.view;
  const nw = clamp(v.w * f, 420, 3600);
  const h = v.w * VH / VW;
  const k = nw / v.w;
  v.x = cx - (cx - v.x) * k;
  v.y = cy - (cy - v.y) * k;
  v.w = nw;
  applyView();
}
function screenToWorld(ev) {
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return {
    x: vb.x + (ev.clientX - r.left) / r.width * vb.width,
    y: vb.y + (ev.clientY - r.top) / r.height * vb.height
  };
}

/* ============================ 16. 初始化与事件 ============================ */
function rebuildStatic() {
  const sk = skyAt(nowHour());
  drawSky(sk);
  drawFar(sk);
  drawMid(sk);
  drawNear(sk);
  SC.sky = sk;
}

function bindUI() {
  // 场景切换
  $('#seg-mode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('#seg-mode').children].forEach(x => x.classList.toggle('on', x === b));
    SC.mode = b.dataset.mode;
    $('#seg-preset').style.display = SC.mode === 'suburb' ? '' : 'none';
    $('#world-ttl').innerHTML = SC.mode === 'urban'
      ? '城市场景<span>建筑遮挡 · 800MHz 基站干扰</span>'
      : `郊区场景 · ${PRESETS[SC.preset].name}<span>${PRESETS[SC.preset].region}</span>`;
    genScene(true);
    rebuildStatic();
    refreshLegend();
    toast(SC.mode === 'urban' ? '已切换到城市场景：建筑遮挡 + 基站干扰' : '已切换到郊区场景：' + PRESETS[SC.preset].name);
  });

  // 郊区预设
  const sp = $('#seg-preset');
  Object.keys(PRESETS).forEach(k => {
    const b = document.createElement('button');
    b.textContent = PRESETS[k].name;
    b.dataset.preset = k;
    if (k === SC.preset) b.classList.add('on');
    sp.appendChild(b);
  });
  sp.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...sp.children].forEach(x => x.classList.toggle('on', x === b));
    SC.preset = b.dataset.preset;
    $('#world-ttl').innerHTML = `郊区场景 · ${PRESETS[SC.preset].name}<span>${PRESETS[SC.preset].region}</span>`;
    genScene(true);
    rebuildStatic();
    refreshLegend();
    toast('郊区环境：' + PRESETS[SC.preset].name + ' · ' + PRESETS[SC.preset].note);
  });

  // 动画 / 波纹开关
  const tgA = $('#tgl-anim');
  tgA.addEventListener('click', () => {
    SC.anim = !SC.anim;
    tgA.classList.toggle('off', !SC.anim);
    tgA.querySelector('span').textContent = SC.anim ? '动画' : '动画（关）';
    toast(SC.anim ? '动画已开启' : '动画已关闭（低端设备省电模式）');
  });
  const tgW = $('#tgl-wave');
  tgW.addEventListener('click', () => {
    SC.wave = !SC.wave;
    tgW.classList.toggle('off', !SC.wave);
    tgW.querySelector('span').textContent = SC.wave ? '波纹' : '波纹（关）';
  });

  // 缩放
  $('#btn-zoom-in').addEventListener('click', () => zoomBy(0.78, 600, 310));
  $('#btn-zoom-out').addEventListener('click', () => zoomBy(1.28, 600, 310));
  $('#btn-zoom-reset').addEventListener('click', () => { SC.view = { x: 0, y: 0, w: VW }; applyView(); });
  $('#btn-regen').addEventListener('click', () => {
    genScene(true);
    rebuildStatic();
    refreshLegend();
    toast('已重新生成场景（建筑层数、地形重新随机）');
  });

  // 天线倾角
  const rt = $('#rng-tilt');
  rt.addEventListener('input', () => {
    SC.device.tilt = +rt.value;
    $('#lbl-tilt').textContent = rt.value + '°';
    $('#btn-tilt').textContent = '天线倾角 ' + rt.value + '°';
  });
  $('#btn-tilt').addEventListener('click', () => {
    const v = (SC.device.tilt + 20) % 90;
    SC.device.tilt = v; rt.value = v;
    $('#lbl-tilt').textContent = v + '°';
    $('#btn-tilt').textContent = '天线倾角 ' + v + '°';
  });

  // 举高高度
  const rh = $('#rng-h');
  rh.addEventListener('input', () => {
    SC.device.h = +rh.value;
    $('#lbl-h').textContent = SC.device.h.toFixed(1) + ' m';
  });

  // 场景交互：拖设备 / 平移 / 滚轮缩放
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    const w = screenToWorld(e);
    const dx = X(SC.device.x) - w.x;
    const dy = (devTipY() + 24) - w.y;
    if (Math.abs(dx) < 32 && Math.abs(dy) < 46) {
      drag = { mode: 'dev', x: w.x, y: w.y, dx: SC.device.x, dh: SC.device.h };
      svg.setPointerCapture(e.pointerId);
    } else {
      drag = { mode: 'pan', x: w.x, y: w.y, vx: SC.view.x, vy: SC.view.y };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('grabbing');
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const w = screenToWorld(e);
    if (drag.mode === 'dev') {
      SC.device.x = clamp(drag.dx + (w.x - drag.x) / WS, -600, 600);
      SC.device.h = clamp(drag.dh - (w.y - drag.y) / DEV_HS, 0.5, DEV_H_MAX);
      $('#rng-h').value = SC.device.h;
      $('#lbl-h').textContent = SC.device.h.toFixed(1) + ' m';
    } else {
      SC.view.x = drag.vx - (w.x - drag.x);
      SC.view.y = drag.vy - (w.y - drag.y);
      applyView();
    }
  });
  const endDrag = e => {
    if (!drag) return;
    drag = null;
    svg.classList.remove('grabbing');
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const w = screenToWorld(e);
    zoomBy(e.deltaY > 0 ? 1.12 : 0.89, w.x, w.y);
  }, { passive: false });

  // 设备按键（K1~K4 / 电源键）统一由模拟器主脚本接管：
  //   长按电源键 = 开关机；单击无功能。
  // 此处不再重复绑定，否则 K1 会被触发两次（开菜单 → 立刻关菜单）。
}

function refreshLegend() {
  const lg = $('#legend');
  if (!lg) return;
  lg.innerHTML = '';
  const items = SC.mode === 'urban'
    ? [['#54d6ff', 'LBJ 车载台信号（821.2375MHz）', 0],
       ['#ff7a5c', '800MHz 手机基站干扰', 0],
       ['#ffd166', '两圈波纹相遇 → 相互干扰', 1],
       ['#4ade80', '无遮挡直线路径', 0],
       ['#f87171', '路径被建筑 / 山体遮挡', 0]]
    : [['#54d6ff', 'LBJ 车载台信号（821.2375MHz）', 0],
       ['#f87171', '山体遮挡 / 林带衰减', 0],
       ['#4ade80', '无遮挡直线路径', 0]];
  items.forEach(([c, txt, dot]) => {
    const d = document.createElement('div');
    d.innerHTML = `<i class="${dot ? 'dotm' : ''}" style="background:${c}"></i><span>${txt}</span>`;
    lg.appendChild(d);
  });
}

/* ============================ 17. 启动 ============================ */
function init() {
  svg = $('#world');
  if (!svg) return;
  gSky  = el('g', { id: 'gSky' },  svg);
  gFar  = el('g', { id: 'gFar' },  svg);
  // 列车层：轨道之上、建筑与山体之下 —— 远处的列车会被前面的楼和山挡住
  gTrain = el('g', { id: 'gTrain' }, svg);
  gMid  = el('g', { id: 'gMid' },  svg);
  gNear = el('g', { id: 'gNear' }, svg);
  gDyn  = el('g', { id: 'gDyn' },  svg);
  // 动态层内部再分四层，保证前后遮挡关系稳定：
  // 波纹 → 信号阴影/干涉 → 视线 → 设备
  gWave   = el('g', { id: 'gWave' },   gDyn);
  gShadow = el('g', { id: 'gShadow' }, gDyn);
  gLos    = el('g', { id: 'gLos' },    gDyn);
  gDev    = el('g', { id: 'gDev' },    gDyn);

  // 测距带插在世界 SVG 之后
  gRadar = el('svg', { id: 'radar', viewBox: `0 0 ${RW} ${RH}`, preserveAspectRatio: 'none' });
  gRadar.style.cssText = 'display:block;width:100%;height:108px;border-top:1px solid #2f3542';
  svg.parentNode.insertBefore(gRadar, svg.nextSibling);

  // 郊区预设：URL 指定或随机
  const keys = Object.keys(PRESETS);
  const pm = /[?&]preset=([a-z]+)/.exec(location.search);
  SC.preset = (pm && PRESETS[pm[1]]) ? pm[1] : keys[Math.floor(Math.random() * keys.length)];
  [...$('#seg-preset').children].forEach(x => x.classList.toggle('on', x.dataset.preset === SC.preset));
  // ?h=米 指定本机举高高度（便于演示与配图）
  const hm = /[?&]h=(\d+(?:\.\d+)?)/.exec(location.search);
  if (hm) {
    SC.device.h = clamp(parseFloat(hm[1]), 0.5, DEV_H_MAX);
    const rh = $('#rng-h'); if (rh) rh.value = SC.device.h;
    const lh = $('#lbl-h'); if (lh) lh.textContent = SC.device.h.toFixed(1) + ' m';
  }
  // 场景：URL 指定
  const mm = /[?&]mode=(urban|suburb)/.exec(location.search);
  if (mm && mm[1] !== SC.mode) {
    SC.mode = mm[1];
    [...$('#seg-mode').children].forEach(x => x.classList.toggle('on', x.dataset.mode === SC.mode));
    $('#seg-preset').style.display = SC.mode === 'suburb' ? '' : 'none';
    $('#world-ttl').innerHTML = SC.mode === 'urban'
      ? '城市场景<span>建筑遮挡 · 800MHz 基站干扰</span>'
      : `郊区场景 · ${PRESETS[SC.preset].name}<span>${PRESETS[SC.preset].region}</span>`;
  }

  buildDefs();
  genScene(true);
  rebuildStatic();
  applyView();
  refreshLegend();
  bindUI();
  window.__SCENE = SC;   // 调试出口：便于在控制台观察场景状态

  // 初始状态
  rx.rssi = -115;

  // ?t=秒 瞬间快进推演（便于截图/演示，不依赖真实等待）
  const tm = /[?&]t=(\d+(?:\.\d+)?)/.exec(location.search);
  if (tm) {
    const secs = Math.min(600, parseFloat(tm[1]));
    // 快进期间静音：几十秒推演会触发上百次提示音，海量音频节点会拖垮渲染进程
    window.__SILENT = true;
    const h = 1 / 30;
    for (let i = 0; i < secs * 30; i++) step(h);
    window.__SILENT = false;
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (SC.anim) step(dt);

    // 昼夜刷新（每 30 秒检查一次）
    if (!SC.phaseCheck || now - SC.phaseCheck > 30000) {
      SC.phaseCheck = now;
      const h = Math.round(nowHour() * 12);
      if (h !== SC.phase) { SC.phase = h; rebuildStatic(); }
    }

    const st = updateStat();
    drawTrains(SC.sky);
    drawWaves(st);
    drawDevice(SC.sky);
    drawLOS(st);
    drawRadar(st);

    hudAcc += dt;
    if (hudAcc > 0.12) { hudAcc = 0; refreshHUD(st); }

    // ?still=1 —— 只渲染静帧后停机（用于截图 / 说明书配图）
    if (!STILL) requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
