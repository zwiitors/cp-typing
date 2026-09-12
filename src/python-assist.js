// Monaco の Python を「VS Code / Codium で打っているときの手触り」に寄せるための設定。
//   1. 言語設定  : 括弧・クォートの自動閉じ、`:` の次行で字下げ、return / pass の次行で戻す
//   2. 補完      : 組み込み関数・キーワード・標準ライブラリのメンバ・競プロ用スニペット
// 型推論は行わないので、`.` の後は「よく使うメソッドをまとめて出す」方式。
// Pylance ほど賢くはないが、打鍵数の減り方はほぼ同じになる。

const K = 'Keyword', F = 'Function', M = 'Method', C = 'Class', V = 'Variable', CONST = 'Constant', MOD = 'Module', S = 'Snippet';

const KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import',
  'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'True', 'try', 'while', 'with', 'yield', 'match', 'case',
];

const BUILTINS = [
  ['abs', 'abs(x)', '絶対値'],
  ['all', 'all(iterable) -> bool', 'すべて真か'],
  ['any', 'any(iterable) -> bool', 'いずれか真か'],
  ['bin', 'bin(n) -> str', '2 進表記'],
  ['bool', 'bool(x) -> bool', ''],
  ['bytes', 'bytes(...)', ''],
  ['callable', 'callable(obj) -> bool', ''],
  ['chr', 'chr(i) -> str', 'コードポイント → 文字'],
  ['complex', 'complex(re, im)', ''],
  ['dict', 'dict(...) -> dict', ''],
  ['divmod', 'divmod(a, b) -> (q, r)', '商と余り'],
  ['enumerate', 'enumerate(iterable, start=0)', '添字つきで回す'],
  ['eval', 'eval(expr)', ''],
  ['filter', 'filter(func, iterable)', ''],
  ['float', 'float(x) -> float', ''],
  ['format', 'format(value, spec)', ''],
  ['frozenset', 'frozenset(iterable)', ''],
  ['hash', 'hash(obj) -> int', ''],
  ['hex', 'hex(n) -> str', '16 進表記'],
  ['id', 'id(obj) -> int', ''],
  ['input', 'input(prompt="") -> str', '1 行読む'],
  ['int', 'int(x, base=10) -> int', ''],
  ['isinstance', 'isinstance(obj, cls) -> bool', ''],
  ['issubclass', 'issubclass(cls, base) -> bool', ''],
  ['iter', 'iter(iterable)', ''],
  ['len', 'len(s) -> int', '長さ'],
  ['list', 'list(iterable) -> list', ''],
  ['map', 'map(func, *iterables)', ''],
  ['max', 'max(iterable, *, key=None, default=...)', '最大'],
  ['min', 'min(iterable, *, key=None, default=...)', '最小'],
  ['next', 'next(iterator, default=...)', ''],
  ['object', 'object()', ''],
  ['oct', 'oct(n) -> str', ''],
  ['open', 'open(file, mode="r")', ''],
  ['ord', 'ord(c) -> int', '文字 → コードポイント'],
  ['pow', 'pow(base, exp, mod=None)', 'mod 付き累乗＝逆元計算に必須'],
  ['print', 'print(*values, sep=" ", end="\\n")', ''],
  ['range', 'range(stop) / range(start, stop, step)', ''],
  ['repr', 'repr(obj) -> str', ''],
  ['reversed', 'reversed(seq)', ''],
  ['round', 'round(x, ndigits=None)', ''],
  ['set', 'set(iterable) -> set', ''],
  ['slice', 'slice(start, stop, step)', ''],
  ['sorted', 'sorted(iterable, *, key=None, reverse=False)', ''],
  ['str', 'str(obj) -> str', ''],
  ['sum', 'sum(iterable, start=0)', '総和'],
  ['super', 'super()', ''],
  ['tuple', 'tuple(iterable) -> tuple', ''],
  ['type', 'type(obj)', ''],
  ['zip', 'zip(*iterables, strict=False)', '複数列を同時に回す'],
];

