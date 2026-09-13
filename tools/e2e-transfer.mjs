/**
 * 記録の持ち出し（段階 0）の実ブラウザ検証。
 *
 *   node e2e-transfer.mjs [url]
 *
 * 事前に http サーバと --remote-debugging-port=9222 の Chrome を上げておくこと。
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect, sleep, typeText, clickCenter } from './cdp.mjs';

const URL_ = process.argv[2] ?? 'http://localhost:8765/';
const DL_DIR = path.join(import.meta.dirname, '.downloads');

const CODE = 'n = int(input())\nprint(n * 2)';
const PROBLEM = 'io-int';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const cdp = await connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');

const consoleErrors = [];
cdp.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'error') consoleErrors.push(`${entry.text} @ ${entry.url ?? '?'}`);
});
cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  consoleErrors.push(exceptionDetails.exception?.description ?? 'exception');
});

fs.rmSync(DL_DIR, { recursive: true, force: true });
fs.mkdirSync(DL_DIR, { recursive: true });
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });

const goto = async (url) => {
  await cdp.send('Page.navigate', { url });
  await sleep(400);
  await cdp.waitFor("document.getElementById('problemSelect')?.options.length > 0", { label: 'アプリ起動' });
  await cdp.waitFor("document.getElementById('boot')?.hidden !== false", { label: 'boot 消滅' });
};

const readRecords = () => cdp.evaluate("return JSON.parse(localStorage.getItem('cp-typing:records:v1') || '{}');");
// 実際の操作と同じくマウスで押す。element.click() ではフォーカスが動かず、
// エディタを掴んだままモーダルが開いてしまい、フォーカスの検証が嘘になる。
const openSettings = async () => {
  await clickCenter(cdp, '#settingsBtn');
  await sleep(150);
};
const transferMsg = () => cdp.evaluate(`
  const el = document.getElementById('transferMsg');
  return { hidden: el.hidden, text: el.textContent, bad: el.classList.contains('bad') };
`);

/* ---------------------------------------------------------------- */
console.log(`\n=== ${URL_} ===\n`);

// --- 1. 旧形式（素の数値 runs）の移行 ---------------------------------
await goto(URL_);
// 前回の実行が残した設定・記録を引きずらないよう、毎回まっさらにする
await cdp.evaluate(`
  localStorage.clear();
  localStorage.setItem('cp-typing:records:v1', JSON.stringify({
    'io-pair': { cpm: 321, sec: 12.5, acc: 97, boost: 1.1, keys: 55, miss: 2, runs: 4 },
  }));
`);
await goto(URL_);

let rec = await readRecords();
check('旧形式の runs が legacy 端末カウンタに移行される',
  JSON.stringify(rec['io-pair']?.runs) === '{"dev_legacy":4}', JSON.stringify(rec['io-pair']?.runs));
check('移行しても他の指標は変わらない', rec['io-pair']?.cpm === 321 && rec['io-pair']?.sec === 12.5);

const deviceId = await cdp.evaluate("return localStorage.getItem('cp-typing:device:v1');");
check('端末 ID が生成される', /^dev_[0-9a-f]{8}$/.test(deviceId ?? ''), deviceId);

// 起動直後はクリックせずに打ち始められること。ここが死ぬと無言で打てなくなる。
check('起動直後にエディタへフォーカスが入っている',
  await cdp.evaluate("return !!document.activeElement?.closest('#inputHost');"));

// --- 2. 実際に 1 回走行して記録を作る -----------------------------------
await cdp.evaluate(`
  const sel = document.getElementById('problemSelect');
  document.getElementById('categorySelect').value = '*';
  document.getElementById('categorySelect').dispatchEvent(new Event('change', { bubbles: true }));
  sel.value = ${JSON.stringify(PROBLEM)};
  sel.dispatchEvent(new Event('change', { bubbles: true }));
`);
await sleep(300);
await clickCenter(cdp, '#inputHost');
await sleep(150);
await typeText(cdp, CODE);
await cdp.waitFor("document.getElementById('resultModal')?.hidden === false", { label: '完走' });

const runNote = await cdp.evaluate("return document.getElementById('resultSub').textContent;");
check('完走して結果が出る', /1 回目/.test(runNote), runNote);

rec = await readRecords();
check('走行後 runs がこの端末のカウンタに 1 入る',
  rec[PROBLEM]?.runs?.[deviceId] === 1, JSON.stringify(rec[PROBLEM]?.runs));
check('他端末（legacy）の回数は保たれる', rec['io-pair']?.runs?.dev_legacy === 4);

// もう一度走らせて、同じ端末のカウンタが積み上がることを見る
await cdp.evaluate("document.getElementById('resultRetry').click();");
await sleep(300);
await clickCenter(cdp, '#inputHost');
await sleep(150);
await typeText(cdp, CODE);
await cdp.waitFor("document.getElementById('resultModal')?.hidden === false", { label: '2 回目の完走' });

const runNote2 = await cdp.evaluate("return document.getElementById('resultSub').textContent;");
check('2 回目は「2 回目」と表示される', /2 回目/.test(runNote2), runNote2);

rec = await readRecords();
check('2 回走るとこの端末のカウンタが 2 になる',
  rec[PROBLEM]?.runs?.[deviceId] === 2, JSON.stringify(rec[PROBLEM]?.runs));
check('2 回走っても他端末の回数は増えない', rec['io-pair']?.runs?.dev_legacy === 4);

await cdp.evaluate("document.getElementById('resultModal').hidden = true;");

