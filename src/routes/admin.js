// Rotas administrativas — acessíveis apenas com ADMIN_TOKEN
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// Mesma regra usada em auth.js, asaas.js e hotmart.js: remotejid sempre inclui o DDI 55
function normalizePhoneDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 12 ? digits : `55${digits}`;
}

// Números brasileiros podem chegar sem o 9º dígito — gera as duas variantes
// possíveis pra não perder o vínculo com o usuário que já conversou com o bot.
function remotejidCandidates(phone) {
  const withCountry = normalizePhoneDigits(phone);
  if (!withCountry) return [];
  const ddi  = withCountry.slice(0, 2);
  const ddd  = withCountry.slice(2, 4);
  const rest = withCountry.slice(4);

  const digitsSet = new Set([withCountry]);
  if (rest.length === 9 && rest[0] === '9') {
    digitsSet.add(`${ddi}${ddd}${rest.slice(1)}`); // variante sem o 9
  } else if (rest.length === 8) {
    digitsSet.add(`${ddi}${ddd}9${rest}`); // variante com o 9
  }
  return [...digitsSet].map(d => `${d}@s.whatsapp.net`);
}

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Acesso negado' });
  }
  next();
}

router.use(adminAuth);

// GET /admin/accounts  — lista contas (exclui logicamente excluídas por padrão)
// GET /admin/accounts?excluidas=true  — lista somente as excluídas (aba "Excluídas")
router.get('/accounts', async (req, res) => {
  const somenteExcluidas = req.query.excluidas === 'true';
  try {
    const { rows } = await pool.query(
      `SELECT
         c.id, c.status, c.excluida, c.excluida_em,
         COALESCE(c.nome_comprador,
           (SELECT u2.nome FROM usuarios u2 WHERE u2.conta_id = c.id ORDER BY u2.data_cadastro ASC LIMIT 1)
         ) AS nome_comprador,
         COALESCE(c.email_comprador,
           (SELECT u2.remotejid FROM usuarios u2 WHERE u2.conta_id = c.id ORDER BY u2.data_cadastro ASC LIMIT 1)
         ) AS email_comprador,
         c.telefone_comprador,
         c.data_ativacao, c.data_expiracao, c.created_at,
         c.plano_id,
         c.max_membros,
         p.nome AS plano,
         p.max_telefones,
         COUNT(u.id) AS membros
       FROM contas c
       JOIN planos p ON c.plano_id = p.id
       LEFT JOIN usuarios u ON u.conta_id = c.id
       WHERE c.excluida = $1
       GROUP BY c.id, p.nome, p.max_telefones
       ORDER BY c.created_at DESC`,
      [somenteExcluidas]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar contas' });
  }
});

// PATCH /admin/accounts/:id  — edita nome/email do comprador manualmente
router.patch('/accounts/:id', async (req, res) => {
  const { nome_comprador, email_comprador } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE contas SET
         nome_comprador  = COALESCE($2, nome_comprador),
         email_comprador = COALESCE($3, email_comprador)
       WHERE id = $1 RETURNING id, nome_comprador, email_comprador`,
      [req.params.id, nome_comprador || null, email_comprador || null]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, conta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar conta' });
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

// DELETE /admin/accounts/:id  — exclusão lógica: some do painel, mas mantém
// nome/e-mail/telefone do comprador e todo o histórico (transações, compras etc.)
router.delete('/accounts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE contas SET excluida = TRUE, excluida_em = NOW()
       WHERE id = $1 RETURNING id, excluida`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, conta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir conta' });
  }
});

