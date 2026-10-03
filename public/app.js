// =========================================================
// Capa Dura — app (rotas por hash, sem framework)
// =========================================================
const state = { user: null };
const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Sem conexão agora. Confira a internet e tente de novo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Algo não saiu como esperado. Aguarde um instante e tente de novo.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0];

// Cor estável a partir de um texto (avatar e capas desenhadas)
function hue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function avatar(user, size = '') {
  if (user.avatar) return `<img class="avatar ${size}" src="${esc(user.avatar)}" alt="">`;
  const letter = (user.name || user.username || '?').trim()[0]?.toUpperCase() || '?';
  return `<div class="avatar ${size}" style="background:linear-gradient(135deg,hsl(${hue(user.username)} 50% 46%),hsl(${(hue(user.username) + 40) % 360} 45% 32%))">${esc(letter)}</div>`;
}

// Capa desenhada para livro sem foto: tecido colorido, moldura dourada e título centralizado
// (mesma paleta da imagem de prévia gerada no servidor, em og.js)
const COVER_PALETTE = [
  ['#6d1f2b', '#e0bd72'],
  ['#1f2f4d', '#d9b46a'],
  ['#234a35', '#e3c47c'],
  ['#1d4f55', '#e7cf8f'],
  ['#4a2545', '#e2bf7d'],
  ['#8c3b24', '#f2d6a2'],
  ['#3a3f47', '#d9b46a'],
  ['#5b4a1e', '#f0dca8'],
];
const coverColors = (title) => COVER_PALETTE[hue(title || '') % COVER_PALETTE.length];
function fakeCover(book) {
  const [bg, gold] = coverColors(book.title);
  const title = String(book.title || 'Sem título');
  const longest = Math.max(...title.split(/\s+/).map((w) => w.length));
  // tamanho da letra pela palavra mais longa, para não quebrar palavra no meio
  const size =
    longest > 16 ? 'xxs' : longest > 12 || title.length > 48 ? 'xs' : longest > 9 || title.length > 34 ? 'sm' : longest > 7 || title.length > 16 ? 'md' : 'lg';
  const author = String(book.authors || '').split(',')[0].trim();
  return `<div class="fake-cover" style="--c:${bg};--g:${gold}">
    <div class="fc-frame">
      <span class="fc-orn">✦</span>
      <span class="fc-title fc-${size}">${esc(title)}</span>
      <span class="fc-rule"></span>
      <span class="fc-author">${esc(author)}</span>
    </div></div>`;
}
function coverHtml(book) {
  if (!book.cover_url) return fakeCover(book);
  // se a imagem falhar, coverFail troca pela capa desenhada (título/autor vão em data-*, já escapados)
  return `<img src="${esc(book.cover_url)}" alt="Capa de ${esc(book.title)}" decoding="async"
    data-t="${esc(book.title)}" data-a="${esc(book.authors)}" onerror="coverFail(this)">`;
}
window.coverFail = (img) => {
  img.onerror = null;
  img.outerHTML = fakeCover({ title: img.dataset.t, authors: img.dataset.a });
};

// Capa em 3D (lombada + capa em perspectiva) — a mesma da estante, usada no site todo
function cover3d(b, extra = '') {
  const [bg] = coverColors(b.title);
  const fmt = b.format && b.format !== 'fisico' ? b.format : '';
  return `<div class="cover3d ${fmt ? 'is-' + fmt : ''}" style="--spine:${bg};--spine-2:color-mix(in srgb, ${bg} 55%, #000)">
    <span class="b-spine"><span>${esc(b.title)}</span></span>
    <span class="b-front"><span class="b-screen">${coverHtml(b)}</span>${fmtTag(b)}${extra}</span>
  </div>`;
}
function timeAgo(iso) {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const s = Math.max(1, (Date.now() - d) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 2592000) return `${Math.floor(s / 86400)} d`;
  return d.toLocaleDateString('pt-BR');
}
// Ícones de linha (estilo Lucide), desenhados em SVG para combinar com o menu
const ICONS = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  penLine: '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  pencil: '<path d="M16.4 3.6a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/><path d="m14 6 4 4"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.7H16c3 0 5.5-2.5 5.5-5.6C21.9 6 17.5 2 12 2z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-12.1 7.6L3 21l1.9-5.9A8.5 8.5 0 1 1 21 11.5z"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  dna: '<path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12M8 7h8M8 17h8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  bookOpen: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  ereader: '<rect x="4" y="2" width="16" height="20" rx="2"/><rect x="7" y="5" width="10" height="11" rx="1"/><path d="M10 19h4"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  feather: '<path d="M20.2 12.2a6 6 0 0 0-8.5-8.5L5 10.5V19h8.5z"/><path d="M16 8 2 22M17.5 15H9"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M16 8v8"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9zM19 3v4M21 5h-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  ghost: '<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const stars = (avg) => `${ic('star', 'fill')} ${String(avg).replace('.', ',')}`;

// Formato do livro: físico, e-book, Kindle ou audiolivro
const FORMATS = {
  fisico: { icon: 'book', label: 'Físico' },
  ebook: { icon: 'tablet', label: 'E-book' },
  kindle: { icon: 'ereader', label: 'Kindle' },
  audio: { icon: 'headphones', label: 'Audiolivro' },
};
const fmtLabel = (k) => `${ic(FORMATS[k].icon)} ${FORMATS[k].label}`;
const fmtTag = (b) =>
  b.format && b.format !== 'fisico' ? `<span class="fmt-tag fmt-${b.format}">${b.format === 'kindle' ? 'kindle' : fmtLabel(b.format)}</span>` : '';

const loadingHtml = '<div class="loading"><div class="spinner"></div></div>';

// ---------- Compartilhar ----------
async function shareLink(path, title, text) {
  const url = `${location.origin}${path}`;
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // a pessoa cancelou
  }
  openModal(`
    <h2>Compartilhar</h2>
    <p class="muted">${esc(text)}</p>
    <div class="row" style="flex-wrap:nowrap">
      <input class="input" id="share-url" value="${esc(url)}" readonly>
      <button class="btn" id="copy-url">Copiar</button>
    </div>
    <div class="row" style="margin-top:14px;gap:8px">
      <a class="btn ghost small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}">WhatsApp</a>
      <a class="btn ghost small" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">Telegram</a>
      <a class="btn ghost small" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">X / Twitter</a>
      <a class="btn ghost small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>
    </div>`);
  $('#copy-url').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      $('#share-url').select();
      document.execCommand('copy');
    }
    toast('Link copiado!');
  };
}

// ---------- Modal ----------
const modal = $('#modal');
let onModalClose = null;
function openModal(html, onClose) {
  $('#modal-body').innerHTML = html;
  modal.hidden = false;
  onModalClose = onClose || null;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  if (modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  const cb = onModalClose;
  onModalClose = null;
  cb?.();
}
modal.addEventListener('click', (e) => e.target.closest('[data-close]') && closeModal());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

// ---------- Estante de madeira (prateleiras) ----------
const SHELF_STYLES = [
  ['nogueira', 'Nogueira', 'Madeira escura clássica'],
  ['carvalho', 'Carvalho', 'Madeira clara e aconchegante'],
  ['rustica', 'Rústica', 'Madeira de demolição'],
  ['branca', 'Branca', 'Laca moderna e limpa'],
  ['industrial', 'Industrial', 'Metal preto e tijolinho'],
  ['rgb', 'RGB', 'Preto fosco com LED arco-íris'],
  ['classica', 'Clássica', 'Mogno com frisos dourados'],
  ['escandinava', 'Escandinava', 'Carvalho claro e fundo branco'],
  ['pintada', 'Pintada', 'Madeira rústica verde-oliva'],
];

// style: modelo da estante (cada pessoa escolhe o seu; fica guardado no container)
let lastShelves = [];
function renderShelf(container, books, emptyText, style) {
  if (style) container._style = style;
  lastShelves = lastShelves.filter((s) => document.body.contains(s.container));
  lastShelves.push({ container, books, emptyText });
  drawShelf(container, books, emptyText);
}
function bookcaseHtml(rows, emptyText, style = 'nogueira') {
  return `<div class="bookcase" data-style="${esc(style)}">
    <div class="bc-crown"></div>
    <div class="bc-body">${rows
      .map(
        (row) => `<div class="shelf-row"><div class="shelf">${
          row.length ? row.map(shelfBook).join('') : `<div class="shelf-empty">${emptyText}</div>`
        }</div><div class="plank"></div></div>`
      )
      .join('')}</div>
    <div class="bc-base"></div>
  </div>`;
}
function drawShelf(container, books, emptyText) {
  const small = window.innerWidth <= 640;
  const bookW = small ? 84 : 122; // capa + lombada (igual ao CSS de .book)
  const gap = small ? 12 : 18;
  const width = container.clientWidth - (small ? 68 : 108);
  const perShelf = Math.max(2, Math.floor((width + gap) / (bookW + gap)));
  let rows = [];
  for (let i = 0; i < books.length; i += perShelf) rows.push(books.slice(i, i + perShelf));
  if (!rows.length) rows.push([]);
  // _maxRows: mostra só algumas prateleiras (ex.: página inicial) com botão para ver o resto
  const max = container._maxRows;
  const hidden = max && rows.length > max ? books.length - perShelf * max : 0;
  if (hidden) rows = rows.slice(0, max);
  container.innerHTML =
    bookcaseHtml(rows, emptyText, container._style || state.user?.shelf_style) +
    (hidden ? `<div class="more-row"><button class="btn ghost" data-more>${ic('plus')} Ver mais ${plural(hidden, 'livro', 'livros')}</button></div>` : '');
  container.querySelector('[data-more]')?.addEventListener('click', () => {
    container._maxRows = 0;
    drawShelf(container, books, emptyText);
  });
  if (container._onSort) enableSort(container);
}

// Livro em pé na prateleira: lombada colorida + capa em perspectiva
function shelfBook(b) {
  const [bg] = coverColors(b.title);
  const fmt = b.format && b.format !== 'fisico' ? b.format : '';
  return `<button class="book ${fmt ? 'is-' + fmt : ''}" data-book="${b.id}" title="${esc(b.title)}${b.authors ? ' — ' + esc(b.authors) : ''}${fmt ? ` (${FORMATS[fmt].label})` : ''}"
      style="--spine:${bg};--spine-2:color-mix(in srgb, ${bg} 55%, #000)">
    <span class="b-spine"><span>${esc(b.title)}</span></span>
    <span class="b-front"><span class="b-screen">${coverHtml(b)}</span>${fmtTag(b)}</span>
    <span class="badges">${b.rating_count ? `<span class="star-badge">${stars(b.rating_avg)}</span>` : ''}${b.like_count ? `<span>${ic('heart', 'fill')} ${b.like_count}</span>` : ''}${b.comment_count ? `<span>${ic('message')} ${b.comment_count}</span>` : ''}</span>
  </button>`;
}

// Cartão de livro (carrosséis e grades)
function bookCard(b, { reason = '', rank = 0, owner = false } = {}) {
  const statsLine = [b.rating_count ? `<span class="st">${stars(b.rating_avg)}</span>` : '', b.like_count ? `<span>${ic('heart', 'fill')} ${b.like_count}</span>` : '', b.comment_count ? `<span>${ic('message')} ${b.comment_count}</span>` : '']
    .filter(Boolean)
    .join('');
  return `<button class="bcard" data-book="${b.id}">
    <div class="bcard-cover">${cover3d(b)}${rank ? `<span class="bcard-rank">${rank}</span>` : ''}</div>
    <div class="bcard-title">${esc(b.title)}</div>
    <div class="bcard-sub">${esc(String(b.authors || '').split(',')[0])}${owner ? ` · @${esc(b.username)}` : ''}</div>
    ${reason ? `<div class="bcard-reason">${esc(reason)}</div>` : statsLine ? `<div class="bcard-stats">${statsLine}</div>` : ''}
  </button>`;
}

// Arrastar e soltar livros entre prateleiras (SortableJS; funciona com toque)
function enableSort(container) {
  if (!window.Sortable) return;
  container.querySelectorAll('.shelf').forEach((shelf) =>
    Sortable.create(shelf, {
      group: 'estante',
      animation: 200,
      draggable: '.book',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      delay: 250, // no celular: segurar um instante antes de arrastar (toque rápido abre o livro)
      delayOnTouchOnly: true,
      touchStartThreshold: 6,
      ghostClass: 'drag-ghost',
      chosenClass: 'drag-chosen',
      dragClass: 'drag-flying',
      onChoose: () => navigator.vibrate?.(30),
      onStart: () => (container._dragAt = Infinity),
      onEnd: (evt) => {
        container._dragAt = Date.now();
        if (evt.from !== evt.to || evt.oldIndex !== evt.newIndex) container._onSort();
      },
    })
  );
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => lastShelves.forEach((s) => document.body.contains(s.container) && drawShelf(s.container, s.books, s.emptyText)), 150);
});
view.addEventListener('click', (e) => {
  const b = e.target.closest('[data-book]');
  if (!b) return;
  const sortable = b.closest('.bookcase')?.parentElement;
  if (sortable && Date.now() - (sortable._dragAt || 0) < 400) return; // clique logo após arrastar
  openBook(b.dataset.book);
});

