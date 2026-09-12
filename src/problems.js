// 競技プログラミングで実際に打つ Python コードの課題集。
// 本文は必ず「4 スペースインデント / 行末空白なし / 末尾改行なし」に正規化する。
// エディタ側も insertSpaces:true, tabSize:4 で動くので、お手本と打鍵結果が 1 文字ずつ一致する。

export function normalizeCode(src) {
  return String(src)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

export const CATEGORIES = [
  { id: 'io',    name: '入出力テンプレ' },
  { id: 'basic', name: '基本アルゴリズム' },
  { id: 'ds',    name: 'データ構造' },
  { id: 'graph', name: 'グラフ' },
  { id: 'dp',    name: '動的計画法' },
  { id: 'math',  name: '数学' },
];

const RAW = [
  // ---------------- 入出力テンプレ ----------------
  {
    id: 'io-int', category: 'io', level: 1,
    title: '整数を 1 つ読む',
    tags: 'input / int',
    code: `
n = int(input())
print(n * 2)
`,
  },
  {
    id: 'io-pair', category: 'io', level: 1,
    title: '空白区切りの 2 整数',
    tags: 'map / split',
    code: `
a, b = map(int, input().split())
print(a + b)
`,
  },
  {
    id: 'io-array', category: 'io', level: 1,
    title: '数列を配列で受け取る',
    tags: 'list / map',
    code: `
n = int(input())
a = list(map(int, input().split()))
print(sum(a), max(a), min(a))
`,
  },
  {
    id: 'io-yesno', category: 'io', level: 1,
    title: 'Yes / No 出力',
    tags: 'set / 条件式',
    code: `
n = int(input())
a = list(map(int, input().split()))
print("Yes" if len(set(a)) == n else "No")
`,
  },
  {
    id: 'io-fast', category: 'io', level: 2,
    title: '高速入出力テンプレ',
    tags: 'sys.stdin / main',
    code: `
import sys
input = sys.stdin.readline

def main():
    n = int(input())
    a = list(map(int, input().split()))
    print(sum(a))

if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'io-readall', category: 'io', level: 2,
    title: '入力を一括読み込み',
    tags: 'sys.stdin.read',
    code: `
import sys

data = sys.stdin.read().split()
n = int(data[0])
a = list(map(int, data[1:1 + n]))
print(" ".join(map(str, a)))
`,
  },
  {
    id: 'io-grid', category: 'io', level: 2,
    title: 'グリッドを読んで数える',
    tags: '二重ループ / 文字列',
    code: `
h, w = map(int, input().split())
grid = [input() for _ in range(h)]
cnt = 0
for i in range(h):
    for j in range(w):
        if grid[i][j] == "#":
            cnt += 1
print(cnt)
`,
  },

  // ---------------- 基本アルゴリズム ----------------
  {
    id: 'basic-cumsum', category: 'basic', level: 2,
    title: '累積和で区間和クエリ',
    tags: '累積和',
    code: `
n, q = map(int, input().split())
a = list(map(int, input().split()))
s = [0] * (n + 1)
for i in range(n):
    s[i + 1] = s[i] + a[i]
for _ in range(q):
    l, r = map(int, input().split())
    print(s[r] - s[l - 1])
`,
  },
  {
    id: 'basic-bisect', category: 'basic', level: 2,
    title: 'bisect で個数を数える',
    tags: 'bisect / ソート',
    code: `
from bisect import bisect_left, bisect_right

n, q = map(int, input().split())
a = sorted(map(int, input().split()))
for _ in range(q):
    x = int(input())
    print(bisect_right(a, x) - bisect_left(a, x))
`,
  },
  {
    id: 'basic-sortkey', category: 'basic', level: 2,
    title: 'lambda で複合ソート',
    tags: 'sort / lambda / tuple',
    code: `
n = int(input())
p = []
for _ in range(n):
    name, score = input().split()
    p.append((name, int(score)))
p.sort(key=lambda x: (-x[1], x[0]))
for name, score in p:
    print(name, score)
`,
  },
  {
    id: 'basic-binsearch', category: 'basic', level: 3,
    title: '答えで二分探索',
    tags: '二分探索 / 判定関数',
    code: `
n, k = map(int, input().split())
a = list(map(int, input().split()))

def check(x):
    return sum((v + x - 1) // x for v in a) <= k

lo, hi = 1, max(a)
while lo < hi:
    mid = (lo + hi) // 2
    if check(mid):
        hi = mid
    else:
        lo = mid + 1
print(lo)
`,
  },
  {
    id: 'basic-twopointer', category: 'basic', level: 3,
    title: 'しゃくとり法',
    tags: '尺取り / while',
    code: `
n, x = map(int, input().split())
a = list(map(int, input().split()))
ans = 0
right = 0
total = 0
for left in range(n):
    while right < n and total + a[right] <= x:
        total += a[right]
        right += 1
    ans = max(ans, right - left)
    if right == left:
        right += 1
    else:
        total -= a[left]
print(ans)
`,
  },

  // ---------------- データ構造 ----------------
  {
    id: 'ds-deque', category: 'ds', level: 2,
    title: 'deque で両端操作',
    tags: 'collections.deque',
    code: `
from collections import deque

n, q = map(int, input().split())
dq = deque(range(1, n + 1))
for _ in range(q):
    t, x = map(int, input().split())
    if t == 1:
        dq.appendleft(x)
    else:
        dq.append(x)
print(*dq)
`,
  },
  {
    id: 'ds-counter', category: 'ds', level: 2,
    title: 'Counter で頻度集計',
    tags: 'Counter / most_common',
    code: `
from collections import Counter

n = int(input())
a = list(map(int, input().split()))
c = Counter(a)
for value, cnt in c.most_common(3):
    print(value, cnt)
`,
  },
  {
    id: 'ds-defaultdict', category: 'ds', level: 2,
    title: 'defaultdict でグループ化',
    tags: 'defaultdict / sorted',
    code: `
from collections import defaultdict

n = int(input())
d = defaultdict(list)
for _ in range(n):
    k, v = input().split()
    d[k].append(v)
for k in sorted(d):
    print(k, *d[k])
`,
  },
  {
    id: 'ds-heapq', category: 'ds', level: 2,
    title: 'heapq で上位 k 個',
    tags: 'heapq / 最大ヒープ',
    code: `
import heapq

n, k = map(int, input().split())
a = list(map(int, input().split()))
hq = []
for v in a:
    heapq.heappush(hq, -v)
ans = 0
for _ in range(k):
    ans += -heapq.heappop(hq)
print(ans)
`,
  },
  {
    id: 'ds-unionfind', category: 'ds', level: 3,
    title: 'Union-Find',
    tags: 'class / 経路圧縮',
    code: `
class UnionFind:
    def __init__(self, n):
        self.par = list(range(n))
        self.size = [1] * n

    def find(self, x):
        while self.par[x] != x:
            self.par[x] = self.par[self.par[x]]
            x = self.par[x]
        return x

    def unite(self, x, y):
        x, y = self.find(x), self.find(y)
        if x == y:
            return False
        if self.size[x] < self.size[y]:
            x, y = y, x
        self.par[y] = x
        self.size[x] += self.size[y]
        return True
`,
  },

  // ---------------- グラフ ----------------
  {
    id: 'graph-adj', category: 'graph', level: 2,
    title: '隣接リストを作る',
    tags: '無向グラフ / 内包表記',
    code: `
n, m = map(int, input().split())
g = [[] for _ in range(n + 1)]
for _ in range(m):
    u, v = map(int, input().split())
    g[u].append(v)
    g[v].append(u)
for i in range(1, n + 1):
    print(i, len(g[i]))
`,
  },
  {
    id: 'graph-bfs', category: 'graph', level: 3,
    title: 'BFS で最短距離',
    tags: 'BFS / deque',
    code: `
from collections import deque

n, m = map(int, input().split())
g = [[] for _ in range(n + 1)]
for _ in range(m):
    u, v = map(int, input().split())
    g[u].append(v)
    g[v].append(u)

dist = [-1] * (n + 1)
dist[1] = 0
q = deque([1])
while q:
    v = q.popleft()
    for nv in g[v]:
        if dist[nv] != -1:
            continue
        dist[nv] = dist[v] + 1
        q.append(nv)
print(*dist[1:])
`,
  },
  {
    id: 'graph-dfs', category: 'graph', level: 3,
    title: '再帰 DFS で連結成分',
    tags: 'DFS / setrecursionlimit',
    code: `
import sys
sys.setrecursionlimit(10 ** 6)

n = int(input())
g = [[] for _ in range(n + 1)]
for _ in range(n - 1):
    u, v = map(int, input().split())
    g[u].append(v)
    g[v].append(u)

seen = [False] * (n + 1)

def dfs(v):
    seen[v] = True
    for nv in g[v]:
        if not seen[nv]:
            dfs(nv)

dfs(1)
print(sum(seen))
`,
  },
  {
    id: 'graph-gridbfs', category: 'graph', level: 3,
    title: 'グリッド BFS',
    tags: '4 近傍 / 境界判定',
    code: `
from collections import deque

h, w = map(int, input().split())
grid = [input() for _ in range(h)]
dist = [[-1] * w for _ in range(h)]
dist[0][0] = 0
q = deque([(0, 0)])
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if not (0 <= ny < h and 0 <= nx < w):
            continue
        if grid[ny][nx] == "#" or dist[ny][nx] != -1:
            continue
        dist[ny][nx] = dist[y][x] + 1
        q.append((ny, nx))
print(dist[h - 1][w - 1])
`,
  },
  {
    id: 'graph-dijkstra', category: 'graph', level: 3,
    title: 'ダイクストラ法',
    tags: 'heapq / 最短路',
    code: `
import heapq

n, m = map(int, input().split())
g = [[] for _ in range(n + 1)]
for _ in range(m):
    u, v, w = map(int, input().split())
    g[u].append((v, w))
    g[v].append((u, w))

INF = float("inf")
dist = [INF] * (n + 1)
dist[1] = 0
hq = [(0, 1)]
while hq:
    d, v = heapq.heappop(hq)
    if d > dist[v]:
        continue
    for nv, w in g[v]:
        if dist[nv] > d + w:
            dist[nv] = d + w
            heapq.heappush(hq, (dist[nv], nv))
print(dist[n] if dist[n] != INF else -1)
`,
  },

  // ---------------- 動的計画法 ----------------
  {
    id: 'dp-knapsack', category: 'dp', level: 3,
    title: '0-1 ナップサック',
    tags: '1 次元 DP / 逆順ループ',
    code: `
n, w = map(int, input().split())
dp = [0] * (w + 1)
for _ in range(n):
    wi, vi = map(int, input().split())
    for j in range(w, wi - 1, -1):
        dp[j] = max(dp[j], dp[j - wi] + vi)
print(dp[w])
`,
  },
  {
    id: 'dp-lis', category: 'dp', level: 3,
    title: '最長増加部分列 (LIS)',
    tags: 'bisect / DP',
    code: `
from bisect import bisect_left

n = int(input())
a = list(map(int, input().split()))
dp = []
for v in a:
    i = bisect_left(dp, v)
    if i == len(dp):
        dp.append(v)
    else:
        dp[i] = v
print(len(dp))
`,
  },
  {
    id: 'dp-gridpath', category: 'dp', level: 3,
    title: 'グリッド経路数 (mod)',
    tags: '2 次元 DP / MOD',
    code: `
MOD = 10 ** 9 + 7

h, w = map(int, input().split())
dp = [[0] * w for _ in range(h)]
dp[0][0] = 1
for i in range(h):
    for j in range(w):
        if i > 0:
            dp[i][j] = (dp[i][j] + dp[i - 1][j]) % MOD
        if j > 0:
            dp[i][j] = (dp[i][j] + dp[i][j - 1]) % MOD
print(dp[h - 1][w - 1])
`,
  },

  // ---------------- 数学 ----------------
  {
    id: 'math-gcd', category: 'math', level: 1,
    title: '全体の最大公約数',
    tags: 'math.gcd',
    code: `
from math import gcd

n = int(input())
a = list(map(int, input().split()))
g = 0
for v in a:
    g = gcd(g, v)
print(g)
`,
  },
  {
    id: 'math-sieve', category: 'math', level: 2,
    title: 'エラトステネスの篩',
    tags: '素数 / while',
    code: `
n = int(input())
is_prime = [True] * (n + 1)
is_prime[0] = is_prime[1] = False
i = 2
while i * i <= n:
    if is_prime[i]:
        for j in range(i * i, n + 1, i):
            is_prime[j] = False
    i += 1
print(sum(is_prime))
`,
  },
  {
    id: 'math-factorize', category: 'math', level: 2,
    title: '試し割り法で素因数分解',
    tags: '素因数分解',
    code: `
n = int(input())
res = []
d = 2
while d * d <= n:
    while n % d == 0:
        res.append(d)
        n //= d
    d += 1
if n > 1:
    res.append(n)
print(*res)
`,
  },
  {
    id: 'math-comb', category: 'math', level: 3,
    title: '二項係数の前計算',
    tags: '逆元 / pow(x, MOD-2)',
    code: `
MOD = 998244353
N = 200005

fact = [1] * N
for i in range(1, N):
    fact[i] = fact[i - 1] * i % MOD
inv_fact = [1] * N
inv_fact[N - 1] = pow(fact[N - 1], MOD - 2, MOD)
for i in range(N - 1, 0, -1):
    inv_fact[i - 1] = inv_fact[i] * i % MOD

def comb(n, r):
    if r < 0 or r > n:
        return 0
    return fact[n] * inv_fact[r] % MOD * inv_fact[n - r] % MOD

n, k = map(int, input().split())
print(comb(n, k))
`,
  },
];

export const PROBLEMS = RAW.map((p) => {
  const code = normalizeCode(p.code);
  return { ...p, code, chars: code.length, lines: code.split('\n').length };
});

export const CUSTOM_ID = '__custom__';

export function problemById(id) {
  return PROBLEMS.find((p) => p.id === id) || null;
}
