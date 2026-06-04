const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

// GET /api/transactions/recent
router.get('/recent', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         t.id, t.descricao, t.valor, t.tipo,
         t.data_transacao, t.status, t.created_at,
         c.nome  AS categoria,
         c.icone AS categoria_icone,
         c.cor   AS categoria_cor,
         fp.nome AS forma_pagamento,
         w.nome  AS carteira
       FROM transacoes t
       LEFT JOIN categorias      c  ON t.categoria_id       = c.id
       LEFT JOIN formas_pagamento fp ON t.forma_pagamento_id = fp.id
       LEFT JOIN carteiras        w  ON t.carteira_id        = w.id
       WHERE t.usuario_id = $1
       ORDER BY t.data_transacao DESC, t.created_at DESC
       LIMIT 20`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar transações recentes' });
  }
});

// GET /api/transactions/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, c.nome AS categoria_nome, fp.nome AS forma_pagamento_nome
       FROM transacoes t
       LEFT JOIN categorias       c  ON t.categoria_id       = c.id
       LEFT JOIN formas_pagamento fp ON t.forma_pagamento_id = fp.id
       WHERE t.id = $1 AND t.usuario_id = $2`,
      [req.params.id, req.userId]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Transação não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar transação' });
  }
});

// POST /api/transactions
router.post('/', async (req, res) => {
  const {
    descricao, valor, tipo,
    carteira_id, categoria_id, data_transacao,
    status = 'Efetivada', forma_pagamento_id,
  } = req.body;

  if (!descricao || !valor || !tipo || !carteira_id || !categoria_id || !data_transacao)
    return res.status(400).json({
      error: 'Campos obrigatórios: descricao, valor, tipo, carteira_id, categoria_id, data_transacao',
    });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO transacoes
         (usuario_id, carteira_id, categoria_id, forma_pagamento_id,
          descricao, valor, tipo, data_transacao, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.userId, carteira_id, categoria_id, forma_pagamento_id || null,
       descricao, Math.abs(Number(valor)), tipo, data_transacao, status]
    );

    const delta = tipo === 'Receita' ? Math.abs(Number(valor)) : -Math.abs(Number(valor));
    await client.query(
      'UPDATE carteiras SET saldo_atual = saldo_atual + $1 WHERE id = $2 AND usuario_id = $3',
      [delta, carteira_id, req.userId]
    );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erro ao inserir transação' });
  } finally {
    client.release();
  }
});

// PATCH /api/transactions/:id
router.patch('/:id', async (req, res) => {
  const {
    descricao, valor, tipo,
    carteira_id, categoria_id, data_transacao,
    status, forma_pagamento_id,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const original = await client.query(
      'SELECT * FROM transacoes WHERE id=$1 AND usuario_id=$2',
      [req.params.id, req.userId]
    );
    if (original.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transação não encontrada' });
    }
    const orig = original.rows[0];

    const newValor    = valor      !== undefined ? Math.abs(Number(valor)) : Number(orig.valor);
    const newTipo     = tipo       || orig.tipo;
    const newCarteira = carteira_id || orig.carteira_id;

    // Reverter impacto original na carteira
    const origDelta = orig.tipo === 'Receita' ? -Number(orig.valor) : Number(orig.valor);
    await client.query(
      'UPDATE carteiras SET saldo_atual = saldo_atual + $1 WHERE id=$2 AND usuario_id=$3',
      [origDelta, orig.carteira_id, req.userId]
    );

    // Aplicar novo impacto
    const newDelta = newTipo === 'Receita' ? newValor : -newValor;
    await client.query(
      'UPDATE carteiras SET saldo_atual = saldo_atual + $1 WHERE id=$2 AND usuario_id=$3',
      [newDelta, newCarteira, req.userId]
    );

    const { rows } = await client.query(
      `UPDATE transacoes SET
         descricao          = COALESCE($1, descricao),
         valor              = COALESCE($2, valor),
         tipo               = COALESCE($3, tipo),
         carteira_id        = COALESCE($4, carteira_id),
         categoria_id       = COALESCE($5, categoria_id),
         data_transacao     = COALESCE($6, data_transacao),
         status             = COALESCE($7, status),
         forma_pagamento_id = COALESCE($8, forma_pagamento_id),
         updated_at         = NOW()
       WHERE id=$9 AND usuario_id=$10 RETURNING *`,
      [
        descricao,
        valor !== undefined ? Math.abs(Number(valor)) : null,
        tipo, carteira_id, categoria_id, data_transacao,
        status, forma_pagamento_id,
        req.params.id, req.userId,
      ]
    );

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar transação' });
  } finally {
    client.release();
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'DELETE FROM transacoes WHERE id=$1 AND usuario_id=$2 RETURNING *',
      [req.params.id, req.userId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    const deleted = rows[0];
    const delta   = deleted.tipo === 'Receita' ? -Number(deleted.valor) : Number(deleted.valor);
    await client.query(
      'UPDATE carteiras SET saldo_atual = saldo_atual + $1 WHERE id=$2 AND usuario_id=$3',
      [delta, deleted.carteira_id, req.userId]
    );

    await client.query('COMMIT');
    res.json({ success: true, deleted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar transação' });
  } finally {
    client.release();
  }
});

module.exports = router;