// --- 3. 書き出し -------------------------------------------------------
await openSettings();
await cdp.evaluate("document.getElementById('exportBtn').click();");
await sleep(700);

const files = fs.readdirSync(DL_DIR).filter((f) => f.endsWith('.json'));
check('書き出しでファイルが落ちる', files.length === 1, files.join(','));
if (files.length !== 1) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
const exportText = fs.readFileSync(path.join(DL_DIR, files[0]), 'utf8');
const exported = JSON.parse(exportText);
check('ファイル名が cp-typing-YYYYMMDD.json', /^cp-typing-\d{8}\.json$/.test(files[0]), files[0]);
check('書き出しの app / schema が正しい', exported.app === 'cp-typing' && exported.schema === 1);
check('書き出しに 2 課題の記録が入る', Object.keys(exported.records).length === 2, Object.keys(exported.records).join(','));
check('書き出しに設定が入る', typeof exported.settings?.font === 'number');

let msg = await transferMsg();
check('書き出し後にメッセージが出る', !msg.hidden && !msg.bad && /2 課題/.test(msg.text), msg.text);

// --- 4. 記録を消してから読み込むと復元される ------------------------------
const importFile = async (text, name = 'restore.json') => {
  await cdp.evaluate(`
    const input = document.getElementById('importFile');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await sleep(400);
};

await cdp.evaluate("localStorage.removeItem('cp-typing:records:v1');");
await goto(URL_);
rec = await readRecords();
check('記録を消せている', Object.keys(rec).length === 0, JSON.stringify(rec));

await openSettings();
await importFile(exportText);
rec = await readRecords();
check('読み込みで 2 課題とも復元される', Object.keys(rec).length === 2, Object.keys(rec).join(','));
check('復元した記録の値が一致する', rec[PROBLEM]?.cpm === exported.records[PROBLEM].cpm);
check('復元した runs が端末ごとに保たれる',
  rec[PROBLEM]?.runs?.[deviceId] === 2 && rec['io-pair']?.runs?.dev_legacy === 4,
  JSON.stringify({ [PROBLEM]: rec[PROBLEM]?.runs, 'io-pair': rec['io-pair']?.runs }));

msg = await transferMsg();
check('読み込み結果が「新規 2」と出る', !msg.bad && /新規 2/.test(msg.text), msg.text);

// --- 5. 同じファイルを二度読んでも増えない（冪等） -------------------------
const before = JSON.stringify(await readRecords());
await importFile(exportText);
const after = JSON.stringify(await readRecords());
check('同じファイルを二度読んでも記録が変わらない', before === after);

msg = await transferMsg();
check('二度目は「変わった課題はありません」と出る', !msg.bad && /変わった課題はありません/.test(msg.text), msg.text);

// --- 6. 壊れたファイルは既存データを壊さない -------------------------------
for (const [label, text, pattern] of [
  ['壊れた JSON', '{ not json', /JSON/],
  ['別アプリのファイル', JSON.stringify({ app: 'other', schema: 1, records: {} }), /このツール/],
  ['新しい schema', JSON.stringify({ app: 'cp-typing', schema: 99, records: {} }), /新しい/],
]) {
  await importFile(text, 'broken.json');
  msg = await transferMsg();
  check(`${label} はエラー表示になる`, msg.bad && pattern.test(msg.text), msg.text);
  check(`${label} でも既存の記録は無傷`, JSON.stringify(await readRecords()) === after);
}

// --- 7. 設定の取り込みは既定では起きない ----------------------------------
const foreign = JSON.parse(exportText);
foreign.settings.font = 22;
foreign.settings.mode = 'accuracy';

// 設定は変更されるまで localStorage に書かれないので、実効値は画面から見る。
await cdp.evaluate("document.getElementById('optImportSettings').checked = false;");
await importFile(JSON.stringify(foreign));
const fontBefore = await cdp.evaluate("return document.getElementById('optFont').value;");
check('チェックを外していれば設定は取り込まれない', fontBefore !== '22', fontBefore);

await cdp.evaluate("document.getElementById('optImportSettings').checked = true;");
await importFile(JSON.stringify(foreign));
const st = await cdp.evaluate("return JSON.parse(localStorage.getItem('cp-typing:settings:v1') || 'null');");
check('チェックを入れれば設定が保存される', st?.font === 22 && st?.mode === 'accuracy', JSON.stringify(st));
const formFont = await cdp.evaluate("return document.getElementById('optFont').value;");
const formMode = await cdp.evaluate("return document.getElementById('modeSelect').value;");
check('取り込んだ設定が画面にも反映される', formFont === '22' && formMode === 'accuracy', `${formFont} / ${formMode}`);

// モード変更で restart() が走るが、モーダルが開いているうちに裏のエディタへ
// フォーカスが移ると、見えないまま計測が始まってしまう。
const focusInfo = await cdp.evaluate(`
  return {
    modalOpen: document.getElementById('settingsModal').hidden === false,
    inEditor: !!document.activeElement?.closest('#inputHost'),
    active: document.activeElement?.id || document.activeElement?.tagName,
  };
`);
check('設定取り込み後もフォーカスがモーダルの裏に落ちない',
  focusInfo.modalOpen && !focusInfo.inEditor, JSON.stringify(focusInfo));

// --- 8. コンソールが綺麗 --------------------------------------------------
check('コンソールエラーが無い', consoleErrors.length === 0, consoleErrors.join(' | '));

console.log(`\n${failures === 0 ? 'すべて PASS' : `${failures} 件失敗`}`);
cdp.close();
process.exit(failures === 0 ? 0 : 1);
