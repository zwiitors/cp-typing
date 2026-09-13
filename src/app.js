import { PROBLEMS, CATEGORIES, problemById, normalizeCode, CUSTOM_ID } from './problems.js';
import { configurePython, registerPythonCompletion } from './python-assist.js';
import {
  ensureDeviceId, migrateRecords, totalRuns,
  mergeRecords, countChanges, buildExport, parseImport,
} from './records.js';

const MONACO_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min';
const FONT_STACK = '"Cascadia Code", Consolas, "SFMono-Regular", Menlo, "BIZ UDGothic", monospace';
const SETTINGS_KEY = 'cp-typing:settings:v1';
const RECORDS_KEY = 'cp-typing:records:v1';
const LAST_KEY = 'cp-typing:last:v1';

const DEFAULT_SETTINGS = {
  mode: 'speed',
  suggest: true,
  quickSuggest: true,
  // VS Code の既定は on だが、候補が開いたまま Enter を押すと改行が入らず
  // 以降の行がまるごとずれる。練習用途では事故が大きいので既定は off。
  acceptEnter: false,
  snippet: true,
  brackets: true,
  indent: true,
  minimap: false,
  font: 15,
};

const $ = (id) => document.getElementById(id);

const MODAL_IDS = ['settingsModal', 'customModal', 'resultModal'];
const anyModalOpen = () => MODAL_IDS.some((id) => $(id) && !$(id).hidden);

/* ------------------------------------------------------------------ */
/* 永続化                                                              */
/* ------------------------------------------------------------------ */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* プライベートウィンドウなどでは保存できないが、練習自体は続けられる */
  }
}

let settings = readJSON(SETTINGS_KEY, DEFAULT_SETTINGS);
// runs は端末ごとカウンタ。古い形式（素の数値）は読み込み時に直して置き換える。
let records = migrateRecords(readJSON(RECORDS_KEY, {}));
writeJSON(RECORDS_KEY, records);

const deviceId = ensureDeviceId(localStorage);

/* ------------------------------------------------------------------ */
/* 判定ロジック                                                        */
/* ------------------------------------------------------------------ */

/** 共通接頭辞の長さ。これを「正しく打てた文字数」とみなす。 */
function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

// 自動で挿入された閉じ括弧・クォート・インデントは「まだ打っていないだけ」なので
// 誤字とは数えない。それ以外の文字が接頭辞の先にあるときだけ間違いとみなす。
const AUTO_TAIL = /[^\s)\]}'"]/;

function hasTypo(buffer, prefixLen) {
  return AUTO_TAIL.test(buffer.slice(prefixLen));
}

// 行末に残った空白は画面にも実行結果にも現れないので、不一致として扱わない。
// 空行に自動インデントが残るのが典型例（お手本の空行は 0 文字なのに、
// エディタは直前のブロックに合わせた字下げを入れてくる）。
// ただし入力中の最終行だけは、これから文字が続くのでそのまま残す。
// そうしないと、手で字下げしている最中に進捗が止まって見える。
function trimLineEnds(text) {
  return text.replace(/[ \t]+(?=\n)/g, '');
}

/* ------------------------------------------------------------------ */
/* 状態                                                                */
/* ------------------------------------------------------------------ */

const state = {
  problem: null,
  target: '',
  buffer: '',       // 行末空白を落とした入力内容。判定はすべてこれを見る
  prefix: 0,
  bufLen: 0,
  keystrokes: 0,
  mistakes: 0,
  startedAt: 0,
  finishedAt: 0,
  running: false,
  done: false,
  customCode: '',
};

let monaco = null;
let inputEditor = null;
let targetEditor = null;
let decorations = null;
let tickTimer = 0;

/* ------------------------------------------------------------------ */
/* 起動                                                                */
/* ------------------------------------------------------------------ */

