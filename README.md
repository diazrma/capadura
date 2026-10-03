# 📚 Capa Dura

Estante de livros social. Você aponta a câmera para o código de barras, o livro aparece na sua estante com capa e resumo, e outras pessoas visitam, curtem, comentam, dão nota e seguem você.

## Funcionalidades

- **Escanear livro:** pelo código de barras (ISBN), por foto da capa, pelo nome ou cadastrando na mão (com foto da capa tirada na hora)
- **Estante de madeira:** prateleiras com textura real; na sua estante, arraste os livros para mudar de lugar
- **🧬 DNA literário:** personalidade de leitor, gêneros favoritos, autores mais presentes e "viagem no tempo" pelas décadas
- **💞 Compatibilidade:** na estante de outra pessoa, a porcentagem de afinidade de leitura e o que vocês têm em comum
- **Leia a seguir:** recomendações tiradas das estantes da comunidade, com o motivo de cada uma
- **Em alta:** os livros mais curtidos, favoritados, comentados e bem avaliados
- **Social:** seguir, curtir, favoritar, notas de 1 a 5 estrelas e comentários
- **Compartilhar:** link do livro ou da estante, com prévia (imagem da estante gerada na hora) no WhatsApp, Telegram etc.
- **Login** com usuário e senha ou com Google
- **Capas desenhadas** para livros sem foto; as capas da internet ficam guardadas no próprio servidor (rápidas e sem sumir)

## Rodar

```bash
cp .env.example .env      # coloque GROQ_API_KEY (e GOOGLE_CLIENT_ID, se quiser login com Google)
npm install
npm start                 # http://localhost:3000
```

Precisa do Node 22 ou mais novo.

## Publicar na Vercel

A Vercel não guarda arquivos entre uma requisição e outra, então o banco fica no **Turso** (SQLite na nuvem, tem plano grátis). Localmente, sem as variáveis do Turso, o projeto continua usando o arquivo `estante.db`.

1. **Crie o banco no Turso**: em https://turso.tech crie uma conta e um banco (ex.: `capadura`). Para levar os dados que você já tem, use a CLI:
   ```bash
   turso db create capadura --from-file data/estante-para-turso.db
   turso db show capadura --url        # → TURSO_DATABASE_URL (libsql://...)
   turso db tokens create capadura     # → TURSO_AUTH_TOKEN
   ```
   Para começar vazio, é só criar o banco: as tabelas são criadas sozinhas no primeiro acesso.
2. **Na Vercel**, em *Settings → Environment Variables*, cadastre:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GROQ_API_KEY` e (se usar login com Google) `GOOGLE_CLIENT_ID`.
3. **Faça o deploy** (git push). O `vercel.json` já manda `/api/*`, `/l/*` e `/u/*` para a função `api/index.js`; o resto do site sai direto da pasta `public/`.
4. **Login com Google**: no Google Cloud, adicione o endereço da Vercel (ex.: `https://capadura-two.vercel.app`) em *Origens JavaScript autorizadas*.

O que muda na Vercel: as capas dos livros ficam num cache temporário (`/tmp`) e são baixadas de novo quando ele é apagado; fotos de perfil, capas de perfil e fotos de capa tiradas pelo celular ficam guardadas no banco.

## Câmera no celular

O navegador só abre a câmera em **HTTPS**. Opções:

- `ngrok http 3000`: gera um link https público (o jeito mais fácil)
- `npm run cert` e depois `npm start`: sobe também `https://<ip-do-pc>:3443` na rede local, com certificado autoassinado

## Como o livro é encontrado

1. O código de barras é lido no navegador (`html5-qrcode`).
2. O servidor busca na **BrasilAPI** (CBL e editoras brasileiras), no **Google Books** e na **Open Library**.
3. Um modelo de IA (Groq) organiza os dados e escreve o resumo em português. Se um modelo falhar, o próximo da lista é tentado; se todos falharem, o livro é montado só com os dados das bibliotecas. Quem usa o site nunca vê erro técnico.
4. As capas são baixadas uma vez e guardadas em `data/covers/`.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `server.js` | API, busca de livros, DNA literário, recomendações, notificações |
| `db.js` | Acesso ao banco (Turso na nuvem ou o arquivo local `estante.db`) |
| `api/index.js`, `vercel.json` | Configuração para rodar na Vercel |
| `covers.js` | Cache local das capas |
| `og.js` | Imagem de prévia da estante para links compartilhados |
| `public/` | Site (HTML, CSS, JS, texturas de madeira) |

## Créditos

Criado por **Rodrigo Cardoso**.

Texturas de madeira em `public/img/` vêm do [Poly Haven](https://polyhaven.com) (domínio público, CC0): `dark_wood` e `wood_table_001`.
