// Gera a imagem de prévia (1200x630) de uma estante: móvel de madeira com as capas dos livros.
// Usada no og:image dos links /u/:usuario, para aparecer no WhatsApp, Telegram etc.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ensureCover } = require('./covers');

const W = 1200;
const H = 630;
const IMG = path.join(__dirname, 'public', 'img');
const FONT = "'DejaVu Serif', 'Liberation Serif', serif";

// Mesma paleta das capas geradas no site (fundo, detalhe dourado)
const PALETTE = [
  ['#6d1f2b', '#e0bd72'],
  ['#1f2f4d', '#d9b46a'],
  ['#234a35', '#e3c47c'],
  ['#1d4f55', '#e7cf8f'],
  ['#4a2545', '#e2bf7d'],
  ['#8c3b24', '#f2d6a2'],
  ['#3a3f47', '#d9b46a'],
  ['#5b4a1e', '#f0dca8'],
];
function paletteFor(title) {
  let h = 0;
  for (const ch of String(title)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return PALETTE[h % PALETTE.length];
}

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.length > 5 ? [...lines.slice(0, 4), lines[4] + '…'] : lines;
}

// Capa desenhada para livro sem foto (igual à do site)
function fakeCoverSvg(book, w, h) {
  const [bg, gold] = paletteFor(book.title);
  const lines = wrap(book.title, 12);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  // letra encolhe para a linha mais longa caber dentro da moldura
  const size = Math.min(lines.length > 3 ? 22 : 27, Math.floor((w - 44) / (longest * 0.64)));
  const startY = h * 0.42 - ((lines.length - 1) * size * 1.15) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".45"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="${bg}"/>
    <rect width="${w}" height="${h}" fill="url(#v)"/>
    <rect x="12" y="12" width="${w - 24}" height="${h - 24}" fill="none" stroke="${gold}" stroke-width="2"/>
    <rect x="18" y="18" width="${w - 36}" height="${h - 36}" fill="none" stroke="${gold}" stroke-width="1" opacity=".6"/>
    <text x="${w / 2}" y="${h * 0.2}" text-anchor="middle" font-family="${FONT}" font-size="16" fill="${gold}">✦</text>
    ${lines.map((l, i) => `<text x="${w / 2}" y="${startY + i * size * 1.15}" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="${size}" fill="${gold}">${xml(l)}</text>`).join('')}
    <line x1="${w / 2 - 24}" x2="${w / 2 + 24}" y1="${h * 0.72}" y2="${h * 0.72}" stroke="${gold}" stroke-width="1.5"/>
    <text x="${w / 2}" y="${h * 0.8}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${gold}" opacity=".9">${xml(wrap(String(book.authors || '').split(',')[0].trim(), 22)[0] || '')}</text>
  </svg>`);
}

async function coverBuffer(book, w, h) {
  const src = book.cover_url || '';
  try {
    const cached = await ensureCover(book.id, src);
    if (cached) return await sharp(cached).resize(w, h, { fit: 'cover' }).png().toBuffer();
    let input = null;
    const m = src.match(/^data:image\/[a-z+.-]+;base64,(.+)$/);
    if (m) input = Buffer.from(m[1], 'base64');
    else if (/^https?:\/\//.test(src)) {
      const r = await fetch(src, { signal: AbortSignal.timeout(6000) });
      if (r.ok) input = Buffer.from(await r.arrayBuffer());
    }
    if (input) return await sharp(input).resize(w, h, { fit: 'cover' }).png().toBuffer();
  } catch {}
  return sharp(fakeCoverSvg(book, w, h)).png().toBuffer();
}

const woodCache = {};
async function wood(name, w, h) {
  const key = `${name}:${w}x${h}`;
  woodCache[key] ??= await sharp(fs.readFileSync(path.join(IMG, name))).resize(w, h, { fit: 'cover' }).toBuffer();
  return woodCache[key];
}

// Cache em memória: refaz só quando a estante muda
const cache = new Map();

async function shelfImage(user, books, total) {
  const key = `${user.id}:${user.name}:${total}:${books.map((b) => b.id + ':' + (b.cover_url || '').length).join(',')}`;
  if (cache.has(key)) return cache.get(key);

  // Geometria do móvel
  const top = 118; // faixa com o nome
  const side = 34;
  const crownH = 26;
  const baseH = 46;
  const plankH = 24;
  const innerTop = top + crownH;
  const plankY = H - baseH - plankH;
  const bookH = 288;
  const bookW = 192;
  const gap = 34;
  const shown = books.slice(0, 5);
  const rowW = shown.length * bookW + Math.max(0, shown.length - 1) * gap;
  const startX = Math.round((W - rowW) / 2);
  const bookY = plankY - bookH + 4;

  const layers = [
    { input: await wood('wood-back.jpg', W - side * 2, plankY - innerTop), left: side, top: innerTop },
    { input: await wood('wood-h.jpg', W + 0, crownH), left: 0, top },
    { input: await wood('wood-v.jpg', side, H - top - crownH - baseH), left: 0, top: innerTop },
    { input: await wood('wood-v.jpg', side, H - top - crownH - baseH), left: W - side, top: innerTop },
    { input: await wood('wood-h.jpg', W - side * 2, plankH), left: side, top: plankY },
    { input: await wood('wood-h.jpg', W, baseH), left: 0, top: H - baseH },
  ];

  // Luz, sombras internas e sombra dos livros
  layers.push({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".85"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
        <radialGradient id="glow" cx="50%" cy="0%" r="60%"><stop offset="0" stop-color="#ffbb6b" stop-opacity=".32"/><stop offset="1" stop-color="#ffbb6b" stop-opacity="0"/></radialGradient>
        <linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".65"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
        <linearGradient id="r" x1="1" x2="0"><stop offset="0" stop-color="#000" stop-opacity=".65"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
        <linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b0f07"/><stop offset="1" stop-color="#2a170b"/></linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="9"/></filter>
      </defs>
      <rect x="${side}" y="${innerTop}" width="${W - side * 2}" height="70" fill="url(#topShade)"/>
      <rect x="${side}" y="${innerTop}" width="${W - side * 2}" height="${plankY - innerTop}" fill="url(#glow)"/>
      <rect x="${side}" y="${innerTop}" width="140" height="${plankY - innerTop}" fill="url(#l)"/>
      <rect x="${W - side - 140}" y="${innerTop}" width="140" height="${plankY - innerTop}" fill="url(#r)"/>
      <rect x="0" y="${top + crownH - 4}" width="${W}" height="4" fill="#000" opacity=".35"/>
      <rect x="${side}" y="${plankY}" width="${W - side * 2}" height="2" fill="#ffe2bd" opacity=".45"/>
      <rect x="0" y="${H - baseH}" width="${W}" height="2" fill="#ffe2bd" opacity=".3"/>
      <rect x="${side - 3}" y="${innerTop}" width="3" height="${H - innerTop - baseH}" fill="#000" opacity=".4"/>
      <rect x="${W - side}" y="${innerTop}" width="3" height="${H - innerTop - baseH}" fill="#000" opacity=".4"/>
      ${shown.map((_, i) => `<rect x="${startX + i * (bookW + gap) + 10}" y="${bookY + 14}" width="${bookW}" height="${bookH - 10}" rx="4" fill="#000" opacity=".7" filter="url(#blur)"/>`).join('')}
      <rect x="0" y="0" width="${W}" height="${top}" fill="url(#band)"/>
    </svg>`),
    left: 0,
    top: 0,
  });

  // Capas
  const covers = await Promise.all(shown.map((b) => coverBuffer(b, bookW, bookH)));
  covers.forEach((buf, i) => layers.push({ input: buf, left: startX + i * (bookW + gap), top: bookY }));

  // Lombada (sombra à esquerda de cada capa) + texto da faixa
  const name = user.name.length > 28 ? user.name.slice(0, 27) + '…' : user.name;
  layers.push({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="sp" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
      <linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      ${shown.map((_, i) => {
        const x = startX + i * (bookW + gap);
        return `<rect x="${x}" y="${bookY}" width="14" height="${bookH}" fill="url(#sp)"/><rect x="${x}" y="${bookY}" width="${bookW}" height="${bookH}" fill="url(#gl)"/>`;
      }).join('')}
      ${shown.length ? '' : `<text x="${W / 2}" y="${(innerTop + plankY) / 2}" text-anchor="middle" font-family="${FONT}" font-size="30" fill="#f0dcc0">Estante novinha, esperando os primeiros livros</text>`}
      <text x="60" y="62" font-family="${FONT}" font-weight="bold" font-size="40" fill="#f6e7cf">Estante de ${xml(name)}</text>
      <text x="60" y="98" font-family="${FONT}" font-size="22" fill="#d6b88f">@${xml(user.username)} · ${total} ${total === 1 ? 'livro' : 'livros'}${total > shown.length && shown.length ? ` · e mais ${total - shown.length}` : ''}</text>
      <text x="${W - 60}" y="80" text-anchor="end" font-family="${FONT}" font-size="28" font-weight="bold" fill="#f6e7cf">Capa <tspan fill="#f0a36f" font-style="italic" font-weight="normal">Dura</tspan></text>
    </svg>`),
    left: 0,
    top: 0,
  });

  const out = await sharp({ create: { width: W, height: H, channels: 3, background: '#2a170b' } })
    .composite(layers)
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

module.exports = { shelfImage, PALETTE };
