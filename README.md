# Rastro

Base de conhecimento pessoal para guardar tutoriais, decisões técnicas e projetos DIY.

## Funcionalidades

- Notas persistentes em PostgreSQL
- Tema claro e escuro
- Projetos e etiquetas
- Importação de repositórios GitHub públicos
- Organização automática de documentação em português de Portugal (opcional)

## Arranque com Docker

1. Copia `.env.example` para `.env`.
2. Preenche uma password forte para `POSTGRES_PASSWORD`.
3. Se quiseres organização por IA, preenche `AI_API_KEY`.
4. Executa:

```bash
docker compose up -d --build
```

Depois abre `http://IP_DO_UNRAID:3000`.

### Unraid / GHCR

A imagem publicada é:

```text
ghcr.io/barroso88/rastro:latest
```

No Unraid, usa essa imagem no Docker template. Se o pacote GHCR estiver privado, autentica o Docker Registry com um GitHub Personal Access Token que tenha permissão `read:packages`.

## Configuração da IA

O Rastro aceita APIs compatíveis com OpenAI:

```env
AI_API_KEY=chave-fora-do-GitHub
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Para outro fornecedor, altera `AI_BASE_URL` e `AI_MODEL` conforme a documentação desse fornecedor. Nunca coloques a chave diretamente no código ou num commit.
