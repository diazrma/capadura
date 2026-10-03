const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const sharp = require('sharp');
const db = require('./db');
const { shelfImage } = require('./og');
const { ensureCover, forgetCover, warmCovers, onCoverResult } = require('./covers');

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
// Modelos tentados em ordem: se um falhar (fora do ar, limite de uso, resposta ruim), passa para o próximo
const modelList = (...vals) => [...new Set(vals.filter(Boolean).join(',').split(',').map((m) => m.trim()).filter(Boolean))];
const TEXT_MODELS = modelList(
  process.env.GROQ_TEXT_MODEL,
  process.env.GROQ_TEXT_MODELS || 'openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b'
);
const VISION_MODELS = modelList(process.env.GROQ_VISION_MODEL, process.env.GROQ_VISION_MODELS || 'qwen/qwen3.8-27b');

// ---------- Banco de dados ----------
// Cria as tabelas e aplica as migrações uma vez por processo (na Vercel, a cada "cold start")
console.log('TURSO:', {
  url: process.env.TURSO_DATABASE_URL,
  tokenExists: Boolean(process.env.TURSO_AUTH_TOKEN),
  tokenLength: process.env.TURSO_AUTH_TOKEN?.length,
});
async function initDb() {
await db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    isbn TEXT,
    title TEXT NOT NULL,
    authors TEXT DEFAULT '',
    description TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    genre TEXT DEFAULT '',
    year TEXT DEFAULT '',
    publisher TEXT DEFAULT '',
    pages INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, book_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, book_id)
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, book_id)
  );
  CREATE TABLE IF NOT EXISTS dna_cache (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    signature TEXT NOT NULL,
    persona TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- quem recebe
    actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- quem fez
    type TEXT NOT NULL,                                               -- follow | like | comment | favorite | rating
    book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
    extra TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id)
  );
`);

// Migrações de colunas novas (ignoram erro se já existirem)
for (const sql of [
  "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''",
  'ALTER TABLE users ADD COLUMN google_sub TEXT',
  'ALTER TABLE users ADD COLUMN email TEXT',
  'ALTER TABLE books ADD COLUMN position INTEGER',
  'ALTER TABLE books ADD COLUMN cover_v INTEGER DEFAULT 0',
  'ALTER TABLE books ADD COLUMN cover_ok INTEGER', // 1: capa no cache; 0: não existe capa de verdade; NULL: ainda não testada
  "ALTER TABLE users ADD COLUMN shelf_style TEXT DEFAULT 'nogueira'",
  "ALTER TABLE books ADD COLUMN format TEXT DEFAULT 'fisico'",
  "ALTER TABLE users ADD COLUMN banner TEXT DEFAULT ''", // '' = automática (capas da estante) | 'preset:<nome>' | 'foto:<versão>'
  "ALTER TABLE users ADD COLUMN banner_img TEXT DEFAULT ''", // foto da capa do perfil (JPEG em data URL, guardada no banco)
]) {
  try {
    await db.exec(sql);
  } catch {}
}
await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub)');
await db.exec("UPDATE users SET shelf_style = 'rgb' WHERE shelf_style = 'neon'"); // o modelo Neon virou RGB
}
const ready = initDb();
onCoverResult((id, ok) => db.prepare('UPDATE books SET cover_ok = ? WHERE id = ?').run(ok ? 1 : 0, id).catch(() => {}));

// ---------- Notificações ----------
// Avisa o dono do livro (ou a pessoa seguida). Ninguém é notificado das próprias ações;
// a mesma ação repetida (ex.: nova nota) só atualiza o aviso existente.
async function notify(type, actorId, { bookId = null, userId = null, extra = '' } = {}) {
  const to = userId ?? await db.prepare('SELECT user_id FROM books WHERE id = ?').get(bookId)?.user_id;
  if (!to || to === actorId) return;
  if (type !== 'comment') {
    await db.prepare('DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND book_id IS ?').run(to, actorId, type, bookId);
  }
  await db.prepare('INSERT INTO notifications (user_id, actor_id, type, book_id, extra) VALUES (?, ?, ?, ?, ?)').run(to, actorId, type, bookId, String(extra).slice(0, 140));
}
async function unnotify(type, actorId, { bookId = null, userId = null } = {}) {
  const to = userId ?? await db.prepare('SELECT user_id FROM books WHERE id = ?').get(bookId)?.user_id;
  if (to) await db.prepare('DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND book_id IS ?').run(to, actorId, type, bookId);
}

// ---------- Senhas e sessões ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false; // contas criadas pelo Google não têm senha
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function setSessionCookie(res, token, secure) {
  const parts = [`sid=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${60 * 60 * 24 * 30}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ---------- App ----------
const app = express();
for (const method of ['get', 'post', 'put', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) =>
    handlers.length
      ? original(route, ...handlers.map((h) => (typeof h === 'function' && h.length < 4 ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h)))
      : original(route); // app.get('configuração')
}
// atrás do proxy https da hospedagem (Railway, Render etc.): req.secure fica correto e o cookie de login sai com Secure
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(async (req, res, next) => {
  try {
    await ready;
    const { sid } = parseCookies(req.headers.cookie);
    if (sid) {
      req.user = await db
        .prepare('SELECT u.id, u.username, u.name, u.bio, u.avatar, u.shelf_style FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
        .get(sid);
    }
    next();
  } catch (err) {
    next(err);
  }
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

// Erros inesperados nunca mostram detalhes técnicos: só um pedido para aguardar
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Algo não saiu como esperado. Aguarde um instante e tente de novo.' });
});

// ----- Autenticação -----
app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Usuário deve ter 3 a 20 caracteres (letras, números, _ ou .).' });
  }
  if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Esse usuário já existe.' });
  }
  const { lastInsertRowid } = await db
    .prepare('INSERT INTO users (username, name, password_hash) VALUES (?, ?, ?)')
    .run(username, name, hashPassword(password));
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, lastInsertRowid);
  setSessionCookie(res, token, req.secure);
  res.json({ user: { id: Number(lastInsertRowid), username, name, bio: '', avatar: '', shelf_style: 'nogueira' } });
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !checkPassword(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  setSessionCookie(res, token, req.secure);
  res.json({ user: { id: user.id, username: user.username, name: user.name, bio: user.bio, avatar: user.avatar, shelf_style: user.shelf_style } });
});

app.post('/api/logout', async (req, res) => {
  const { sid } = parseCookies(req.headers.cookie);
  if (sid) await db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: req.user || null }));

app.get('/api/config', (req, res) => res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }));

// ----- Login com Google -----
async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  setSessionCookie(res, token, req.secure);
}

async function uniqueUsername(base) {
  base = base.toLowerCase().normalize('NFD').replace(/[^a-z0-9_.]/g, '').slice(0, 16) || 'leitor';
  if (base.length < 3) base = `${base}leitor`;
  let name = base;
  for (let i = 2; await db.prepare('SELECT 1 FROM users WHERE username = ?').get(name); i++) name = `${base}${i}`;
  return name;
}