// POST /admin/accounts/:id/restore  — reverte a exclusão lógica
router.post('/accounts/:id/restore', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE contas SET excluida = FALSE, excluida_em = NULL
       WHERE id = $1 RETURNING id, excluida`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, conta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao restaurar conta' });
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

// PATCH /admin/accounts/:id/plan  — altera o plano da conta
router.patch('/accounts/:id/plan', async (req, res) => {
  const { plano_id } = req.body;
  if (!plano_id) return res.status(400).json({ error: 'plano_id obrigatório' });
  try {
    const { rows } = await pool.query(
      'UPDATE contas SET plano_id=$2 WHERE id=$1 RETURNING id, plano_id',
      [req.params.id, plano_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, conta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao alterar plano' });
  }
});

// PATCH /admin/accounts/:id/max-membros  — define limite customizado de membros (null = usar padrão do plano)
router.patch('/accounts/:id/max-membros', async (req, res) => {
  const { max_membros } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE contas SET max_membros=$2 WHERE id=$1 RETURNING id, max_membros',
      [req.params.id, max_membros != null ? Number(max_membros) : null]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true, conta: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar limite de membros' });
  }
});

// GET /admin/plans  — lista planos disponíveis
router.get('/plans', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, max_telefones, is_motorista, descricao FROM planos ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
});

// PATCH /admin/plans/:id  — renomeia um plano (nome/descrição)
router.patch('/plans/:id', async (req, res) => {
  const { nome, descricao } = req.body;
  if (!nome) return res.status(400).json({ error: 'nome obrigatório' });
  try {
    const { rows } = await pool.query(
      `UPDATE planos SET nome = $2, descricao = COALESCE($3, descricao)
       WHERE id = $1 RETURNING id, nome, descricao`,
      [req.params.id, nome, descricao || null]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json({ success: true, plano: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao renomear plano' });
  }
});

// POST /admin/accounts  — cadastra e ativa uma conta manualmente (sem Hotmart)
router.post('/accounts', async (req, res) => {
  const { nome, telefone, email, plano_id } = req.body;
  if (!nome || !telefone || !plano_id)
    return res.status(400).json({ error: 'Campos obrigatórios: nome, telefone, plano_id' });

  const candidatos = remotejidCandidates(telefone);
  if (candidatos.length === 0)
    return res.status(400).json({ error: 'Telefone inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const contaRes = await client.query(
      `INSERT INTO contas
         (plano_id, status, email_comprador, nome_comprador, telefone_comprador,
          data_ativacao, data_expiracao)
       VALUES ($1,'ativo',$2,$3,$4,NOW(),NOW() + INTERVAL '1 year') RETURNING id`,
      [plano_id, email || null, nome, telefone]
    );
    const contaId = contaRes.rows[0].id;

    const { rows: [row] } = await client.query(
      `SELECT vincular_usuario_conta($1,$2,$3,$4,'titular') AS usuario_id`,
      [contaId, candidatos[0], nome, telefone]
    );
    if (!row?.usuario_id) throw new Error('Falha ao vincular usuário à conta');

    await client.query('COMMIT');
    res.status(201).json({ success: true, conta_id: contaId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erro ao cadastrar conta' });
  } finally {
    client.release();
  }
});

// GET /admin/hotmart-products  — lista mapeamentos de produtos Hotmart
router.get('/hotmart-products', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT hp.hotmart_product_id, hp.nome, hp.ativo, hp.created_at,
              p.id AS plano_id, p.nome AS plano_nome
       FROM hotmart_produtos hp
       JOIN planos p ON hp.plano_id = p.id
       ORDER BY hp.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar produtos Hotmart' });
  }
});

// POST /admin/hotmart-products  — cria ou atualiza mapeamento de produto
router.post('/hotmart-products', async (req, res) => {
  const { hotmart_product_id, plano_id, nome } = req.body;
  if (!hotmart_product_id || !plano_id || !nome)
    return res.status(400).json({ error: 'Campos obrigatórios: hotmart_product_id, plano_id, nome' });
  try {
    await pool.query(
      `INSERT INTO hotmart_produtos (hotmart_product_id, plano_id, nome)
       VALUES ($1,$2,$3)
       ON CONFLICT (hotmart_product_id) DO UPDATE SET plano_id=$2, nome=$3, ativo=TRUE`,
      [hotmart_product_id, plano_id, nome]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar produto Hotmart' });
  }
});

// DELETE /admin/hotmart-products/:id  — remove mapeamento de produto
router.delete('/hotmart-products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM hotmart_produtos WHERE hotmart_product_id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover produto Hotmart' });
  }
});

module.exports = router;
