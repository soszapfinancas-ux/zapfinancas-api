# Ativação automática via Hotmart — referência do sistema

Documento vivo: como a ativação automática funciona, o que já foi feito, e o
passo a passo pra incluir um produto novo no futuro. Atualizar este arquivo
a cada mudança relevante no fluxo de ativação.

---

## Como funciona (visão geral)

```
Compra aprovada na Hotmart
        ↓
POST https://zapfinancas.orbitarosa.com/webhook/hotmart
        ↓
src/routes/hotmart.js valida o hottok, lê o product_id
        ↓
Busca em hotmart_produtos → descobre o plano vinculado
        ↓
Cria ou renova a conta (tabela contas) com esse plano, status='ativo'
        ↓
Vincula o telefone do comprador a um usuário (vincular_usuario_conta)
        ↓
Comprador já pode conversar com o bot no WhatsApp
```

- **Webhook:** `POST /webhook/hotmart` — único endpoint, atende todos os produtos, evento esperado: `PURCHASE_APPROVED`
- **Segurança:** header `x-hotmart-hottok` comparado com `HOTMART_HOTTOK` do `.env` do servidor. Sem token válido → `401`.
- **Mapeamento produto → plano:** tabela `hotmart_produtos` (`hotmart_product_id`, `plano_id`, `nome`, `ativo`)
- **Painel admin:** `https://zapfinancas.orbitarosa.com/admin.html`, autenticado por `x-admin-token` (comparado com `ADMIN_TOKEN` do `.env`)

## Como incluir um produto novo (checklist)

1. Pegar o **ID do produto** na Hotmart: Produtos > [o produto] > Configurações > URL de checkout (número no final da URL)
2. Decidir o **plano**: reaproveitar um já existente (Casal, Familiar, Individual, Protocolo Corrida Lucrativa) ou criar um novo
   - Plano novo: hoje só dá via SQL direto (`INSERT INTO planos (nome, descricao, max_telefones, is_motorista) VALUES (...)`) — não existe rota admin para criar plano, só pra renomear um existente
3. No painel admin (`admin.html`) → seção **"Produtos Hotmart"** → preencher ID do produto, nome, e escolher o plano → "+ Adicionar"
   (equivalente via API: `POST /admin/hotmart-products` com `{hotmart_product_id, plano_id, nome}`)
4. Na Hotmart: **Ferramentas > Webhooks** → cadastrar (ou confirmar que já existe) o webhook desse produto apontando pra `https://zapfinancas.orbitarosa.com/webhook/hotmart`, evento **"Compra Aprovada"**, mesmo hottok dos outros produtos
5. Testar: usar o botão de teste de webhook da própria Hotmart, ou aguardar uma compra real, e conferir em `GET /admin/accounts` se uma conta nova apareceu com o plano certo

## Produtos mapeados hoje (tabela `hotmart_produtos`)

| Produto Hotmart | ID | Plano vinculado | Status |
|---|---|---|---|
| CASAL COM GRANA | `7940783` | Casal (id 1) | ✅ ativo, confirmado funcionando (conta ativada 22/07/2026) |
| LUCRO REAL DO MOTORISTA (Protocolo Corrida Lucrativa) | `7918279` | Farol (id 5) | ✅ ativo, confirmado funcionando (última ativação 11/07/2026) |

Consulta: `GET /admin/hotmart-products` (header `x-admin-token`).

### Pendência: renomear plano id 5

Ainda consta como **"Farol"** (descrição "Meu Farol no Bolso" — nome de outro produto, reaproveitado). 3 contas ativas usam esse plano; renomear é só cosmético, não afeta o acesso delas.

Como renomear (qualquer uma das duas):
- **Painel:** Admin > seção "Planos" > botão "Renomear" na linha do plano
- **API:** `PATCH /admin/plans/5` com `{"nome": "Protocolo Corrida Lucrativa", "descricao": "Protocolo Corrida Lucrativa"}`

### Nota: Protocolo Corrida Lucrativa (motorista-planner) não está 100% integrado

A ativação da Hotmart cria a **conta ZapFinanças** (bot WhatsApp) normalmente, mas o `motorista-planner/planner.html` (a ferramenta de registro de corridas) continua 100% client-side (`localStorage`), sem login nem conexão com essa API — ver `motorista-planner/README.md`. O comprador recebe a conta ativa, mas o planner em si ainda não está conectado a ela. Mapeamento de integração futura já descrito no README do motorista-planner.

## Rotas admin relevantes (`src/routes/admin.js`, todas exigem `x-admin-token`)