// `モジュール名.` の後に出すメンバ
const MODULE_MEMBERS = {
  sys: [
    ['stdin', V, 'sys.stdin', '標準入力'],
    ['stdout', V, 'sys.stdout', '標準出力'],
    ['stderr', V, 'sys.stderr', '標準エラー出力'],
    ['setrecursionlimit', F, 'setrecursionlimit(limit)', '再帰上限。DFS の前に必ず'],
    ['exit', F, 'exit(status=0)', ''],
    ['maxsize', CONST, 'sys.maxsize', '実質無限大として使える'],
    ['argv', V, 'sys.argv', ''],
  ],
  collections: [
    ['deque', C, 'deque(iterable=(), maxlen=None)', 'BFS のキュー'],
    ['Counter', C, 'Counter(iterable)', '頻度集計'],
    ['defaultdict', C, 'defaultdict(default_factory)', '初期値つき dict'],
    ['OrderedDict', C, 'OrderedDict()', ''],
    ['namedtuple', F, 'namedtuple(typename, field_names)', ''],
  ],
  heapq: [
    ['heappush', F, 'heappush(heap, item)', ''],
    ['heappop', F, 'heappop(heap)', '最小値を取り出す'],
    ['heapify', F, 'heapify(x)', 'O(n) でヒープ化'],
    ['heappushpop', F, 'heappushpop(heap, item)', ''],
    ['heapreplace', F, 'heapreplace(heap, item)', ''],
    ['nlargest', F, 'nlargest(n, iterable, key=None)', ''],
    ['nsmallest', F, 'nsmallest(n, iterable, key=None)', ''],
  ],
  bisect: [
    ['bisect_left', F, 'bisect_left(a, x)', 'x 以上が始まる位置'],
    ['bisect_right', F, 'bisect_right(a, x)', 'x 超が始まる位置'],
    ['insort_left', F, 'insort_left(a, x)', ''],
    ['insort_right', F, 'insort_right(a, x)', ''],
  ],
  itertools: [
    ['permutations', F, 'permutations(iterable, r=None)', '順列'],
    ['combinations', F, 'combinations(iterable, r)', '組合せ'],
    ['combinations_with_replacement', F, 'combinations_with_replacement(iterable, r)', '重複組合せ'],
    ['product', F, 'product(*iterables, repeat=1)', '直積＝多重ループ'],
    ['accumulate', F, 'accumulate(iterable, func=add)', '累積和'],
    ['groupby', F, 'groupby(iterable, key=None)', '連続部分をまとめる'],
    ['chain', F, 'chain(*iterables)', ''],
    ['count', F, 'count(start=0, step=1)', ''],
    ['cycle', F, 'cycle(iterable)', ''],
  ],
  math: [
    ['gcd', F, 'gcd(*integers)', '最大公約数'],
    ['lcm', F, 'lcm(*integers)', '最小公倍数'],
    ['isqrt', F, 'isqrt(n)', '整数平方根。誤差が出ない'],
    ['sqrt', F, 'sqrt(x)', ''],
    ['ceil', F, 'ceil(x)', ''],
    ['floor', F, 'floor(x)', ''],
    ['factorial', F, 'factorial(n)', ''],
    ['comb', F, 'comb(n, k)', '二項係数'],
    ['perm', F, 'perm(n, k=None)', ''],
    ['inf', CONST, 'math.inf', ''],
    ['pi', CONST, 'math.pi', ''],
    ['log2', F, 'log2(x)', ''],
    ['log10', F, 'log10(x)', ''],
  ],
  functools: [
    ['lru_cache', F, 'lru_cache(maxsize=128)', 'メモ化再帰'],
    ['cache', F, 'cache(func)', 'メモ化再帰 (3.9+)'],
    ['reduce', F, 'reduce(func, iterable, initial)', ''],
    ['cmp_to_key', F, 'cmp_to_key(func)', '比較関数でソート'],
  ],
  string: [
    ['ascii_lowercase', CONST, '"abcdefghijklmnopqrstuvwxyz"', ''],
    ['ascii_uppercase', CONST, '"ABCDEFGHIJKLMNOPQRSTUVWXYZ"', ''],
    ['digits', CONST, '"0123456789"', ''],
  ],
};

