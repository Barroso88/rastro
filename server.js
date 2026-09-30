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
    res.status(500).json({ error: error.message || 'Falha ao processar o guia com IA.' });
  }
});

async function organizeGuide({ owner, repo, readme }) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('A variável AI_API_KEY não está configurada no servidor Docker.');
  }

  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'grok-2-latest';

  console.log(`[Rastro AI] A enviar ${owner}/${repo} para ${baseUrl} (modelo: ${model})...`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `És um editor técnico de Portugal especialista em documentação de software e projetos de computação/eletrónica.
O teu trabalho é reescrever integralmente a documentação em Português de Portugal (PT-PT), com rigor e clareza.
Mantém comandos de terminal, nomes de pacotes, código e caminhos de ficheiros intactos.

Estrutura o teu texto OBRIGATORIAMENTE assim em Markdown:
# [Título claro e elucidativo do guia]
## Objetivo
Explica em poucas palavras o que este projeto faz e qual o seu benefício.

## Requisitos
Lista de pré-requisitos de sistema, dependências ou hardware.

## Instalação
Passo a passo com os comandos exatos de instalação.

## Configuração
Ficheiros de ambiente, portas e variáveis necessárias.

## Execução
Como iniciar o projeto e comandos úteis.

## Problemas Comuns
Dicas e soluções para os erros mais frequentes.

A primeira linha da tua resposta DEVE ser o título do guia começando por "# ". Não uses blocos de código a envolver todo o texto.`
        },
        {
          role: 'user',
          content: `Repositório: ${owner}/${repo}\n\nDocumentação README original:\n${readme.slice(0, 45000)}`
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Rastro AI] Erro HTTP ${response.status} da API:`, errorBody);
    let errorDetail = `Erro HTTP ${response.status}`;
    try {
      const parsedErr = JSON.parse(errorBody);
      errorDetail = parsedErr.error?.message || parsedErr.message || errorDetail;
    } catch {}
    throw new Error(`A API de IA devolveu erro (${response.status}): ${errorDetail}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';

  if (!rawText.trim()) {
    throw new Error('A API de IA não devolveu conteúdo.');
  }

  // Se o modelo responder em JSON, tenta descodificar
  try {
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[1].trim() : rawText.trim());
    if (parsed.title && parsed.content) {
      return { title: parsed.title, content: parsed.content };
    }
  } catch {}

  // Extração inteligente de título a partir de Markdown
  const lines = rawText.trim().split('\n');
  let title = `Guia DIY — ${repo}`;
  const headerIdx = lines.findIndex(l => l.trim().startsWith('# '));
  if (headerIdx !== -1) {
    title = lines[headerIdx].replace(/^#\s+/, '').trim();
  }

  return { title, content: rawText.trim() };
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
