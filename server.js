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

async function fetchUrlContent(url) {
  const trimmedUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    throw new Error('Indica um URL válido começado por http:// ou https://');
  }

  // 1. Caso especial: Repositório GitHub
  const ghMatch = trimmedUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i);
  if (ghMatch) {
    const [, owner, repo] = ghMatch;
    for (const branch of ['HEAD', 'main', 'master']) {
      try {
        const readmeRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`, {
          headers: { 'User-Agent': 'rastro-app' },
          signal: AbortSignal.timeout(10000)
        });
        if (readmeRes.ok) {
          const text = await readmeRes.text();
          if (text.trim().length > 30) {
            return {
              sourceName: `${owner}/${repo}`,
              sourceUrl: trimmedUrl,
              content: text,
              isGithub: true
            };
          }
        }
      } catch {}
    }
  }

  // 2. Fóruns e Páginas Web (XDA, Reddit, Tutoriais, Artigos)
  // Utilizamos o Jina Reader (r.jina.ai) para ultrapassar proteções anti-bot (Cloudflare, Bunny Shield) e extrair Markdown limpo
  try {
    const jinaUrl = `https://r.jina.ai/${trimmedUrl}`;
    const jinaRes = await fetch(jinaUrl, {
      headers: {
        'User-Agent': 'rastro-app',
        'X-No-Cache': 'true'
      },
      signal: AbortSignal.timeout(25000)
    });
    if (jinaRes.ok) {
      const markdown = await jinaRes.text();
      if (markdown.trim().length > 100) {
        const titleMatch = markdown.match(/^Title:\s*(.+)$/m);
        const sourceName = titleMatch ? titleMatch[1].trim() : trimmedUrl;
        return {
          sourceName,
          sourceUrl: trimmedUrl,
          content: markdown,
          isGithub: false
        };
      }
    }
  } catch (err) {
    console.warn('[Rastro Import] Jina Reader falhou, a tentar acesso direto:', err.message);
  }

  // 3. Fallback direto caso o Jina Reader esteja indisponível
  const directRes = await fetch(trimmedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!directRes.ok) {
    throw new Error(`Não foi possível aceder ao endereço web (HTTP ${directRes.status}).`);
  }

  const html = await directRes.text();
  const cleanText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (cleanText.length < 100) {
    throw new Error('A página não continha texto suficiente ou está bloqueada por proteção anti-bot.');
  }

  return {
    sourceName: trimmedUrl,
    sourceUrl: trimmedUrl,
    content: cleanText,
    isGithub: false
  };
}

async function handleImport(req, res) {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url) {
      return res.status(400).json({ error: 'Indica um URL válido (GitHub, fórum XDA, tutorial ou artigo web).' });
    }

    console.log(`[Rastro Import] A recolher conteúdo de: ${url}`);
    const sourceData = await fetchUrlContent(url);

    console.log(`[Rastro Import] Conteúdo obtido (${sourceData.content.length} carateres). A estruturar com IA...`);
    const guide = await organizeGuide(sourceData);

    const saved = await pool.query(
      'INSERT INTO notes (title, content, project, tags) VALUES ($1, $2, $3, $4) RETURNING *',
      [guide.title || `Guia DIY — ${sourceData.sourceName}`, guide.content, 'DIY', ['diy', 'tutorial', 'ia']]
    );

    res.status(201).json(saved.rows[0]);
  } catch (error) {
    console.error('Erro na importação com IA:', error.message);
    res.status(500).json({ error: error.message || 'Falha ao processar o guia com IA.' });
  }
}

app.post('/api/import/url', handleImport);
app.post('/api/import/github', handleImport);

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

