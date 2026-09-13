// 404 になっているリクエストの URL を突き止める。
import { connect, sleep } from './cdp.mjs';

const URL_ = process.argv[2] ?? 'https://zwiitors.github.io/cp-typing/';
const cdp = await connect(Number(process.argv[3] ?? 9222));
await cdp.send('Page.enable');
await cdp.send('Network.enable');
await cdp.send('Log.enable');

const bad = [];
cdp.on('Network.responseReceived', ({ response }) => {
  if (response.status >= 400) bad.push(`${response.status} ${response.url}`);
});
cdp.on('Network.loadingFailed', ({ errorText, type }) => bad.push(`failed(${type}) ${errorText}`));
cdp.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'error') bad.push(`console: ${entry.text} @ ${entry.url ?? '?'}`);
});

await cdp.send('Page.navigate', { url: URL_ });
await cdp.waitFor("document.getElementById('problemSelect')?.options.length > 0");
await sleep(1500);

console.log(bad.length ? bad.join('\n') : '問題なし');
cdp.close();