// ---------- Tema claro / escuro ----------
// Segue o aparelho até a pessoa escolher; a escolha fica salva neste navegador
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function savedTheme() {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
}
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light')) === 'dark';
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name=theme-color]').content = isDark() ? '#14100d' : '#f6efe4';
  const btn = $('#theme-toggle');
  if (btn) btn.innerHTML = themeIcon();
}
const themeIcon = () =>
  isDark()
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  try {
    localStorage.setItem('theme', next);
  } catch {}
  applyTheme(next);
}
applyTheme(savedTheme());
darkQuery.addEventListener?.('change', () => applyTheme(savedTheme()));

// ---------- Cabeçalho ----------
function renderAuthArea() {
  const area = $('#auth-area');
  const themeBtn = `<button class="icon-btn" id="theme-toggle" title="Modo claro / escuro" aria-label="Alternar modo claro e escuro">${themeIcon()}</button>`;
  document.querySelectorAll('.needs-auth').forEach((el) => (el.hidden = !state.user));
  document.querySelectorAll('.needs-guest').forEach((el) => (el.hidden = !!state.user));
  if (state.user) {
    area.innerHTML = `${themeBtn}
      <button class="icon-btn bell" id="bell" title="Notificações" aria-label="Notificações"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg><span class="bell-dot" id="bell-dot" hidden></span></button>
      <a href="#/u/${esc(state.user.username)}" title="Meu perfil">${avatar(state.user, 'sm')}</a>
      <button class="icon-btn" id="logout" title="Sair" aria-label="Sair"><svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg></button>`;
    $('#logout').onclick = async () => {
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      state.user = null;
      renderAuthArea();
      location.hash = '#/';
    };
  } else {
    area.innerHTML = `${themeBtn}<a class="btn small" href="#/entrar">Entrar</a>`;
  }
  $('#theme-toggle').onclick = toggleTheme;
  $('#bell')?.addEventListener('click', openNotifications);
  refreshBell();
}
$('#scan-top').onclick = () => openScanner();
$('#scan-tab').onclick = () => openScanner();
$('#top-search').onsubmit = (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  location.hash = `#/buscar?q=${encodeURIComponent(q)}`;
};

// ---------- Notificações ----------
let unread = 0;
async function refreshBell() {
  if (!state.user) return;
  try {
    ({ unread } = await api('/api/notifications/count'));
  } catch {
    return;
  }
  const dot = $('#bell-dot');
  if (dot) {
    dot.hidden = !unread;
    dot.textContent = unread > 9 ? '9+' : unread;
  }
  document.title = (unread ? `(${unread}) ` : '') + document.title.replace(/^\(\d+\+?\) /, '');
}
setInterval(() => document.visibilityState === 'visible' && refreshBell(), 30000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshBell());

function notifText(n) {
  const who = `<b>${esc(n.name)}</b>`;
  const book = `<i>${esc(n.book_title || 'um livro')}</i>`;
  switch (n.type) {
    case 'follow': return `${who} começou a seguir você`;
    case 'like': return `${who} curtiu ${book}`;
    case 'favorite': return `${who} favoritou ${book}`;
    case 'rating': return `${who} deu <span class="notif-stars">${ic('star', 'fill').repeat(Number(n.extra) || 0)}</span> para ${book}`;
    case 'comment': return `${who} comentou em ${book}: “${esc(n.extra)}”`;
    default: return `${who} interagiu com você`;
  }
}

async function openNotifications() {
  openModal(loadingHtml);
  let items;
  try {
    ({ items } = await api('/api/notifications'));
  } catch (e) {
    $('#modal-body').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  $('#modal-body').innerHTML = `
    <h2>Notificações</h2>
    ${
      items.length
        ? `<div class="notif-list">${items
            .map(
              (n) => `<div class="notif ${n.read_at ? '' : 'unread'}" data-notif-type="${n.type}" data-user="${esc(n.username)}" data-book-id="${n.book_id || ''}">
                ${avatar(n, 'sm')}
                <div class="notif-text">${notifText(n)}<small>${timeAgo(n.created_at)}</small></div>
                ${
                  n.type === 'follow'
                    ? followBtn(n.username, n.following_back)
                    : n.book_id
                      ? `<div class="notif-book">${cover3d({ title: n.book_title, cover_url: n.book_cover })}</div>`
                      : ''
                }
              </div>`
            )
            .join('')}</div>`
        : `<div class="empty"><div class="big">${ic('bell')}</div>Nada por aqui ainda. Quando alguém seguir você ou interagir com seus livros, aparece aqui.</div>`
    }`;
  $('#modal-body').querySelectorAll('.notif').forEach(
    (el) =>
      (el.onclick = (e) => {
        if (e.target.closest('[data-follow]')) return;
        if (el.dataset.bookId) {
          onModalClose = null;
          openBook(el.dataset.bookId);
        } else {
          closeModal();
          location.hash = `#/u/${el.dataset.user}`;
        }
      })
  );
  if (unread) {
    await api('/api/notifications/read', { method: 'POST' }).catch(() => {});
    refreshBell();
  }
}

// ---------- Início ----------
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

async function pageHome() {
  const n = navSeq;
  view.innerHTML = loadingHtml;
  const [feed, recs, activity] = await Promise.all([
    api('/api/feed'),
    state.user ? api('/api/recommendations').catch(() => ({ books: [] })) : null,
    state.user ? api('/api/activity').catch(() => ({ items: [] })) : null,
  ]);
  if (isStale(n)) return;
  const { recent, trending, people, stats } = feed;
  const heroBooks = [...trending, ...recent].filter((b) => b.cover_url).slice(0, 3);
  while (heroBooks.length < 3 && recent[heroBooks.length]) heroBooks.push(recent[heroBooks.length]);

  const top = state.user
    ? `<section class="greet">
        ${avatar(state.user)}
        <div>
          <h1>${greeting()}, ${esc(firstName(state.user.name))}!</h1>
          <p>O que você está lendo hoje? Escaneie um livro e ele vai direto pra sua estante.</p>
          <a class="greet-dna" href="#/dna">${ic('dna')} Ver meu DNA literário →</a>
        </div>
        <button class="btn" id="greet-scan">${ic('scan')}Escanear livro</button>
      </section>`
    : `<section class="hero">
        <div>
          <div class="eyebrow">Sua estante social</div>
          <h1>Mostre seus livros de <em>capa dura</em> pro mundo.</h1>
          <p>Aponte a câmera para o código de barras e o livro aparece na sua estante, com capa e resumo. Descubra seu DNA literário e com quem você mais combina.</p>
          <div class="hero-actions">
            <a class="btn" href="#/entrar">Criar minha estante</a>
            <a class="btn light" href="#/buscar">Explorar livros</a>
          </div>
          <div class="hero-stats">
            <div><b>${stats.books}</b><span>livros nas estantes</span></div>
            <div><b>${stats.readers}</b><span>leitores</span></div>
            <div><b>${stats.comments}</b><span>comentários</span></div>
          </div>
        </div>
        <div class="hero-books">${heroBooks.map((b) => `<div class="hb">${cover3d(b)}</div>`).join('')}</div>
      </section>`;

  view.innerHTML = `
    ${top}
    ${state.user ? `
      <section class="section">
        <div class="section-head"><div><div class="eyebrow">Seguindo</div><h2>O que seus amigos andam lendo</h2></div></div>
        ${activityHtml(activity?.items || [], people)}
      </section>` : ''}
    ${recs?.books?.length ? `
      <section class="section">
        <div class="section-head"><div><div class="eyebrow">Feito pra você</div><h2>Leia a seguir</h2><p>Livros das estantes da comunidade que combinam com a sua.</p></div></div>
        <div class="rail">${recs.books.map((b) => bookCard(b, { reason: b.reason })).join('')}</div>
      </section>` : ''}
    ${trending.length ? `
      <section class="section">
        <div class="section-head"><div><div class="eyebrow">Em alta</div><h2>Os mais amados</h2></div></div>
        <div class="rail">${trending.map((b, i) => bookCard(b, { rank: i < 3 ? i + 1 : 0, owner: true })).join('')}</div>
      </section>` : ''}
    ${people.length ? `
      <section class="section">
        <div class="section-head"><div><div class="eyebrow">Comunidade</div><h2>Leitores para conhecer</h2></div><a class="btn ghost small" href="#/buscar?tab=leitores">Ver todos</a></div>
        <div class="rail people-rail">${people.map(personCard).join('')}</div>
      </section>` : ''}
    <section class="section">
      <div class="section-head"><div><div class="eyebrow">Novidades</div><h2>Chegaram agora</h2></div></div>
      <div id="feed-recent"></div>
    </section>`;

  $('#greet-scan')?.addEventListener('click', openScanner);
  const recentEl = $('#feed-recent');
  recentEl._maxRows = 2;
  renderShelf(recentEl, recent.slice(0, 40), 'Nenhum livro ainda. Seja o primeiro a escanear um!');
}

// Feed: livros adicionados, notas, comentários e favoritos de quem você segue
function activityHtml(items, people) {
  if (!items.length) {
    return `<div class="act-empty card">
      <div class="big">${ic('users')}</div>
      <div><b>Siga leitores para ver aqui o que eles adicionam, avaliam e comentam.</b>
      <p class="muted" style="margin:4px 0 0">Comece pelos leitores sugeridos ou procure amigos em Descobrir.</p></div>
      <a class="btn" href="#/buscar?tab=leitores">${ic('search')} Encontrar leitores</a>
    </div>`;
  }
  // agrupa vários livros adicionados em sequência pela mesma pessoa
  const groups = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (it.type === 'add' && last?.type === 'add' && last.username === it.username) last.books.push(it);
    else groups.push({ ...it, books: [it] });
  }
  const text = (g) => {
    const who = `<a href="#/u/${esc(g.username)}"><b>${esc(g.name)}</b></a>`;
    const book = `<i>${esc(g.title)}</i>`;
    if (g.type === 'add') return g.books.length > 1 ? `${who} adicionou ${plural(g.books.length, 'livro', 'livros')} à estante` : `${who} adicionou ${book} à estante`;
    if (g.type === 'rating') return `${who} deu <span class="notif-stars">${ic('star', 'fill').repeat(Number(g.extra) || 0)}</span> para ${book}`;
    if (g.type === 'favorite') return `${who} favoritou ${book}`;
    return `${who} comentou em ${book}`;
  };
  return `<div class="act-list">${groups
    .slice(0, 10)
    .map(
      (g) => `<div class="act">
        <a href="#/u/${esc(g.username)}">${avatar(g, 'sm')}</a>
        <div class="act-body">
          <div class="act-text">${text(g)}</div>
          ${g.type === 'comment' ? `<p class="act-quote">“${esc(g.extra)}”</p>` : ''}
          <small class="muted">${timeAgo(g.at)}</small>
        </div>
        <div class="act-covers">${g.books
          .slice(0, 4)
          .map((b) => `<button class="act-cover" data-book="${b.book_id}" title="${esc(b.title)}">${cover3d({ ...b, id: b.book_id })}</button>`)
          .join('')}</div>
      </div>`
    )
    .join('')}</div>`;
}

