import test from 'node:test';
import assert from 'node:assert/strict';

import {
  totalRuns, migrateRecords, mergeRecords, countChanges,
  buildExport, parseImport, ensureDeviceId, SCHEMA, LEGACY_DEVICE, DEVICE_KEY,
} from '../src/records.js';

/* ------------------------------------------------------------------ */
/* runs の表現                                                          */
/* ------------------------------------------------------------------ */

test('totalRuns は端末ごとの回数を合計する', () => {
  assert.equal(totalRuns({ runs: { dev_a: 12, dev_b: 7 } }), 19);
});

test('totalRuns は runs を持たない記録では 0 を返す', () => {
  assert.equal(totalRuns({ cpm: 400 }), 0);
  assert.equal(totalRuns(undefined), 0);
});

test('migrateRecords は数値の runs を legacy 端末の counter に変える', () => {
  const migrated = migrateRecords({ 'io-1': { cpm: 400, runs: 5 } });
  assert.deepEqual(migrated['io-1'].runs, { [LEGACY_DEVICE]: 5 });
});

test('migrateRecords は数値以外の値を書き換えない', () => {
  const migrated = migrateRecords({ 'io-1': { cpm: 400, sec: 18.2, runs: 5 } });
  assert.equal(migrated['io-1'].cpm, 400);
  assert.equal(migrated['io-1'].sec, 18.2);
});

test('migrateRecords は移行済みの記録をそのまま通す（冪等）', () => {
  const already = { 'io-1': { cpm: 400, runs: { dev_a: 3 } } };
  assert.deepEqual(migrateRecords(migrateRecords(already)), already);
});

test('migrateRecords は runs を持たない記録に空の counter を補う', () => {
  const migrated = migrateRecords({ 'io-1': { cpm: 400 } });
  assert.deepEqual(migrated['io-1'].runs, {});
});

test('migrateRecords は元のオブジェクトを破壊しない', () => {
  const original = { 'io-1': { cpm: 400, runs: 5 } };
  migrateRecords(original);
  assert.equal(original['io-1'].runs, 5);
});

/* ------------------------------------------------------------------ */
/* マージ規則                                                           */
/* ------------------------------------------------------------------ */

const REC_A = { cpm: 400, sec: 20, acc: 98, boost: 1.2, keys: 130, miss: 3, runs: { dev_a: 12 } };
const REC_B = { cpm: 380, sec: 18, acc: 99, boost: 1.5, keys: 120, miss: 1, runs: { dev_b: 7 } };

test('mergeRecords は cpm / acc / boost を max で取る', () => {
  const m = mergeRecords({ p: REC_A }, { p: REC_B }).p;
  assert.equal(m.cpm, 400);
  assert.equal(m.acc, 99);
  assert.equal(m.boost, 1.5);
});

test('mergeRecords は sec / keys / miss を min で取る', () => {
  const m = mergeRecords({ p: REC_A }, { p: REC_B }).p;
  assert.equal(m.sec, 18);
  assert.equal(m.keys, 120);
  assert.equal(m.miss, 1);
});

test('mergeRecords は runs を端末ごとに max で取る', () => {
  const local = { p: { runs: { dev_a: 12, dev_b: 3 } } };
  const incoming = { p: { runs: { dev_b: 7, dev_c: 5 } } };
  assert.deepEqual(mergeRecords(local, incoming).p.runs, { dev_a: 12, dev_b: 7, dev_c: 5 });
});

test('mergeRecords は課題 ID の和集合を返す', () => {
  const m = mergeRecords({ only_local: REC_A }, { only_incoming: REC_B });
  assert.deepEqual(Object.keys(m).sort(), ['only_incoming', 'only_local']);
});

test('mergeRecords は片方にしかない指標を残す', () => {
  const m = mergeRecords({ p: { cpm: 400, sec: 20 } }, { p: { cpm: 380 } }).p;
  assert.equal(m.sec, 20);
  assert.equal(m.cpm, 400);
});

test('mergeRecords は両方にない指標を生やさない', () => {
  const m = mergeRecords({ p: { cpm: 400 } }, { p: { cpm: 380 } }).p;
  assert.equal('sec' in m, false);
});

test('mergeRecords は冪等（同じものを二度取り込んでも変わらない）', () => {
  const once = mergeRecords({ p: REC_A }, { p: REC_B });
  const twice = mergeRecords(once, { p: REC_B });
  assert.deepEqual(twice, once);
});

test('mergeRecords は可換（取り込む順に依らない）', () => {
  assert.deepEqual(mergeRecords({ p: REC_A }, { p: REC_B }), mergeRecords({ p: REC_B }, { p: REC_A }));
});

test('mergeRecords は素の数値の runs も端末カウンタとして扱う', () => {
  const m = mergeRecords({ p: { runs: 5 } }, { p: { runs: { dev_b: 7 } } }).p;
  assert.deepEqual(m.runs, { [LEGACY_DEVICE]: 5, dev_b: 7 });
});

