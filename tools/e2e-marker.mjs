/**
 * 「次に打つ 1 文字」のマーカーが字形を潰していないことの検証。
 *
 *   node tools/e2e-marker.mjs [url]
 *
 * 事前に http サーバと --remote-debugging-port=9222 の Chrome を上げておくこと。
 * 別のポートに繋ぐときは環境変数 CDP_PORT を指定する。
 *
 * q と g はディセンダの形でしか見分けられない。マーカーの棒がそこに重なると
 * 打ち間違いの原因になるので、棒がセルの外にあることを画素で確かめる。
 * 「棒がセルの下に在る」ほうも見ているのは、棒を消すだけの変更を通さないため。
 */
import { connect, sleep, typeText, clickCenter } from './cdp.mjs';
import { decodePng, near } from './png.mjs';

const URL_ = process.argv[2] ?? 'http://localhost:8765/';
const GOOD = [78, 201, 176];   // --good
const BAD = [241, 76, 76];     // --bad

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const cdp = await connect(Number(process.env.CDP_PORT ?? 9222));
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
// CSS px と画素を 1:1 にしておくと、要素の座標をそのまま画像の添字に使える。
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
});
await cdp.send('Page.navigate', { url: URL_ });
await cdp.waitFor("document.getElementById('problemSelect')?.options.length > 0");
await sleep(600);

const setCustom = async (code) => {
  await cdp.evaluate(`
    document.getElementById('customBtn').click();
    document.getElementById('customText').value = ${JSON.stringify(code)};
    document.getElementById('customStart').click();
  `);
  await sleep(400);
};

const markerRect = (selector) => cdp.evaluate(`
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right),
           top: Math.round(r.top), bottom: Math.round(r.bottom) };
`);

const grab = async () => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  return decodePng(Buffer.from(data, 'base64'));
};

/** 矩形のなかで色 c に近い画素を数える。 */
const countNear = (img, c, x0, x1, y0, y1) => {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x += 1) {
      if (near(img.at(x, y), c)) n += 1;
    }
  }
  return n;
};

/**
 * 1 ケース分の検証。
 * @param label 表示名 / selector マーカー / color 棒の色 / setup マーカーを目的の字に乗せる手順
 */
async function inspect(label, selector, color, setup) {
  await setup();
  const r = await markerRect(selector);
  if (!r) {
    check(`${label}: マーカーが描画される`, false);
    return;
  }
  const img = await grab();

  // 角丸とアンチエイリアスを避けて、セルの内側だけを見る
  const inside = countNear(img, color, r.left + 2, r.right - 2, r.top + 1, r.bottom);
  check(`${label}: 棒が文字のセルに入り込んでいない`, inside === 0, `セル内の棒色画素 ${inside}`);

  // セルのすぐ下に棒が出ていること（棒を消しただけの変更を通さない）
  const below = countNear(img, color, r.left + 2, r.right - 2, r.bottom, r.bottom + 5);
  const wide = Math.max(1, Math.floor((r.right - r.left - 4) / 2));
  check(`${label}: 棒がセルのすぐ下に出ている`, below >= wide, `セル下の棒色画素 ${below} (必要 ${wide} 以上)`);
}

const typeInto = async (text) => {
  await clickCenter(cdp, '#inputHost');
  await sleep(120);
  await typeText(cdp, text, 5);
  await sleep(250);
};

console.log(`\n=== ${URL_} ===\n`);

// ディセンダを持ち、かつ下半分でしか見分けられない字を並べる
for (const ch of ['g', 'q', 'p', 'y']) {
  await inspect(`${ch} の上`, '.tt-caret', GOOD, async () => {
    await setCustom(`sum ${ch} = 0`);
    await typeInto('sum ');
  });
}

// 棒をセルの外に出したので、下に行があるときに切り取られたり
// 次の行の字に被されたりしないかを見る（上のケースは全部最終行）。
await inspect('g の上（下に行があるとき）', '.tt-caret', GOOD, async () => {
  await setCustom('sum g = 0\nbdk = 1');
  await typeInto('sum ');
});

// 打ち間違い中の赤マーカーも同じ扱いになっていること
await inspect('誤字中の g の上', '.tt-caret-bad', BAD, async () => {
  await setCustom('sug = 0');
  await typeInto('sux');
});

console.log(`\n${failures === 0 ? 'すべて PASS' : `${failures} 件失敗`}`);
cdp.close();
process.exit(failures === 0 ? 0 : 1);