function personCard(u) {
  return `<div class="pcard">
    <a href="#/u/${esc(u.username)}">${avatar(u)}<b>${esc(u.name)}</b><small>@${esc(u.username)} · ${plural(u.book_count, 'livro', 'livros')}</small></a>
    ${followBtn(u.username, u.is_following) || `<a class="btn ghost small" href="#/u/${esc(u.username)}">Ver estante</a>`}
  </div>`;
}

// ---------- Descobrir (busca de livros e leitores) ----------
const ost = { lang: 'pt', sort: 'rel', cover: false }; // filtros da busca na internet

async function pageSearch() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let tab = params.get('tab') === 'leitores' ? 'leitores' : 'livros';
  view.innerHTML = `
    <div class="eyebrow">Descobrir</div>
    <h1>O que você quer ler?</h1>
    <div class="search-big">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input id="q" type="search" placeholder="Título, autor, gênero, ISBN ou @leitor" autocomplete="off" value="${esc(params.get('q') || '')}">
    </div>
    <div class="tabs-line" style="margin-top:0">
      <button data-tab="livros">Livros</button>
      <button data-tab="leitores">Leitores</button>
    </div>
    <div id="results"></div>`;
  const input = $('#q');
  const results = $('#results');

  const load = async () => {
    const q = input.value.trim();
    view.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    history.replaceState(null, '', `#/buscar?${new URLSearchParams({ ...(q && { q }), ...(tab === 'leitores' && { tab }) })}`);
    if (tab === 'leitores') {
      const { users } = await api(`/api/users?q=${encodeURIComponent(q)}`);
      if (input.value.trim() !== q) return;
      results.innerHTML = users.length
        ? `<div class="people-grid">${users
            .map(
              (u) => `<div class="person-row"><a class="person" href="#/u/${esc(u.username)}" style="flex:1;min-width:0">${avatar(u, 'sm')}
              <div style="min-width:0"><b>${esc(u.name)}</b><div class="muted" style="font-size:.85rem">@${esc(u.username)} · ${plural(u.book_count, 'livro', 'livros')}</div></div></a>
              ${followBtn(u.username, u.is_following)}</div>`
            )
            .join('')}</div>`
        : `<div class="empty"><div class="big">${ic('users')}</div>Ninguém encontrado com “${esc(q)}”.</div>`;
      return;
    }
    if (!q) {
      const { trending, recent } = await api('/api/feed');
      if (input.value.trim() !== q || !document.body.contains(results)) return;
      const seen = new Set();
      const list = [...trending, ...recent].filter((b) => !seen.has(b.id) && seen.add(b.id)).slice(0, 30);
      results.innerHTML = `<p class="muted" style="margin-top:0">Em destaque nas estantes:</p><div class="book-grid">${list.map((b) => bookCard(b, { owner: true })).join('')}</div>`;
      return;
    }
    const { books } = await api(`/api/books?q=${encodeURIComponent(q)}`);
    if (input.value.trim() !== q) return; // a pessoa já digitou outra coisa
    results.innerHTML = `
      <div class="section-head" style="margin-bottom:10px"><div><h2 style="font-size:1.2rem">Nas estantes</h2></div></div>
      ${
        books.length
          ? `<p class="muted" style="margin-top:0">${plural(books.length, 'livro encontrado', 'livros encontrados')}</p><div class="book-grid">${books.map((b) => bookCard(b, { owner: true })).join('')}</div>`
          : `<p class="muted" style="margin-top:0">Ninguém tem “${esc(q)}” na estante ainda.</p>`
      }
      <section class="section">
        <div class="section-head"><div><div class="eyebrow">${ic('globe')} Na internet</div><h2 style="font-size:1.2rem">Adicione direto na sua estante</h2><p>Sem escanear: ótimo para e-books, Kindle e audiolivros.</p></div></div>
        <div class="online-tools">
          <div class="seg-mini" role="group" aria-label="Idioma">
            <button data-olang="pt" class="${ost.lang === 'pt' ? 'active' : ''}">Em português</button>
            <button data-olang="all" class="${ost.lang === 'all' ? 'active' : ''}">Todos os idiomas</button>
          </div>
          <select class="input select" data-osort>
            <option value="rel">Mais relevantes</option>
            <option value="new" ${ost.sort === 'new' ? 'selected' : ''}>Mais recentes</option>
            <option value="old" ${ost.sort === 'old' ? 'selected' : ''}>Mais antigos</option>
            <option value="az" ${ost.sort === 'az' ? 'selected' : ''}>Título (A–Z)</option>
          </select>
          <label class="check"><input type="checkbox" data-ocover ${ost.cover ? 'checked' : ''}> Só com capa</label>
        </div>
        <div id="online">${loadingHtml}</div>
      </section>`;
    loadOnline(q);
  };

  // Resultados do catálogo online, com filtros e botão de adicionar
  let online = []; // resultados como vieram (ordem de relevância)
  let shown = []; // depois de filtrar/ordenar (o índice do botão aponta para cá)
  const loadOnline = async (q) => {
    const box = $('#online');
    box.innerHTML = loadingHtml;
    try {
      ({ results: online } = await api(`/api/online-search?q=${encodeURIComponent(q)}&lang=${ost.lang}`));
    } catch {
      online = [];
    }
    if (input.value.trim() !== q || !document.body.contains(box)) return;
    drawOnline(q);
  };
  const yearOf = (r) => Number(r.edition_year || r.year) || 0;
  const drawOnline = (q) => {
    const box = $('#online');
    if (!box) return;
    shown = online.filter((r) => !ost.cover || r.cover_url);
    if (ost.sort === 'new') shown.sort((a, b) => yearOf(b) - yearOf(a));
    if (ost.sort === 'old') shown.sort((a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999));
    if (ost.sort === 'az') shown.sort((a, b) => a.title.localeCompare(b.title, 'pt'));
    box.innerHTML = shown.length
      ? `<div class="book-grid">${shown
          .map(
            (r, i) => `<div class="bcard online">
              <div class="bcard-cover">${cover3d(r)}</div>
              <div class="bcard-title">${esc(r.title)}</div>
              <div class="bcard-sub">${esc(String(r.authors || '').split(',')[0])}${r.edition_year || r.year ? ` · ${esc(r.edition_year || r.year)}` : ''}</div>
              <button class="btn small add-online" data-online="${i}">${ic('plus')} Adicionar</button>
            </div>`
          )
          .join('')}</div>`
      : `<div class="empty"><p>Não achei “${esc(q)}” na internet${ost.lang === 'pt' ? ' em português' : ''}.</p>${
          ost.lang === 'pt' ? `<button class="btn ghost" data-olang="all">${ic('globe')} Procurar em todos os idiomas</button> ` : ''
        }${
          state.user ? `<button class="btn" id="add-by-name">${ic('penLine')} Cadastrar “${esc(q)}” na mão</button>` : ''
        }</div>`;
    $('#add-by-name')?.addEventListener('click', () => {
      openModal('<div></div>', stopScanner);
      showPreview({ title: q }, '', { manual: true });
    });
  };
  results.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-online]');
    if (btn) return addOnline(shown[Number(btn.dataset.online)]);
    const lang = e.target.closest('[data-olang]');
    if (lang && lang.dataset.olang !== ost.lang) {
      ost.lang = lang.dataset.olang;
      results.querySelectorAll('.seg-mini [data-olang]').forEach((b) => b.classList.toggle('active', b.dataset.olang === ost.lang));
      loadOnline(input.value.trim());
    }
  });
  results.addEventListener('change', (e) => {
    if (e.target.matches('[data-osort]')) ost.sort = e.target.value;
    else if (e.target.matches('[data-ocover]')) ost.cover = e.target.checked;
    else return;
    drawOnline(input.value.trim());
  });
  view.querySelectorAll('[data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        load();
      })
  );
  let t;
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(load, 280);
  };
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
  load();
}

