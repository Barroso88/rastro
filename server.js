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

function getAiEndpointAndModel() {
  let rawUrl = String(process.env.AI_BASE_URL || '').trim();
  let model = String(process.env.AI_MODEL || '').trim();

  // Sem URL especificado -> OpenAI padrão
  if (!rawUrl) {
    return {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: model || 'gpt-4o-mini'
    };
  }

  // Remove caminhos redundantes adicionados acidentalmente
  rawUrl = rawUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');

  // Auto-correção para Google Gemini
  if (rawUrl.includes('generativelanguage.googleapis.com')) {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    if (!model || model.startsWith('grok') || model.startsWith('gpt')) {
      model = 'gemini-1.5-flash';
    }
    return { endpoint, model };
  }

  // Auto-correção para xAI (Grok)
  if (rawUrl.includes('api.x.ai')) {
    const endpoint = 'https://api.x.ai/v1/chat/completions';
    if (!model || model.startsWith('gemini') || model.startsWith('gpt')) {
      model = 'grok-2-latest';
    }
    return { endpoint, model };
  }

  // Auto-correção para Groq
  if (rawUrl.includes('api.groq.com')) {
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    if (!model || model.startsWith('gemini') || model.startsWith('grok')) {
      model = 'llama-3.3-70b-versatile';
    }
    return { endpoint, model };
  }

  // Outros endpoints (Ollama, vLLM, etc.)
  return {
    endpoint: `${rawUrl}/chat/completions`,
    model: model || 'gpt-4o-mini'
  };
}

async function organizeGuide({ owner, repo, readme }) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('A variável AI_API_KEY não está configurada no servidor Docker.');
  }

  const rawUrl = String(process.env.AI_BASE_URL || '').trim();
  const isGoogle = apiKey.startsWith('AQ') ||
                   apiKey.startsWith('AIza') ||
                   rawUrl.includes('googleapis') ||
                   rawUrl.includes('gemini') ||
                   (!apiKey.startsWith('sk-') && !apiKey.startsWith('xai-') && !apiKey.startsWith('gsk_') && !rawUrl);

  const systemPrompt = `És um editor técnico sénior de Portugal, especialista em documentação de software, DevOps, hardware e projetos DIY/domótica.
O teu objetivo é transformar a documentação fornecida num guia técnico prático e de referência em Português de Portugal (PT-PT).

Diretrizes essenciais:
1. Usa Português de Portugal natural, correto e técnico (ex.: "ecrã", "ficheiro", "utilizador", "arranque", "consola", "rede").
2. NUNCA traduzas termos técnicos padrão, nomes de comandos, variáveis, código, caminhos de ficheiros ou nomes de integrações (ex.: mantém "media_player", "openWakeWord", "docker-compose", "npm install", "ESPHome", URLs).
3. Formata comandos e código em blocos Markdown com a sintaxe apropriada (\`\`\`bash, \`\`\`yaml, etc.).

Estrutura OBRIGATÓRIA do documento:

# [Nome do Projeto] — [Subtítulo claro e elucidativo do que faz]

## Objetivo
Explicação concisa e direta do que é o projeto, que problema resolve e qual o seu benefício prático.

## Requisitos
- **Hardware:** (se aplicável, lista de dispositivos, placas ou especificações)
- **Software / Dependências:** (versões de sistema, runtimes, ferramentas CLI necessárias)

## Funcionalidades Principais
Lista com as capacidades chave do projeto, explicadas de forma clara e objetiva.

## Instalação
Passo a passo sequencial com todos os comandos exatos de instalação, setup ou gravação de firmware.

## Configuração e Integração
Exemplos práticos de ficheiros de configuração (variáveis .env, YAML, portas de rede) e como integrar com outros sistemas (ex.: Home Assistant, Unraid, etc. se aplicável).

## Arquitetura Técnica
Breve descrição de como o projeto funciona por dentro (daemons, ferramentas CLI, protocolos ou bibliotecas).

## Problemas Comuns e Dicas
Lista prática de resoluções de problemas frequentes, testes e comandos úteis para diagnóstico.

A primeira linha da tua resposta DEVE ser o título do guia começando por "# ". Não uses blocos de código a envolver todo o texto.`;

  const userContent = `Repositório: ${owner}/${repo}\n\nDocumentação README original:\n${readme.slice(0, 45000)}`;

  let rawText = '';

  if (isGoogle) {
    // API Nativa do Google Gemini (sem passar por adaptadores)
    let model = String(process.env.AI_MODEL || '').trim();
    if (!model || model.startsWith('grok') || model.startsWith('gpt')) {
      model = 'gemini-1.5-flash';
    }
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    console.log(`[Rastro AI] A enviar ${owner}/${repo} para Google Gemini Nativo (${model})...`);

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userContent }]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Rastro AI] Erro HTTP ${response.status} do Google Gemini:`, errorBody);
      let errorDetail = `Erro HTTP ${response.status}`;
      try {
        const parsedErr = JSON.parse(errorBody);
        errorDetail = parsedErr.error?.message || parsedErr.message || errorDetail;
      } catch {}
      throw new Error(`Google Gemini devolveu erro (${response.status}): ${errorDetail}`);
    }

    const data = await response.json();
    rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else {
    // API Compatível OpenAI (xAI Grok, Groq, Ollama, OpenAI)
    const { endpoint, model } = getAiEndpointAndModel();
    console.log(`[Rastro AI] A enviar ${owner}/${repo} para ${endpoint} (${model})...`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
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
    rawText = data.choices?.[0]?.message?.content || '';
  }

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