// CDN から読むので worker は同一オリジンの blob 経由で起動する。
// data: URL だと Chrome が Worker の生成を拒否し、worker 依存の機能
// （単語ベース補完 = textualSuggest）が無言で死ぬ。
window.MonacoEnvironment = {
  getWorker() {
    const src =
      `self.MonacoEnvironment = { baseUrl: '${MONACO_BASE}/' };\n` +
      `importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url, { name: 'monaco-editor-worker' });
    worker.addEventListener('error', (e) => console.error('monaco worker failed', e.message));
    return worker;
  },
};

window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
window.require(
  ['vs/editor/editor.main'],
  () => boot(window.monaco),
  (err) => {
    console.error(err);
    $('boot').innerHTML =
      '<div class="boot-inner"><p>エディタの読み込みに失敗しました。<br>' +
      'ネットワーク接続を確認してページを再読み込みしてください。</p></div>';
  },
);

function boot(m) {
  monaco = m;
  configurePython(monaco);
  registerPythonCompletion(monaco, () => settings);

  targetEditor = monaco.editor.create($('targetHost'), {
    ...baseOptions(),
    value: '',
    language: 'python',
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    renderLineHighlight: 'none',
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    matchBrackets: 'never',
    folding: false,
    lineNumbersMinChars: 3,
  });
  decorations = targetEditor.createDecorationsCollection([]);

  inputEditor = monaco.editor.create($('inputHost'), {
    ...baseOptions(),
    ...assistOptions(),
    value: '',
    language: 'python',
    lineNumbersMinChars: 3,
  });

  inputEditor.onDidChangeModelContent(onInputChanged);
  inputEditor.addAction({
    id: 'cp-typing.restart',
    label: 'やり直す',
    // Esc は補完候補を閉じるキーなので、やり直しには割り当てない。
    // 候補を消したつもりで進捗が吹き飛ぶ事故が起きる。
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyR],
    run: () => restart(),
  });

  // タイピング練習なので貼り付けとドロップは封じる。
  const host = $('inputHost');
  for (const type of ['paste', 'drop']) {
    host.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      flashHint('貼り付けは使えません。打って覚えましょう。', true);
    }, true);
  }
  host.addEventListener('keydown', onKeyDown, true);

  buildSelectors();
  wireUI();
  applySettingsToForm();

  const last = readJSON(LAST_KEY, { id: '' });
  const start = problemById(last.id) || PROBLEMS[0];
  $('categorySelect').value = start.category;
  refreshProblemOptions();
  $('problemSelect').value = start.id;
  loadProblem(start);

  $('boot').classList.add('gone');
  setTimeout(() => $('boot').remove(), 300);
}

/* ------------------------------------------------------------------ */
/* エディタ設定                                                        */
/* ------------------------------------------------------------------ */

function baseOptions() {
  return {
    theme: 'vs-dark',
    fontFamily: FONT_STACK,
    fontSize: settings.font,
    fontLigatures: false,
    tabSize: 4,
    insertSpaces: true,
    detectIndentation: false,
    // VS Code の既定。自動で入った字下げだけを、その行から離れるときに消す。
    // 空行に字下げが残るのを発生源で減らせる（判定側でも吸収している）。
    trimAutoWhitespace: true,
    automaticLayout: true,
    minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    guides: { indentation: true },
    smoothScrolling: true,
    contextmenu: false,
    fixedOverflowWidgets: true,
    padding: { top: 10, bottom: 10 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  };
}

/** 入力補助まわり。設定トグルで差し替えるのはここだけ。 */
function assistOptions() {
  const pairs = settings.brackets ? 'languageDefined' : 'never';
  return {
    autoClosingBrackets: pairs,
    autoClosingQuotes: pairs,
    autoSurround: pairs,
    autoClosingDelete: settings.brackets ? 'auto' : 'never',
    autoClosingOvertype: 'auto',
    autoIndent: settings.indent ? 'full' : 'none',
    quickSuggestions:
      settings.suggest && settings.quickSuggest
        ? { other: true, comments: false, strings: false }
        : false,
    quickSuggestionsDelay: 10,
    suggestOnTriggerCharacters: settings.suggest,
    wordBasedSuggestions: settings.suggest ? 'currentDocument' : 'off',
    snippetSuggestions: settings.snippet ? 'inline' : 'none',
    acceptSuggestionOnEnter: settings.acceptEnter ? 'on' : 'off',
    tabCompletion: 'on',
    suggestSelection: 'first',
    parameterHints: { enabled: settings.suggest },
    dragAndDrop: false,
    links: false,
    occurrencesHighlight: 'off',
    renderLineHighlight: 'all',
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
  };
}

function applyEditorSettings() {
  const common = { fontSize: settings.font, minimap: { enabled: settings.minimap } };
  inputEditor.updateOptions({ ...common, ...assistOptions() });
  targetEditor.updateOptions({ ...common, minimap: { enabled: false } });
  updateAssistMeta();
}

function updateAssistMeta() {
  const on = [];
  if (settings.suggest) on.push(settings.quickSuggest ? '補完(自動)' : '補完(Ctrl+Space)');
  if (settings.snippet) on.push('スニペット');
  if (settings.brackets) on.push('自動括弧');
  if (settings.indent) on.push('自動インデント');
  $('assistMeta').textContent = on.length ? on.join(' ・ ') : '補助なし（純粋打鍵モード）';
}

/* ------------------------------------------------------------------ */
/* 課題の読み込み                                                      */
/* ------------------------------------------------------------------ */

function loadProblem(problem) {
  state.problem = problem;
  state.target = problem.code;

  decorations.clear();
  const oldTarget = targetEditor.getModel();
  const targetModel = monaco.editor.createModel(problem.code, 'python');
  targetModel.setEOL(monaco.editor.EndOfLineSequence.LF);
  targetEditor.setModel(targetModel);
  if (oldTarget) oldTarget.dispose();

  $('problemMeta').textContent =
    `${problem.title} ・ ${problem.tags} ・ ${problem.lines} 行 / ${problem.chars} 文字`;

  if (problem.id !== CUSTOM_ID) writeJSON(LAST_KEY, { id: problem.id });

  restart();
}

function restart() {
  const oldInput = inputEditor.getModel();
  const model = monaco.editor.createModel('', 'python');
  model.setEOL(monaco.editor.EndOfLineSequence.LF);
  inputEditor.setModel(model);
  if (oldInput) oldInput.dispose();

  inputEditor.updateOptions({ readOnly: false });
  $('panes').querySelector('.pane-input').classList.remove('done');
  $('resultModal').hidden = true;

  state.buffer = '';
  state.prefix = 0;
  state.bufLen = 0;
  state.keystrokes = 0;
  state.mistakes = 0;
  state.startedAt = 0;
  state.finishedAt = 0;
  state.running = false;
  state.done = false;

  stopTick();
  paintProgress();
  renderStats(0);
  // モーダルが開いているあいだは裏のエディタを掴まない。掴むと、見えない
  // ところで打鍵が拾われて計測が始まってしまう。閉じるときに focus される。
  if (!anyModalOpen()) inputEditor.focus();
}

/* ------------------------------------------------------------------ */
/* 入力イベント                                                        */
/* ------------------------------------------------------------------ */

const MODIFIER_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock',
  'ScrollLock', 'ContextMenu', 'Dead', 'Process', 'Unidentified',
]);

function onKeyDown(e) {
  if (state.done || MODIFIER_KEYS.has(e.key)) return;
  if (e.key === 'Escape') return;
  state.keystrokes++;
  if (!state.running) {
    state.running = true;
    state.startedAt = performance.now();
    startTick();
  }
}

function onInputChanged() {
  if (state.done) return;

  const buffer = trimLineEnds(inputEditor.getValue());
  const prevPrefix = state.prefix;
  const prevLen = state.bufLen;

  state.buffer = buffer;
  state.prefix = commonPrefix(buffer, state.target);
  state.bufLen = buffer.length;

  if (state.running) {
    if (state.prefix < prevPrefix) {
      state.mistakes++;                               // 正しく打てていた部分を壊した
    } else if (state.prefix === prevPrefix && buffer.length > prevLen && hasTypo(buffer, state.prefix)) {
      state.mistakes++;                               // 進まない文字を打ち込んだ
    }
  }

  paintProgress();
  renderStats(elapsedSeconds());

  if (buffer.replace(/\s+$/, '') === state.target) finish();
}

function elapsedSeconds() {
  if (!state.startedAt) return 0;
  const end = state.finishedAt || performance.now();
  return (end - state.startedAt) / 1000;
}

function startTick() {
  stopTick();
  tickTimer = setInterval(() => renderStats(elapsedSeconds()), 100);
}

function stopTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = 0;
}

/* ------------------------------------------------------------------ */
/* 表示                                                                */
/* ------------------------------------------------------------------ */

function paintProgress() {
  const model = targetEditor.getModel();
  if (!model) return;

  const total = state.target.length;
  const done = Math.min(state.prefix, total);
  const buffer = state.buffer;
  const typo = hasTypo(buffer, state.prefix);

  const list = [];
  if (done > 0) {
    list.push({
      range: monaco.Range.fromPositions(model.getPositionAt(0), model.getPositionAt(done)),
      options: { className: 'tt-typed', isWholeLine: false },
    });
  }

  const caret = model.getPositionAt(Math.min(done, total));
  list.push({
    range: new monaco.Range(caret.lineNumber, 1, caret.lineNumber, 1),
    options: { className: 'tt-line', isWholeLine: true },
  });

  if (done < total && state.target[done] !== '\n') {
    const next = model.getPositionAt(done + 1);
    list.push({
      range: monaco.Range.fromPositions(caret, next),
      options: { className: typo ? 'tt-caret-bad' : 'tt-caret', isWholeLine: false },
    });
  }

  decorations.set(list);
  targetEditor.revealLineInCenterIfOutsideViewport(caret.lineNumber, 0);

  $('progressBar').style.width = total ? `${(done / total) * 100}%` : '0%';
  $('statProgressLabel').textContent = `${done} / ${total} 文字`;

  if (state.done) {
    flashHint('');
  } else if (done === total) {
    flashHint('余分な文字が残っています。閉じ括弧などを消してください。', true);
  } else if (typo) {
    flashHint('ここが違います。Backspace で戻してください。', true);
  } else if (buffer.length > done) {
    flashHint('インデントが余分です。Backspace / Shift+Tab で戻せます。');
  } else {
    flashHint('');
  }
}

function flashHint(text, bad = false) {
  const el = $('statHint');
  el.textContent = text;
  el.classList.toggle('bad', bad && !!text);
}

// 主評価はモードごとに 1 つだけ。残りは参考値として小さく添える。
// 速度モードでは補完を使ったか手で打ったかを問わない ―― 同じコードが同じ時間で
// 出せるなら手段はどちらでもよく、評価すべきはコードが画面に出る速さだから。
// 「補完を使いこなす」「打ち直しを減らす」は別の目的なので専用モードに分けてある。
const MODES = {
  speed: {
    name: '速度',
    hero: 'speed',
    sub: ['acc'],
    ref: ['keys', 'boost', 'raw'],
    best: (r) => (r.cpm > 0 ? `${Math.round(r.cpm)} cpm` : null),
  },
  assist: {
    name: '補完',
    hero: 'keys',
    sub: ['boost'],
    ref: ['speed', 'acc'],
    best: (r) => (Number.isFinite(r.keys) ? `${r.keys} 打鍵` : null),
  },
  accuracy: {
    name: '正確性',
    hero: 'acc',
    sub: ['miss'],
    ref: ['speed', 'keys'],
    best: (r) => (Number.isFinite(r.miss) ? `ミス ${r.miss}` : null),
  },
};

const currentMode = () => MODES[settings.mode] || MODES.speed;

/** 主指標・補助指標・参考値の並びと強調をモードに合わせて切り替える。 */
function applyMode() {
  const m = currentMode();
  const main = ['time', m.hero, ...m.sub];
  for (const el of document.querySelectorAll('.statbar [data-metric]')) {
    const k = el.dataset.metric;
    const i = main.indexOf(k);
    const r = m.ref.indexOf(k);
    el.hidden = i < 0 && r < 0;
    el.classList.toggle('stat-hero', k === m.hero);
    el.classList.toggle('stat-ref', r >= 0);
    el.style.order = i >= 0 ? i : 10 + r;
  }
  $('statSep').hidden = m.ref.length === 0;
  refreshProblemOptions();
}

function renderStats(sec) {
  const cpm = sec > 0 ? (state.prefix / sec) * 60 : 0;
  const raw = sec > 0 ? (state.keystrokes / sec) * 60 : 0;
  const boost = state.keystrokes > 0 ? state.prefix / state.keystrokes : 0;

  $('statTime').textContent = sec.toFixed(1);
  $('statCpm').textContent = Math.round(cpm);
  $('statRaw').textContent = Math.round(raw);
  $('statBoost').textContent = boost.toFixed(2);
  $('statAcc').textContent = Math.round(accuracy());
  $('statKeys').textContent = state.keystrokes;
  $('statMiss').textContent = state.mistakes;
}

function accuracy() {
  if (state.keystrokes === 0) return 100;
  return Math.max(0, Math.min(100, (1 - state.mistakes / state.keystrokes) * 100));
}

/* ------------------------------------------------------------------ */
/* 完了処理                                                            */
/* ------------------------------------------------------------------ */

function finish() {
  state.done = true;
  state.finishedAt = performance.now();
  stopTick();

  const sec = elapsedSeconds();
  const result = {
    sec,
    chars: state.target.length,
    keys: state.keystrokes,
    miss: state.mistakes,
    acc: accuracy(),
    cpm: sec > 0 ? (state.target.length / sec) * 60 : 0,
    boost: state.keystrokes > 0 ? state.target.length / state.keystrokes : 0,
  };

  inputEditor.updateOptions({ readOnly: true });
  $('panes').querySelector('.pane-input').classList.add('done');
  state.prefix = state.target.length;
  paintProgress();
  renderStats(sec);

  showResult(result, saveRecord(result));
}

// 全指標の自己ベストをまとめて持つ。どれを主役として見せるかはモードが決める。
function saveRecord(r) {
  const id = state.problem.id;
  if (id === CUSTOM_ID) return null;

  const old = records[id] || {};
  const prev = {
    cpm: old.cpm ?? 0,
    sec: old.sec ?? Infinity,
    acc: old.acc ?? 0,
    boost: old.boost ?? 0,
    keys: old.keys ?? Infinity,
    miss: old.miss ?? Infinity,
    runs: totalRuns(old),
  };
  const improved = {
    cpm: r.cpm > prev.cpm,
    sec: r.sec < prev.sec,
    acc: r.acc > prev.acc,
    boost: r.boost > prev.boost,
    keys: r.keys < prev.keys,
    miss: r.miss < prev.miss,
  };

  records[id] = {
    cpm: Math.max(prev.cpm, r.cpm),
    sec: Math.min(prev.sec, r.sec),
    acc: Math.max(prev.acc, r.acc),
    boost: Math.max(prev.boost, r.boost),
    keys: Math.min(prev.keys, r.keys),
    miss: Math.min(prev.miss, r.miss),
    // 回数だけはこの端末の分を増やす。他の端末の分はそのまま持ち越す。
    runs: { ...(old.runs || {}), [deviceId]: ((old.runs || {})[deviceId] ?? 0) + 1 },
  };
  writeJSON(RECORDS_KEY, records);
  return { prev, improved, runs: totalRuns(records[id]) };
}

const CARDS = {
  speed: (r) => ['速度 (cpm)', Math.round(r.cpm)],
  time: (r) => ['タイム (秒)', r.sec.toFixed(1)],
  acc: (r) => ['正確度 (%)', Math.round(r.acc)],
  keys: (r) => ['打鍵数', r.keys],
  miss: (r) => ['ミス (回)', r.miss],
  boost: (r) => ['補完効率 (×)', r.boost.toFixed(2)],
  raw: (r) => ['生打鍵 (cpm)', r.sec > 0 ? Math.round((r.keys / r.sec) * 60) : 0],
};

const BESTS = {
  speed: (b) => [b.improved.cpm, b.prev.cpm, (v) => `${Math.round(v)} cpm`],
  time: (b) => [b.improved.sec, b.prev.sec, (v) => `${v.toFixed(1)} 秒`],
  acc: (b) => [b.improved.acc, b.prev.acc, (v) => `${Math.round(v)} %`],
  keys: (b) => [b.improved.keys, b.prev.keys, (v) => `${v} 打鍵`],
  miss: (b) => [b.improved.miss, b.prev.miss, (v) => `${v} 回`],
  boost: (b) => [b.improved.boost, b.prev.boost, (v) => `${v.toFixed(2)} ×`],
};

function bestNote(metric, best) {
  if (!best || !BESTS[metric]) return '';
  const [up, prev, fmt] = BESTS[metric](best);
  if (best.runs === 1 || !Number.isFinite(prev)) return '初回記録';
  return up ? `自己ベスト更新 (前 ${fmt(prev)})` : `自己ベスト ${fmt(prev)}`;
}

function showResult(r, best) {
  const m = currentMode();
  $('resultTitle').textContent = state.problem.title;
  $('resultSub').textContent =
    `${m.name}モード ・ ${r.chars} 文字 / ${r.keys} 打鍵 / ${r.sec.toFixed(1)} 秒` +
    (best ? ` ・ ${best.runs} 回目` : ' ・ 記録は保存されません');

  const metrics = [m.hero, 'time', ...m.sub, ...m.ref].filter((k, i, a) => a.indexOf(k) === i);
  const grid = $('resultGrid');
  grid.replaceChildren();

  metrics.forEach((metric, i) => {
    const [key, value] = CARDS[metric](r);
    const isRef = m.ref.includes(metric);
    const card = document.createElement('div');
    card.className = 'rstat' + (i === 0 ? ' rstat-hero' : isRef ? ' rstat-ref' : '');
    // 自己ベストは主評価まわりだけに出す。参考値に併記すると何を見ればいいのか散る。
    for (const [cls, text] of [['rstat-val', value], ['rstat-key', key], ['rstat-note', isRef ? '' : bestNote(metric, best)]]) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      card.appendChild(span);
    }
    grid.appendChild(card);
  });

  $('resultComment').textContent = advise(r, settings.mode);
  $('resultModal').hidden = false;
  $('resultRetry').focus();
}

function advise(r, mode) {
  if (mode === 'accuracy') {
    if (r.miss === 0) return 'ノーミスです。この精度を保ったまま、速度モードで少しずつ上げていきましょう。';
    if (r.acc < 90) {
      return `ミス ${r.miss} 回。打ち直しの時間そのものより、本番で気づかずに提出してしまう方が高くつきます。速度を捨ててでも、まずノーミスを 1 回作りましょう。`;
    }
    return `ミス ${r.miss} 回。あと少しでノーミスです。詰まりやすい記号（[ ] : , _ ）を意識してみてください。`;
  }

  if (mode === 'assist') {
    if (r.boost < 1.2) {
      return `${r.chars} 文字を ${r.keys} 打鍵。ほぼ手打ちです。3〜4 文字打って Tab、長い変数名は一度書けば呼び戻せます。スニペット（li / nm / fr / uf など）も試してください。`;
    }
    if (r.boost < 1.8) {
      return `${r.chars} 文字を ${r.keys} 打鍵（${r.boost.toFixed(2)} 倍）。効き始めています。同じ課題をもう一度、今度は打鍵数だけを見て縮めてみましょう。`;
    }
    return `${r.chars} 文字を ${r.keys} 打鍵（${r.boost.toFixed(2)} 倍）。かなり削れています。この課題は十分でしょう。`;
  }

  // 速度モード。補完を使えという話はしない ―― 速ければ手段は問わない。
  if (r.acc < 85) {
    return '打ち直しに時間を取られています。正確性モードで一度ノーミスを作ってから戻ると、速度はそのまま上がります。';
  }
  if (r.cpm >= 400) {
    return '十分に速いです。同じ課題を繰り返すより、未経験のカテゴリを増やす方が実戦での手の止まりが減ります。';
  }
  if (r.cpm >= 250) {
    return '実戦で困らない速度域です。長めの課題（Union-Find やダイクストラ）でも最後まで手が止まらないか確かめてみましょう。';
  }
  return '同じ課題をもう 2〜3 回打つと手が形を覚えます。まずはこの課題で自己ベストを 1 回更新してみてください。';
}

/* ------------------------------------------------------------------ */
/* UI 配線                                                             */
/* ------------------------------------------------------------------ */

function buildSelectors() {
  const cat = $('categorySelect');
  cat.innerHTML = '';
  const all = document.createElement('option');
  all.value = '*';
  all.textContent = 'すべて';
  cat.appendChild(all);
  for (const c of CATEGORIES) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    cat.appendChild(o);
  }
  refreshProblemOptions();
}

function refreshProblemOptions() {
  const catId = $('categorySelect').value;
  const sel = $('problemSelect');
  const keep = sel.value;
  const mode = currentMode();
  const list = catId === '*' ? PROBLEMS : PROBLEMS.filter((p) => p.category === catId);

  sel.innerHTML = '';
  for (const p of list) {
    const o = document.createElement('option');
    o.value = p.id;
    const rec = records[p.id];
    const best = rec ? mode.best(rec) : null;      // 表示する自己ベストもモードに合わせる
    const star = '★'.repeat(p.level) + '☆'.repeat(3 - p.level);
    o.textContent = `${star} ${p.title}${best ? `  (best ${best})` : ''}`;
    sel.appendChild(o);
  }
  if (keep && list.some((p) => p.id === keep)) sel.value = keep;
  return list;
}

/* ------------------------------------------------------------------ */
/* 記録の持ち出し                                                       */
/* ------------------------------------------------------------------ */

function showTransfer(text, bad = false) {
  const el = $('transferMsg');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.hidden = false;
}

function exportRecords() {
  const data = buildExport({ records, settings });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('');
  a.href = url;
  a.download = `cp-typing-${stamp}.json`;
  // Firefox は document に入っていない <a> のクリックを無視する。
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  const n = Object.keys(data.records).length;
  showTransfer(`${n} 課題の記録を書き出しました。別の端末でこのファイルを読み込んでください。`);
}

async function importRecords(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    showTransfer('ファイルを読めませんでした。', true);
    return;
  }

  const res = parseImport(text);
  // 少しでも怪しければ手元のデータには触らない。
  if (!res.ok) {
    showTransfer(res.error, true);
    return;
  }

  const merged = mergeRecords(records, res.records);
  const { added, improved } = countChanges(records, merged);
  records = merged;
  writeJSON(RECORDS_KEY, records);

  let note = '';
  if ($('optImportSettings').checked) {
    const before = settings.mode;
    // 見知らぬキーを持ち込まないよう、既定にあるものだけ受け取る。
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in res.settings) settings[key] = res.settings[key];
    }
    writeJSON(SETTINGS_KEY, settings);
    applySettingsToForm();
    applyEditorSettings();
    if (settings.mode !== before) restart();   // 評価対象が変わるので測り直す
    note = ' 設定も取り込みました。';
  }

  refreshProblemOptions();
  showTransfer(
    added + improved === 0
      ? `取り込みました。手元の記録のほうが良かったので、変わった課題はありません。${note}`
      : `${added + improved} 課題を取り込みました（新規 ${added} / 自己ベスト更新 ${improved}）。${note}`,
  );
}

function wireUI() {
  $('modeSelect').addEventListener('change', (e) => {
    settings.mode = e.target.value;
    writeJSON(SETTINGS_KEY, settings);
    applyMode();
    restart();            // 評価対象が変わるので、走行中なら測り直す
  });

  $('categorySelect').addEventListener('change', () => {
    const list = refreshProblemOptions();
    if (list.length) loadProblem(list[0]);
  });

  $('problemSelect').addEventListener('change', (e) => {
    const p = problemById(e.target.value);
    if (p) loadProblem(p);
  });

  $('restartBtn').addEventListener('click', () => restart());

  // --- 設定 ---
  const toggles = {
    optSuggest: 'suggest',
    optQuickSuggest: 'quickSuggest',
    optAcceptEnter: 'acceptEnter',
    optSnippet: 'snippet',
    optBrackets: 'brackets',
    optIndent: 'indent',
    optMinimap: 'minimap',
  };
  for (const [elId, key] of Object.entries(toggles)) {
    $(elId).addEventListener('change', (e) => {
      settings[key] = e.target.checked;
      writeJSON(SETTINGS_KEY, settings);
      applyEditorSettings();
    });
  }
  $('optFont').addEventListener('input', (e) => {
    settings.font = Number(e.target.value);
    $('optFontVal').textContent = settings.font;
    writeJSON(SETTINGS_KEY, settings);
    applyEditorSettings();
  });
  // --- 記録の持ち出し ---
  $('exportBtn').addEventListener('click', exportRecords);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    // 同じファイルを続けて選んでも change が飛ぶように毎回空にする。
    e.target.value = '';
    if (file) importRecords(file);
  });

  $('settingsBtn').addEventListener('click', () => {
    $('settingsModal').hidden = false;
    $('transferMsg').hidden = true;      // 前回の結果を引きずらない
  });
  $('settingsClose').addEventListener('click', () => {
    $('settingsModal').hidden = true;
    inputEditor.focus();
  });

  // --- 貼り付け練習 ---
  $('customBtn').addEventListener('click', () => {
    $('customText').value = state.customCode;
    $('customModal').hidden = false;
    $('customText').focus();
  });
  $('customCancel').addEventListener('click', () => {
    $('customModal').hidden = true;
    inputEditor.focus();
  });
  $('customStart').addEventListener('click', () => {
    const code = normalizeCode($('customText').value);
    if (!code) {
      $('customText').focus();
      return;
    }
    state.customCode = code;
    $('customModal').hidden = true;
    loadProblem({
      id: CUSTOM_ID,
      category: '*',
      level: 1,
      title: '貼り付けたコード',
      tags: 'custom',
      code,
      chars: code.length,
      lines: code.split('\n').length,
    });
  });

  // --- 結果 ---
  $('resultRetry').addEventListener('click', () => restart());
  $('resultNext').addEventListener('click', () => {
    $('resultModal').hidden = true;
    const list = refreshProblemOptions();
    const i = list.findIndex((p) => p.id === state.problem.id);
    const next = list[(i + 1) % list.length];
    if (next) {
      $('problemSelect').value = next.id;
      loadProblem(next);
    } else {
      restart();
    }
  });

  // モーダルは背景クリックで閉じる
  for (const id of MODAL_IDS) {
    $(id).addEventListener('mousedown', (e) => {
      if (e.target === $(id)) {
        $(id).hidden = true;
        inputEditor.focus();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const id of MODAL_IDS) {
      if (!$(id).hidden) {
        $(id).hidden = true;
        inputEditor.focus();
        e.preventDefault();
        return;
      }
    }
  });
}

function applySettingsToForm() {
  $('modeSelect').value = MODES[settings.mode] ? settings.mode : 'speed';
  applyMode();
  $('optSuggest').checked = settings.suggest;
  $('optQuickSuggest').checked = settings.quickSuggest;
  $('optAcceptEnter').checked = settings.acceptEnter;
  $('optSnippet').checked = settings.snippet;
  $('optBrackets').checked = settings.brackets;
  $('optIndent').checked = settings.indent;
  $('optMinimap').checked = settings.minimap;
  $('optFont').value = settings.font;
  $('optFontVal').textContent = settings.font;
  updateAssistMeta();
}