app.post('/api/auth/google', wrap(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(400).json({ error: 'Login com Google não configurado.' });
  const credential = String(req.body.credential || '');
  // O Google valida a assinatura do token e devolve os dados da conta
  const info = await fetchJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!info || info.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) {
    return res.status(401).json({ error: 'Não foi possível confirmar sua conta Google.' });
  }
  let user = await db.prepare('SELECT * FROM users WHERE google_sub = ?').get(info.sub);
  if (!user) {
    const username = await uniqueUsername(String(info.email || '').split('@')[0]);
    const { lastInsertRowid } = await db
      .prepare('INSERT INTO users (username, name, password_hash, google_sub, email, avatar) VALUES (?, ?, ?, ?, ?, ?)')
      .run(username, info.name || username, '', info.sub, info.email || '', info.picture || '');
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  }
  await startSession(req, res, user.id);
  res.json({ user: { id: user.id, username: user.username, name: user.name, bio: user.bio, avatar: user.avatar, shelf_style: user.shelf_style } });
}));

// ----- Capa (banner) do perfil -----
const BANNER_PRESETS = ['por-do-sol', 'floresta', 'oceano', 'noite', 'biblioteca', 'papel', 'aurora', 'cafe'];
// o que o site recebe: link da foto, nome do modelo ou '' (automática)
const bannerOut = (u) =>
  String(u.banner || '').startsWith('foto:') ? `/api/users/${encodeURIComponent(u.username)}/banner.jpg?v=${u.banner.slice(5)}` : u.banner || '';

app.put('/api/me/banner', requireAuth, wrap(async (req, res) => {
  const { image, preset } = req.body || {};
  let value = '';
  if (image) {
    const m = String(image).match(/^data:image\/[a-z+.-]+;base64,(.+)$/);
    if (!m || image.length > 12_000_000) return res.status(400).json({ error: 'Imagem inválida ou muito grande.' });
    let jpeg;
    try {
      jpeg = await sharp(Buffer.from(m[1], 'base64')).rotate().resize(1600, 520, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    } catch {
      return res.status(400).json({ error: 'Não consegui abrir essa imagem. Tente outra foto.' });
    }
    await db.prepare('UPDATE users SET banner_img = ? WHERE id = ?').run(`data:image/jpeg;base64,${jpeg.toString('base64')}`, req.user.id);
    value = `foto:${Date.now().toString(36)}`;
  } else if (preset) {
    if (!BANNER_PRESETS.includes(preset)) return res.status(400).json({ error: 'Modelo de capa inválido.' });
    value = `preset:${preset}`;
  }
  await db.prepare(`UPDATE users SET banner = ?${value.startsWith('foto:') ? '' : ", banner_img = ''"} WHERE id = ?`).run(value, req.user.id);
  res.json({ banner: bannerOut({ username: req.user.username, banner: value }) });
}));

app.get('/api/users/:username/banner.jpg', async (req, res) => {
  const u = await db.prepare('SELECT banner_img FROM users WHERE username = ?').get(req.params.username);
  const m = String(u?.banner_img || '').match(/^data:image\/jpeg;base64,(.+)$/);
  if (!m) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.end(Buffer.from(m[1], 'base64'));
});

app.put('/api/me', requireAuth, async (req, res) => {
  const name = String(req.body.name || '').trim() || req.user.name;
  const bio = req.body.bio === undefined ? req.user.bio : String(req.body.bio).slice(0, 280);
  let avatar = req.user.avatar || '';
  if (req.body.avatar !== undefined) {
    avatar = String(req.body.avatar || '');
    if (avatar && (!avatar.startsWith('data:image/') || avatar.length > 500_000)) {
      return res.status(400).json({ error: 'Foto inválida ou muito grande.' });
    }
  }
  const SHELF_STYLES = ['nogueira', 'carvalho', 'rustica', 'branca', 'industrial', 'rgb', 'classica', 'escandinava', 'pintada'];
  const shelf_style = SHELF_STYLES.includes(req.body.shelf_style) ? req.body.shelf_style : req.user.shelf_style || 'nogueira';
  await db.prepare('UPDATE users SET name = ?, bio = ?, avatar = ?, shelf_style = ? WHERE id = ?').run(name, bio, avatar, shelf_style, req.user.id);
  res.json({ user: { ...req.user, name, bio, avatar, shelf_style } });
});

// ---------- Groq ----------
// Pergunta à IA e devolve o JSON da resposta, ou null se todos os modelos falharem (nunca lança erro)
async function askAI(messages, models = TEXT_MODELS) {
  if (!GROQ_API_KEY) {
    console.warn('GROQ_API_KEY não configurada — usando só os dados das bibliotecas.');
    return null;
  }
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) {
          console.error(`[ia] ${model} respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
          // limite de uso ou instabilidade: espera um pouco e tenta de novo; outros erros: próximo modelo
          if ((r.status === 429 || r.status >= 500) && attempt === 1) {
            await new Promise((ok) => setTimeout(ok, 1200));
            continue;
          }
          break;
        }
        const data = await r.json();
        return JSON.parse(data.choices[0].message.content);
      } catch (err) {
        console.error(`[ia] ${model} falhou: ${err.message}`);
        if (attempt === 2) break;
      }
    }
  }
  return null;
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function cleanIsbn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

// Busca dados brutos do livro em fontes públicas (BrasilAPI/CBL, Google Books e Open Library)
async function searchSources({ isbn, title, author }) {
  const sources = {};
  const q = isbn ? `isbn:${isbn}` : [title && `intitle:${title}`, author && `inauthor:${author}`].filter(Boolean).join('+');
  const googleKey = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : '';
  const [brasil, google, openlib] = await Promise.all([
    isbn ? fetchJson(`https://brasilapi.com.br/api/isbn/v1/${isbn}`) : null,
    fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3${googleKey}`),
    isbn ? fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`) : null,
  ]);

  if (brasil?.title) {
    sources.brasilApi = {
      title: brasil.title,
      subtitle: brasil.subtitle,
      authors: brasil.authors,
      publisher: brasil.publisher,
      synopsis: brasil.synopsis,
      year: brasil.year,
      page_count: brasil.page_count,
      subjects: brasil.subjects,
      cover: brasil.cover_url,
    };
  }
  const vol = google?.items?.[0]?.volumeInfo;
  if (vol) {
    sources.google = {
      title: vol.title,
      subtitle: vol.subtitle,
      authors: vol.authors,
      publisher: vol.publisher,
      publishedDate: vol.publishedDate,
      description: vol.description,
      pageCount: vol.pageCount,
      categories: vol.categories,
      isbns: vol.industryIdentifiers,
      cover: vol.imageLinks?.thumbnail?.replace('http://', 'https://').replace('&edge=curl', ''),
    };
  }
  const ol = openlib?.[`ISBN:${isbn}`];
  if (ol) {
    sources.openLibrary = {
      title: ol.title,
      authors: ol.authors?.map((a) => a.name),
      publishers: ol.publishers?.map((p) => p.name),
      publish_date: ol.publish_date,
      number_of_pages: ol.number_of_pages,
      subjects: ol.subjects?.slice(0, 8).map((s) => s.name),
      cover: ol.cover?.large || ol.cover?.medium,
    };
  }
  return sources;
}