async function organizeGuide({ sourceName, sourceUrl, content }) {
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

  const systemPrompt = `És um editor técnico sénior de Portugal, especialista em documentação de software, DevOps, hardware, engenharia reversa, firmware e projetos DIY/domótica.
O teu objetivo é transformar a documentação, tutorial ou publicação fornecida num guia técnico prático e de referência em Português de Portugal (PT-PT).

Diretrizes essenciais:
1. Usa Português de Portugal natural, correto e técnico (ex.: "ecrã", "ficheiro", "utilizador", "arranque", "consola", "rede", "dispositivo", "gravação").
2. NUNCA traduzas termos técnicos padrão, nomes de comandos, variáveis, código, caminhos de ficheiros, partições, ferramentas ou nomes de integrações (ex.: mantém "fastboot", "TWRP", "root", "unbrick", "biscuit", "amonet", "adb", "flashing", "Home Assistant", URLs).
3. Formata comandos e código em blocos Markdown com a sintaxe apropriada (\`\`\`bash, \`\`\`yaml, etc.).
4. Se o tutorial incluir opções (ex: Opção 1 normal, Opção 2 unbrick com pino GND/hardware), estrutura claramente cada método com os passos detalhados.
5. Preserva todos os links úteis de download de ficheiros, ferramentas ou anexos mencionados.

Estrutura OBRIGATÓRIA do documento:

# [Nome do Dispositivo / Projeto] — [Subtítulo claro e elucidativo do que faz]

## Objetivo
Explicação concisa e direta do que é o projeto/tutorial, o que permite fazer (desbloquear, instalar firmware, root, integrar) e o benefício prático.

## Avisos e Cuidados Importantes
(Se aplicável, avisos de garantia, riscos de brick, versões de hardware suportadas).

## Requisitos
- **Hardware:** (dispositivo exato, cabos, computadores necessários)
- **Software / Dependências:** (sistemas operativos suportados, drivers, pacotes Python, ferramentas CLI como adb/fastboot)
- **Ficheiros e Ferramentas:** (links e nomes de ficheiros para download)

## Preparação e Pré-requisitos
Passos prévios necessários antes de iniciar o procedimento (colocar em modo fastboot, instalar drivers, etc.).

## Instruções Passo a Passo
Passo a passo sequencial, limpo e organizado com todos os comandos de consola e ações necessárias. Se houver métodos alternativos (ex.: Fastboot vs Hardware/Unbrick), divide em subsecções claras (### Método 1 ..., ### Método 2 ...).

## Pós-Instalação e Próximos Passos
O que fazer após o procedimento (ex.: como entrar no TWRP, instalar ROM, integrar com Home Assistant, etc.).

## Resolução de Problemas (Troubleshooting)
Lista prática de resoluções de erros frequentes, verificação de ligação USB e recuperação.

A primeira linha da tua resposta DEVE ser o título do guia começando por "# ". Não uses blocos de código a envolver todo o texto.`;

  const userContent = `Origem: ${sourceName} (${sourceUrl || ''})\n\nConteúdo original:\n${content.slice(0, 45000)}`;

  let rawText = '';

  if (isGoogle) {
    let preferredModel = String(process.env.AI_MODEL || '').trim();
    if (!preferredModel || preferredModel.startsWith('grok') || preferredModel.startsWith('gpt')) {
      preferredModel = 'gemini-2.5-flash';
    }

    const modelsToTry = [
      preferredModel,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-exp'
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    let lastError = null;

    for (const m of modelsToTry) {
      console.log(`[Rastro AI] A tentar Google Gemini modelo: ${m}...`);
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;

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

      if (response.ok) {
        const data = await response.json();
        rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (rawText) break;
      } else {
        const errorBody = await response.text();
        console.warn(`[Rastro AI] Modelo ${m} falhou com HTTP ${response.status}:`, errorBody);
        let errorDetail = `Erro HTTP ${response.status}`;
        try {
          const parsedErr = JSON.parse(errorBody);
          errorDetail = parsedErr.error?.message || parsedErr.message || errorDetail;
        } catch {}

        if (response.status === 404) {
          lastError = new Error(`Google Gemini (${response.status}): ${errorDetail}`);
          continue; // Tenta o modelo seguinte automaticamente
        }
        throw new Error(`Google Gemini (${response.status}): ${errorDetail}`);
      }
    }

    if (!rawText && lastError) {
      throw lastError;
    }
  } else {
    // API Compatível OpenAI (xAI Grok, Groq, Ollama, OpenAI)
    const { endpoint, model } = getAiEndpointAndModel();
    console.log(`[Rastro AI] A enviar ${sourceName} para ${endpoint} (${model})...`);

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
  let title = `Guia DIY — ${sourceName}`;
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
