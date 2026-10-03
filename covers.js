// Cache local das capas: cada capa é baixada uma vez, reduzida e guardada em data/covers/<id>.jpg.
// Assim a estante não depende da velocidade (nem da disponibilidade) dos sites de capas.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// fica junto do banco de dados (cada banco tem sua própria pasta de capas)
const DIR =
  process.env.COVERS_DIR ||
  (process.env.VERCEL ? '/tmp/covers' : process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'covers') : path.join(__dirname, 'data', 'covers'));
fs.mkdirSync(DIR, { recursive: true });

const fileFor = (id) => path.join(DIR, `${Number(id)}.jpg`);
const failedAt = new Map(); // id -> momento da última falha (evita tentar de novo a cada pedido)
let onResult = () => {}; // avisa o servidor se a capa existe ou não (para não mandar link quebrado)
const onCoverResult = (fn) => (onResult = fn);
const pending = new Map(); // id -> promessa em andamento (evita baixar a mesma capa duas vezes)

async function download(src) {
  const m = String(src).match(/^data:image\/[a-z+.-]+;base64,(.+)$/);
  if (m) return Buffer.from(m[1], 'base64');
  if (!/^https?:\/\//.test(src)) return null;
  const r = await fetch(src, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!r.ok || !String(r.headers.get('content-type') || '').startsWith('image/')) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > 1500 ? buf : null; // imagens minúsculas são "sem capa" de alguns sites
}

// Recusa imagens que não são capa de verdade: "imagem indisponível" (quase sem detalhe),
// ícones minúsculos e figuras deitadas (capa de livro é em pé ou quadrada)
async function assertRealCover(input) {
  const img = sharp(input);
  const { width = 0, height = 0 } = await img.metadata();
  if (width < 40 || height < 40 || width / height > 1.25) throw new Error('não parece capa');
  const { entropy } = await img.stats();
  if (entropy < 3) throw new Error('imagem quase lisa (provável "sem capa")');
}

// Garante a capa no disco; devolve o caminho do arquivo ou null
function ensureCover(id, src) {
  const file = fileFor(id);
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (!src) return Promise.resolve(null);
  if (Date.now() - (failedAt.get(id) || 0) < 10 * 60 * 1000) return Promise.resolve(null);
  if (pending.has(id)) return pending.get(id);
  const job = (async () => {
    try {
      const input = await download(src);
      if (!input) throw new Error('sem imagem');
      await assertRealCover(input);
      await sharp(input).rotate().resize(600, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(file);
      failedAt.delete(id);
      onResult(id, true);
      return file;
    } catch (err) {
      failedAt.set(id, Date.now());
      onResult(id, false);
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, job);
  return job;
}

function forgetCover(id) {
  failedAt.delete(id);
  fs.rmSync(fileFor(id), { force: true });
}

// Baixa em segundo plano as capas que ainda não estão no disco
async function warmCovers(books) {
  for (const b of books) {
    if (b.cover_url && !fs.existsSync(fileFor(b.id))) await ensureCover(b.id, b.cover_url);
  }
}

module.exports = { ensureCover, forgetCover, warmCovers, fileFor, onCoverResult };
