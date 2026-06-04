const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

function buildPeriodFilter(periodo, start, end) {
  switch (periodo) {
    case 'dia':    return `data_transacao = CURRENT_DATE`;
    case 'semana': return `data_transacao >= DATE_TRUNC('week', NOW())::date`;
    case 'ano':    return `EXTRACT(YEAR FROM data_transacao) = EXTRACT(YEAR FROM NOW())`;
    case 'custom': return `data_transacao BETWEEN '${start}' AND '${end}'`;
    case 'mes': default: return `TO_CHAR(data_transacao,'YYYY-MM') = TO_CHAR(NOW(),'YYYY-MM')`;
  }
}

async function resolveUserIds(userId, contaId, familia) {
  if (!familia || !contaId) return [userId];
  const { rows } = await pool.query(
    'SELECT id FROM usuarios WHERE conta_id = $1 AND ativo = TRUE', [contaId]
  );
  const ids = rows.map(r => r.id);
  if (!ids.includes(Number(userId))) ids.push(Number(userId));
  return ids.length > 0 ? ids : [userId];
}

// GET /api/dashboard/summary?periodo=mes|semana|dia|ano|custom&start=DATE&end=DATE&familia=true
router.get('/summary', async (req, res) => {
  const { periodo = 'mes', start, end, familia } = req.query;
  const isFamilia = familia === 'true';

  if (periodo === 'custom' && (!start || !end))
    return res.status(400).json({ error: 'Para período custom, informe start e end (YYYY-MM-DD)' });

  const filter = buildPeriodFilter(periodo, start, end);

  try {
    const userIds  = await resolveUserIds(req.userId, req.auth.conta_id, isFamilia);
    const idsParam = userIds.length === 1
      ? `= ${userIds[0]}`
      : `= ANY(ARRAY[${userIds.join(',')}]::int[])`;

    const [walletRes, totaisRes, categoriasRes, tendenciaRes, membrosRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(saldo_atual),0) AS saldo_atual
         FROM carteiras WHERE usuario_id ${idsParam}`, []
      ),
      pool.query(
        `SELECT
           SUM(CASE WHEN tipo='Receita' THEN valor ELSE 0 END) AS total_receitas,
           SUM(CASE WHEN tipo='Despesa' THEN valor ELSE 0 END) AS total_despesas,
           COUNT(*) AS total_transacoes
         FROM transacoes
         WHERE usuario_id ${idsParam} AND ${filter} AND status='Efetivada'`, []
      ),
      pool.query(
        `SELECT
           c.nome AS categoria, c.icone, c.cor,
           SUM(CASE WHEN t.tipo='Receita' THEN t.valor ELSE 0 END) AS total_receitas,
           SUM(CASE WHEN t.tipo='Despesa' THEN t.valor ELSE 0 END) AS total_despesas
         FROM transacoes t
         JOIN categorias c ON t.categoria_id = c.id
         WHERE t.usuario_id ${idsParam} AND ${filter} AND t.status='Efetivada'
         GROUP BY c.nome, c.icone, c.cor
         ORDER BY total_despesas DESC`, []
      ),
      pool.query(
        `SELECT
           t.id, t.descricao, t.valor, t.tipo, t.data_transacao,
           c.nome AS categoria, c.icone AS categoria_icone,
           u.nome AS membro
         FROM transacoes t
         LEFT JOIN categorias c ON t.categoria_id = c.id
         LEFT JOIN usuarios u ON t.usuario_id = u.id
         WHERE t.usuario_id ${idsParam} AND ${filter}
         ORDER BY t.data_transacao DESC, t.created_at DESC
         LIMIT 10`, []
      ),
      isFamilia && req.auth.conta_id ? pool.query(
        `SELECT
           u.nome AS membro,
           u.tipo AS tipo_usuario,
           COALESCE(SUM(CASE WHEN t.tipo='Despesa' THEN t.valor ELSE 0 END), 0) AS despesas,
           COALESCE(SUM(CASE WHEN t.tipo='Receita' THEN t.valor ELSE 0 END), 0) AS receitas,
           COUNT(t.id) AS qtd_transacoes
         FROM usuarios u
         LEFT JOIN transacoes t
           ON t.usuario_id = u.id AND ${filter} AND t.status = 'Efetivada'
         WHERE u.conta_id = $1 AND u.ativo = TRUE
         GROUP BY u.id, u.nome, u.tipo
         ORDER BY despesas DESC`,
        [req.auth.conta_id]
      ) : Promise.resolve({ rows: [] }),
    ]);

    const saldo = Number(walletRes.rows[0]?.saldo_atual    || 0);
    const tr    = Number(totaisRes.rows[0]?.total_receitas  || 0);
    const td    = Number(totaisRes.rows[0]?.total_despesas  || 0);
    const ttx   = Number(totaisRes.rows[0]?.total_transacoes || 0);

    res.json({
      periodo,
      familia:            isFamilia,
      por_membro:         membrosRes.rows,
      saldo_atual:        saldo,
      total_receitas:     tr,
      total_despesas:     td,
      saldo_periodo:      tr - td,
      total_transacoes:   ttx,
      por_categoria:      categoriasRes.rows,
      ultimas_transacoes: tendenciaRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar resumo do dashboard' });
  }
});

// GET /api/dashboard/trend?meses=6&familia=true
router.get('/trend', async (req, res) => {
  const meses     = Math.min(parseInt(req.query.meses || '6'), 12);
  const isFamilia = req.query.familia === 'true';

  try {
    const userIds  = await resolveUserIds(req.userId, req.auth.conta_id, isFamilia);
    const idsParam = userIds.length === 1
      ? `= ${userIds[0]}`
      : `= ANY(ARRAY[${userIds.join(',')}]::int[])`;

    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(gs.m, 'YYYY-MM')                                             AS mes,
         TO_CHAR(gs.m, 'Mon/YY')                                              AS label,
         COALESCE(SUM(CASE WHEN t.tipo='Receita' THEN t.valor ELSE 0 END),0)  AS receitas,
         COALESCE(SUM(CASE WHEN t.tipo='Despesa' THEN t.valor ELSE 0 END),0)  AS despesas
       FROM generate_series(
         DATE_TRUNC('month', NOW() - ($1 - 1 || ' months')::INTERVAL),
         DATE_TRUNC('month', NOW()),
         '1 month'::INTERVAL
       ) AS gs(m)
       LEFT JOIN transacoes t
         ON TO_CHAR(t.data_transacao,'YYYY-MM') = TO_CHAR(gs.m,'YYYY-MM')
        AND t.usuario_id ${idsParam}
        AND t.status = 'Efetivada'
       GROUP BY gs.m
       ORDER BY gs.m`,
      [meses]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar tendência' });
  }
});

module.exports = router;
