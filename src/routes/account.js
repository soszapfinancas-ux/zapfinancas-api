// Rotas de conta — informações do plano e gerenciamento de membros
const express  = require('express');
const router   = express.Router();
const pool     = require('../db');
const auth     = require('../middleware/auth');

router.use(auth);

// GET /api/account — retorna dados da conta e membros
router.get('/', async (req, res) => {
  try {
    const contaRes = await pool.query(
      `SELECT
         c.id, c.status, c.nome_comprador, c.email_comprador,
         c.telefone_comprador, c.data_ativacao, c.data_expiracao,
         p.nome AS plano, p.max_telefones, p.tem_exportacao,
         p.tem_lembretes_avancados
       FROM contas c
       JOIN planos p ON c.plano_id = p.id
       WHERE c.id = $1`,
      [req.auth.conta_id]
    );
    if (contaRes.rows.length === 0)
      return res.status(404).json({ error: 'Conta não encontrada' });

    const membrosRes = await pool.query(
      `SELECT id, nome, remotejid, tipo, ativo, data_cadastro, ultimo_acesso
       FROM usuarios
       WHERE conta_id = $1
       ORDER BY tipo = 'comprador' DESC, data_cadastro ASC`,
      [req.auth.conta_id]
    );

    res.json({ conta: contaRes.rows[0], membros: membrosRes.rows });
  } catch (err) {
    console.error('[Account] GET /:', err);
    res.status(500).json({ error: 'Erro ao carregar dados da conta' });
  }
});

// POST /api/account/members — adiciona membro (apenas plano Familiar)
router.post('/members', async (req, res) => {
  const { remotejid, nome } = req.body;
  if (!remotejid || !nome)
    return res.status(400).json({ error: 'Campos obrigatórios: remotejid, nome' });

  try {
    const contaRes = await pool.query(
      `SELECT c.id, p.max_telefones,
              (SELECT COUNT(*) FROM usuarios WHERE conta_id = c.id) AS total_membros
       FROM contas c JOIN planos p ON c.plano_id = p.id
       WHERE c.id = $1`,
      [req.auth.conta_id]
    );
    const conta = contaRes.rows[0];
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    if (Number(conta.total_membros) >= Number(conta.max_telefones)) {
      return res.status(400).json({
        error: `Limite de ${conta.max_telefones} membros atingido para este plano.`,
      });
    }

    const { rows } = await pool.query(
      'SELECT * FROM adicionar_membro_familia($1,$2,$3,$4)',
      [req.auth.conta_id, remotejid, nome, remotejid.split('@')[0]]
    );
    res.status(201).json({ success: true, membro: rows[0] });
  } catch (err) {
    if (err.message?.includes('Limite')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[Account] POST /members:', err);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// DELETE /api/account/members/:userId — remove membro (não pode remover a si mesmo)
router.delete('/members/:userId', async (req, res) => {
  const targetId = Number(req.params.userId);
  if (targetId === req.userId)
    return res.status(400).json({ error: 'Você não pode remover a si mesmo.' });

  try {
    const check = await pool.query(
      'SELECT id, tipo FROM usuarios WHERE id=$1 AND conta_id=$2',
      [targetId, req.auth.conta_id]
    );
    if (check.rows.length === 0)
      return res.status(404).json({ error: 'Membro não encontrado nesta conta' });
    if (check.rows[0].tipo === 'comprador')
      return res.status(400).json({ error: 'Não é possível remover o comprador principal.' });

    await pool.query('DELETE FROM usuarios WHERE id=$1', [targetId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Account] DELETE /members:', err);
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

module.exports = router;