// ---------- Perfil ----------
async function pageProfile(username, startTab = 'estante') {
  const n = navSeq;
  view.innerHTML = loadingHtml;
  let data;
  try {
    data = await api(`/api/users/${encodeURIComponent(username)}`);
    if (isStale(n)) return;
  } catch (e) {
    if (isStale(n)) return;
    view.innerHTML = `<div class="empty"><div class="big">${ic('ghost')}</div><h2>Ops</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  const { user, books, favorites = [] } = data;
  const isMe = state.user?.username === user.username;
  view.innerHTML = `
    <div class="profile-banner" id="banner">${bannerInner(user, books)}${
      isMe ? `<button class="banner-edit" id="change-banner">${ic('image')}<span>Trocar capa</span></button>` : ''
    }</div>
    <div class="profile-head">
      <div class="profile-avatar">${isMe ? `<button class="avatar-edit" id="change-photo" title="Trocar foto">${avatar(user)}<span>${ic('camera')}</span></button>` : avatar(user)}</div>
      <div class="profile-info">
        <h1>${esc(user.name)}</h1>
        <div class="handle">@${esc(user.username)}</div>
      </div>
      <div class="profile-actions">
        ${
          isMe
            ? `<button class="btn ghost small grow" id="edit-profile">${ic('pencil')} Editar perfil</button>
               <button class="icon-btn lg" id="pick-style" title="Estilo da estante" aria-label="Estilo da estante">${ic('palette')}</button>`
            : state.user
              ? `<button class="btn small grow ${user.is_following ? 'ghost' : ''}" id="follow" data-follow="${esc(user.username)}">${user.is_following ? 'Seguindo ✓' : 'Seguir'}</button>`
              : `<a class="btn small grow" href="#/entrar">Entrar para seguir</a>`
        }
        <button class="icon-btn lg" id="share-shelf" title="Compartilhar estante" aria-label="Compartilhar estante">${ic('share')}</button>
      </div>
    </div>
    ${user.bio ? `<p class="profile-bio">${esc(user.bio)}</p>` : ''}
    <div class="stats">
      <span class="stat"><b>${books.length}</b><span>livros</span></span>
      <button class="stat" data-list="followers"><b id="followers-count" data-user="${esc(user.username)}">${user.followers}</b><span>seguidores</span></button>
      <button class="stat" data-list="following"><b>${user.following}</b><span>seguindo</span></button>
      <span class="stat"><b>${favorites.length}</b><span>favoritos</span></span>
    </div>
    <div id="match"></div>
    <div class="tabs-line">
      <button data-tab="estante">${ic('bookOpen')} Estante<span class="count">${books.length}</span></button>
      <button data-tab="favoritos">${ic('star')} Favoritos<span class="count">${favorites.length}</span></button>
      <button data-tab="dna">${ic('dna')} DNA<span class="desk-only">literário</span></button>
    </div>
    <div id="tab-body"></div>`;

  const emptyMsg = isMe ? 'Sua estante está vazia. Toque em “Escanear” para adicionar o primeiro livro.' : 'Essa estante ainda está vazia.';
  const showTab = (tab) => {
    view.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const body = $('#tab-body');
    if (tab === 'estante') {
      body.innerHTML = `${shelfToolbar(books)}${
        isMe && books.length > 1
          ? `<p class="muted sort-hint" id="sort-hint">${ic('move')} ${matchMedia('(pointer: coarse)').matches ? 'Segure um livro e arraste' : 'Arraste os livros'} para mudar a ordem.</p>`
          : ''
      }<div id="profile-shelf" class="${isMe ? 'can-sort' : ''}"></div>`;
      const shelfEl = $('#profile-shelf');
      // Na própria estante, arrastar muda a ordem: salva e redistribui as prateleiras
      if (isMe)
        shelfEl._onSort = async () => {
          const ids = [...shelfEl.querySelectorAll('[data-book]')].map((el) => Number(el.dataset.book));
          const byId = new Map(books.map((b) => [b.id, b]));
          books.splice(0, books.length, ...ids.map((id) => byId.get(id)));
          drawShelf(shelfEl, books, emptyMsg);
          try {
            await api('/api/books/order', { method: 'PUT', body: { ids } });
            toast('Lugar salvo ✓');
          } catch (err) {
            toast(err.message);
          }
        };
      renderShelf(shelfEl, books, emptyMsg, user.shelf_style);
      wireShelfToolbar(body, shelfEl, books, emptyMsg, isMe);
    } else if (tab === 'favoritos') {
      body.innerHTML = `${shelfToolbar(favorites)}<div id="fav-shelf"></div>`;
      const favEmpty = isMe ? 'Abra qualquer livro e toque em Favoritar para guardar aqui.' : 'Nenhum favorito ainda.';
      renderShelf($('#fav-shelf'), favorites, favEmpty, user.shelf_style);
      wireShelfToolbar(body, $('#fav-shelf'), favorites, favEmpty, false);
    } else {
      renderDna(body, user, isMe);
    }
  };
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(startTab);

  if (state.user && !isMe) renderMatch($('#match'), user);
  view.querySelectorAll('[data-list]').forEach((b) => (b.onclick = () => showFollowList(user.username, b.dataset.list)));
  $('#share-shelf').onclick = () =>
    shareLink(`/u/${user.username}`, `Estante de ${user.name}`, isMe ? '📚 Olha a minha estante no Capa Dura!' : `📚 Olha a estante de ${user.name} no Capa Dura!`);
  $('#edit-profile')?.addEventListener('click', editProfile);
  $('#change-photo')?.addEventListener('click', changePhoto);
  $('#change-banner')?.addEventListener('click', () =>
    openBannerPicker(user, books, (banner) => {
      user.banner = banner;
      const el = $('#banner');
      el.className = 'profile-banner';
      el.querySelectorAll('.collage, .banner-photo').forEach((x) => x.remove());
      el.insertAdjacentHTML('afterbegin', bannerInner(user, books));
      applyBannerClass(el, banner);
    })
  );
  applyBannerClass($('#banner'), user.banner);
  $('#pick-style')?.addEventListener('click', () =>
    openStylePicker(books, (style) => {
      user.shelf_style = style;
      view.querySelectorAll('#profile-shelf, #fav-shelf').forEach((el) => {
        el._style = style;
        const entry = lastShelves.find((s) => s.container === el);
        if (entry) drawShelf(el, entry.books, entry.emptyText);
      });
    })
  );
}

// Escolher o modelo da estante (com prévia de cada um)
function openStylePicker(books, onChange) {
  const sample = books.slice(0, 4);
  while (sample.length < 4) sample.push({ id: 0, title: ['Dom Casmurro', 'Duna', 'Ensaio', 'Torto Arado'][sample.length], authors: '' });
  const current = state.user.shelf_style || 'nogueira';
  openModal(`
    <h2>Estilo da estante</h2>
    <p class="muted">Escolha como sua estante aparece pra você e pra quem visitar seu perfil.</p>
    <div class="style-grid">${SHELF_STYLES.map(
      // div (e não button): a prévia tem livros que já são <button>, e botão dentro de botão quebra o HTML
      ([key, name, desc]) => `<div class="style-opt ${key === current ? 'active' : ''}" data-style-opt="${key}" role="button" tabindex="0" aria-label="Estante ${name}">
        ${bookcaseHtml([sample], '', key)}
        <b>${name}</b><small>${desc}</small>
      </div>`
    ).join('')}</div>`);
  $('#modal-body').querySelectorAll('[data-style-opt]').forEach((btn) => {
    btn.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), btn.click());
  });
  $('#modal-body').querySelectorAll('[data-style-opt]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        const style = btn.dataset.styleOpt;
        if (btn.classList.contains('active')) return;
        try {
          const { user } = await api('/api/me', { method: 'PUT', body: { name: state.user.name, shelf_style: style } });
          state.user = user;
          $('#modal-body').querySelectorAll('[data-style-opt]').forEach((b) => b.classList.toggle('active', b === btn));
          onChange(style);
          toast(`Estante ${SHELF_STYLES.find((s) => s[0] === style)[1]} aplicada ✓`);
        } catch (err) {
          toast(err.message);
        }
      })
  );
}

// ---------- Capa (banner) do perfil ----------
const BANNER_PRESETS = [
  ['por-do-sol', 'Pôr do sol'],
  ['floresta', 'Floresta'],
  ['oceano', 'Oceano'],
  ['noite', 'Noite estrelada'],
  ['aurora', 'Aurora'],
  ['biblioteca', 'Biblioteca'],
  ['cafe', 'Café'],
  ['papel', 'Papel antigo'],
];
// foto enviada, modelo pronto ou (padrão) mosaico desfocado das capas da estante
function bannerInner(user, books) {
  const b = user.banner || '';
  if (b.startsWith('/api/')) return `<div class="banner-photo" style="background-image:url('${esc(b)}')"></div>`;
  if (b.startsWith('preset:')) return '';
  const covers = books.filter((x) => x.cover_url).slice(0, 5);
  return `<div class="collage">${covers.map((x) => `<div style="background-image:url('${esc(x.cover_url)}')"></div>`).join('')}</div>`;
}
function applyBannerClass(el, banner) {
  if (!el) return;
  [...el.classList].filter((c) => c.startsWith('bn-')).forEach((c) => el.classList.remove(c));
  if (String(banner || '').startsWith('preset:')) el.classList.add(`bn-${banner.slice(7)}`);
}

// Reduz a foto no navegador antes de enviar (o servidor recorta no formato da capa)
function pickBannerImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1800 / img.naturalWidth); // cabe no limite de envio da Vercel (4,5 MB)
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

function openBannerPicker(user, books, onChange) {
  const current = user.banner || '';
  const tile = (key, label, inner, cls = '') =>
    `<button class="banner-opt ${cls} ${current === key || (key === 'auto' && !current) ? 'active' : ''}" data-banner="${key}">
      <span class="banner-prev profile-banner ${key.startsWith('preset:') ? 'bn-' + key.slice(7) : ''}">${inner}</span><b>${label}</b>
    </button>`;
  openModal(`
    <h2>Capa do perfil</h2>
    <p class="muted">A imagem que aparece no topo da sua estante.</p>
    <button class="btn" id="banner-upload" style="margin:6px 0 4px">${ic('camera')} Enviar uma foto</button>
    <div class="banner-grid">
      ${tile('auto', 'Automática (capas da estante)', bannerInner({ banner: '' }, books))}
      ${current.startsWith('/api/') ? tile(current, 'Sua foto', `<div class="banner-photo" style="background-image:url('${esc(current)}')"></div>`) : ''}
      ${BANNER_PRESETS.map(([k, l]) => tile(`preset:${k}`, l, '')).join('')}
    </div>`);
  const save = async (body, btn) => {
    try {
      if (btn) btn.disabled = true;
      const { banner } = await api('/api/me/banner', { method: 'PUT', body });
      onChange(banner);
      closeModal();
      toast('Capa atualizada!');
    } catch (err) {
      toast(err.message);
      if (btn) btn.disabled = false;
    }
  };
  $('#banner-upload').onclick = async (e) => {
    const image = await pickBannerImage();
    if (image) save({ image }, e.currentTarget);
  };
  $('#modal-body').querySelectorAll('[data-banner]').forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.banner;
        if (k === current || (k === 'auto' && !current)) return closeModal();
        if (k.startsWith('/api/')) return closeModal();
        save(k === 'auto' ? {} : { preset: k.slice(7) }, b);
      })
  );
}

// ---------- Filtros e busca dentro de uma estante ----------
const SORTS = [
  ['ordem', 'Ordem da estante'],
  ['titulo', 'Título (A–Z)'],
  ['autor', 'Autor (A–Z)'],
  ['recentes', 'Adicionados recentemente'],
  ['nota', 'Melhor nota'],
  ['curtidos', 'Mais curtidos'],
  ['ano', 'Ano de publicação'],
];
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function shelfToolbar(books) {
  if (books.length < 2) return '';
  return `<div class="shelf-tools">
    <div class="shelf-tools-row">
      <div class="shelf-search">
        ${ic('search')}
        <input type="search" data-f="q" placeholder="Buscar nesta estante…" autocomplete="off" enterkeyhint="search">
      </div>
      <select class="input select desk-only" data-f="sort" aria-label="Ordenar">${SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="filter-btn" data-f="open">${ic('sliders')}<span>Filtros</span><b data-f="badge" hidden></b></button>
    </div>
    <div class="active-chips" data-f="chips"></div>
  </div>`;
}

// Busca, filtros e ordem dentro de uma estante. Arrastar para reordenar só vale na ordem original sem filtros.
function wireShelfToolbar(box, shelfEl, books, emptyMsg, canSort) {
  const tools = $('.shelf-tools', box);
  if (!tools) return;
  const all = books.slice();
  const st = { q: '', genre: '', sort: 'ordem', fmt: '' };
  const genres = [...new Map(all.filter((b) => b.genre).map((b) => [fold(b.genre), b.genre.trim()])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
  const formats = Object.keys(FORMATS).filter((k) => all.some((b) => (b.format || 'fisico') === k));
  const sorters = {
    titulo: (a, b) => a.title.localeCompare(b.title, 'pt'),
    autor: (a, b) => (a.authors || '~').localeCompare(b.authors || '~', 'pt'),
    recentes: (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id,
    nota: (a, b) => (b.rating_avg || 0) - (a.rating_avg || 0) || b.rating_count - a.rating_count,
    curtidos: (a, b) => b.like_count - a.like_count,
    ano: (a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999),
  };
  const filterList = (s) => {
    const q = fold(s.q.trim());
    let list = all.filter(
      (b) =>
        (!q || fold(`${b.title} ${b.authors} ${b.genre} ${b.publisher} ${b.isbn}`).includes(q)) &&
        (!s.genre || fold(b.genre) === s.genre) &&
        (!s.fmt || (b.format || 'fisico') === s.fmt)
    );
    if (sorters[s.sort]) list = list.slice().sort(sorters[s.sort]);
    return list;
  };
  const apply = () => {
    const list = filterList(st);
    const filtered = Boolean(st.q.trim() || st.genre || st.fmt || st.sort !== 'ordem');
    shelfEl._onSort = filtered ? null : shelfEl._sortFn;
    shelfEl.classList.toggle('can-sort', canSort && !filtered);
    $('#sort-hint', box)?.toggleAttribute('hidden', filtered);
    const entry = lastShelves.find((s) => s.container === shelfEl);
    if (entry) entry.books = filtered ? list : books;
    drawShelf(shelfEl, filtered ? list : books, filtered ? 'Nenhum livro com esses filtros.' : emptyMsg);

    // selo com o número de filtros e chips removíveis
    const active = [
      st.sort !== 'ordem' && { k: 'sort', label: SORTS.find(([k]) => k === st.sort)[1] },
      st.fmt && { k: 'fmt', label: fmtLabel(st.fmt) },
      st.genre && { k: 'genre', label: esc(genres.find(([k]) => k === st.genre)?.[1] || '') },
    ].filter(Boolean);
    const badge = $('[data-f=badge]', tools);
    badge.hidden = !active.length;
    badge.textContent = active.length;
    $('[data-f=sort]', tools).value = st.sort;
    $('[data-f=chips]', tools).innerHTML = filtered
      ? `<span class="muted count">${list.length} de ${plural(all.length, 'livro', 'livros')}</span>${active
          .map((a) => `<button class="achip" data-clear="${a.k}">${a.label}<span aria-label="remover">×</span></button>`)
          .join('')}${active.length > 1 ? '<button class="link-btn" data-clear="all">Limpar tudo</button>' : ''}`
      : '';
  };
  shelfEl._sortFn = shelfEl._onSort;

  let t;
  $('[data-f=q]', tools).oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => ((st.q = e.target.value), apply()), 180);
  };
  $('[data-f=sort]', tools).onchange = (e) => ((st.sort = e.target.value), apply());
  $('[data-f=chips]', tools).onclick = (e) => {
    const c = e.target.closest('[data-clear]');
    if (!c) return;
    if (c.dataset.clear === 'all') Object.assign(st, { genre: '', fmt: '', sort: 'ordem' });
    else st[c.dataset.clear] = c.dataset.clear === 'sort' ? 'ordem' : '';
    apply();
  };

  // Gaveta de filtros (no celular sobe de baixo; no computador aparece no centro)
  $('[data-f=open]', tools).onclick = () => {
    const draft = { ...st };
    const chip = (group, value, label, count) =>
      `<button class="fchip ${draft[group] === value ? 'on' : ''}" data-g="${group}" data-v="${esc(value)}">${label}${count != null ? ` <span>${count}</span>` : ''}</button>`;
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `<div class="sheet-backdrop" data-x></div>
      <div class="sheet-card" role="dialog" aria-modal="true" aria-label="Filtros">
        <div class="sheet-head"><h3>Filtros</h3><button class="modal-x" data-x aria-label="Fechar">×</button></div>
        <div class="sheet-body">
          <h4>Ordenar por</h4>
          <div class="fchips">${SORTS.map(([k, l]) => chip('sort', k, l)).join('')}</div>
          ${formats.length > 1 ? `<h4>Formato</h4><div class="fchips">${chip('fmt', '', 'Todos')}${formats.map((k) => chip('fmt', k, fmtLabel(k), all.filter((b) => (b.format || 'fisico') === k).length)).join('')}</div>` : ''}
          ${genres.length > 1 ? `<h4>Gênero</h4><div class="fchips">${chip('genre', '', 'Todos')}${genres.map(([k, g]) => chip('genre', k, esc(g), all.filter((b) => fold(b.genre) === k).length)).join('')}</div>` : ''}
        </div>
        <div class="sheet-foot">
          <button class="btn ghost" data-reset>Limpar</button>
          <button class="btn" data-ok></button>
        </div>
      </div>`;
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';
    const refresh = () => {
      sheet.querySelectorAll('.fchip').forEach((b) => b.classList.toggle('on', draft[b.dataset.g] === b.dataset.v));
      const n = filterList(draft).length;
      $('[data-ok]', sheet).textContent = n ? `Ver ${plural(n, 'livro', 'livros')}` : 'Nenhum livro';
    };
    const close = () => {
      sheet.classList.add('closing');
      document.body.style.overflow = '';
      setTimeout(() => sheet.remove(), 200);
    };
    refresh();
    sheet.onclick = (e) => {
      const f = e.target.closest('.fchip');
      if (f) {
        draft[f.dataset.g] = f.dataset.v;
        return refresh();
      }
      if (e.target.closest('[data-reset]')) {
        Object.assign(draft, { genre: '', fmt: '', sort: 'ordem' });
        return refresh();
      }
      if (e.target.closest('[data-ok]')) {
        Object.assign(st, { genre: draft.genre, fmt: draft.fmt, sort: draft.sort });
        apply();
        return close();
      }
      if (e.target.closest('[data-x]')) close();
    };
  };
}

// Compatibilidade com o dono da estante
async function renderMatch(box, user) {
  let m;
  try {
    m = await api(`/api/users/${encodeURIComponent(user.username)}/match`);
  } catch {
    return;
  }
  if (m.score == null) return;
  const shared = [
    ...m.shared_books.map((t) => `<span class="chip accent">${ic('bookOpen')} ${esc(t)}</span>`),
    ...m.shared_authors.map((a) => `<span class="chip">${ic('feather')} ${esc(a)}</span>`),
    ...m.shared_genres.map((g) => `<span class="chip">${ic('tag')} ${esc(g)}</span>`),
  ].slice(0, 8);
  const label = m.score >= 75 ? 'Almas gêmeas literárias!' : m.score >= 50 ? 'Vocês combinam bastante' : m.score >= 30 ? 'Gostos que se cruzam' : 'Gostos diferentes — ótimo pra descobrir coisas novas';
  const C = 2 * Math.PI * 36;
  box.innerHTML = `<div class="match">
    <div class="match-ring"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="36"/><circle class="fg" cx="42" cy="42" r="36" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><b>${m.score}%</b></div>
    <div>
      <h3>${label}</h3>
      <div class="muted">Sua compatibilidade de leitura com ${esc(firstName(user.name))}.</div>
      ${shared.length ? `<div class="chips">${shared.join('')}</div>` : ''}
    </div>
  </div>`;
  requestAnimationFrame(() => setTimeout(() => ($('.match-ring .fg', box).style.strokeDashoffset = C * (1 - m.score / 100)), 50));
}

// ---------- DNA literário ----------
const HELIX = '<svg class="helix" viewBox="0 0 100 120"><path d="M20 0c0 30 60 30 60 60s-60 30-60 60M80 0c0 30-60 30-60 60s60 30 60 60M28 15h44M22 45h56M28 75h44M22 105h56"/></svg>';

async function renderDna(box, user, isMe) {
  box.innerHTML = `<div class="loading"><div class="spinner"></div><div class="muted">Lendo as estrelas da estante…</div></div>`;
  let d;
  try {
    d = await api(`/api/users/${encodeURIComponent(user.username)}/dna`);
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  const decades = Object.entries(d.decades).sort((a, b) => a[0] - b[0]);
  const maxDec = Math.max(1, ...decades.map(([, n]) => n));
  box.innerHTML = `<div class="dna">
    <div class="dna-persona">
      ${HELIX}
      <div class="eyebrow" style="color:#f0a36f">${isMe ? 'Seu' : 'O'} DNA literário${isMe ? '' : ` de ${esc(firstName(user.name))}`}</div>
      <div class="emoji" style="margin-top:12px">${esc(d.persona.emoji)}</div>
      <h2>${esc(d.persona.title)}</h2>
      <p>${esc(d.persona.text)}</p>
    </div>
    <div class="dna-nums">
      <div class="dna-num"><b>${d.total}</b><span>${d.total === 1 ? 'livro' : 'livros'} na estante</span></div>
      <div class="dna-num"><b>${d.pages.toLocaleString('pt-BR')}</b><span>páginas no total</span></div>
      <div class="dna-num"><b>${d.oldest ?? '—'}</b><span>livro mais antigo</span></div>
    </div>
    <div class="card">
      <h3>Gêneros favoritos</h3>
      ${
        d.genres.length
          ? `<div class="bars">${d.genres
              .map((g) => `<div><div class="bar-label"><span>${esc(g.name)}</span><span class="muted">${g.pct}%</span></div><div class="bar-track"><div class="bar-fill" data-w="${g.pct}"></div></div></div>`)
              .join('')}</div>`
          : '<p class="muted">Adicione livros para ver os gêneros.</p>'
      }
    </div>
    <div class="card">
      <h3>Autores mais presentes</h3>
      ${d.authors.length ? `<div class="row" style="gap:6px">${d.authors.map((a) => `<span class="chip">${ic('feather')} ${esc(a.name)}${a.count > 1 ? ` · ${a.count}` : ''}</span>`).join('')}</div>` : '<p class="muted">Nenhum autor ainda.</p>'}
      ${
        decades.length
          ? `<h3 style="margin-top:20px">Viagem no tempo</h3>
            <div style="display:flex;align-items:end;gap:6px;height:90px">${decades
              .map(([dec, n]) => `<div title="${dec}: ${n}" style="flex:1;display:grid;gap:4px;justify-items:center;align-content:end;height:100%"><div style="width:100%;max-width:34px;height:${Math.max(8, (n / maxDec) * 64)}px;border-radius:6px 6px 2px 2px;background:linear-gradient(var(--gold),var(--accent))"></div><small class="muted" style="font-size:.68rem">${dec}</small></div>`)
              .join('')}</div>`
          : ''
      }
    </div>
    ${isMe ? `<div class="dna-share"><button class="btn" id="share-dna">${ic('share')} Compartilhar meu DNA</button></div>` : ''}
  </div>`;
  requestAnimationFrame(() => setTimeout(() => box.querySelectorAll('.bar-fill').forEach((el) => (el.style.width = el.dataset.w + '%')), 60));
  $('#share-dna')?.addEventListener('click', () =>
    shareLink(`/u/${user.username}`, `Meu DNA literário: ${d.persona.title}`, `🧬 Meu DNA literário no Capa Dura: ${d.persona.emoji} ${d.persona.title}. Qual é o seu?`)
  );
}

async function pageDna() {
  if (!state.user) return (location.hash = '#/entrar');
  view.innerHTML = `
    <div class="eyebrow">Só seu</div>
    <h1>DNA literário</h1>
    <p class="muted" style="margin-top:-4px">Quem você é como leitor, a partir da sua estante — e o que ler a seguir.</p>
    <div id="dna-box" style="margin-top:18px"></div>
    <section class="section" id="recs"></section>`;
  const n = navSeq;
  renderDna($('#dna-box'), state.user, true);
  const { books } = await api('/api/recommendations').catch(() => ({ books: [] }));
  if (isStale(n)) return;
  if (books.length) {
    $('#recs').innerHTML = `<div class="section-head"><div><div class="eyebrow">Feito pra você</div><h2>Leia a seguir</h2></div></div>
      <div class="rail">${books.map((b) => bookCard(b, { reason: b.reason })).join('')}</div>`;
  }
}

// ---------- Seguir ----------
function followBtn(username, isFollowing, small = true) {
  if (!state.user || state.user.username === username) return '';
  return `<button class="btn ${small ? 'small' : ''} ${isFollowing ? 'ghost' : ''}" data-follow="${esc(username)}">${isFollowing ? 'Seguindo ✓' : 'Seguir'}</button>`;
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-follow]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  btn.disabled = true;
  try {
    const r = await api(`/api/users/${encodeURIComponent(btn.dataset.follow)}/follow`, { method: 'POST' });
    document.querySelectorAll(`[data-follow="${CSS.escape(btn.dataset.follow)}"]`).forEach((b) => {
      b.textContent = r.is_following ? 'Seguindo ✓' : 'Seguir';
      b.classList.toggle('ghost', r.is_following);
    });
    const count = $('#followers-count');
    if (count && count.dataset.user === btn.dataset.follow) count.textContent = r.followers;
    toast(r.is_following ? `Agora você segue @${btn.dataset.follow}` : `Você deixou de seguir @${btn.dataset.follow}`);
  } catch (err) {
    toast(err.message);
  }
  btn.disabled = false;
});

async function showFollowList(username, list) {
  const { users } = await api(`/api/users/${encodeURIComponent(username)}/${list}`);
  openModal(`
    <h2>${list === 'followers' ? 'Seguidores' : 'Seguindo'}</h2>
    ${users.length ? '' : '<p class="muted">Ninguém por aqui ainda.</p>'}
    <div style="display:grid;gap:12px;margin-top:10px">${users
      .map((u) => `<a class="person" href="#/u/${esc(u.username)}" data-close>${avatar(u, 'sm')}<div><b>${esc(u.name)}</b><div class="muted">@${esc(u.username)}</div></div></a>`)
      .join('')}</div>`);
}

// ---------- Foto de perfil e edição ----------
function pickSquareImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

async function saveAvatar(dataUrl) {
  try {
    const { user } = await api('/api/me', { method: 'PUT', body: { name: state.user.name, avatar: dataUrl } });
    state.user = user;
    renderAuthArea();
    toast(dataUrl ? 'Foto atualizada!' : 'Foto removida.');
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

async function changePhoto() {
  const dataUrl = await pickSquareImage();
  if (dataUrl && (await saveAvatar(dataUrl))) route();
}

function editProfile() {
  openModal(`
    <h2>Editar perfil</h2>
    <div class="row" style="margin:14px 0">
      ${avatar(state.user)}
      <button class="btn ghost small" id="edit-photo">Trocar foto</button>
      ${state.user.avatar ? '<button class="btn danger small" id="remove-photo">Remover</button>' : ''}
    </div>
    <form id="profile-form">
      <label class="field"><span>Nome</span><input class="input" name="name" value="${esc(state.user.name)}" required></label>
      <label class="field"><span>Bio</span><textarea class="input" name="bio" maxlength="280" placeholder="Leitora de ficção científica, café e chuva…">${esc(state.user.bio)}</textarea></label>
      <button class="btn">Salvar</button>
    </form>`);
  $('#edit-photo').onclick = async () => {
    const dataUrl = await pickSquareImage();
    if (dataUrl && (await saveAvatar(dataUrl))) editProfile();
  };
  $('#remove-photo')?.addEventListener('click', async () => {
    if (await saveAvatar('')) editProfile();
  });
  $('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('/api/me', { method: 'PUT', body: { name: f.get('name'), bio: f.get('bio') } });
      state.user = user;
      closeModal();
      renderAuthArea();
      route();
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- Entrar ----------
function pageAuth() {
  if (state.user) return (location.hash = `#/u/${state.user.username}`);
  let mode = 'login';
  const draw = () => {
    view.innerHTML = `
      <div class="auth">
        <div class="auth-side">
          <div>
            <div class="eyebrow" style="color:#f0a36f">Capa Dura</div>
            <h1>Sua estante, <em>de capa dura.</em></h1>
          </div>
          <ul>
            <li>${ic('scan')} Escaneie o código de barras e o livro aparece com capa e resumo</li>
            <li>${ic('dna')} Descubra seu DNA literário</li>
            <li>${ic('users')} Veja com quem você mais combina</li>
            <li>${ic('star')} Dê notas, comente e favorite</li>
          </ul>
        </div>
        <div class="auth-form">
          <h2>${mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua estante'}</h2>
          <div class="seg">
            <button data-mode="login" class="${mode === 'login' ? 'active' : ''}">Entrar</button>
            <button data-mode="register" class="${mode === 'register' ? 'active' : ''}">Criar conta</button>
          </div>
          <div id="google-btn" style="display:flex;justify-content:center"></div>
          <div id="google-sep" class="or" hidden>ou com usuário e senha</div>
          <form id="auth-form">
            ${mode === 'register' ? `<label class="field"><span>Seu nome</span><input class="input" name="name" required autocomplete="name"></label>` : ''}
            <label class="field"><span>Usuário</span><input class="input" name="username" required autocapitalize="none" autocomplete="username" placeholder="ex: maria.le"></label>
            <label class="field"><span>Senha</span><input class="input" type="password" name="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
            <p id="auth-error" style="color:var(--like);min-height:1.2em;margin:4px 0 10px"></p>
            <button class="btn" style="width:100%;justify-content:center">${mode === 'login' ? 'Entrar' : 'Criar minha estante'}</button>
          </form>
        </div>
      </div>`;
    view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => ((mode = b.dataset.mode), draw())));
    renderGoogleButton();
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try {
        const { user } = await api(mode === 'login' ? '/api/login' : '/api/register', { body });
        state.user = user;
        renderAuthArea();
        location.hash = mode === 'login' ? '#/' : `#/u/${user.username}`;
      } catch (err) {
        $('#auth-error').textContent = err.message;
      }
    };
  };
  draw();
}

