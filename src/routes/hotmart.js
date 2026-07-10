// Webhook Hotmart — ativa contas automaticamente na compra
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const axios   = require('axios');

// Mesma regra usada em auth.js e asaas.js: remotejid sempre inclui o DDI 55
function normalizePhoneDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 12 ? digits : `55${digits}`;
}

async function notificarAtivacao(telefone, nome, contaId, email, planoNome, productId) {
  const webhookUrl = process.env.N8N_WEBHOOK_ATIVACAO;
  if (!webhookUrl) return;

  const payload = {
    evento:       'usuario_ativado',
    timestamp:    new Date().toISOString(),
    dominio:      process.env.APP_URL || 'https://zapfinancas.orbitarosa.com',
    id:           contaId,
    nome,
    telefone:     telefone.replace(/\D/g, ''),
    email,
    plano_nome:   planoNome,
    produto_id:   productId,
    mensagem_ativacao: {
      titulo:   'Sua conta foi ativada!',
      mensagem: `Olá, ${nome.split(' ')[0]}! 🎉 Sua conta no *ZapFinanças* foi ativada com sucesso!\n\nAgora você já pode registrar seus gastos e receitas diretamente aqui pelo WhatsApp.\n\nAcesse também o painel web para ver seus relatórios e gráficos:`,
    },
  };

  try {
    await axios.post(webhookUrl, payload, { timeout: 8000 });
  } catch (e) {
    console.warn('[Hotmart] Falha ao chamar webhook de ativação:', e.message);
  }
}

// POST /webhook/hotmart
router.post('/', async (req, res) => {
  const hottok = req.headers['x-hotmart-hottok'] || req.headers['hottok'];
  if (process.env.HOTMART_HOTTOK && hottok !== process.env.HOTMART_HOTTOK) {
    return res.status(401).json({ error: 'Hottok inválido' });
  }

  const event = req.body.event;
  console.log(`[Hotmart] evento: ${event}`);

  if (event !== 'PURCHASE_APPROVED') {
    return res.json({ received: true, ignored: true });
  }

  const data = req.body.data;
  if (!data) return res.status(400).json({ error: 'Payload inválido' });

  const buyer     = data.buyer    || {};
  const product   = data.product  || {};
  const purchase  = data.purchase || {};
  const productId = String(product.id || '');
  const txId      = purchase.transaction || '';
  const email     = buyer.email  || '';
  const nome      = buyer.name   || 'Usuário';
  const telefone  = buyer.phone  || '';
  const valor     = purchase.value?.total || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lookup dinâmico do plano pelo produto Hotmart
    const prodRes = await client.query(
      `SELECT hp.plano_id, p.nome AS plano_nome
       FROM hotmart_produtos hp
       JOIN planos p ON hp.plano_id = p.id
       WHERE hp.hotmart_product_id = $1 AND hp.ativo = TRUE`,
      [productId]
    );

    let planoId   = 3; // Individual como fallback (modo dev sem HOTTOK)
    let planoNome = 'Individual';

    if (prodRes.rows.length > 0) {
      planoId   = prodRes.rows[0].plano_id;
      planoNome = prodRes.rows[0].plano_nome;
    } else if (process.env.HOTMART_HOTTOK) {
      // Em produção, produto não mapeado em hotmart_produtos → ignora
      console.warn(`[Hotmart] Produto ${productId} não mapeado em hotmart_produtos`);
      await client.query('ROLLBACK');
      return res.json({ received: true, ignored: true, reason: 'produto não mapeado' });
    }

    // Verifica conta existente pelo e-mail
    const existing = await client.query(
      `SELECT id FROM contas WHERE email_comprador = $1 ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    let contaId;
    if (existing.rows.length > 0) {
      // Renova conta existente e atualiza plano
      contaId = existing.rows[0].id;
      await client.query(
        `UPDATE contas SET
           status = 'ativo',
           plano_id = $2,
           hotmart_transaction_id = $3,
           data_ativacao = NOW(),
           data_expiracao = NOW() + INTERVAL '1 year',
           excluida = FALSE,
           excluida_em = NULL
         WHERE id = $1`,
        [contaId, planoId, txId]
      );
    } else {
      // Cria nova conta
      const contaRes = await client.query(
        `INSERT INTO contas
           (plano_id, status, email_comprador, nome_comprador, telefone_comprador,
            hotmart_transaction_id, data_ativacao, data_expiracao)
         VALUES ($1,'ativo',$2,$3,$4,$5,NOW(),NOW() + INTERVAL '1 year') RETURNING id`,
        [planoId, email, nome, telefone, txId]
      );
      contaId = contaRes.rows[0].id;

      // Vincula usuário que já interagiu com o bot pelo telefone
      const telefoneNormalizado = normalizePhoneDigits(telefone);
      const vinculo = await client.query(
        `UPDATE usuarios SET conta_id = $1, ativo = TRUE
         WHERE remotejid LIKE $2
         AND conta_id IN (SELECT id FROM contas WHERE status = 'inativo')`,
        [contaId, `${telefoneNormalizado}%`]
      );
      if (vinculo.rowCount === 0) {
        console.warn(`[Hotmart] Nenhum usuário vinculado pelo telefone ${telefone} (normalizado: ${telefoneNormalizado}) na conta ${contaId}`);
      }
    }

    // Log da compra
    await client.query(
      `INSERT INTO compras_hotmart
         (conta_id, hotmart_transaction_id, produto_id, produto_nome, valor, tipo, status, email_comprador, payload)
       VALUES ($1,$2,$3,$4,$5,'principal','APPROVED',$6,$7)`,
      [contaId, txId, productId, product.name || planoNome, valor, email, JSON.stringify(req.body)]
    );

    await client.query('COMMIT');

    notificarAtivacao(telefone, nome, contaId, email, planoNome, productId);
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Hotmart] Erro:', err);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  } finally {
    client.release();
  }
});

module.exports = router;
