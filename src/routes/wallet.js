const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

// GET /api/wallet/current
router.get('/current', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, descricao, saldo_atual, data_criacao
       FROM carteiras
       WHERE usuario_id = $1
       ORDER BY data_criacao ASC
       LIMIT 1`,
      [req.userId]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Carteira não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar carteira' });
  }
});

// GET /api/wallet  (lista todas as carteiras do usuário)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, descricao, saldo_atual, data_criacao
       FROM carteiras WHERE usuario_id = $1 ORDER BY data_criacao`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar carteiras' });
  }
});

module.exports = router;