// ---------- Login com Google ----------
let googleReady = null;
function loadGoogle() {
  if (googleReady) return googleReady;
  googleReady = (async () => {
    const { googleClientId } = await api('/api/config');
    if (!googleClientId) return null;
    await new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.onload = resolve;
      sc.onerror = reject;
      document.head.appendChild(sc);
    });
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async ({ credential }) => {
        try {
          const { user } = await api('/api/auth/google', { body: { credential } });
          state.user = user;
          renderAuthArea();
          location.hash = '#/';
        } catch (err) {
          toast(err.message);
        }
      },
    });
    return googleClientId;
  })().catch(() => null);
  return googleReady;
}
async function renderGoogleButton() {
  const id = await loadGoogle();
  const box = $('#google-btn');
  if (!id || !box) return;
  google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'pt-BR', width: 300 });
  $('#google-sep').hidden = false;
}

// ---------- Detalhe do livro (nota, curtir, favoritar, comentar) ----------
async function openBook(id) {
  openModal(loadingHtml);
  let data;
  try {
    data = await api(`/api/books/${id}`);
  } catch (e) {
    $('#modal-body').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  const { book, comments } = data;
  const isOwner = state.user?.id === book.user_id;
  const meta = [
    book.format && book.format !== 'fisico' ? fmtLabel(book.format) : '',
    book.genre,
    book.year,
    book.publisher,
    book.pages && `${book.pages} ${book.format === 'audio' ? 'páginas (impresso)' : 'páginas'}`,
    book.isbn && `ISBN ${book.isbn}`,
  ].filter(Boolean);
  let refreshLater = false;

  $('#modal-body').innerHTML = `
    <div class="book-detail">
      <div class="cover">${cover3d(book)}</div>
      <div>
        <h2>${esc(book.title)}</h2>
        <div class="muted by">${esc(book.authors)}</div>
        <div class="meta">${meta.map((m, i) => `<span class="chip">${i === 0 && book.format && book.format !== 'fisico' ? m : esc(m)}</span>`).join('')}</div>
        <div class="rating-box">
          <div class="stars-input" id="stars" role="radiogroup" aria-label="Sua nota">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${plural(n, 'estrela', 'estrelas')}">${ic('star', 'fill')}</button>`).join('')}
          </div>
          <span class="muted" id="rating-info"></span>
        </div>
        <p class="desc">${esc(book.description) || '<span class="muted">Sem descrição.</span>'}</p>
        <div class="actions-row">
          <button class="like-btn ${book.liked ? 'on' : ''}" id="like" title="Curtir">${ic('heart')} <span id="like-count">${book.like_count}</span></button>
          <button class="like-btn fav ${book.favorited ? 'on' : ''}" id="fav" title="Favoritar">${ic('star')} <span>${book.favorited ? 'Favorito' : 'Favoritar'}</span></button>
          <button class="like-btn" id="share-book">${ic('share')} Compartilhar</button>
          ${isOwner ? `<button class="like-btn" id="edit-book">${ic('pencil')} Editar</button>` : ''}
        </div>
        <div class="owner-card">
          <a href="#/u/${esc(book.username)}" data-close>${avatar({ username: book.username, name: book.owner_name, avatar: book.owner_avatar }, 'sm')}<span style="min-width:0"><span class="muted" style="font-size:.8rem;display:block">na estante de</span><b>@${esc(book.username)}</b></span></a>
          ${followBtn(book.username, book.owner_followed)}
          ${isOwner ? `<button class="btn danger small" id="remove-book">Tirar da estante</button>` : ''}
        </div>
      </div>
    </div>
    <section class="comments">
      <h3>Comentários</h3>
      <div id="comment-list"></div>
      ${
        state.user
          ? `<form id="comment-form" class="row" style="margin-top:10px;flex-wrap:nowrap">
              ${avatar(state.user, 'sm')}
              <input class="input" name="text" placeholder="O que você achou desse livro?" maxlength="1000" required autocomplete="off">
              <button class="btn">Enviar</button></form>`
          : `<p class="muted"><a href="#/entrar" data-close>Entre</a> para curtir, dar nota e comentar.</p>`
      }
    </section>`;

  const list = $('#comment-list');
  const drawComment = (c) => {
    const canDelete = state.user && (state.user.id === c.user_id || isOwner);
    return `<div class="comment" data-comment="${c.id}">
      <a href="#/u/${esc(c.username)}" data-close>${avatar(c, 'sm')}</a>
      <div class="bubble">
        <header><a href="#/u/${esc(c.username)}" data-close><b>${esc(c.name)}</b></a>
          <span class="muted">${timeAgo(c.created_at)} ${canDelete ? `· <button class="link-btn" data-del="${c.id}">apagar</button>` : ''}</span></header>
        <p>${esc(c.text)}</p>
      </div></div>`;
  };
  list.innerHTML = comments.map(drawComment).join('') || '<p class="muted" id="no-comments">Seja o primeiro a comentar.</p>';
  list.onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    try {
      await api(`/api/comments/${del.dataset.del}`, { method: 'DELETE' });
      list.querySelector(`[data-comment="${del.dataset.del}"]`)?.remove();
    } catch (err) {
      toast(err.message);
    }
  };

  const guard = (msg, fn) => async () => {
    if (!state.user) return toast(msg);
    try {
      await fn();
      refreshLater = true;
    } catch (err) {
      toast(err.message);
    }
  };
  $('#like').onclick = guard('Entre para curtir.', async () => {
    const r = await api(`/api/books/${book.id}/like`, { method: 'POST' });
    $('#like').classList.toggle('on', r.liked);
    $('#like-count').textContent = r.like_count;
  });
  $('#fav').onclick = guard('Entre para favoritar.', async () => {
    const r = await api(`/api/books/${book.id}/favorite`, { method: 'POST' });
    $('#fav').classList.toggle('on', r.favorited);
    $('#fav span').textContent = r.favorited ? 'Favorito' : 'Favoritar';
    toast(r.favorited ? 'Adicionado aos seus favoritos' : 'Removido dos favoritos');
  });
  $('#comment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.text;
    try {
      const { comment } = await api(`/api/books/${book.id}/comments`, { body: { text: input.value } });
      $('#no-comments')?.remove();
      list.insertAdjacentHTML('beforeend', drawComment(comment));
      input.value = '';
      refreshLater = true;
    } catch (err) {
      toast(err.message);
    }
  });

  // Nota: tocar na mesma estrela de novo remove a nota
  let myRating = book.my_rating || 0;
  const drawRating = (avg, count) => {
    $('#stars').querySelectorAll('[data-star]').forEach((b) => b.classList.toggle('on', Number(b.dataset.star) <= myRating));
    $('#rating-info').textContent =
      (count ? `Média ${String(avg).replace('.', ',')} · ${plural(count, 'nota', 'notas')}` : 'Ainda sem notas') +
      (myRating ? ` · sua nota: ${myRating}` : state.user ? ' · toque para avaliar' : '');
  };
  drawRating(book.rating_avg, book.rating_count);
  $('#stars').onclick = (e) => {
    const star = e.target.closest('[data-star]');
    if (!star) return;
    guard('Entre para dar sua nota.', async () => {
      const n = Number(star.dataset.star);
      const r = await api(`/api/books/${book.id}/rating`, { body: { stars: n === myRating ? 0 : n } });
      myRating = r.my_rating;
      drawRating(r.rating_avg, r.rating_count);
    })();
  };
  $('#share-book').onclick = () =>
    shareLink(`/l/${book.id}`, book.title, `📚 “${book.title}”${book.authors ? ` de ${book.authors}` : ''} na estante de @${book.username} no Capa Dura`);
  $('#edit-book')?.addEventListener('click', () => {
    onModalClose = null;
    openModal('<div></div>', () => route());
    showPreview(book, '', { editId: book.id });
  });
  $('#remove-book')?.addEventListener('click', async () => {
    if (!confirm(`Tirar “${book.title}” da sua estante?`)) return;
    try {
      await api(`/api/books/${book.id}`, { method: 'DELETE' });
      refreshLater = true;
      closeModal();
      toast('Livro removido.');
    } catch (err) {
      toast(err.message);
    }
  });

  onModalClose = () => refreshLater && route();
}

// ---------- Scanner (câmera + busca do livro) ----------
let scanner = null;
async function stopScanner() {
  if (scanner) {
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {}
    scanner = null;
  }
}

function openScanner() {
  if (!state.user) return (location.hash = '#/entrar');
  openModal(
    `
    <h2>Escanear livro</h2>
    <p class="muted scan-hint">Aponte para o código de barras (ISBN) na contracapa.</p>
    <div id="reader"></div>
    <p class="muted" id="cam-error" style="text-align:center;margin:10px 0 0"></p>
    <div class="scan-actions">
      <button class="btn ghost small" id="snap">${ic('camera')} Foto da capa</button>
      <label class="btn ghost small" style="cursor:pointer">${ic('image')} Enviar foto<input type="file" accept="image/*" capture="environment" id="file" hidden></label>
      <button class="btn ghost small" id="by-name">${ic('search')} Buscar pelo nome</button>
      <button class="btn ghost small" id="manual">${ic('keyboard')} Digitar ISBN</button>
      <button class="btn ghost small" id="by-hand">${ic('penLine')} Cadastrar na mão</button>
    </div>`,
    stopScanner
  );

  $('#by-name').onclick = () => {
    const title = prompt('Qual o nome do livro? (pode incluir o autor)');
    if (title?.trim()) handleTitle(title.trim());
  };
  $('#by-hand').onclick = async () => {
    await stopScanner();
    showPreview({}, '', { manual: true });
  };
  $('#manual').onclick = () => {
    const isbn = prompt('Digite o ISBN (os números embaixo do código de barras):');
    if (isbn) handleIsbn(isbn);
  };
  $('#file').onchange = async (e) => {
    const file = e.target.files[0];
    if (file) handlePhoto(await resizeImage(file));
  };
  $('#snap').onclick = () => {
    const video = $('#reader video');
    if (!video || !video.videoWidth) return $('#file').click();
    handlePhoto(frameToDataUrl(video));
  };

  if (typeof Html5Qrcode === 'undefined') {
    $('#cam-error').textContent = 'Não consegui carregar a câmera. Use as opções abaixo.';
    return;
  }
  if (!window.isSecureContext) {
    $('#cam-error').textContent = 'A câmera só abre em conexão segura (https). Use as opções abaixo.';
    return;
  }
  const F = Html5QrcodeSupportedFormats;
  scanner = new Html5Qrcode('reader', {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });
  let handled = false;
  scanner
    .start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 360), height: Math.min(h * 0.45, 160) }) },
      (text) => {
        if (handled) return;
        handled = true;
        navigator.vibrate?.(80);
        handleIsbn(text);
      }
    )
    .catch((err) => {
      console.warn('câmera:', err);
      $('#cam-error').textContent = 'Não consegui abrir a câmera. Confira se o navegador tem permissão — ou use as opções abaixo.';
    });
}

function frameToDataUrl(source, max = 1280) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(frameToDataUrl(img));
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function showLoading(msg) {
  $('#modal-body').innerHTML = `<div class="loading"><div class="spinner"></div><div><b>${esc(msg)}</b><div class="muted">Procurando capa e resumo…</div></div></div>`;
}

async function handleIsbn(code) {
  await stopScanner();
  showLoading(`Código ${code}`);
  try {
    const { book } = await api('/api/books/lookup', { body: { isbn: code } });
    showPreview(book);
  } catch (e) {
    showPreview({ isbn: String(code).replace(/\D/g, ''), ...(e.data?.book || {}), title: e.data?.book?.title || '' }, e.message);
  }
}

async function handleTitle(title) {
  await stopScanner();
  showLoading(`Procurando “${title}”`);
  try {
    const { book } = await api('/api/books/lookup', { body: { title } });
    showPreview(book);
  } catch (e) {
    showPreview({ ...(e.data?.book || {}), title }, e.message);
  }
}

// Livro escolhido na busca online: completa os dados (resumo em português) e abre o formulário
async function addOnline(r) {
  if (!state.user) return (location.hash = '#/entrar');
  openModal('<div></div>');
  showLoading(r.title);
  let book = { ...r };
  try {
    const { book: found } = await api('/api/books/lookup', { body: r.isbn ? { isbn: r.isbn } : { title: r.title, author: r.authors } });
    // o que a busca completou tem prioridade; a capa do catálogo fica se a busca não trouxe nenhuma
    book = { ...r, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v)), cover_url: found.cover_url && !found.cover_url.includes('default=false') ? found.cover_url : r.cover_url };
  } catch {}
  showPreview(book);
}

async function handlePhoto(dataUrl) {
  await stopScanner();
  showLoading('Lendo a foto');
  try {
    const { book } = await api('/api/books/scan-image', { body: { image: dataUrl } });
    if (book.photo_fallback) book.cover_url = await makeCoverFromPhoto(dataUrl);
    showPreview(book);
  } catch (e) {
    showPreview({ cover_url: await makeCoverFromPhoto(dataUrl) }, e.message);
  }
}

// Usa a própria foto como capa (reduzida) quando nenhuma fonte tem imagem
function makeCoverFromPhoto(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(frameToDataUrl(img, 480));
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

// Foto da capa tirada/escolhida pela pessoa: reduz para no máximo 600x900 (JPEG)
function pickCoverPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 600 / img.naturalWidth, 900 / img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

// Formulário do livro: confirmar o que foi encontrado, cadastrar na mão ou editar (opts.editId)
function showPreview(book, warning = '', opts = {}) {
  book = { title: '', authors: '', description: '', genre: '', year: '', publisher: '', pages: '', cover_url: '', isbn: '', ...book };
  const editing = Boolean(opts.editId);
  const heading = editing ? 'Editar livro' : opts.manual ? 'Cadastrar livro' : warning ? 'Não achei esse livro' : 'Achei!';
  const intro = editing
    ? 'Mude o que quiser, inclusive a foto da capa.'
    : opts.manual || warning
      ? `${warning ? esc(warning) + ' ' : ''}Tire uma foto da capa e preencha os dados.`
      : 'Revise e coloque na sua estante.';
  let cover = book.cover_url || '';

  $('#modal-body').innerHTML = `
    <h2>${heading}</h2>
    <p class="muted" ${warning && !editing ? 'style="color:var(--like)"' : ''}>${intro}</p>
    <form id="book-form" class="preview">
      <div class="cover-col">
        <div class="cover" id="preview-cover"></div>
        <button type="button" class="btn small" id="cover-photo">${ic('camera')} Foto da capa</button>
        <button type="button" class="link-btn" id="cover-remove" hidden>remover capa</button>
      </div>
      <div>
        <div class="field"><span>Formato</span>
          <div class="fmt-pick">${Object.entries(FORMATS)
            .map(([k]) => `<label><input type="radio" name="format" value="${k}" ${(book.format || 'fisico') === k ? 'checked' : ''}><span>${fmtLabel(k)}</span></label>`)
            .join('')}</div>
        </div>
        <label class="field"><span>Título *</span><input class="input" name="title" value="${esc(book.title)}" required></label>
        <label class="field"><span>Autor(es)</span><input class="input" name="authors" value="${esc(book.authors)}"></label>
        <div class="grid-2">
          <label class="field"><span>Gênero</span><input class="input" name="genre" value="${esc(book.genre)}"></label>
          <label class="field"><span>Ano</span><input class="input" name="year" inputmode="numeric" value="${esc(book.year)}"></label>
          <label class="field"><span>Editora</span><input class="input" name="publisher" value="${esc(book.publisher)}"></label>
          <label class="field"><span>Páginas</span><input class="input" name="pages" type="number" min="1" value="${esc(book.pages ?? '')}"></label>
        </div>
        <label class="field"><span>ISBN</span><input class="input" name="isbn" inputmode="numeric" value="${esc(book.isbn)}" placeholder="(opcional)"></label>
        <label class="field"><span>Descrição</span><textarea class="input" name="description" placeholder="Sobre o que é o livro?">${esc(book.description)}</textarea></label>
        <div class="row">
          <button class="btn" id="save-book">${editing ? 'Salvar alterações' : 'Colocar na estante'}</button>
          ${editing ? '' : '<button type="button" class="btn ghost" id="again">Escanear outro</button>'}
        </div>
      </div>
    </form>`;

  const form = $('#book-form');
  const drawCover = () => {
    $('#preview-cover').innerHTML = cover3d({ title: form.title.value || 'Sem título', authors: form.authors.value, cover_url: cover, format: form.format?.value });
    $('#cover-remove').hidden = !cover;
    $('#cover-photo').innerHTML = `${ic('camera')} ${cover ? 'Trocar foto' : 'Foto da capa'}`;
  };
  drawCover();
  form.title.addEventListener('input', () => !cover && drawCover());
  form.querySelectorAll('[name=format]').forEach((r) => r.addEventListener('change', drawCover));
  form.authors.addEventListener('input', () => !cover && drawCover());
  $('#cover-photo').onclick = async () => {
    const photo = await pickCoverPhoto();
    if (photo) {
      cover = photo;
      drawCover();
    }
  };
  $('#cover-remove').onclick = () => {
    cover = '';
    drawCover();
  };
  $('#again')?.addEventListener('click', openScanner);
  if (opts.manual) form.title.focus();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(form)), cover_url: cover };
    const btn = $('#save-book');
    btn.disabled = true;
    try {
      if (editing) {
        await api(`/api/books/${opts.editId}`, { method: 'PUT', body });
        toast('Livro atualizado!');
      } else {
        await api('/api/books', { body });
        toast(`“${body.title}” está na sua estante!`);
      }
      onModalClose = null;
      closeModal();
      if (location.hash !== `#/u/${state.user.username}`) location.hash = `#/u/${state.user.username}`;
      else route();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
}

