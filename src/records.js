/**
 * 記録の表現・マージ・持ち出し。
 *
 * DOM にも localStorage にも依存しない純粋ロジックだけを置く。端末間で
 * 記録を合成する規則がここに閉じているので、Node から import して検証できる。
 */

// 端末ごとカウンタを導入する前に保存された runs（素の数値）の置き場所。
export const LEGACY_DEVICE = 'dev_legacy';

/** 端末ごとの試行回数を合計する。結果画面の「N 回目」はこれ。 */
export function totalRuns(rec) {
  const runs = rec && rec.runs;
  if (!runs || typeof runs !== 'object') return 0;
  let sum = 0;
  for (const n of Object.values(runs)) if (typeof n === 'number') sum += n;
  return sum;
}

/**
 * runs を端末ごとカウンタ `{ [deviceId]: number }` に揃える。
 *
 * 端末をまたぐと、max では回数が過小になり、加算では同じファイルを二度
 * 読んだときに二重計上する。端末ごとに持って端末ごとに max を取れば
 * どちらも起きない。
 */
export function migrateRecords(records) {
  const out = {};
  for (const [id, rec] of Object.entries(records || {})) {
    out[id] = { ...rec, runs: normalizeRuns(rec && rec.runs) };
  }
  return out;
}

function normalizeRuns(runs) {
  if (typeof runs === 'number') return { [LEGACY_DEVICE]: runs };
  if (!runs || typeof runs !== 'object') return {};
  const out = {};
  for (const [dev, n] of Object.entries(runs)) if (typeof n === 'number') out[dev] = n;
  return out;
}

// 大きいほど良い指標と、小さいほど良い指標。
const MAX_KEYS = ['cpm', 'acc', 'boost'];
const MIN_KEYS = ['sec', 'keys', 'miss'];

/**
 * 手元の記録に取り込んだ記録を合成する。
 *
 * 全指標が max / min、runs は端末ごとの max。どれも冪等・可換・結合的
 * なので、同じファイルを二度読んでも、どちらの端末から先に取り込んでも
 * 結果が同じになる。だからバージョン番号も競合解決 UI も要らない。
 *
 * 既知の指標だけを通す。未知のキーを素通しすると「あとから書いたほうが
 * 勝つ」規則が混ざり、可換でなくなるため。指標を増やすときは schema を
 * 上げてここに足す。
 */
export function mergeRecords(local, incoming) {
  const ids = new Set([...Object.keys(local || {}), ...Object.keys(incoming || {})]);
  const out = {};
  for (const id of ids) out[id] = mergeOne((local || {})[id], (incoming || {})[id]);
  return out;
}

function mergeOne(a, b) {
  const x = a || {};
  const y = b || {};
  const rec = {};
  for (const k of MAX_KEYS) pick(rec, k, x[k], y[k], Math.max);
  for (const k of MIN_KEYS) pick(rec, k, x[k], y[k], Math.min);
  rec.runs = mergeRuns(normalizeRuns(x.runs), normalizeRuns(y.runs));
  return rec;
}

// 片方にしかない指標はその値を残し、どちらにも無ければキー自体を作らない。
function pick(rec, key, a, b, fn) {
  const hasA = typeof a === 'number' && Number.isFinite(a);
  const hasB = typeof b === 'number' && Number.isFinite(b);
  if (hasA && hasB) rec[key] = fn(a, b);
  else if (hasA) rec[key] = a;
  else if (hasB) rec[key] = b;
}

function mergeRuns(a, b) {
  const out = { ...a };
  for (const [dev, n] of Object.entries(b)) out[dev] = Math.max(out[dev] ?? 0, n);
  return out;
}

/* ------------------------------------------------------------------ */
/* 持ち出し                                                             */
/* ------------------------------------------------------------------ */

export const APP = 'cp-typing';
export const SCHEMA = 1;

/** 書き出すファイルの中身。runs は必ず新形式に直してから載せる。 */
export function buildExport({ records, settings }) {
  return {
    app: APP,
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    records: migrateRecords(records),
    settings: { ...(settings || {}) },
  };
}

/**
 * 読み込んだテキストを検証して取り出す。
 *
 * 少しでも怪しければ ok:false を返し、呼び出し側は手元のデータに一切
 * 触らない。半端に取り込むより、何もせず理由を出すほうがよい。
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('JSON として読めませんでした。書き出したファイルをそのまま選んでください。');
  }
  if (!data || typeof data !== 'object') return fail('中身が空か、想定した形式ではありません。');
  if (data.app !== APP) return fail('このツールが書き出したファイルではないようです。');
  if (typeof data.schema !== 'number') return fail('形式のバージョンが読み取れません。');
  if (data.schema > SCHEMA) {
    return fail('新しいバージョンで書き出されたファイルです。先にページを再読み込みしてください。');
  }
  if (!data.records || typeof data.records !== 'object' || Array.isArray(data.records)) {
    return fail('記録が入っていません。');
  }
  return {
    ok: true,
    records: migrateRecords(data.records),
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
  };
}

const fail = (error) => ({ ok: false, error });

/** 取り込みの結果を一行で伝えるための集計。 */
export function countChanges(local, merged) {
  let added = 0;
  let improved = 0;
  for (const [id, rec] of Object.entries(merged)) {
    const before = (local || {})[id];
    if (!before) {
      added += 1;
    } else if ([...MAX_KEYS, ...MIN_KEYS].some((k) => before[k] !== rec[k])) {
      improved += 1;
    }
  }
  return { added, improved };
}

/* ------------------------------------------------------------------ */
/* 端末 ID                                                             */
/* ------------------------------------------------------------------ */

export const DEVICE_KEY = 'cp-typing:device:v1';

const DEVICE_RE = /^dev_[0-9a-f]{8}$/;

/**
 * この端末の ID を得る。runs を端末ごとに数えるためだけに使う。
 *
 * 保存できない環境（プライベートウィンドウなど）でも ID は返す。その場合
 * 次回は別の ID になるが、記録もどのみち残らないので実害はない。
 */
export function ensureDeviceId(storage) {
  try {
    const saved = storage.getItem(DEVICE_KEY);
    if (typeof saved === 'string' && DEVICE_RE.test(saved)) return saved;
  } catch {
    /* 読めない環境では毎回作り直す */
  }
  const id = newDeviceId();
  try {
    storage.setItem(DEVICE_KEY, id);
  } catch {
    /* 保存できなくても練習は続けられる */
  }
  return id;
}

function newDeviceId() {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `dev_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
