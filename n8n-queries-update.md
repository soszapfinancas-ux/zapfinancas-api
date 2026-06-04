# Atualização das Queries do Fluxo n8n

Abaixo estão as alterações que precisam ser feitas em cada nó do fluxo principal.
Apenas os nós que mudam estão listados.

---

## 1. Nó: "Varre o BD pelo remotejid"

**Tipo:** Postgres → Execute Query  
**Substituir o SQL por:**

```sql
SELECT
  u.*,
  c.status         AS conta_status,
  c.plano_id,
  c.id             AS conta_id,
  p.max_telefones,
  p.tem_exportacao,
  p.tem_lembretes_avancados
FROM usuarios u
LEFT JOIN contas c ON u.conta_id = c.id
LEFT JOIN planos p ON c.plano_id = p.id
WHERE u.remotejid = $1;
```

**Query Replacement:** `={{ $json.remoteJid }}`

---

## 2. Nó: "If4" — Verifica se usuário existe

**Substituir a condição por:**  
Manter como está — verifica se o objeto JSON está vazio (usuário não encontrado).

---

## 3. Nó: "Trava se usuario ativo ou nao"

**Tipo:** IF  
**Substituir as condições por:**

Condição 1 (OR):
- Left: `={{ $('Varre o BD pelo remotejid').item.json?.id }}`
- Operator: Does Not Exist

Condição 2 (OR):
- Left: `={{ $('Varre o BD pelo remotejid').item.json?.conta_status }}`
- Operator: Not Equal
- Right: `ativo`

**Saída TRUE → Usuário inativo ou não existe → vai para mensagem de cobrança**  
**Saída FALSE → Usuário ativo → vai para pegar token**

---

## 4. Nó: "Cria Usuario" — SUBSTITUIR COMPLETAMENTE

**Tipo:** Postgres → Execute Query  
**Remover:** os nós "Cria MasterToken" e "Cria Carteira Principal" (a função cria tudo de uma vez)

**Novo SQL:**
```sql
SELECT * FROM registrar_novo_usuario($1, $2, $3);
```

**Query Replacement (3 parâmetros separados por vírgula):**
```
={{ $('referencia das mensagens recebidas').item.json.remoteJid }},={{ $('referencia das mensagens recebidas').item.json.pushname || 'Usuário' }},={{ $('referencia das mensagens recebidas').item.json.remoteJid.split('@')[0] }}
```

**Saída:** retorna `{ usuario_id, conta_id, api_token }`

---

## 5. Nó: "Pega o Token do Usuario" — mantém mas ajusta

**SQL atual está correto.** Apenas confirmar que usa:
```sql
SELECT * FROM api_tokens WHERE usuario_id = $1;
```
**Query Replacement:** `={{ $('Varre o BD pelo remotejid').item.json?.id }}`

---

## 6. Nó: "Edit Fields" — adicionar campo plano

Após o Merge, no nó Edit Fields, adicionar o campo:
```
tem_exportacao = {{ $item("0").$node["Variaveis do Sistema"].json["tem_exportacao"] }}
```
(útil para o agente saber se pode gerar relatórios PDF/Excel)

---

## 7. System Prompt do AI Agent — adicionar contexto de plano

No final do system prompt, adicionar antes do fechamento:

```
## Recursos disponíveis para este usuário
- Exportação PDF/Excel: {{ $item("0").$node["Edit Fields"].json["tem_exportacao"] ? "SIM — o usuário pode solicitar /relatorio" : "NÃO — apenas no Plano Familiar" }}
- Máximo de telefones na conta: {{ $item("0").$node["Edit Fields"].json["max_telefones"] }}
```

---

## 8. Diagrama do novo fluxo de cadastro

```
Primeira mensagem
       ↓
Varre BD pelo remotejid
       ↓
If4: JSON vazio? ─── SIM ──→ registrar_novo_usuario() ──→ Envia Boas Vindas
       │ NÃO
       ↓
Trava: conta_status = 'ativo'? ─── NÃO ──→ Envia mensagem cobrança
       │ SIM
       ↓
Pega Token do Usuário
       ↓
AI Agent
```

---

## Checklist de deploy

- [ ] Copiar `.env.example` para `.env` e preencher todas as variáveis
- [ ] Criar banco: `createdb zapfinancas`
- [ ] Rodar schema: `psql -U postgres -d zapfinancas -f schema.sql`
- [ ] Instalar dependências: `npm install`
- [ ] Iniciar API: `pm2 start src/index.js --name zapfinancas-api`
- [ ] Configurar Nginx para proxy `zapfinancas.orbitarosa.com → localhost:3000`
- [ ] Importar fluxo no n8n e atualizar as queries acima
- [ ] Preencher credenciais no nó "credenciais" do n8n:
  - `openai_token`
  - `gemini_token`
  - `endpoint_url` = `https://zapfinancas.orbitarosa.com`
- [ ] Configurar webhook UAZAPI → URL do n8n (`/webhook/financehub`)
- [ ] Configurar webhook Hotmart → `https://zapfinancas.orbitarosa.com/webhook/hotmart`
- [ ] Testar: mandar mensagem no WhatsApp → verificar se cria usuário no BD
- [ ] Testar: cadastrar compra teste no Hotmart → verificar se ativa conta

---

## Nginx config sugerido

```nginx
server {
    listen 80;
    server_name zapfinancas.orbitarosa.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name zapfinancas.orbitarosa.com;

    ssl_certificate     /etc/letsencrypt/live/zapfinancas.orbitarosa.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zapfinancas.orbitarosa.com/privkey.pem;

    location /api/       { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
    location /webhook/   { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
    location /admin/     { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
    location /health     { proxy_pass http://localhost:3000; }

    # Painel (Next.js ou HTML estático — fase 3)
    location / {
        root /var/www/zapfinancas-painel;
        try_files $uri $uri/ /index.html;
    }
}
```
