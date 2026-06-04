const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

function buildPeriodFilter(periodo, start, end) {
  switch (periodo) {
    case 'dia':
      return `data_transacao = CURRENT_DATE`;
    case 'semana':
      return `data_transacao >= DATE_TRUNC('week', NOW())::date`;
    case 'ano':
      return `EXTRACT(YEAR FROM data_transacao) = EXTRACT(YEAR FROM NOW())`;
    case 'custom':
      return `data_transacao BETWEEN '${start}' AND '${end}'`;
    case 'mes':
    default:
      return `TO_CHAR(data_transacao,'YYYY-MM') = TO_CHAR(NOW(),'YYYY-MM')`;
  }
}

// GET /api/dashboard/summary?periodo=mes|semana|dia|ano|custom&start=DATE&end=DATE
router.get('/summary', async (req, res) => {
  const { periodo = 'mes', start, end } = req.query;

  if (periodo === 'custom' && (!start || !end))
    return res.status(400).json({ error: 'Para período custom, informe start e end (YYYY-MM-DD)' });

  const filter = buildPeriodFilter(periodo, start, end);

  try {
    const [walletRes, totaisRes, categoriasRes, tendenciaRes] = await Promise.all([
      pool.query(
        'SELECT saldo_atual FROM carteiras WHERE usuario_id=$1 ORDER BY data_criacao LIMIT 1',
        [req.userId]
      ),
      pool.query(
        `SELECT
           SUM(CASE WHEN tipo='Receita' THEN valor ELSE 0 END) AS total_receitas,
           SUM(CASE WHEN tipo='Despesa' THEN valor ELSE 0 END) AS total_despesas,
           COUNT(*) AS total_transacoes
         FROM transacoes
         WHERE usuario_id=$1 AND ${filter} AND status='Efetivada'`,
        [req.userId]
      ),
      pool.query(
        `SELECT
           c.nome AS categoria, c.icone, c.cor,
           SUM(CASE WHEN t.tipo='Receita' THEN t.valor ELSE 0 END) AS total_receitas,
           SUM(CASE WHEN t.tipo='Despesa' THEN t.valor ELSE 0 END) AS total_despesas
         FROM transacoes t
         JOIN categorias c ON t.categoria_id = c.id
         WHERE t.usuario_id=$1 AND ${filter} AND t.status='Efetivada'
         GROUP BY c.nome, c.icone, c.cor
         ORDER BY total_despesas DESC`,
        [req.userId]
      ),
      // Últimas 10 transações do período
      pool.query(
        `SELECT
           t.id, t.descricao, t.valor, t.tipo, t.data_transacao,
           c.nome AS categoria, c.icone AS categoria_icone
         FROM transacoes t
         LEFT JOIN categorias c ON t.categoria_id = c.id
         WHERE t.usuario_id=$1 AND ${filter}
         ORDER BY t.data_transacao DESC, t.created_at DESC
         LIMIT 10`,
        [req.userId]
      ),
    ]);

    const saldo         = Number(walletRes.rows[0]?.saldo_atual   || 0);
    const totalReceitas = Number(totaisRes.rows[0]?.total_receitas || 0);
    const totalDespesas = Number(totaisRes.rows[0]?.total_despesas || 0);
    const totalTx       = Number(totaisRes.rows[0]?.total_transacoes || 0);

    res.json({
      periodo,
      saldo_atual:       saldo,
      total_receitas:    totalReceitas,
      total_despesas:    totalDespesas,
      saldo_periodo:     totalReceitas - totalDespesas,
      total_transacoes:  totalTx,
      por_categoria:     categoriasRes.rows,
      ultimas_transacoes: tendenciaRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar resumo do dashboard' });
  }
});

// GET /api/dashboard/trend?meses=6
// Tendência dos últimos N meses para o gráfico de barras empilhadas
router.get('/trend', async (req, res) => {
  const meses = Math.min(parseInt(req.query.meses || '6'), 12);

  try {
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(gs.m, 'YYYY-MM')                                               AS mes,
         TO_CHAR(gs.m, 'Mon/YY')                                                AS label,
         COALESCE(SUM(CASE WHEN t.tipo='Receita' THEN t.valor ELSE 0 END), 0)   AS receitas,
         COALESCE(SUM(CASE WHEN t.tipo='Despesa' THEN t.valor ELSE 0 END), 0)   AS despesas
       FROM generate_series(
         DATE_TRUNC('month', NOW() - ($1 - 1 || ' months')::INTERVAL),
         DATE_TRUNC('month', NOW()),
         '1 month'::INTERVAL
       ) AS gs(m)
       LEFT JOIN transacoes t
         ON TO_CHAR(t.data_transacao,'YYYY-MM') = TO_CHAR(gs.m,'YYYY-MM')
        AND t.usuario_id = $2
        AND t.status = 'Efetivada'
       GROUP BY gs.m
       ORDER BY gs.m`,
      [meses, req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar tendência' });
  }
});

module.exports = router;
