# SCsync

Ordens de serviço com cobrança Asaas (Pix/boleto), baixa automática por webhook e conciliação.

## Rodar

1. Supabase: crie o projeto (região São Paulo) e rode `supabase/migrations/*.sql` em ordem no SQL Editor.
2. Copie `.env.example` para `.env.local` e preencha.
3. `npm install && npm run dev`

`npm run build` roda os testes antes do build; o deploy na Vercel falha se um teste falhar.

## Como a baixa automática funciona

1. "Lançar contas" transforma as parcelas da OS em títulos (`launch_accounts`).
2. "Gerar cobrança" cria o cliente e a cobrança no Asaas (`externalReference` = id do título).
3. O Asaas chama `/api/webhooks/asaas/<org>` com o header `asaas-access-token`.
4. `apply_asaas_event` grava o evento uma vez só e liquida o título uma vez por cobrança.
5. Um cron diário (`/api/cron/reconcile-charges`) relê as cobranças abertas no Asaas, caso um webhook se perca.

Testes de banco: `tests/sql/slice.sql` (rode num Postgres com as migrações aplicadas).