test('mergeRecords は手元の記録を破壊しない', () => {
  const local = { p: { cpm: 400, runs: { dev_a: 12 } } };
  mergeRecords(local, { p: REC_B });
  assert.deepEqual(local, { p: { cpm: 400, runs: { dev_a: 12 } } });
});

/* ------------------------------------------------------------------ */
/* 書き出し / 読み込み                                                  */
/* ------------------------------------------------------------------ */

test('buildExport は app / schema / exportedAt を付ける', () => {
  const out = buildExport({ records: {}, settings: {} });
  assert.equal(out.app, 'cp-typing');
  assert.equal(out.schema, SCHEMA);
  assert.match(out.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildExport は記録と設定をそのまま載せる', () => {
  const out = buildExport({ records: { p: REC_A }, settings: { font: 15 } });
  assert.equal(out.records.p.cpm, 400);
  assert.deepEqual(out.settings, { font: 15 });
});

test('buildExport は素の数値の runs を端末カウンタに直してから書き出す', () => {
  const out = buildExport({ records: { p: { cpm: 400, runs: 5 } }, settings: {} });
  assert.deepEqual(out.records.p.runs, { [LEGACY_DEVICE]: 5 });
});

test('parseImport は buildExport の出力を読み戻せる', () => {
  const text = JSON.stringify(buildExport({ records: { p: REC_A }, settings: { font: 15 } }));
  const res = parseImport(text);
  assert.equal(res.ok, true);
  assert.equal(res.records.p.cpm, 400);
  assert.deepEqual(res.settings, { font: 15 });
});

test('parseImport は壊れた JSON を退ける', () => {
  const res = parseImport('{ not json');
  assert.equal(res.ok, false);
  assert.match(res.error, /JSON/);
});

test('parseImport は別アプリのファイルを退ける', () => {
  const res = parseImport(JSON.stringify({ app: 'something-else', schema: 1, records: {} }));
  assert.equal(res.ok, false);
});

test('parseImport は未知の新しい schema を退ける', () => {
  const res = parseImport(JSON.stringify({ app: 'cp-typing', schema: SCHEMA + 1, records: {} }));
  assert.equal(res.ok, false);
  assert.match(res.error, /新しい/);
});

test('parseImport は records がオブジェクトでないファイルを退ける', () => {
  const res = parseImport(JSON.stringify({ app: 'cp-typing', schema: SCHEMA, records: 'nope' }));
  assert.equal(res.ok, false);
});

test('parseImport は settings が無くても成功し、空の設定を返す', () => {
  const res = parseImport(JSON.stringify({ app: 'cp-typing', schema: SCHEMA, records: {} }));
  assert.equal(res.ok, true);
  assert.deepEqual(res.settings, {});
});

test('countChanges は新しく増えた課題の数を数える', () => {
  const local = { p: REC_A };
  const merged = mergeRecords(local, { q: REC_B });
  assert.equal(countChanges(local, merged).added, 1);
});

test('countChanges は自己ベストが更新された課題の数を数える', () => {
  const local = { p: REC_A };
  const merged = mergeRecords(local, { p: REC_B });
  assert.equal(countChanges(local, merged).improved, 1);
});

test('countChanges は何も良くならなかった取り込みを 0 と数える', () => {
  const local = { p: REC_A };
  const merged = mergeRecords(local, { p: REC_A });
  assert.deepEqual(countChanges(local, merged), { added: 0, improved: 0 });
});

/* ------------------------------------------------------------------ */
/* 端末 ID                                                             */
/* ------------------------------------------------------------------ */

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    size: () => map.size,
  };
};

test('ensureDeviceId は保存済みの ID をそのまま返す', () => {
  const s = fakeStorage();
  s.setItem(DEVICE_KEY, 'dev_deadbeef');
  assert.equal(ensureDeviceId(s), 'dev_deadbeef');
});

test('ensureDeviceId は未保存なら生成して保存する', () => {
  const s = fakeStorage();
  const id = ensureDeviceId(s);
  assert.equal(s.getItem(DEVICE_KEY), id);
});

test('ensureDeviceId が生成する ID は dev_ + 16 進 8 桁', () => {
  assert.match(ensureDeviceId(fakeStorage()), /^dev_[0-9a-f]{8}$/);
});

test('ensureDeviceId は同じ端末では同じ ID を返し続ける', () => {
  const s = fakeStorage();
  assert.equal(ensureDeviceId(s), ensureDeviceId(s));
});

test('ensureDeviceId は端末ごとに違う ID を作る', () => {
  assert.notEqual(ensureDeviceId(fakeStorage()), ensureDeviceId(fakeStorage()));
});

test('ensureDeviceId は保存できない環境でも使える ID を返す', () => {
  const broken = {
    getItem() { throw new Error('private window'); },
    setItem() { throw new Error('private window'); },
  };
  assert.match(ensureDeviceId(broken), /^dev_[0-9a-f]{8}$/);
});
