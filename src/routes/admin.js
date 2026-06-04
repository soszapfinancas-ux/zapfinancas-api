// Rotas administrativas — acessíveis apenas com ADMIN_TOKEN
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Acesso negado' });
  }
  next();
}

router.use(adminAuth);

// GET /admin/accounts  — lista todas as contas
router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         c.id, c.status, c.email_comprador, c.nome_comprador,
         c.data_ativacao, c.data_expiracao, c.created_at,
         p.nome AS plano,
         COUNT(u.id) AS membros
       FROM contas c
       JOIN planos p ON c.plano_id = p.id
       LEFT JOIN usuarios u ON u.conta_id = c.id
       GROUP BY c.id, p.nome
       ORDER BY c.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar contas' });
  }
});

// POST /admin/accounts/:id/activate  — ativa uma conta manualmente
router.post('/accounts/:id/activate', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE contas SET status='ativo', data_ativacao=NOW()
       WHERE id=$1 RETURNING id, status, email_comprador`,
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, conta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao ativar conta' });
  }
});

// POST /admin/accounts/:id/deactivate  — desativa uma conta
router.post('/accounts/:id/deactivate', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE contas SET status='inativo'
       WHERE id=$1 RETURNING id, status, email_comprador`,
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, conta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao desativar conta' });
  }
});

// POST /admin/accounts/:id/upgrade  — faz upgrade para o plano familiar
router.post('/accounts/:id/upgrade', async (req, res) => {
  try {
    await pool.query('UPDATE contas SET plano_id=2 WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Conta atualizada para Plano Familiar' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
});

// GET /admin/users  — lista todos os usuários
router.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.remotejid, u.nome, u.tipo, u.ativo,
         u.data_cadastro, u.ultimo_acesso,
         c.status AS conta_status,
         p.nome   AS plano
       FROM usuarios u
       JOIN contas c ON u.conta_id = c.id
       JOIN planos p ON c.plano_id = p.id
       ORDER BY u.data_cadastro DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// POST /admin/accounts/:contaId/add-member  — adiciona membro à família
router.post('/accounts/:contaId/add-member', async (req, res) => {
  const { remotejid, nome, telefone } = req.body;
  if (!remotejid || !nome)
    return res.status(400).json({ error: 'Campos obrigatórios: remotejid, nome' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM adicionar_membro_familia($1,$2,$3,$4)',
      [req.params.contaId, remotejid, nome, telefone || '']
    );
    res.status(201).json({ success: true, membro: rows[0] });
  } catch (err) {
    if (err.message?.includes('Limite de telefones')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

module.exports = router;