| Rota | O que faz |
|---|---|
| `GET /admin/accounts` | Lista contas (`?excluidas=true` pra ver excluídas) |
| `POST /admin/accounts` | Cadastra e ativa conta manualmente — sem passar pela Hotmart (nome, telefone, plano_id). `email_comprador` recebe automaticamente `ddi+ddd+telefone@s.whatsapp.net`, não é mais digitado |
| `PATCH /admin/accounts/:id` | Edita nome do comprador |
| `PATCH /admin/accounts/:id/plan` | Troca o plano de uma conta |
| `POST /admin/accounts/:id/activate` \| `/deactivate` | Ativa/desativa conta |
| `POST /admin/accounts/:contaId/add-member` | Adiciona membro à conta |
| `GET /admin/plans` | Lista planos |
| `PATCH /admin/plans/:id` | Renomeia nome/descrição de um plano |
| `GET /admin/hotmart-products` \| `POST` \| `DELETE /:id` | Lista/cadastra/remove mapeamento produto Hotmart → plano |

Cadastro manual (`POST /admin/accounts`) segue a mesma lógica do webhook: cria a conta, ativa na hora, e já vincula o titular no WhatsApp via `vincular_usuario_conta()` — útil pra ativar alguém sem esperar a Hotmart (cortesia, correção manual, etc), inclusive pelo botão **"+ Cadastrar Conta"** no painel.

---

## Histórico

**22/07/2026 — Auditoria inicial + correções de segurança + novos recursos**

- Analisado o webhook `POST /webhook/hotmart` (único, já existente, ativo)
- Confirmado via `GET /admin/hotmart-products`: Casal com Grana (`7940783`) e Lucro Real do Motorista/Corrida Lucrativa (`7918279`) já mapeados e ativos
- Testada a segurança do webhook: hottok inválido → `401` (confirmado)
- Identificado que o `motorista-planner` (Protocolo Corrida Lucrativa) não está conectado à API — é uma página client-side isolada
- Adicionadas 2 rotas em `src/routes/admin.js`: `PATCH /admin/plans/:id` (renomear plano) e `POST /admin/accounts` (cadastro manual de conta)
- Adicionada UI correspondente em `painel/admin.html`: seção "Planos" e botão "+ Cadastrar Conta"
- **Incidente de segurança encontrado e corrigido:** o `ADMIN_TOKEN` de produção estava em texto puro no `.env.example`, versionado no GitHub **público** `soszapfinancas-ux/zapfinancas-api` desde 04/06/2026 (~7 semanas exposto). Corrigido o arquivo (placeholder no lugar do valor real) e **rotacionado o `ADMIN_TOKEN`** em produção — token antigo confirmado inválido (`401`), token novo confirmado funcionando
- Removida cópia duplicada/desatualizada `src/routes/admin.html` (sobrava do upload manual anterior) e adicionado `.gitignore` (`.env`, `node_modules/`)
- Pasta local conectada ao repositório GitHub (`git init` + `remote add origin`) e mudanças enviadas via `git push`
- Confirmado ao vivo em produção (via curl): as duas rotas novas respondem corretamente (`400` em payload incompleto = rota existe e valida)
- ⚠️ Correção: as contas do plano Casal ativadas em 22/07/2026 citadas nesta auditoria **não eram prova do webhook** — foram criadas manualmente pelo painel (cadastro manual), não pela Hotmart. O teste de ponta a ponta de verdade só aconteceu no dia seguinte (ver abaixo).

**23/07/2026 — Teste real do webhook revelou bug crítico (função ausente no banco) + achados sobre e-mail**

