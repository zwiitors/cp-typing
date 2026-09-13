/**
 * スクリーンショットの画素を読むための最小 PNG デコーダ。
 *
 * Chrome の Page.captureScreenshot が返すもの（8bit / 非インタレース /
 * RGB または RGBA）だけを相手にする。依存パッケージを増やしたくないので
 * 自前で持つ。検証用で、アプリからは読まない。
 */
import zlib from 'node:zlib';

/** @returns {{width:number,height:number,at:(x:number,y:number)=>[number,number,number]}} */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではない');

  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} は未対応`);
      if (data[12] !== 0) throw new Error('インタレースは未対応');
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
      if (!channels) throw new Error(`colorType ${colorType} は未対応`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  // 行ごとのフィルタを戻す（PNG 仕様 9.2）
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`フィルタ ${filter} は未対応`);
      cur[i] = v & 0xff;
    }
  }

  const at = (x, y) => {
    const i = y * stride + x * channels;
    return [out[i], out[i + 1], out[i + 2]];
  };
  return { width, height, at };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 2 色が近いか。スクリーンショットのアンチエイリアスを吸収する幅を持たせる。 */
export const near = ([r, g, b], [r2, g2, b2], tol = 26) =>
  Math.abs(r - r2) <= tol && Math.abs(g - g2) <= tol && Math.abs(b - b2) <= tol;
