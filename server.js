import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://rastro:rastro@localhost:5432/rastro' });

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// Mantém bases já existentes compatíveis com a funcionalidade de vídeos.
pool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS youtube_url TEXT').catch(error => console.error('Migração:', error.message));

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get('/api/notes', async (req, res) => {
  const search = String(req.query.search || '').trim();
  const result = search
    ? await pool.query("SELECT * FROM notes WHERE title ILIKE $1 OR content ILIKE $1 ORDER BY updated_at DESC", [`%${search}%`])
    : await pool.query('SELECT * FROM notes ORDER BY updated_at DESC');
  res.json(result.rows);
});

app.post('/api/notes', async (req, res) => {
  const { title, content = '', project = 'Loja online', tags = [], youtube_url = null } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'O título é obrigatório.' });
  const result = await pool.query(
    'INSERT INTO notes (title, content, project, tags, youtube_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [title.trim(), content, project, Array.isArray(tags) ? tags : [], youtube_url]
  );
  res.status(201).json(result.rows[0]);
});

app.post('/api/import/github', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i);
  if (!match) return res.status(400).json({ error: 'Indica um URL válido de um repositório GitHub público.' });
  const [, owner, repo] = match;
  const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;
  const response = await fetch(readmeUrl, { headers: { 'User-Agent': 'rastro-app' } });
  if (!response.ok) return res.status(404).json({ error: 'Não foi possível encontrar um README público nesse repositório.' });
  const readme = await response.text();
  const guide = await organizeGuide({ owner, repo, readme });
  const saved = await pool.query(
    'INSERT INTO notes (title, content, project, tags) VALUES ($1, $2, $3, $4) RETURNING *',
    [guide.title, guide.content, 'DIY', ['github', 'diy', 'guia']]
  );
  res.status(201).json(saved.rows[0]);
});

async function organizeGuide({ owner, repo, readme }) {
  const apiKey = process.env.AI_API_KEY;
  if (apiKey) {
    const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'system', content: 'És um editor técnico de Portugal. Reorganiza documentação em português de Portugal, preservando comandos e nomes técnicos. Cria um guia claro com Objetivo, Requisitos, Instalação, Configuração, Execução e Problemas comuns. Responde em JSON com as chaves title e content.' }, { role: 'user', content: `Repositório: ${owner}/${repo}\n\nREADME:\n${readme.slice(0, 50000)}` }] }) });
    if (response.ok) { const data = await response.json(); try { return JSON.parse(data.choices[0].message.content); } catch { /* usa fallback */ } }
  }
  return { title: `Guia DIY — ${repo}`, content: `# ${repo}\n\n## Fonte\nhttps://github.com/${owner}/${repo}\n\n## Instruções originais\n\n${readme}` };
}

app.delete('/api/notes/:id', async (req, res) => {
  await pool.query('DELETE FROM notes WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Rastro disponível na porta ${port}`));