// Procura uma capa pelo título na Open Library quando as fontes não trouxeram imagem
async function findCoverByTitle(title, authors) {
  if (!title) return '';
  const params = new URLSearchParams({ title, limit: '5', fields: 'cover_i' });
  const author = String(authors || '').split(',')[0].trim();
  if (author) params.set('author', author);
  const r = await fetchJson(`https://openlibrary.org/search.json?${params}`);
  const doc = r?.docs?.find((d) => d.cover_i);
  return doc ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : '';
}

// Groq lê os dados encontrados e monta o cadastro final em português
async function lookupBook({ isbn, title, author }) {
  isbn = cleanIsbn(isbn);
  const sources = await searchSources({ isbn, title, author });
  const found = Object.keys(sources).length > 0;

  const result = (await askAI([
    {
      role: 'system',
      content:
        'Você é um bibliotecário. Recebe dados brutos de um livro (podem estar vazios, incompletos ou em outro idioma) e devolve SOMENTE um JSON com as chaves: ' +
        '"found" (boolean), "title", "authors" (string, separados por vírgula; só autores, não tradutores), "description" (resumo em português do Brasil, 3 a 5 frases, sem spoilers), ' +
        '"genre" (um gênero curto em português), "year" (ano com 4 dígitos ou ""), "publisher", "pages" (número ou null). ' +
        'Quando as fontes ou as pistas trouxerem o título, considere o livro identificado ("found": true) e complete autor, gênero e descrição com seu conhecimento sobre a obra. ' +
        'Se não houver título em lugar nenhum, use seu conhecimento apenas se tiver certeza absoluta de qual livro é aquele ISBN; caso contrário retorne "found": false.',
    },
    {
      role: 'user',
      content: JSON.stringify({ isbn: isbn || null, pista_titulo: title || null, pista_autor: author || null, fontes: sources }),
    },
  ])) || {};

  // Se a IA não respondeu, aproveita o que as bibliotecas trouxeram
  const g = sources.google || {};
  const br = sources.brasilApi || {};
  const ol = sources.openLibrary || {};
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : v || '');
  const yearOf = (...vals) => vals.map((v) => String(v || '').match(/\d{4}/)?.[0]).find(Boolean) || '';
  const fallback = {
    authors: list(br.authors?.length ? br.authors : g.authors?.length ? g.authors : ol.authors) || author || '',
    description: br.synopsis || g.description || '',
    genre: g.categories?.[0] || br.subjects?.[0] || ol.subjects?.[0] || '',
    year: yearOf(br.year, g.publishedDate, ol.publish_date),
    publisher: br.publisher || g.publisher || ol.publishers?.[0] || '',
    pages: Number(br.page_count || g.pageCount || ol.number_of_pages) || null,
  };

  const finalTitle = result.title || sources.brasilApi?.title || sources.google?.title || sources.openLibrary?.title || title || '';
  const cover =
    sources.google?.cover ||
    sources.openLibrary?.cover ||
    sources.brasilApi?.cover ||
    (await findCoverByTitle(finalTitle, result.authors || fallback.authors)) ||
    (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : '');

  return {
    found: Boolean(result.found) || found,
    isbn,
    title: finalTitle,
    authors: result.authors || fallback.authors,
    description: result.description || fallback.description,
    genre: result.genre || fallback.genre,
    year: String(result.year || fallback.year),
    publisher: result.publisher || fallback.publisher,
    pages: Number(result.pages) || fallback.pages,
    cover_url: cover,
  };
}

app.post('/api/books/lookup', requireAuth, wrap(async (req, res) => {
  const isbn = cleanIsbn(req.body.isbn);
  const title = String(req.body.title || '').trim();
  if (isbn.length < 8 && !title) return res.status(400).json({ error: 'Código de barras inválido.' });
  const book = await lookupBook(isbn.length >= 8 ? { isbn } : { title, author: String(req.body.author || '').trim() });
  if (!book.found || !book.title) {
    return res.status(404).json({ error: 'Não encontrei esse livro.', book });
  }
  res.json({ book });
}));

// Foto da capa ou do código de barras: a IA de visão lê ISBN / título
app.post('/api/books/scan-image', requireAuth, wrap(async (req, res) => {
  const image = String(req.body.image || '');
  if (!image.startsWith('data:image/')) return res.status(400).json({ error: 'Imagem inválida.' });
  const read = await askAI(
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Esta é a foto de um livro (capa, contracapa ou código de barras). Leia e devolva SOMENTE um JSON com: ' +
              '"isbn" (os 10 ou 13 dígitos do ISBN/código de barras, se visível, senão ""), "title" (título se visível, senão ""), "author" (autor se visível, senão "").',
          },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ],
    VISION_MODELS
  );
  if (!read) {
    return res.status(503).json({ error: 'Não consegui ler a foto agora. Aguarde um instante e tente de novo.' });
  }
  const isbn = cleanIsbn(read.isbn);
  if (isbn.length < 10 && !read.title) {
    return res.status(404).json({ error: 'Não consegui ler o código nem o título nessa foto.' });
  }
  const book = await lookupBook({ isbn: isbn.length >= 10 ? isbn : '', title: read.title, author: read.author });
  if (!book.cover_url || book.cover_url.includes('default=false')) book.photo_fallback = true;
  res.json({ book, read });
}));

// ----- Livros -----
const BOOK_SELECT = `
  SELECT b.*, u.username, u.name AS owner_name, u.avatar AS owner_avatar,
    EXISTS(SELECT 1 FROM follows f WHERE f.following_id = b.user_id AND f.follower_id = ?) AS owner_followed,
    (SELECT COUNT(*) FROM likes l WHERE l.book_id = b.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.book_id = b.id) AS comment_count,
    (SELECT ROUND(AVG(stars), 1) FROM ratings r WHERE r.book_id = b.id) AS rating_avg,
    (SELECT COUNT(*) FROM ratings r WHERE r.book_id = b.id) AS rating_count,
    -- fotos tiradas pelo usuário viram link (não manda a imagem inteira em cada lista)
    -- toda capa é servida pelo próprio site (cache local): rápido e sem depender de sites externos
    CASE WHEN b.cover_url = '' OR b.cover_url IS NULL OR b.cover_ok = 0 THEN '' ELSE '/api/books/' || b.id || '/cover?v=' || COALESCE(b.cover_v, 0) END AS cover_url,
    EXISTS(SELECT 1 FROM likes l WHERE l.book_id = b.id AND l.user_id = ?) AS liked
  FROM books b JOIN users u ON u.id = b.user_id`;

function bookFields(b) {
  const cover = String(b.cover_url || '');
  if (cover.startsWith('data:') && (!cover.startsWith('data:image/') || cover.length > 1_500_000)) {
    throw Object.assign(new Error('A foto da capa é inválida ou muito grande.'), { status: 400 });
  }
  if (cover && !cover.startsWith('data:image/') && !/^https?:\/\//.test(cover) && !cover.startsWith('/api/books/')) {
    throw Object.assign(new Error('Link da capa inválido.'), { status: 400 });
  }
  return {
    isbn: cleanIsbn(b.isbn),
    title: String(b.title || '').trim().slice(0, 300),
    authors: String(b.authors || '').slice(0, 300),
    description: String(b.description || '').slice(0, 5000),
    cover_url: cover,
    genre: String(b.genre || '').slice(0, 80),
    year: String(b.year || '').slice(0, 10),
    publisher: String(b.publisher || '').slice(0, 120),
    pages: Number(b.pages) || null,
    format: ['fisico', 'ebook', 'kindle', 'audio'].includes(b.format) ? b.format : 'fisico',
  };
}