// ---------- Rotas ----------
// Cada navegação ganha um número; uma página que termina de carregar depois que a pessoa
// já foi para outra (navSeq mudou) não sobrescreve a tela nova.
let navSeq = 0;
const isStale = (n) => n !== navSeq;

async function route() {
  navSeq++;
  const hash = location.hash.slice(1) || '/';
  const [, rawPage = '', arg] = hash.split('/');
  let page = rawPage.split('?')[0];
  // rotas antigas
  if (page === 'livros' || page === 'pessoas') {
    const q = new URLSearchParams(hash.split('?')[1] || '').get('q') || '';
    return (location.hash = `#/buscar?${new URLSearchParams({ ...(q && { q }), ...(page === 'pessoas' && { tab: 'leitores' }) })}`);
  }
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const nav = a.dataset.nav;
    const active =
      (nav === 'home' && !page) ||
      (nav === 'buscar' && page === 'buscar') ||
      (nav === 'dna' && page === 'dna') ||
      (nav === 'entrar' && page === 'entrar') ||
      (nav === 'eu' && (page === 'eu' || (page === 'u' && arg === state.user?.username)));
    a.classList.toggle('active', active);
  });
  window.scrollTo(0, 0);
  refreshBell();
  try {
    if (!page) await pageHome();
    else if (page === 'u' && arg) await pageProfile(decodeURIComponent(arg));
    else if (page === 'eu') location.hash = state.user ? `#/u/${state.user.username}` : '#/entrar';
    else if (page === 'buscar') await pageSearch();
    else if (page === 'dna') await pageDna();
    else if (page === 'entrar') pageAuth();
    else if (page === 'livro' && arg) {
      const n = navSeq;
      try {
        const { book } = await api(`/api/books/${arg}`);
        if (isStale(n)) return;
        await pageProfile(book.username);
      } catch {
        if (isStale(n)) return;
        await pageHome();
      }
      if (!isStale(n)) openBook(arg);
    } else await pageHome();
  } catch (e) {
    view.innerHTML = `<div class="empty"><div class="big">${ic('coffee')}</div><h2>Um instante…</h2><p>${esc(e.message)}</p><button class="btn" onclick="route()">Tentar de novo</button></div>`;
  }
}
window.addEventListener('hashchange', route);

(async () => {
  try {
    state.user = (await api('/api/me')).user;
  } catch {}
  const shared = location.pathname.match(/^\/(l|u)\/([^/]+)\/?$/);
  if (shared) history.replaceState(null, '', `/#/${shared[1] === 'l' ? 'livro' : 'u'}/${shared[2]}`);
  renderAuthArea();
  route();
})();

$('#year').textContent = new Date().getFullYear();
