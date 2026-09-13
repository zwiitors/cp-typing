// 依存なしの最小 CDP クライアント。Node 22 のグローバル WebSocket を使う。
export async function connect(port = 9222) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('page target が見つからない');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const cb of listeners.get(msg.method) ?? []) cb(msg.params);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const on = (method, cb) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(cb);
  };

  /** ページ内で式を評価して値を返す。例外はそのまま投げ直す。 */
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  };

  /** 条件が真になるまで待つ。*/
  const waitFor = async (expr, { timeout = 20000, label = expr } = {}) => {
    const until = Date.now() + timeout;
    for (;;) {
      if (await evaluate(`return !!(${expr});`)) return;
      if (Date.now() > until) throw new Error(`待機がタイムアウト: ${label}`);
      await sleep(100);
    }
  };

  return { send, on, evaluate, waitFor, close: () => ws.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Monaco に効く形でキーを送る。改行だけ Enter キーとして送る。 */
export async function typeText(cdp, text, delay = 8) {
  for (const ch of text) {
    if (ch === '\n') {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r',
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      });
    } else {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
    await sleep(delay);
  }
}

/** 要素の中心をクリックする。*/
export async function clickCenter(cdp, selector) {
  const box = await cdp.evaluate(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  `);
  if (!box) throw new Error(`要素が無い: ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
    });
  }
}