const MODULE_NAMES = ['sys', 'collections', 'heapq', 'bisect', 'itertools', 'math', 'functools', 'string', 'array', 'decimal', 'fractions', 'random', 're'];

// 型推論がないので `.` の後はこの共通プールを出す(list / str / dict / set / deque)。
const METHOD_POOL = [
  ['append', 'append(x)', 'list / deque'],
  ['appendleft', 'appendleft(x)', 'deque'],
  ['extend', 'extend(iterable)', 'list'],
  ['insert', 'insert(i, x)', 'list'],
  ['pop', 'pop(i=-1)', 'list / dict / set'],
  ['popleft', 'popleft()', 'deque'],
  ['remove', 'remove(x)', 'list / set'],
  ['clear', 'clear()', ''],
  ['index', 'index(x, start=0, end=len)', 'list / str'],
  ['count', 'count(x)', 'list / str'],
  ['sort', 'sort(*, key=None, reverse=False)', 'list'],
  ['reverse', 'reverse()', 'list'],
  ['copy', 'copy()', ''],
  ['split', 'split(sep=None, maxsplit=-1)', 'str'],
  ['rsplit', 'rsplit(sep=None)', 'str'],
  ['strip', 'strip(chars=None)', 'str'],
  ['rstrip', 'rstrip(chars=None)', 'str'],
  ['lstrip', 'lstrip(chars=None)', 'str'],
  ['join', 'join(iterable)', 'str'],
  ['replace', 'replace(old, new, count=-1)', 'str'],
  ['find', 'find(sub)', 'str'],
  ['startswith', 'startswith(prefix)', 'str'],
  ['endswith', 'endswith(suffix)', 'str'],
  ['upper', 'upper()', 'str'],
  ['lower', 'lower()', 'str'],
  ['zfill', 'zfill(width)', 'str'],
  ['format', 'format(*args, **kwargs)', 'str'],
  ['isdigit', 'isdigit()', 'str'],
  ['isalpha', 'isalpha()', 'str'],
  ['keys', 'keys()', 'dict'],
  ['values', 'values()', 'dict'],
  ['items', 'items()', 'dict'],
  ['get', 'get(key, default=None)', 'dict'],
  ['setdefault', 'setdefault(key, default=None)', 'dict'],
  ['update', 'update(other)', 'dict / set'],
  ['add', 'add(x)', 'set'],
  ['discard', 'discard(x)', 'set'],
  ['union', 'union(other)', 'set'],
  ['intersection', 'intersection(other)', 'set'],
  ['difference', 'difference(other)', 'set'],
  ['most_common', 'most_common(n=None)', 'Counter'],
  ['readline', 'readline()', 'sys.stdin'],
  ['read', 'read()', 'sys.stdin'],
  ['write', 'write(s)', 'sys.stdout'],
];