- Reenviado teste de webhook real pela Hotmart (`PURCHASE_APPROVED`, produto Casal com Grana) → retornou **500 Internal Server Error**
- Log do servidor (`pm2 logs`) revelou a causa: `function vincular_usuario_conta(...) does not exist` (Postgres `42883`) — **o `schema-v5.sql` nunca tinha sido aplicado no banco de produção**, apesar do código (`hotmart.js`) já depender dele
- Reconstruído o motivo pelas datas: `schema-v5.sql` foi escrito em 16/07/2026, e todas as contas reais encontradas (ativadas entre 19/06 e 14/07) são anteriores a isso — ou seja, **desde 16/07 nenhuma compra de cliente novo estava sendo ativada automaticamente**, falhando silenciosamente (a Hotmart tentava, recebia 500, tentava de novo, e desistia)
- Isso também deixava quebrado o `POST /admin/accounts` (cadastro manual) criado no dia anterior, pelo mesmo motivo
- **Correção aplicada:** `schema-v5.sql` rodado em produção via script Node (`pg` + `dotenv`, direto no container — não tem `psql` instalado nele, é um container Docker Swarm em `/app`) — sucesso confirmado
- Reenviado o mesmo teste da Hotmart → **ativação automática funcionou de ponta a ponta**: conta nova criada e usuário vinculado ao WhatsApp sem nenhuma ação manual (confirmado comparando contagem de contas antes/depois)
- Durante a investigação, cheguei a alterar `vincular_usuario_conta` pra gravar o e-mail real da Hotmart em `usuarios.email` (achando que era um bug) — **revertido**: `usuarios.email` precisa continuar no formato `telefone@s.whatsapp.net`, é o que o bot/UAZAPI usa pra reconhecer a conta como ativa. Mudança desfeita em `hotmart.js`/`admin.js`, `schema-v6.sql` (que criava isso) removido do repo
- Rastreio completo de dados de clientes (e-mail, telefone, etc.) vai ficar numa planilha separada, fora do escopo deste banco por enquanto
- **Ainda não explicado:** o campo `contas.email_comprador` de uma das contas de teste (criada via webhook real) ficou com um valor estranho (`williamsambagol2024@s.whatsapp.net` — nem o e-mail real completo, nem o formato de remotejid) — não investigado a fundo, baixa prioridade

**23/07/2026 (continuação) — Tentativa de renomear a coluna causou queda de produção; revertido; fix final bem mais simples**

- Tentei generalizar o formato `telefone@s.whatsapp.net` renomeando `contas.email_comprador` → `telefone_identificador` em todo o sistema (Hotmart, Asaas, admin, account.js) — mudança grande, tocando 5 arquivos + 1 migração
- Rodei a migração (`ALTER TABLE ... RENAME COLUMN`) no banco de produção, mas o **código do container não foi atualizado junto** (`git push` não redeploya o container sozinho — isso não estava claro até esse momento) → **painel e API ficaram fora do ar (`500`) por alguns minutos**, porque o código antigo ainda buscava a coluna pelo nome velho
- **Ação de emergência:** revertido o rename da coluna direto no banco (`ALTER TABLE ... RENAME COLUMN telefone_identificador TO email_comprador`) — confirmado `200 OK` de volta em `GET /admin/accounts`
- Código local também revertido pro estado estável (`git checkout` no commit anterior ao refactor) pra bater com o que está rodando em produção
- **Fix final, bem mais simples e sem migração nenhuma:** só o cadastro manual do painel (`POST /admin/accounts`) passou a gravar `ddi+ddd+telefone@s.whatsapp.net` em `email_comprador` (no lugar do e-mail digitado) — Hotmart, Asaas e o resto do sistema continuam exatamente como estavam, sem nenhuma mudança de schema
- Removido o campo "E-mail (opcional)" do formulário de cadastro manual no painel (não é mais necessário, o valor é automático)
- Deploy automático confirmado e testado ao vivo: `POST /admin/accounts` com conta de teste gravou `email_comprador = "5511900000001@s.whatsapp.net"` (formato correto), conta de teste removida em seguida

**Lição aprendida (corrigida):** o container **redeploya automaticamente** a partir do push no GitHub (plataforma tipo Coolify, confirmado no "Histórico de Implantação" do painel dela). O problema do incidente não foi falta de auto-deploy — foi que a migração do banco (`ALTER TABLE ... RENAME COLUMN`) foi rodada manualmente logo em seguida ao push, provavelmente **antes do redeploy automático do código terminar**, criando uma janela onde código antigo + banco novo ficaram incompatíveis. **Regra pra próxima vez:** depois de um `git push` que muda schema, esperar confirmar que o deploy automático terminou (checar o histórico de implantação da plataforma) antes de rodar qualquer migração de banco.

**Pendências em aberto:**
- Renomear plano id 5 de "Farol" para "Protocolo Corrida Lucrativa" (SQL ou painel — ver seção acima)
- Conectar `motorista-planner/planner.html` à API (login OTP + rotas de transactions/reminders), conforme roadmap em `motorista-planner/README.md`
- Investigar valor estranho em `contas.email_comprador` de contas vindas do webhook real (ver acima) — baixa prioridade
- Conferir na Hotmart se teve venda real entre 16/07 e 23/07 que ficou sem conta criada (janela em que o webhook esteve quebrado por causa do `schema-v5.sql` ausente) — esses compradores pagaram e podem não ter sido ativados; cadastrar manualmente os que faltarem
- ~~Descobrir como o deploy de código funciona~~ — confirmado: auto-deploy via plataforma (tipo Coolify) a partir do push no GitHub
