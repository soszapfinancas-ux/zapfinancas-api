# Ativação automática via Hotmart — status e alterações (2026-07-22)

## Webhook (já ativo em produção)

```
POST https://zapfinancas.orbitarosa.com/webhook/hotmart
```

- Evento: `PURCHASE_APPROVED`
- Segurança: header `x-hotmart-hottok` validado contra `HOTMART_HOTTOK` (testado — retorna `401` sem token válido)
- Confirmar do lado da Hotmart: em **Ferramentas > Webhooks**, os dois produtos abaixo precisam ter esse webhook cadastrado com o evento "Compra Aprovada" marcado.

## Produtos mapeados (tabela `hotmart_produtos`)

| Produto Hotmart | ID | Plano vinculado | Status |
|---|---|---|---|
| CASAL COM GRANA | `7940783` | Casal (id 1) | ✅ ativo |
| LUCRO REAL DO MOTORISTA (Protocolo Corrida Lucrativa) | `7918279` | Farol (id 5) → renomear p/ "Protocolo Corrida Lucrativa" | ✅ ativo, rename pendente |

Consulta usada pra verificar: `GET /admin/hotmart-products` (header `x-admin-token`).

## Pendência: renomear plano id 5

Ainda como "Farol" (descrição "Meu Farol no Bolso") — nome antigo de outro produto, reaproveitado. 3 contas ativas já usam esse plano, renomear não afeta acesso delas.

**Opção A — pelo painel (depois do deploy abaixo):** Admin > seção "Planos" > botão "Renomear" na linha do plano.

**Opção B — SQL direto no servidor:**
```sql
UPDATE planos
SET nome = 'Protocolo Corrida Lucrativa',
    descricao = 'Protocolo Corrida Lucrativa'
WHERE id = 5;
```

## Nota importante: Protocolo Corrida Lucrativa (motorista-planner)

A ativação da Hotmart cria/ativa a **conta ZapFinanças** (bot WhatsApp), mas o `motorista-planner/planner.html` continua 100% client-side (`localStorage`), sem login nem conexão com a API — ver `motorista-planner/README.md`. Ou seja: o comprador recebe a conta ativa, mas o planner em si não está conectado a ela ainda. Integração futura mapeada no próprio README do motorista-planner.

## Alterações de código feitas nesta sessão (pendentes de deploy)

**`src/routes/admin.js`**
- `PATCH /admin/plans/:id` — renomeia nome/descrição de um plano
- `POST /admin/accounts` — cadastra e ativa conta manualmente (nome, telefone, e-mail opcional, plano_id), vinculando o titular no WhatsApp do mesmo jeito que o webhook da Hotmart faz

**`painel/admin.html`**
- Nova seção "Planos" (lista + botão "Renomear" por linha)
- Novo botão "+ Cadastrar Conta" na tabela de Contas → modal de cadastro manual
- `planBadge()`: adicionada cor para "Protocolo Corrida Lucrativa" (mesma cor laranja do "Farol", pra não perder o estilo quando o plano for renomeado)

Sintaxe do backend validada (`node -c`), sem testar contra banco real ainda.

## Deploy pendente

Esta pasta local **não é** o servidor de produção (não é repositório git). Falta:

1. Enviar `src/routes/admin.js` e `painel/admin.html` pro servidor
2. `pm2 restart zapfinancas-api` (só o backend precisa reiniciar — o HTML é servido estático)
3. Depois do deploy: testar `PATCH /admin/plans/5` e `POST /admin/accounts` em produção
