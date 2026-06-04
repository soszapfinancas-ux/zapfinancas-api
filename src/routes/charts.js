const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

router.use(auth);

const CORES = [
  '#FF6384','#36A2EB','#FFCE56','#4BC0C0',
  '#9966FF','#FF9F40','#E7E9ED','#2ecc71','#C9CBCF',
];

function quickchartUrl(config) {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&width=800&height=400&backgroundColor=white&devicePixelRatio=2.0`;
}

// GET /api/charts/bar?date=YYYY-MM-DD
// Gráfico de barras — receitas vs despesas nos últimos 7 dias
router.get('/bar', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  try {
    const { rows } = await pool.query(
      `SELECT
         ds.d::date                                                              AS dia,
         TO_CHAR(ds.d, 'DD/MM')                                                 AS label,
         COALESCE(SUM(CASE WHEN t.tipo='Receita' THEN t.valor ELSE 0 END), 0)   AS receitas,
         COALESCE(SUM(CASE WHEN t.tipo='Despesa' THEN t.valor ELSE 0 END), 0)   AS despesas
       FROM generate_series(
         ($1::date - INTERVAL '6 days'),
         $1::date,
         '1 day'::interval
       ) AS ds(d)
       LEFT JOIN transacoes t
         ON t.data_transacao = ds.d::date
        AND t.usuario_id = $2
        AND t.status = 'Efetivada'
       GROUP BY ds.d
       ORDER BY ds.d`,
      [date, req.userId]
    );

    const config = {
      type: 'bar',
      data: {
        labels: rows.map(r => r.label),
        datasets: [
          {
            label: 'Receitas',
            backgroundColor: 'rgba(46,204,113,0.8)',
            data: rows.map(r => Number(r.receitas)),
          },
          {
            label: 'Despesas',
            backgroundColor: 'rgba(255,99,132,0.8)',
            data: rows.map(r => Number(r.despesas)),
          },
        ],
      },
      options: {
        plugins: { legend: { position: 'top' } },
        scales:  { y: { beginAtZero: true } },
      },
    };

    const url = quickchartUrl(config);
    res.json({ url, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar gráfico de barras' });
  }
});

// GET /api/charts/pizza?date=YYYY-MM-DD
// Gráfico de pizza — despesas por categoria no mês da data informada
router.get('/pizza', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  try {
    const { rows } = await pool.query(
      `SELECT
         c.nome  AS categoria,
         c.icone,
         SUM(t.valor) AS total
       FROM transacoes t
       JOIN categorias c ON t.categoria_id = c.id
       WHERE t.usuario_id = $1
         AND t.tipo = 'Despesa'
         AND t.status = 'Efetivada'
         AND TO_CHAR(t.data_transacao,'YYYY-MM') = TO_CHAR($2::date,'YYYY-MM')
       GROUP BY c.nome, c.icone
       ORDER BY total DESC`,
      [req.userId, date]
    );

    if (rows.length === 0) {
      return res.json({ url: null, message: 'Sem despesas no período', data: [] });
    }

    const config = {
      type: 'pie',
      data: {
        labels: rows.map(r => `${r.icone || ''} ${r.categoria}`),
        datasets: [{
          data:            rows.map(r => Number(r.total)),
          backgroundColor: rows.map((_, i) => CORES[i % CORES.length]),
        }],
      },
      options: {
        plugins: {
          legend: { position: 'right' },
          datalabels: { display: true, formatter: (val) => `R$${Number(val).toFixed(2)}` },
        },
      },
    };

    const url = quickchartUrl(config);
    res.json({ url, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar gráfico de pizza' });
  }
});

module.exports = router;
