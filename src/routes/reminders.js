const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

// GET /api/reminders
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, titulo, descricao, data_lembrete,
              avisar_antes_horas, enviado_aviso, enviado, ativo, created_at
       FROM lembretes
       WHERE usuario_id=$1 AND ativo=TRUE
       ORDER BY data_lembrete ASC`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar lembretes' });
  }
});

// POST /api/reminders
// {titulo, descricao, data_lembrete, avisar_antes_horas?}
// avisar_antes_horas: 24 = avisa 1 dia antes; 48 = 2 dias antes; null = só na data
router.post('/', async (req, res) => {
  const { titulo, descricao, data_lembrete, avisar_antes_horas } = req.body;
  if (!data_lembrete)
    return res.status(400).json({ error: 'Campo obrigatório: data_lembrete' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO lembretes (usuario_id, titulo, descricao, data_lembrete, avisar_antes_horas)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.userId, titulo || null, descricao || null, data_lembrete,
       avisar_antes_horas ? parseInt(avisar_antes_horas) : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar lembrete' });
  }
});

// PUT /api/reminders/:id
router.put('/:id', async (req, res) => {
  const { titulo, descricao, data_lembrete, avisar_antes_horas } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE lembretes SET
         titulo             = COALESCE($1, titulo),
         descricao          = COALESCE($2, descricao),
         data_lembrete      = COALESCE($3, data_lembrete),
         avisar_antes_horas = COALESCE($4, avisar_antes_horas),
         enviado            = FALSE,
         enviado_aviso      = FALSE
       WHERE id=$5 AND usuario_id=$6 RETURNING *`,
      [titulo, descricao, data_lembrete,
       avisar_antes_horas !== undefined ? parseInt(avisar_antes_horas) : null,
       req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Lembrete não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar lembrete' });
  }
});

// DELETE /api/reminders/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE lembretes SET ativo=FALSE WHERE id=$1 AND usuario_id=$2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Lembrete não encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar lembrete' });
  }
});

module.exports = router;
