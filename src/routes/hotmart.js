// Webhook Hotmart — ativa contas automaticamente na compra
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// POST /webhook/hotmart
router.post('/', async (req, res) => {
  // Validação do hottok (token de segurança configurado no painel Hotmart)
  const hottok = req.headers['x-hotmart-hottok'] || req.headers['hottok'];
  if (process.env.HOTMART_HOTTOK && hottok !== process.env.HOTMART_HOTTOK) {
    return res.status(401).json({ error: 'Hottok inválido' });
  }

  const event = req.body.event;
  console.log(`[Hotmart] evento: ${event}`);

  // Só processa compras aprovadas
  if (event !== 'PURCHASE_APPROVED') {
    return res.json({ received: true, ignored: true });
  }

  const data = req.body.data;
  if (!data) return res.status(400).json({ error: 'Payload inválido' });

  const buyer      = data.buyer      || {};
  const product    = data.product    || {};
  const purchase   = data.purchase   || {};
  const productId  = String(product.id || '');
  const baseId     = String(process.env.HOTMART_PRODUCT_BASE_ID     || '');
  const bumpId     = String(process.env.HOTMART_PRODUCT_ORDERBUMP_ID || '');
  const txId       = purchase.transaction || '';
  const email      = buyer.email      || '';
  const nome       = buyer.name       || 'Usuário';
  const telefone   = buyer.phone      || '';
  const valor      = purchase.value?.total || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Produto base (R$ 87) ─────────────────────────────────
    if (productId === baseId || baseId === '') {
      // Verifica se já existe uma conta ativa para este e-mail
      const existing = await client.query(
        `SELECT id FROM contas
         WHERE email_comprador = $1 AND status = 'ativo'
         LIMIT 1`,
        [email]
      );

      let contaId;
      if (existing.rows.length > 0) {
        // Renova a conta existente
        contaId = existing.rows[0].id;
        await client.query(
          `UPDATE contas SET
             status = 'ativo',
             hotmart_transaction_id = $2,
             data_ativacao = NOW(),
             data_expiracao = NULL
           WHERE id = $1`,
          [contaId, txId]
        );
      } else {
        // Cria nova conta ativa com plano base
        const contaRes = await client.query(
          `INSERT INTO contas
             (plano_id, status, email_comprador, nome_comprador, telefone_comprador,
              hotmart_transaction_id, data_ativacao)
           VALUES (1,'ativo',$1,$2,$3,$4,NOW()) RETURNING id`,
          [email, nome, telefone, txId]
        );
        contaId = contaRes.rows[0].id;

        // Se o usuário já tinha mandado mensagem (conta criada como inativo),
        // vincula o usuário existente pelo e-mail/remotejid aproximado
        await client.query(
          `UPDATE usuarios
           SET conta_id = $1, ativo = TRUE
           WHERE remotejid LIKE $2 AND conta_id IN (
             SELECT id FROM contas WHERE status = 'inativo'
           )`,
          [contaId, `${telefone.replace(/\D/g, '')}%`]
        );
      }

      // Log da compra
      await client.query(
        `INSERT INTO compras_hotmart
           (conta_id, hotmart_transaction_id, produto_id, produto_nome, valor, tipo, status, email_comprador, payload)
         VALUES ($1,$2,$3,$4,$5,'principal','APPROVED',$6,$7)`,
        [contaId, txId, productId, product.name || 'ZapFinanças Base', valor, email, JSON.stringify(req.body)]
      );
    }

    // ── Order bump — Plano Familiar (R$ 37) ─────────────────
    if (productId === bumpId && bumpId !== '') {
      const contaRes = await client.query(
        `SELECT id FROM contas
         WHERE email_comprador = $1
         ORDER BY created_at DESC LIMIT 1`,
        [email]
      );

      if (contaRes.rows.length > 0) {
        const contaId = contaRes.rows[0].id;
        await client.query(
          'UPDATE contas SET plano_id = 2 WHERE id = $1',
          [contaId]
        );
        await client.query(
          `INSERT INTO compras_hotmart
             (conta_id, hotmart_transaction_id, produto_id, produto_nome, valor, tipo, status, email_comprador, payload)
           VALUES ($1,$2,$3,$4,$5,'order_bump','APPROVED',$6,$7)`,
          [contaId, txId, productId, product.name || 'ZapFinanças Familiar', valor, email, JSON.stringify(req.body)]
        );
      }
    }

    await client.query('COMMIT');
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