app.post('/api/books', requireAuth, async (req, res) => {
  let f;
  try {
    f = bookFields(req.body || {});
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (!f.title) return res.status(400).json({ error: 'O título é obrigatório.' });
  const { lastInsertRowid } = await db
    .prepare(
      `INSERT INTO books (user_id, isbn, title, authors, description, cover_url, genre, year, publisher, pages, format, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM books WHERE user_id = ?))`
    )
    .run(req.user.id, f.isbn, f.title, f.authors, f.description, f.cover_url, f.genre, f.year, f.publisher, f.pages, f.format, req.user.id);
  ensureCover(Number(lastInsertRowid), f.cover_url);
  res.json({ book: await db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(req.user.id, req.user.id, lastInsertRowid) });
});

// Pesquisa nos livros de todas as estantes
app.get('/api/books', async (req, res) => {
  const me = req.user?.id ?? 0;
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ books: [] });
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const books = await db
    .prepare(
      `${BOOK_SELECT} WHERE b.title LIKE ? OR b.authors LIKE ? OR b.genre LIKE ? OR (length(?) >= 8 AND b.isbn = ?) OR b.publisher LIKE ?
       ORDER BY (b.title LIKE ?) DESC, like_count DESC, b.created_at DESC LIMIT 80`
    )
    .all(me, me, like, like, like, digits, digits, like, like);
  res.json({ books });
});

app.get('/api/books/:id', async (req, res) => {
  const book = await db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(req.user?.id ?? 0, req.user?.id ?? 0, req.params.id);
  if (!book) return res.status(404).json({ error: 'Livro não encontrado.' });
  const comments = await db
    .prepare(
      `SELECT c.id, c.text, c.created_at, c.user_id, u.username, u.name, u.avatar
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.book_id = ? ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(book.id);
  const fav = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM favorites WHERE book_id = ?) AS n,
              EXISTS(SELECT 1 FROM favorites WHERE book_id = ? AND user_id = ?) AS mine`
    )
    .get(book.id, book.id, req.user?.id ?? 0);
  const mine = await db.prepare('SELECT stars FROM ratings WHERE book_id = ? AND user_id = ?').get(book.id, req.user?.id ?? 0);
  res.json({ book: { ...book, favorite_count: fav.n, favorited: Boolean(fav.mine), my_rating: mine?.stars || 0 }, comments });
});

// Salva a nova ordem dos livros na estante do usuário (livro novo entra na frente)
app.put('/api/books/order', requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  const owned = new Set((await db.prepare('SELECT id FROM books WHERE user_id = ?').all(req.user.id)).map((r) => r.id));
  if (!ids.length || ids.some((id) => !owned.has(id))) return res.status(400).json({ error: 'Ordem inválida.' });
  // tudo de uma vez (ou nada)
  await db.batch(ids.map((id, i) => ['UPDATE books SET position = ? WHERE id = ? AND user_id = ?', [i, id, req.user.id]]));
  res.json({ ok: true });
});

