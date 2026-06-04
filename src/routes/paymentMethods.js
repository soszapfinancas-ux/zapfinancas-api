const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

// GET /api/payment-methods
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome FROM formas_pagamento
       WHERE usuario_id=$1 AND ativo=TRUE ORDER BY nome`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar formas de pagamento' });
  }
});

// POST /api/payment-methods
router.post('/', async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Campo obrigatório: nome' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO formas_pagamento (usuario_id, nome) VALUES ($1,$2) RETURNING *',
      [req.userId, nome]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar forma de pagamento' });
  }
});

// PUT /api/payment-methods/:id
router.put('/:id', async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Campo obrigatório: nome' });
  try {
    const { rows } = await pool.query(
      'UPDATE formas_pagamento SET nome=$1 WHERE id=$2 AND usuario_id=$3 RETURNING *',
      [nome, req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Forma de pagamento não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar forma de pagamento' });
  }
});

// DELETE /api/payment-methods/:id
router.delete('/:id', async (req, res) => {
  try {
    const inUse = await pool.query(
      'SELECT COUNT(*) FROM transacoes WHERE forma_pagamento_id=$1 AND usuario_id=$2',
      [req.params.id, req.userId]
    );
    if (parseInt(inUse.rows[0].count) > 0) {
      await pool.query(
        'UPDATE formas_pagamento SET ativo=FALSE WHERE id=$1 AND usuario_id=$2',
        [req.params.id, req.userId]
      );
      return res.json({ success: true, message: 'Forma de pagamento desativada (possui histórico)' });
    }
    await pool.query(
      'DELETE FROM formas_pagamento WHERE id=$1 AND usuario_id=$2',
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar forma de pagamento' });
  }
});

module.exports = router;
