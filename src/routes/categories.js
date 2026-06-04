const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

// GET /api/categories
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, descricao, icone, cor, tipo
       FROM categorias
       WHERE usuario_id = $1 AND ativo = TRUE
       ORDER BY nome`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar categorias' });
  }
});

// POST /api/categories
router.post('/', async (req, res) => {
  const { nome, descricao, icone, cor, tipo = 'ambos' } = req.body;
  if (!nome) return res.status(400).json({ error: 'Campo obrigatório: nome' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO categorias (usuario_id, nome, descricao, icone, cor, tipo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, nome, descricao || null, icone || '🔖', cor || '#6366f1', tipo]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

// PUT /api/categories/:id
router.put('/:id', async (req, res) => {
  const { nome, descricao, icone, cor, tipo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE categorias SET
         nome      = COALESCE($1, nome),
         descricao = COALESCE($2, descricao),
         icone     = COALESCE($3, icone),
         cor       = COALESCE($4, cor),
         tipo      = COALESCE($5, tipo)
       WHERE id=$6 AND usuario_id=$7 RETURNING *`,
      [nome, descricao, icone, cor, tipo, req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req, res) => {
  try {
    // Verifica se há transações usando esta categoria
    const inUse = await pool.query(
      'SELECT COUNT(*) FROM transacoes WHERE categoria_id=$1 AND usuario_id=$2',
      [req.params.id, req.userId]
    );
    if (parseInt(inUse.rows[0].count) > 0) {
      // Soft delete — mantém para histórico
      await pool.query(
        'UPDATE categorias SET ativo=FALSE WHERE id=$1 AND usuario_id=$2',
        [req.params.id, req.userId]
      );
      return res.json({ success: true, message: 'Categoria desativada (possui transações associadas)' });
    }
    await pool.query(
      'DELETE FROM categorias WHERE id=$1 AND usuario_id=$2',
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar categoria' });
  }
});

module.exports = router;
