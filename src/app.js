import { PROBLEMS, CATEGORIES, problemById, normalizeCode, CUSTOM_ID } from './problems.js';
import { configurePython, registerPythonCompletion } from './python-assist.js';

const MONACO_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min';
const FONT_STACK = '"Cascadia Code", Consolas, "SFMono-Regular", Menlo, "BIZ UDGothic", monospace';
const SETTINGS_KEY = 'cp-typing:settings:v1';
const RECORDS_KEY = 'cp-typing:records:v1';
const LAST_KEY = 'cp-typing:last:v1';

const DEFAULT_SETTINGS = {
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
let records = readJSON(RECORDS_KEY, {});

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

/* ------------------------------------------------------------------ */
/* 状態                                                                */
/* ------------------------------------------------------------------ */

const state = {
  problem: null,
  target: '',
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
    keybindings: [monaco.KeyCode.Escape],
    precondition: '!suggestWidgetVisible && !parameterHintsVisible && !findWidgetVisible',
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
    trimAutoWhitespace: false,
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
  inputEditor.focus();
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

  const buffer = inputEditor.getValue();
  const prevPrefix = state.prefix;
  const prevLen = state.bufLen;

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
  const buffer = inputEditor.getValue();
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

function renderStats(sec) {
  const cpm = sec > 0 ? (state.prefix / sec) * 60 : 0;
  const raw = sec > 0 ? (state.keystrokes / sec) * 60 : 0;
  const boost = state.keystrokes > 0 ? state.prefix / state.keystrokes : 0;
  const acc = accuracy();

  $('statTime').textContent = sec.toFixed(1);
  $('statCpm').textContent = Math.round(cpm);
  $('statRaw').textContent = Math.round(raw);
  $('statBoost').textContent = boost.toFixed(2);
  $('statAcc').textContent = Math.round(acc);
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
  const cpm = sec > 0 ? (state.target.length / sec) * 60 : 0;
  const boost = state.keystrokes > 0 ? state.target.length / state.keystrokes : 0;
  const acc = accuracy();

  inputEditor.updateOptions({ readOnly: true });
  $('panes').querySelector('.pane-input').classList.add('done');
  state.prefix = state.target.length;
  paintProgress();
  renderStats(sec);

  const best = saveRecord({ cpm, sec, acc, boost });
  showResult({ cpm, sec, acc, boost, best });
}

function saveRecord({ cpm, sec, acc, boost }) {
  const id = state.problem.id;
  if (id === CUSTOM_ID) return null;

  const prev = records[id] || { cpm: 0, sec: Infinity, acc: 0, boost: 0, runs: 0 };
  const improved = { cpm: cpm > prev.cpm, sec: sec < prev.sec, acc: acc > prev.acc };

  records[id] = {
    cpm: Math.max(prev.cpm, cpm),
    sec: Math.min(prev.sec, sec),
    acc: Math.max(prev.acc, acc),
    boost: Math.max(prev.boost, boost),
    runs: prev.runs + 1,
  };
  writeJSON(RECORDS_KEY, records);
  return { prev, improved, runs: records[id].runs };
}

function showResult({ cpm, sec, acc, boost, best }) {
  $('resultTitle').textContent = state.problem.title;
  $('resultSub').textContent =
    `${state.target.length} 文字を ${state.keystrokes} 打鍵で入力（${best ? `${best.runs} 回目` : '記録は保存されません'}）`;

  $('rCpm').textContent = Math.round(cpm);
  $('rTime').textContent = sec.toFixed(1);
  $('rAcc').textContent = Math.round(acc);
  $('rBoost').textContent = boost.toFixed(2);

  const firstRun = best && best.runs === 1;
  $('rCpmBest').textContent =
    !best ? '' : best.improved.cpm ? (firstRun ? '初回記録' : `自己ベスト更新 (前 ${Math.round(best.prev.cpm)})`) : `自己ベスト ${Math.round(best.prev.cpm)}`;
  $('rTimeBest').textContent =
    !best || firstRun ? '' : best.improved.sec ? `自己ベスト更新 (前 ${best.prev.sec.toFixed(1)}s)` : `自己ベスト ${best.prev.sec.toFixed(1)}s`;
  $('rMiss').textContent = `ミス ${state.mistakes} 回`;
  $('rKeys').textContent = `補完が ${Math.max(0, state.target.length - state.keystrokes)} 打鍵を肩代わり`;

  $('resultComment').textContent = advise({ cpm, acc, boost });
  $('resultModal').hidden = false;
  $('resultRetry').focus();
}

function advise({ cpm, acc, boost }) {
  if (acc < 85) {
    return 'ミスが多めです。競プロでは打ち直しよりデバッグの方が高くつくので、まずは正確度 95% を目標にゆっくり打ちましょう。';
  }
  if (boost < 1.15) {
    return '補完をほとんど使えていません。3〜4 文字打ったところで Tab を押す癖をつけると、この課題はもっと少ない打鍵で書けます。スニペット（li, nm, fr など）も試してみてください。';
  }
  if (boost >= 1.6 && acc >= 95) {
    return '補完をかなり活用できています。この打鍵効率なら実戦でも手が止まりません。次は 1 段上のカテゴリに進んでみましょう。';
  }
  if (cpm >= 300 && acc >= 95) {
    return '十分に速いです。同じ課題を繰り返すより、未経験のカテゴリを増やした方が実戦での詰まりが減ります。';
  }
  return '良いペースです。同じ課題をもう 2〜3 回打つと手が形を覚えて、考えながらでも打てるようになります。';
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
  const list = catId === '*' ? PROBLEMS : PROBLEMS.filter((p) => p.category === catId);
  sel.innerHTML = '';
  for (const p of list) {
    const o = document.createElement('option');
    o.value = p.id;
    const rec = records[p.id];
    const star = '★'.repeat(p.level) + '☆'.repeat(3 - p.level);
    o.textContent = `${star} ${p.title}${rec ? `  (best ${Math.round(rec.cpm)} cpm)` : ''}`;
    sel.appendChild(o);
  }
  return list;
}

function wireUI() {
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
  $('settingsBtn').addEventListener('click', () => { $('settingsModal').hidden = false; });
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
  for (const id of ['settingsModal', 'customModal', 'resultModal']) {
    $(id).addEventListener('mousedown', (e) => {
      if (e.target === $(id)) {
        $(id).hidden = true;
        inputEditor.focus();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const id of ['settingsModal', 'customModal', 'resultModal']) {
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