app.put('/api/books/:id', requireAuth, async (req, res) => {
  let f;
  try {
    f = bookFields(req.body || {});
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (!f.title) return res.status(400).json({ error: 'O título é obrigatório.' });
  const old = await db.prepare('SELECT cover_url FROM books WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!old) return res.status(404).json({ error: 'Livro não encontrado.' });
  if (f.cover_url.startsWith('/api/books/')) f.cover_url = old.cover_url || '';
  const coverChanged = f.cover_url !== (old.cover_url || '');
  await db.prepare(
    `UPDATE books SET isbn = ?, title = ?, authors = ?, description = ?, cover_url = ?, genre = ?, year = ?, publisher = ?, pages = ?,
       format = ?, cover_v = COALESCE(cover_v, 0) + ?
     WHERE id = ? AND user_id = ?`
  ).run(f.isbn, f.title, f.authors, f.description, f.cover_url, f.genre, f.year, f.publisher, f.pages, f.format, coverChanged ? 1 : 0, req.params.id, req.user.id);
  if (coverChanged) {
    await db.prepare('UPDATE books SET cover_ok = NULL WHERE id = ?').run(req.params.id);
    forgetCover(req.params.id);
    ensureCover(Number(req.params.id), f.cover_url);
  }
  res.json({ book: await db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(req.user.id, req.user.id, req.params.id) });
});

// Nota de 1 a 5 estrelas (0 remove a nota)
app.post('/api/books/:id/rating', requireAuth, async (req, res) => {
  const stars = Math.round(Number(req.body.stars));
  if (!(stars >= 0 && stars <= 5)) return res.status(400).json({ error: 'Nota inválida.' });
  if (!await db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Livro não encontrado.' });
  }
  const bookId = Number(req.params.id);
  if (stars === 0) {
    await db.prepare('DELETE FROM ratings WHERE user_id = ? AND book_id = ?').run(req.user.id, bookId);
    await unnotify('rating', req.user.id, { bookId });
  } else {
    await db.prepare(
      `INSERT INTO ratings (user_id, book_id, stars) VALUES (?, ?, ?)
       ON CONFLICT(user_id, book_id) DO UPDATE SET stars = excluded.stars`
    ).run(req.user.id, bookId, stars);
    await notify('rating', req.user.id, { bookId, extra: String(stars) });
  }
  const r = await db
    .prepare('SELECT ROUND(AVG(stars), 1) AS avg, COUNT(*) AS n FROM ratings WHERE book_id = ?')
    .get(req.params.id);
  res.json({ my_rating: stars, rating_avg: r.avg, rating_count: r.n });
});

// Capa como imagem própria (serve fotos tiradas pelo usuário e é usada na prévia do link compartilhado)
app.get('/api/books/:id/cover', wrap(async (req, res) => {
  const row = await db.prepare('SELECT id, cover_url FROM books WHERE id = ?').get(req.params.id);
  const file = row && (await ensureCover(row.id, row.cover_url));
  if (!file) return res.status(404).end(); // o site mostra a capa desenhada
  // o ?v= muda quando a capa é trocada, então pode guardar por bastante tempo
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.sendFile(file);
}));

app.delete('/api/books/:id', requireAuth, async (req, res) => {
  const r = await db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Livro não encontrado.' });
  res.json({ ok: true });
});

app.post('/api/books/:id/favorite', requireAuth, async (req, res) => {
  if (!await db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Livro não encontrado.' });
  }
  const exists = await db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND book_id = ?').get(req.user.id, req.params.id);
  const bookId = Number(req.params.id);
  if (exists) {
    await db.prepare('DELETE FROM favorites WHERE user_id = ? AND book_id = ?').run(req.user.id, bookId);
    await unnotify('favorite', req.user.id, { bookId });
  } else {
    await db.prepare('INSERT INTO favorites (user_id, book_id) VALUES (?, ?)').run(req.user.id, bookId);
    await notify('favorite', req.user.id, { bookId });
  }
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE book_id = ?').get(req.params.id);
  res.json({ favorited: !exists, favorite_count: n });
});

app.post('/api/books/:id/like', requireAuth, async (req, res) => {
  const exists = await db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND book_id = ?').get(req.user.id, req.params.id);
  const bookId = Number(req.params.id);
  if (exists) {
    await db.prepare('DELETE FROM likes WHERE user_id = ? AND book_id = ?').run(req.user.id, bookId);
    await unnotify('like', req.user.id, { bookId });
  } else {
    await db.prepare('INSERT INTO likes (user_id, book_id) VALUES (?, ?)').run(req.user.id, bookId);
    await notify('like', req.user.id, { bookId });
  }
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM likes WHERE book_id = ?').get(req.params.id);
  res.json({ liked: !exists, like_count: n });
});

app.post('/api/books/:id/comments', requireAuth, async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Escreva um comentário.' });
  if (!await db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Livro não encontrado.' });
  }
  const { lastInsertRowid } = await db
    .prepare('INSERT INTO comments (user_id, book_id, text) VALUES (?, ?, ?)')
    .run(req.user.id, req.params.id, text);
  await notify('comment', req.user.id, { bookId: Number(req.params.id), extra: text });
  res.json({
    comment: { id: Number(lastInsertRowid), text, created_at: new Date().toISOString(), user_id: req.user.id, username: req.user.username, name: req.user.name },
  });
});

app.delete('/api/comments/:id', requireAuth, async (req, res) => {
  // Pode apagar quem escreveu ou o dono do livro
  const r = await db
    .prepare(
      `DELETE FROM comments WHERE id = ? AND (user_id = ? OR book_id IN (SELECT id FROM books WHERE user_id = ?))`
    )
    .run(req.params.id, req.user.id, req.user.id);
  res.json({ ok: r.changes > 0 });
});

// ----- Usuários e seguidores -----
app.get('/api/users', async (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const users = await db
    .prepare(
      `SELECT u.username, u.name, u.bio, u.avatar, (SELECT COUNT(*) FROM books b WHERE b.user_id = u.id) AS book_count,
         EXISTS(SELECT 1 FROM follows f WHERE f.following_id = u.id AND f.follower_id = ?) AS is_following
       FROM users u WHERE u.username LIKE ? OR u.name LIKE ? ORDER BY book_count DESC LIMIT 30`
    )
    .all(req.user?.id ?? 0, q, q);
  res.json({ users });
});

app.get('/api/users/:username', async (req, res) => {
  const user = await db.prepare('SELECT id, username, name, bio, avatar, shelf_style, banner, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const me = req.user?.id ?? 0;
  const stats = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM follows WHERE following_id = ?) AS followers,
              (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
              EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?) AS is_following`
    )
    .get(user.id, user.id, me, user.id);
  const books = await db.prepare(`${BOOK_SELECT} WHERE b.user_id = ?
     ORDER BY b.position IS NULL, b.position, b.created_at DESC, b.id DESC`).all(me, me, user.id);
  const favorites = await db
    .prepare(
      `${BOOK_SELECT} JOIN favorites fav ON fav.book_id = b.id AND fav.user_id = ?
       ORDER BY fav.created_at DESC, b.id DESC`
    )
    .all(me, me, user.id);
  res.json({ user: { ...user, banner: bannerOut(user), ...stats, is_following: Boolean(stats.is_following) }, books, favorites });
});

app.get('/api/users/:username/:list(followers|following)', async (req, res) => {
  const user = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const sql =
    req.params.list === 'followers'
      ? 'SELECT u.username, u.name, u.avatar FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = ?'
      : 'SELECT u.username, u.name, u.avatar FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ?';
  res.json({ users: await db.prepare(sql).all(user.id) });
});

app.post('/api/users/:username/follow', requireAuth, async (req, res) => {
  const target = await db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Você não pode seguir a si mesmo.' });
  const exists = await db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, target.id);
  if (exists) {
    await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, target.id);
    await unnotify('follow', req.user.id, { userId: target.id });
  } else {
    await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user.id, target.id);
    await notify('follow', req.user.id, { userId: target.id });
  }
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?').get(target.id);
  res.json({ is_following: !exists, followers: n });
});

// Feed: livros de quem você segue (ou todos os recentes, se não segue ninguém)
app.get('/api/feed', async (req, res) => {
  const me = req.user?.id ?? 0;
  let books = [];
  if (me) {
    books = await db
      .prepare(
        `${BOOK_SELECT} WHERE b.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
         ORDER BY b.created_at DESC, b.id DESC LIMIT 60`
      )
      .all(me, me, me);
  }
  const recent = await db.prepare(`${BOOK_SELECT} ORDER BY b.created_at DESC, b.id DESC LIMIT 60`).all(me, me);
  // Em alta: curtidas, favoritos, comentários e notas (com peso maior para os últimos 30 dias)
  const trending = await db
    .prepare(
      `${BOOK_SELECT}
       WHERE EXISTS (SELECT 1 FROM likes l WHERE l.book_id = b.id) OR EXISTS (SELECT 1 FROM favorites f WHERE f.book_id = b.id)
          OR EXISTS (SELECT 1 FROM comments c WHERE c.book_id = b.id) OR EXISTS (SELECT 1 FROM ratings r WHERE r.book_id = b.id)
       ORDER BY (like_count * 2 + (SELECT COUNT(*) FROM favorites f WHERE f.book_id = b.id) * 3 + comment_count + rating_count * 2
                 + COALESCE(rating_avg, 0)) DESC, b.created_at DESC
       LIMIT 12`
    )
    .all(me, me);
  // Leitores para conhecer: quem você ainda não segue, com mais livros
  const people = (
    await db
    .prepare(
      `SELECT u.username, u.name, u.avatar, u.bio, (SELECT COUNT(*) FROM books b WHERE b.user_id = u.id) AS book_count
       FROM users u
       WHERE u.id <> ? AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
       ORDER BY book_count DESC, u.id DESC LIMIT 8`
    )
    .all(me, me)
  ).filter((u) => u.book_count > 0);
  const stats = await db
    .prepare('SELECT (SELECT COUNT(*) FROM books) AS books, (SELECT COUNT(*) FROM users) AS readers, (SELECT COUNT(*) FROM comments) AS comments')
    .get();
  res.json({ following: books, recent, trending, people, stats });
});

// ----- Busca de livros na internet (para adicionar sem escanear) -----
const onlineCache = new Map(); // termo -> { at, results } (evita repetir a mesma busca)
app.get('/api/online-search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const pt = req.query.lang !== 'all'; // padrão: só livros em português
  if (q.length < 2) return res.json({ results: [] });
  const key = `${pt ? 'pt' : 'all'}:${norm(q)}`;
  const hit = onlineCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return res.json({ results: hit.results });

  const googleKey = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : '';
  const [ol, gb] = await Promise.all([
    fetchJson(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(pt ? `${q} language:por` : q)}&limit=30&fields=title,subtitle,author_name,first_publish_year,cover_i,isbn,publisher,number_of_pages_median,language${pt ? '&lang=pt' : ''}`
    ),
    fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books${pt ? '&langRestrict=pt' : ''}${googleKey}`),
  ]);

  const results = [];
  const seen = new Set();
  const add = (r) => {
    const k = `${titleKey(r.title)}|${norm(firstAuthor(r.authors))}`;
    if (!r.title || seen.has(k)) return;
    seen.add(k);
    results.push(r);
  };
  for (const v of gb?.items || []) {
    const i = v.volumeInfo || {};
    if (pt && i.language && i.language !== 'pt') continue;
    const ids = i.industryIdentifiers || [];
    add({
      title: i.title + (i.subtitle ? `: ${i.subtitle}` : ''),
      authors: (i.authors || []).join(', '),
      year: String(i.publishedDate || '').slice(0, 4),
      publisher: i.publisher || '',
      pages: i.pageCount || null,
      isbn: (ids.find((x) => x.type === 'ISBN_13') || ids.find((x) => x.type === 'ISBN_10'))?.identifier || '',
      cover_url: i.imageLinks?.thumbnail?.replace('http://', 'https://').replace('&edge=curl', '') || '',
      lang: i.language || '',
    });
  }
  // ISBN de edição em português: Brasil (978-85, 978-65) e Portugal (978-972, 978-989)
  const ptIsbn = (x) => /^97(8|9)65|^97885|^978972|^978989/.test(x);
  for (const d of ol?.docs || []) {
    // prefere a edição brasileira quando existir
    const isbns = d.isbn || [];
    const isbn = isbns.find((x) => /^97(8|9)65|^97885/.test(x)) || isbns.find(ptIsbn) || isbns.find((x) => x.length === 13) || isbns[0] || '';
    if (pt && !ptIsbn(isbn)) continue; // sem edição em português: não entra
    add({
      title: d.title + (d.subtitle ? `: ${d.subtitle}` : ''),
      authors: (d.author_name || []).slice(0, 3).join(', '),
      year: d.first_publish_year ? String(d.first_publish_year) : '',
      publisher: d.publisher?.[0] || '',
      pages: d.number_of_pages_median || null,
      isbn,
      cover_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
      lang: (d.language || []).includes('por') ? 'pt' : '',
    });
  }
  // A busca devolve o título original da obra; troca pelo título, capa e editora da edição em português
  if (pt) {
    const want = results.filter((r) => ptIsbn(r.isbn)).slice(0, 30);
    const eds = want.length
      ? await fetchJson(`https://openlibrary.org/api/books?bibkeys=${want.map((r) => 'ISBN:' + r.isbn).join(',')}&jscmd=data&format=json`)
      : null;
    for (const r of want) {
      const e = eds?.[`ISBN:${r.isbn}`];
      if (!e?.title) continue;
      r.title = e.title + (e.subtitle ? `: ${e.subtitle}` : '');
      r.publisher = e.publishers?.[0]?.name || r.publisher;
      r.cover_url = e.cover?.medium || r.cover_url;
      r.pages = e.number_of_pages || r.pages;
      r.edition_year = String(e.publish_date || '').match(/\d{4}/)?.[0] || '';
    }
    // a mesma obra pode aparecer duas vezes com títulos diferentes; remove repetidos pelo novo título
    const again = new Set();
    for (let i = results.length - 1; i >= 0; i--) {
      const k = `${titleKey(results[i].title)}|${norm(firstAuthor(results[i].authors))}`;
      if (again.has(k)) results.splice(i, 1);
      else again.add(k);
    }
  }
  // mantém a ordem de relevância das fontes; só manda para o fim quem não tem capa
  results.forEach((r, i) => (r._i = i));
  results.sort((a, b) => !!b.cover_url - !!a.cover_url || a._i - b._i);
  const out = results.slice(0, 24).map(({ _i, lang, ...r }) => r);
  onlineCache.set(key, { at: Date.now(), results: out });
  if (onlineCache.size > 300) onlineCache.clear();
  res.json({ results: out });
}));