// 競プロ用スニペット。展開後がお手本と一致しやすいよう、変数名は i / n / a に寄せてある。
const SNIPPETS = [
  ['si', 'import sys\ninput = sys.stdin.readline', '高速入力'],
  ['fio', 'import sys\ninput = sys.stdin.readline\n\ndef main():\n    ${0}\n\nif __name__ == "__main__":\n    main()', '入出力＋main テンプレ'],
  ['main', 'def main():\n    ${0}\n\nif __name__ == "__main__":\n    main()', 'main テンプレ'],
  ['ii', 'int(input())', '整数 1 つ'],
  ['mi', 'map(int, input().split())', '整数複数'],
  ['li', 'list(map(int, input().split()))', '整数の配列'],
  ['nm', 'n, m = map(int, input().split())', ''],
  ['na', 'n = int(input())\na = list(map(int, input().split()))', 'n と数列'],
  ['hw', 'h, w = map(int, input().split())', ''],
  ['fr', 'for ${1:i} in range(${2:n}):\n    ${0}', 'range ループ'],
  ['fe', 'for ${1:i}, ${2:x} in enumerate(${3:a}):\n    ${0}', 'enumerate ループ'],
  ['fu', 'for _ in range(${1:n}):\n    ${0}', '回数だけ回す'],
  ['rec', 'sys.setrecursionlimit(10 ** 6)', '再帰上限'],
  ['mod', 'MOD = 10 ** 9 + 7', ''],
  ['mod9', 'MOD = 998244353', ''],
  ['inf', 'INF = float("inf")', ''],
  ['yn', 'print("Yes" if ${1:cond} else "No")', 'Yes / No 出力'],
  ['pj', 'print(" ".join(map(str, ${1:a})))', '配列を空白区切りで出力'],
  ['grid', 'grid = [input() for _ in range(h)]', 'グリッド読み込み'],
  ['d4', 'for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n    ${0}', '4 近傍'],
  ['adj', 'g = [[] for _ in range(n + 1)]\nfor _ in range(m):\n    u, v = map(int, input().split())\n    g[u].append(v)\n    g[v].append(u)', '隣接リスト'],
  ['bfs', 'dist = [-1] * (n + 1)\ndist[${1:1}] = 0\nq = deque([${1:1}])\nwhile q:\n    v = q.popleft()\n    for nv in g[v]:\n        if dist[nv] != -1:\n            continue\n        dist[nv] = dist[v] + 1\n        q.append(nv)', 'BFS 本体'],
  ['dij', 'INF = float("inf")\ndist = [INF] * (n + 1)\ndist[1] = 0\nhq = [(0, 1)]\nwhile hq:\n    d, v = heapq.heappop(hq)\n    if d > dist[v]:\n        continue\n    for nv, w in g[v]:\n        if dist[nv] > d + w:\n            dist[nv] = d + w\n            heapq.heappush(hq, (dist[nv], nv))', 'ダイクストラ'],
  ['uf', 'class UnionFind:\n    def __init__(self, n):\n        self.par = list(range(n))\n        self.size = [1] * n\n\n    def find(self, x):\n        while self.par[x] != x:\n            self.par[x] = self.par[self.par[x]]\n            x = self.par[x]\n        return x\n\n    def unite(self, x, y):\n        x, y = self.find(x), self.find(y)\n        if x == y:\n            return False\n        if self.size[x] < self.size[y]:\n            x, y = y, x\n        self.par[y] = x\n        self.size[x] += self.size[y]\n        return True', 'Union-Find'],
  ['sieve', 'is_prime = [True] * (n + 1)\nis_prime[0] = is_prime[1] = False\ni = 2\nwhile i * i <= n:\n    if is_prime[i]:\n        for j in range(i * i, n + 1, i):\n            is_prime[j] = False\n    i += 1', 'エラトステネスの篩'],
  ['dq', 'from collections import deque', ''],
  ['cnt', 'from collections import Counter', ''],
  ['dd', 'from collections import defaultdict', ''],
  ['bs', 'from bisect import bisect_left, bisect_right', ''],
];

