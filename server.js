import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://rastro:rastro@localhost:5432/rastro'
});

app.use(express.json({ limit: '1mb' }));
// Serve apenas os ficheiros estáticos da pasta public por razões de segurança
app.use(express.static(path.join(__dirname, 'public')));

// Cria/atualiza a estrutura automaticamente para facilitar a instalação pelo Unraid.
async function ensureSchema() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS notes (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        project TEXT NOT NULL DEFAULT 'Geral',
        youtube_url TEXT,
        tags TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS youtube_url TEXT');
      await pool.query("CREATE INDEX IF NOT EXISTS notes_search_idx ON notes USING GIN (to_tsvector('simple', title || ' ' || content))");
      return;
    } catch (error) {
      if (attempt === 20) console.error('Não foi possível preparar a base de dados:', error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}
ensureSchema();

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ ok: false, error: 'Base de dados indisponível' });
  }
});

app.get('/api/notes', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const result = search
      ? await pool.query(
          "SELECT * FROM notes WHERE title ILIKE $1 OR content ILIKE $1 ORDER BY updated_at DESC",
          [`%${search}%`]
        )
      : await pool.query('SELECT * FROM notes ORDER BY updated_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao obter notas:', error.message);
    res.status(500).json({ error: 'Não foi possível carregar as notas.' });
  }
});

app.post('/api/notes', async (req, res) => {
  try {
    const { title, content = '', project = 'Geral', tags = [], youtube_url = null } = req.body || {};
    if (!title?.trim()) {
      return res.status(400).json({ error: 'O título é obrigatório.' });
    }
    const result = await pool.query(
      'INSERT INTO notes (title, content, project, tags, youtube_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title.trim(), content, project, Array.isArray(tags) ? tags : [], youtube_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar nota:', error.message);
    res.status(500).json({ error: 'Não foi possível guardar a nota.' });
  }
});

app.post('/api/import/github', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i);
    if (!match) {
      return res.status(400).json({ error: 'Indica um URL válido de um repositório GitHub público.' });
    }
    const [, owner, repo] = match;
    const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;
    const response = await fetch(readmeUrl, { headers: { 'User-Agent': 'rastro-app' } });
    if (!response.ok) {
      return res.status(404).json({ error: 'Não foi possível encontrar um README público nesse repositório.' });
    }
    const readme = await response.text();
    const guide = await organizeGuide({ owner, repo, readme });
    const saved = await pool.query(
      'INSERT INTO notes (title, content, project, tags) VALUES ($1, $2, $3, $4) RETURNING *',
      [guide.title || `Guia DIY — ${repo}`, guide.content || readme, 'DIY', ['github', 'diy', 'guia']]
    );
    res.status(201).json(saved.rows[0]);
  } catch (error) {
    console.error('Erro ao importar repositório do GitHub:', error.message);
    res.status(500).json({ error: 'Falha ao processar e guardar o guia do GitHub.' });
  }
});

async function organizeGuide({ owner, repo, readme }) {
  const apiKey = process.env.AI_API_KEY;
  if (apiKey) {
    try {
      const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: 'És um editor técnico de Portugal. Reorganiza documentação em português de Portugal, preservando comandos e nomes técnicos. Cria um guia claro com Objetivo, Requisitos, Instalação, Configuração, Execução e Problemas comuns. Responde estritamente em formato JSON com as chaves title e content.'
            },
            {
              role: 'user',
              content: `Repositório: ${owner}/${repo}\n\nREADME:\n${readme.slice(0, 50000)}`
            }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        // Trata respostas envolvidas em blocos markdown ```json ... ```
        const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[1].trim() : rawContent.trim());
        if (parsed.title && parsed.content) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Aviso: Organização por IA falhou, a usar formato original:', err.message);
    }
  }
  return {
    title: `Guia DIY — ${repo}`,
    content: `# ${repo}\n\n## Fonte\nhttps://github.com/${owner}/${repo}\n\n## Instruções originais\n\n${readme}`
  };
}

app.delete('/api/notes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    await pool.query('DELETE FROM notes WHERE id = $1', [id]);
    res.status(204).end();
  } catch (error) {
    console.error('Erro ao eliminar nota:', error.message);
    res.status(500).json({ error: 'Não foi possível eliminar a nota.' });
  }
});

// Redireciona qualquer outra rota GET não encontrada para o frontend
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Rastro disponível na porta ${port}`));