// ----- Atividade de quem você segue (feed da página inicial) -----
app.get('/api/activity', requireAuth, async (req, res) => {
  const cover = `CASE WHEN b.cover_url = '' OR b.cover_url IS NULL OR b.cover_ok = 0 THEN '' ELSE '/api/books/' || b.id || '/cover?v=' || COALESCE(b.cover_v, 0) END`;
  const bookCols = `b.id AS book_id, b.title, b.authors, b.format, ${cover} AS cover_url, o.username AS owner_username`;
  const who = 'u.username, u.name, u.avatar';
  const items = await db
    .prepare(
      `SELECT * FROM (
         SELECT 'add' AS type, b.created_at AS at, '' AS extra, ${who}, ${bookCols}
           FROM books b JOIN users u ON u.id = b.user_id JOIN users o ON o.id = b.user_id
           WHERE b.user_id IN (SELECT following_id FROM follows WHERE follower_id = :me)
         UNION ALL
         SELECT 'rating', r.created_at, r.stars, ${who}, ${bookCols}
           FROM ratings r JOIN users u ON u.id = r.user_id JOIN books b ON b.id = r.book_id JOIN users o ON o.id = b.user_id
           WHERE r.user_id IN (SELECT following_id FROM follows WHERE follower_id = :me)
         UNION ALL
         SELECT 'comment', c.created_at, c.text, ${who}, ${bookCols}
           FROM comments c JOIN users u ON u.id = c.user_id JOIN books b ON b.id = c.book_id JOIN users o ON o.id = b.user_id
           WHERE c.user_id IN (SELECT following_id FROM follows WHERE follower_id = :me)
         UNION ALL
         SELECT 'favorite', f.created_at, '', ${who}, ${bookCols}
           FROM favorites f JOIN users u ON u.id = f.user_id JOIN books b ON b.id = f.book_id JOIN users o ON o.id = b.user_id
           WHERE f.user_id IN (SELECT following_id FROM follows WHERE follower_id = :me)
       ) ORDER BY at DESC LIMIT 24`
    )
    .all({ me: req.user.id });
  res.json({ items });
});

// ----- Notificações -----
app.get('/api/notifications/count', requireAuth, async (req, res) => {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id);
  res.json({ unread: n });
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  const items = await db
    .prepare(
      `SELECT n.id, n.type, n.extra, n.created_at, n.read_at, n.book_id,
              u.username, u.name, u.avatar,
              b.title AS book_title,
              CASE WHEN b.cover_url = '' OR b.cover_url IS NULL OR b.cover_ok = 0 THEN '' ELSE '/api/books/' || b.id || '/cover?v=' || COALESCE(b.cover_v, 0) END AS book_cover,
              EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = n.user_id AND f.following_id = n.actor_id) AS following_back
       FROM notifications n
       JOIN users u ON u.id = n.actor_id
       LEFT JOIN books b ON b.id = n.book_id
       WHERE n.user_id = ?
       ORDER BY n.id DESC LIMIT 60`
    )
    .all(req.user.id);
  res.json({ items });
});