/** 括弧の自動閉じ・自動インデントを VS Code の Python 相当にする。 */
export function configurePython(monaco) {
  monaco.languages.setLanguageConfiguration('python', {
    comments: { lineComment: '#', blockComment: ['"""', '"""'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      // `:` で終わる行の次は字下げする
      increaseIndentPattern: /^\s*(?:def|class|for|if|elif|else|while|try|with|except|finally|async|match|case)\b.*:\s*(?:#.*)?$/,
      decreaseIndentPattern: /^\s*(?:elif|else|except|finally)\b.*:\s*$/,
    },
    onEnterRules: [
      {
        // return / pass / break / continue / raise の次行は 1 段戻す
        beforeText: /^\s+(?:return|pass|break|continue|raise)\b.*$/,
        action: { indentAction: monaco.languages.IndentAction.Outdent },
      },
    ],
  });
}

// 編集中のファイルに出てくる識別子を集める。
// Monaco 標準の単語ベース補完は、同じ言語に自前プロバイダを登録すると出てこなく
// なるため、ここで自前で供給する。inv_fact / is_prime のような長い名前を 3 文字で
// 呼び戻せるかどうかは、競プロの打鍵数にそのまま効く。
function documentWords(model, typing) {
  const words = [];
  const seen = new Set(typing ? [typing] : []);
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  const text = model.getValue();
  let m;
  while ((m = re.exec(text)) !== null && words.length < 300) {
    const w = m[0];
    if (w.length < 3 || seen.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return words;
}

function item(monaco, { label, kind, insert, detail, doc, snippet, sort }) {
  const it = {
    label,
    kind: monaco.languages.CompletionItemKind[kind],
    insertText: insert ?? label,
    detail,
    sortText: sort,
  };
  if (doc) it.documentation = { value: doc };
  if (snippet) it.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  return it;
}

/**
 * 補完プロバイダを登録する。
 * getOptions() は { suggest, snippet } を返す関数。設定でオフにされていたら何も出さない。
 */
export function registerPythonCompletion(monaco, getOptions) {
  return monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],

    provideCompletionItems(model, position) {
      const opts = getOptions();
      if (!opts.suggest) return { suggestions: [] };

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const before = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const suggestions = [];
      // `.` の直後かどうかだけで判定する。`g[u].append` や `self.par[x].pop` のように
      // 受け手が添字式のことが多く、識別子に限定すると候補が出なくなる。
      const isMember = /\.\s*[A-Za-z0-9_]*$/.test(before);
      const dot = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z0-9_]*$/.exec(before);

      if (isMember) {
        const members = dot ? MODULE_MEMBERS[dot[1]] : null;
        if (members) {
          for (const [label, kind, detail, doc] of members) {
            suggestions.push(item(monaco, { label, kind, detail, doc, sort: '0' + label }));
          }
        } else {
          for (const [label, detail, doc] of METHOD_POOL) {
            suggestions.push(item(monaco, { label, kind: M, detail, doc, sort: '1' + label }));
          }
        }
      } else {
        // 自分が書いた識別子を最優先。VS Code の単語ベース補完に相当する。
        const seen = new Set();
        for (const label of documentWords(model, word.word)) {
          seen.add(label);
          suggestions.push(item(monaco, { label, kind: V, detail: 'このファイル内', sort: '0' + label }));
        }
        if (opts.snippet) {
          for (const [label, body, doc] of SNIPPETS) {
            if (seen.has(label)) continue;
            suggestions.push(item(monaco, {
              label, kind: S, insert: body, snippet: true,
              detail: doc || body.split('\n')[0],
              doc: '```python\n' + body.replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\$\{?0\}?/g, '') + '\n```',
              // スニペットは組み込み関数より下に置く。ここを最上位にすると
              // `n` と打っただけで `na` スニペットが選択され、Enter が暴発する。
              sort: '3' + label,
            }));
          }
        }
        for (const [label, detail, doc] of BUILTINS) {
          if (seen.has(label)) continue;
          suggestions.push(item(monaco, { label, kind: F, detail, doc, sort: '2' + label }));
        }
        for (const label of KEYWORDS) {
          if (seen.has(label)) continue;
          suggestions.push(item(monaco, { label, kind: K, sort: '2' + label }));
        }
        for (const label of MODULE_NAMES) {
          if (seen.has(label)) continue;
          suggestions.push(item(monaco, { label, kind: MOD, detail: 'module', sort: '4' + label }));
        }
      }

      for (const s of suggestions) s.range = range;
      return { suggestions };
    },
  });
}

export const ASSIST_SUMMARY = {
  snippets: SNIPPETS.length,
  builtins: BUILTINS.length,
  modules: Object.keys(MODULE_MEMBERS).length,
};