app.post('/api/notifications/read', requireAuth, async (req, res) => {
  await db.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  res.json({ ok: true });
});

// ---------- DNA literário, compatibilidade e "Leia a seguir" ----------
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const titleKey = (t) => norm(String(t || '').split(/[:(\-–—]/)[0]);
const firstAuthor = (a) => String(a || '').split(',')[0].trim();
const nice = (s) => String(s || '').trim().replace(/^./, (c) => c.toUpperCase());

async function shelfProfile(userId) {
  const books = await db.prepare('SELECT id, title, authors, genre, pages, year FROM books WHERE user_id = ?').all(userId);
  const genres = new Map();
  const authors = new Map();
  let pages = 0;
  const years = [];
  for (const b of books) {
    if (b.genre) {
      const k = norm(b.genre);
      const g = genres.get(k) || { name: nice(b.genre), count: 0 };
      g.count++;
      genres.set(k, g);
    }
    const a = firstAuthor(b.authors);
    if (a) {
      const k = norm(a);
      const e = authors.get(k) || { name: a, count: 0 };
      e.count++;
      authors.set(k, e);
    }
    pages += Number(b.pages) || 0;
    const y = Number(String(b.year).match(/\d{4}/)?.[0]);
    if (y) years.push(y);
  }
  return { books, genres, authors, pages, years };
}

// Personalidade de leitor sem IA (usada quando a IA não responde)
const PERSONAS = [
  [/fantas|magia|mitolog/, '🐉', 'Guardião de Mundos Mágicos', 'Você coleciona portais: dragões, magia e mitologias são seu território. Uma estante que prefere o impossível ao óbvio.'],
  [/distop|ficcao cientifica|sci|futur/, '🚀', 'Explorador do Amanhã', 'Você lê o futuro antes de ele chegar: distopias, máquinas e sociedades imaginadas que fazem pensar no presente.'],
  [/romance|amor/, '💌', 'Coração de Biblioteca', 'Você vive cada história por dentro: personagens intensos, encontros e desencontros. Livro bom é livro que emociona.'],
  [/terror|horror|suspense|misterio|policial|thriller/, '🕯️', 'Detetive da Meia-Noite', 'Você gosta de luz baixa e coração acelerado: mistérios, crimes e sustos bem contados.'],
  [/historia|biograf|memori|politic/, '🏛️', 'Arqueólogo de Histórias Reais', 'Você procura o que aconteceu de verdade: história, biografias e os bastidores que moldaram o mundo.'],
  [/filosof|religi|espirit|autoajuda|desenvolvimento/, '🧭', 'Buscador de Sentidos', 'Sua estante faz perguntas grandes: filosofia, espiritualidade e caminhos para viver melhor.'],
  [/infantil|juvenil|manga|quadrinho|hq|graphic/, '🎈', 'Leitor de Alma Jovem', 'Você sabe que histórias ilustradas e juvenis carregam algumas das ideias mais bonitas da literatura.'],
  [/classic|literatura|ficcao/, '🖋️', 'Colecionador de Clássicos', 'Você aprecia a boa literatura: obras que atravessam gerações e continuam dizendo algo novo.'],
];
function fallbackPersona(topGenres) {
  const key = norm(topGenres.map((g) => g.name).join(' '));
  const hit = PERSONAS.find(([re]) => re.test(key));
  if (hit) return { emoji: hit[1], title: hit[2], text: hit[3] };
  return { emoji: '📚', title: 'Leitor Eclético', text: 'Sua estante não cabe em um rótulo só: um pouco de tudo, sempre com curiosidade.' };
}

app.get('/api/users/:username/dna', wrap(async (req, res) => {
  const user = await db.prepare('SELECT id, name FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const p = await shelfProfile(user.id);
  const total = p.books.length;
  const genres = [...p.genres.values()].sort((a, b) => b.count - a.count);
  const withGenre = genres.reduce((n, g) => n + g.count, 0) || 1;
  const topGenres = genres.slice(0, 6).map((g) => ({ ...g, pct: Math.round((g.count / withGenre) * 100) }));
  const topAuthors = [...p.authors.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const decades = {};
  for (const y of p.years) decades[`${Math.floor(y / 10) * 10}`] = (decades[`${Math.floor(y / 10) * 10}`] || 0) + 1;
  const oldest = p.years.length ? Math.min(...p.years) : null;

  let persona;
  if (total < 2) {
    persona = { emoji: '🌱', title: 'Estante em crescimento', text: 'Com mais alguns livros, o DNA literário revela que tipo de leitor mora aqui.' };
  } else {
    // a personalidade só é recalculada quando a estante muda
    const signature = crypto
      .createHash('sha1')
      .update(p.books.map((b) => `${b.id}:${norm(b.genre)}`).sort().join('|'))
      .digest('hex');
    const cached = await db.prepare('SELECT signature, persona FROM dna_cache WHERE user_id = ?').get(user.id);
    if (cached?.signature === signature) persona = JSON.parse(cached.persona);
    else {
      const ai = await askAI([
        {
          role: 'system',
          content:
            'Você cria a "personalidade literária" de um leitor a partir da estante dele. Responda SOMENTE um JSON com: ' +
            '"emoji" (1 emoji), "title" (2 a 5 palavras, criativo e elogioso, em português do Brasil, estilo "Explorador de Mundos Distantes"), ' +
            '"text" (2 frases calorosas e específicas sobre o gosto dele, citando gêneros ou autores reais da lista, segunda pessoa "você", sem inventar livros).',
        },
        {
          role: 'user',
          content: JSON.stringify({
            nome: user.name,
            livros: p.books.slice(0, 40).map((b) => `${b.title}${b.authors ? ' — ' + firstAuthor(b.authors) : ''}${b.genre ? ' [' + b.genre + ']' : ''}`),
          }),
        },
      ]);
      persona =
        ai?.title && ai?.text
          ? { emoji: String(ai.emoji || '📚').slice(0, 4), title: String(ai.title).slice(0, 60), text: String(ai.text).slice(0, 400) }
          : fallbackPersona(topGenres);
      if (ai?.title) {
        await db.prepare(
          'INSERT INTO dna_cache (user_id, signature, persona) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET signature = excluded.signature, persona = excluded.persona'
        ).run(user.id, signature, JSON.stringify(persona));
      }
    }
  }
  res.json({ total, pages: p.pages, oldest, genres: topGenres, authors: topAuthors, decades, persona });
}));

// Compatibilidade entre quem está vendo e o dono da estante
app.get('/api/users/:username/match', requireAuth, async (req, res) => {
  const other = await db.prepare('SELECT id, name FROM users WHERE username = ?').get(req.params.username);
  if (!other) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (other.id === req.user.id) return res.json({ score: null });
  const a = await shelfProfile(req.user.id);
  const b = await shelfProfile(other.id);
  if (!a.books.length || !b.books.length) return res.json({ score: null, reason: a.books.length ? 'other-empty' : 'me-empty' });

  const titlesA = new Map(a.books.map((x) => [titleKey(x.title), x.title]));
  const sharedBooks = [...new Set(b.books.filter((x) => titlesA.has(titleKey(x.title))).map((x) => x.title))];
  const sharedAuthors = [...a.authors.keys()].filter((k) => b.authors.has(k)).map((k) => a.authors.get(k).name);
  const sharedGenres = [...a.genres.keys()].filter((k) => b.genres.has(k)).map((k) => a.genres.get(k).name);

  // semelhança de gêneros (cosseno), autores e títulos
  const keys = new Set([...a.genres.keys(), ...b.genres.keys()]);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const x = a.genres.get(k)?.count || 0;
    const y = b.genres.get(k)?.count || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const genreSim = na && nb ? dot / Math.sqrt(na * nb) : 0;
  const authorSim = sharedAuthors.length / Math.max(1, Math.min(a.authors.size, b.authors.size));
  const bookSim = sharedBooks.length / Math.max(1, Math.min(a.books.length, b.books.length));
  const raw = 0.55 * genreSim + 0.25 * Math.min(1, authorSim * 1.5) + 0.2 * Math.min(1, bookSim * 2);
  const score = Math.round(raw > 0 ? 18 + 81 * Math.pow(raw, 0.75) : 8 + Math.min(10, a.books.length + b.books.length));
  res.json({ score, shared_books: sharedBooks.slice(0, 6), shared_authors: sharedAuthors.slice(0, 6), shared_genres: sharedGenres.slice(0, 6) });
});

// Recomendações: livros das estantes de outras pessoas que combinam com a sua
app.get('/api/recommendations', requireAuth, async (req, res) => {
  const me = req.user.id;
  const p = await shelfProfile(me);
  const mine = new Set(p.books.map((b) => titleKey(b.title)));
  const totalGenres = [...p.genres.values()].reduce((n, g) => n + g.count, 0) || 1;
  const following = new Set((await db.prepare('SELECT following_id AS id FROM follows WHERE follower_id = ?').all(me)).map((r) => r.id));
  const candidates = await db.prepare(`${BOOK_SELECT} WHERE b.user_id <> ? ORDER BY b.created_at DESC LIMIT 600`).all(me, me, me);

  const best = new Map();
  for (const b of candidates) {
    const key = titleKey(b.title);
    if (!key || mine.has(key)) continue;
    const g = p.genres.get(norm(b.genre));
    const author = p.authors.get(norm(firstAuthor(b.authors)));
    let score = 0;
    let reason = '';
    if (author) {
      score += 5;
      reason = `Você já tem um livro de ${author.name}`;
    }
    if (g) {
      score += 3 * (g.count / totalGenres) + 1;
      reason ||= `Porque você curte ${g.name}`;
    }
    if (following.has(b.user_id)) {
      score += 1.2;
      reason ||= `Na estante de @${b.username}, que você segue`;
    }
    score += Math.log1p(b.like_count + b.comment_count) * 0.8 + (b.rating_avg || 0) / 5 + (b.cover_url ? 0.3 : 0);
    reason ||= b.like_count || b.rating_count ? 'Em alta entre os leitores' : 'Novidade na Estante';
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { ...b, score, reason });
  }
  const books = [...best.values()].sort((x, y) => y.score - x.score).slice(0, 12);
  res.json({ books });
});

// Links compartilháveis: /l/:id (livro) e /u/:usuario (estante), com prévia de título, texto e imagem
const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function sendWithPreview(req, res, { title, description, image }) {
  const origin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Capa Dura">`,
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:url" content="${escHtml(origin + req.originalUrl)}">`,
    image ? `<meta property="og:image" content="${escHtml(image.startsWith('/') ? origin + image : image)}">` : '',
    image ? `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="description" content="${escHtml(description)}">`,
  ].join('\n  ');
  const html = fs
    .readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replace(/<title>[^<]*<\/title>\s*<meta name="description"[^>]*>/, `<title>${escHtml(title)}</title>\n  ${tags}`);
  res.type('html').send(html);
}

app.get('/l/:id', async (req, res) => {
  const b = await db
    .prepare('SELECT b.id, b.title, b.authors, b.description, b.cover_url, u.name FROM books b JOIN users u ON u.id = b.user_id WHERE b.id = ?')
    .get(req.params.id);
  if (!b) return res.redirect('/');
  sendWithPreview(req, res, {
    title: `${b.title}${b.authors ? ' — ' + b.authors : ''}`,
    description: (b.description || `Na estante de ${b.name} no Capa Dura`).slice(0, 200),
    image: b.cover_url ? `/api/books/${b.id}/cover` : '',
  });
});

// Imagem da estante para a prévia do link (gerada na hora e guardada em cache)
app.get('/api/users/:username/shelf.jpg', wrap(async (req, res) => {
  const user = await db.prepare('SELECT id, username, name FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).end();
  const books = await db
    .prepare(
      `SELECT id, title, authors, cover_url FROM books WHERE user_id = ?
       ORDER BY position IS NULL, position, created_at DESC, id DESC LIMIT 5`
    )
    .all(user.id);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM books WHERE user_id = ?').get(user.id);
  const img = await shelfImage(user, books, n);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(img);
}));

app.get('/u/:username', async (req, res) => {
  const u = await db.prepare('SELECT id, name, username, bio FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.redirect('/');
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM books WHERE user_id = ?').get(u.id);
  sendWithPreview(req, res, {
    title: `Estante de ${u.name} (@${u.username}) · Capa Dura`,
    description: u.bio || `${n} ${n === 1 ? 'livro' : 'livros'} na estante. Venha ver, curtir e comentar!`,
    // ?n= muda quando entra livro novo, para o WhatsApp não reaproveitar a imagem antiga
    image: `/api/users/${encodeURIComponent(u.username)}/shelf.jpg?n=${n}`,
  });
});

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Erros inesperados: resposta amigável, sem detalhes técnicos
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status === 413 ? 413 : 500).json({
    error: err.status === 413 ? 'Arquivo grande demais. Tente uma foto menor.' : 'Algo não saiu como esperado. Aguarde um instante e tente de novo.',
  });
});

module.exports = app;

// ---------- Inicialização (só quando roda como servidor: npm start) ----------
if (require.main === module) {
  // baixa em segundo plano as capas que ainda não estão no cache
  setTimeout(async () => {
    await ready;
    warmCovers(await db.prepare("SELECT id, cover_url FROM books WHERE cover_url <> '' AND cover_ok IS NOT 0").all()).catch(() => {});
  }, 1500);

  http.createServer(app).listen(PORT, () => {
    console.log(`📚 Capa Dura rodando em http://localhost:${PORT}${db.remote ? ' (banco: Turso)' : ''}`);
    if (!GROQ_API_KEY) console.warn('⚠️  GROQ_API_KEY não definida — o cadastro automático não vai funcionar.');
  });

  // HTTPS (necessário para abrir a câmera pelo celular na rede local)
  const certDir = path.join(__dirname, 'certs');
  if (fs.existsSync(path.join(certDir, 'key.pem')) && fs.existsSync(path.join(certDir, 'cert.pem'))) {
    https
      .createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, app)
      .listen(HTTPS_PORT, () => console.log(`🔒 HTTPS em https://<ip-do-computador>:${HTTPS_PORT} (use no celular)`));
  }
}
