// Relatórios — analítico (detalhado) e sintético (por categoria)
// PDF/Excel exclusivo do Plano Familiar
const express     = require('express');
const router      = express.Router();
const pool        = require('../db');
const auth        = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const ExcelJS     = require('exceljs');
const nodemailer  = require('nodemailer');

router.use(auth);

function requireExportacao(req, res, next) {
  if (!req.auth.tem_exportacao)
    return res.status(403).json({
      error: 'Exportação exclusiva do Plano Familiar. Acesse zapfinancas.orbitarosa.com para fazer upgrade.',
    });
  next();
}

function resolvePeriod(periodo, start, end) {
  const hoje = new Date().toISOString().slice(0, 10);
  switch (periodo) {
    case '7dias':  {
      const s = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      return [s, hoje];
    }
    case '30dias': {
      const s = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
      return [s, hoje];
    }
    case 'mes': {
      const now = new Date();
      const s   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      return [s, hoje];
    }
    case 'ano': {
      return [`${new Date().getFullYear()}-01-01`, hoje];
    }
    case 'custom':
      return [start, end];
    default:
      return [start || hoje, end || hoje];
  }
}

async function fetchTransacoes(userId, startDate, endDate, categorias) {
  let q = `
    SELECT t.id, t.descricao, t.valor, t.tipo, t.data_transacao, t.status,
           c.nome AS categoria, c.icone, c.cor,
           fp.nome AS forma_pagamento
    FROM transacoes t
    LEFT JOIN categorias       c  ON t.categoria_id       = c.id
    LEFT JOIN formas_pagamento fp ON t.forma_pagamento_id = fp.id
    WHERE t.usuario_id=$1 AND t.data_transacao BETWEEN $2 AND $3
  `;
  const params = [userId, startDate, endDate];
  if (categorias?.length) { params.push(categorias); q += ` AND c.nome = ANY($${params.length})`; }
  q += ' ORDER BY t.data_transacao ASC, t.created_at ASC';
  const { rows } = await pool.query(q, params);
  return rows;
}

// GET /api/reports/analitico?periodo=7dias|30dias|mes|ano|custom&start=&end=&categorias=
router.get('/analitico', async (req, res) => {
  const { periodo = '30dias', start, end, categorias: cq } = req.query;
  const [s, e] = resolvePeriod(periodo, start, end);
  const cats   = cq ? cq.split(',').map(c => c.trim()) : [];

  try {
    const rows          = await fetchTransacoes(req.userId, s, e, cats);
    const totalReceitas = rows.reduce((a, r) => r.tipo === 'Receita' ? a + Number(r.valor) : a, 0);
    const totalDespesas = rows.reduce((a, r) => r.tipo === 'Despesa' ? a + Number(r.valor) : a, 0);

    res.json({
      tipo: 'analitico',
      periodo: { inicio: s, fim: e },
      totais:  { receitas: totalReceitas, despesas: totalDespesas, saldo: totalReceitas - totalDespesas },
      transacoes: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório analítico' });
  }
});

// GET /api/reports/sintetico?periodo=...
router.get('/sintetico', async (req, res) => {
  const { periodo = '30dias', start, end } = req.query;
  const [s, e] = resolvePeriod(periodo, start, end);

  try {
    const [totaisRes, categoriasRes, mensalRes] = await Promise.all([
      pool.query(
        `SELECT
           SUM(CASE WHEN tipo='Receita' THEN valor ELSE 0 END) AS total_receitas,
           SUM(CASE WHEN tipo='Despesa' THEN valor ELSE 0 END) AS total_despesas,
           COUNT(*) AS total_transacoes
         FROM transacoes WHERE usuario_id=$1 AND data_transacao BETWEEN $2 AND $3`,
        [req.userId, s, e]
      ),
      pool.query(
        `SELECT
           c.nome AS categoria, c.icone, c.cor,
           SUM(CASE WHEN t.tipo='Receita' THEN t.valor ELSE 0 END) AS receitas,
           SUM(CASE WHEN t.tipo='Despesa' THEN t.valor ELSE 0 END) AS despesas,
           COUNT(*)                                                  AS qtd
         FROM transacoes t
         JOIN categorias c ON t.categoria_id = c.id
         WHERE t.usuario_id=$1 AND t.data_transacao BETWEEN $2 AND $3
         GROUP BY c.nome, c.icone, c.cor
         ORDER BY despesas DESC`,
        [req.userId, s, e]
      ),
      // Evolução mês a mês dentro do período
      pool.query(
        `SELECT
           TO_CHAR(data_transacao,'YYYY-MM')                                       AS mes,
           TO_CHAR(data_transacao,'Mon/YY')                                        AS label,
           SUM(CASE WHEN tipo='Receita' THEN valor ELSE 0 END)                     AS receitas,
           SUM(CASE WHEN tipo='Despesa' THEN valor ELSE 0 END)                     AS despesas
         FROM transacoes
         WHERE usuario_id=$1 AND data_transacao BETWEEN $2 AND $3
         GROUP BY TO_CHAR(data_transacao,'YYYY-MM'), TO_CHAR(data_transacao,'Mon/YY')
         ORDER BY 1`,
        [req.userId, s, e]
      ),
    ]);

    const tr = Number(totaisRes.rows[0]?.total_receitas || 0);
    const td = Number(totaisRes.rows[0]?.total_despesas || 0);

    res.json({
      tipo: 'sintetico',
      periodo:      { inicio: s, fim: e },
      totais:       { receitas: tr, despesas: td, saldo: tr - td, transacoes: Number(totaisRes.rows[0]?.total_transacoes || 0) },
      por_categoria: categoriasRes.rows.map(r => ({
        ...r,
        pct_despesas: td > 0 ? Math.round((Number(r.despesas) / td) * 100) : 0,
      })),
      evolucao_mensal: mensalRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório sintético' });
  }
});

// GET /api/reports/pdf?periodo=...   (order bump)
router.get('/pdf', requireExportacao, async (req, res) => {
  const { periodo = '30dias', start, end, tipo = 'sintetico' } = req.query;
  const [s, e] = resolvePeriod(periodo, start, end);

  try {
    const rows          = await fetchTransacoes(req.userId, s, e, []);
    const totalReceitas = rows.reduce((a, r) => r.tipo === 'Receita' ? a + Number(r.valor) : a, 0);
    const totalDespesas = rows.reduce((a, r) => r.tipo === 'Despesa' ? a + Number(r.valor) : a, 0);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="zapfinancas-${s}-${e}.pdf"`);
    doc.pipe(res);

    doc.fontSize(22).fillColor('#059669').text('ZapFinanças', { align: 'center' });
    doc.fontSize(11).fillColor('#6b7280').text(`Relatório ${tipo === 'sintetico' ? 'Sintético' : 'Analítico'} — ${s} a ${e}`, { align: 'center' });
    doc.moveDown();
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#d1fae5').lineWidth(2).stroke();
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor('#059669').text(`✅ Receitas:  R$ ${totalReceitas.toFixed(2)}`);
    doc.fillColor('#ef4444').text(`❌ Despesas:  R$ ${totalDespesas.toFixed(2)}`);
    const saldo = totalReceitas - totalDespesas;
    doc.fillColor(saldo >= 0 ? '#059669' : '#ef4444').text(`💰 Saldo:     R$ ${saldo.toFixed(2)}`);
    doc.moveDown();

    if (tipo === 'sintetico') {
      // Agrupado por categoria
      const cats = {};
      rows.forEach(r => {
        if (!cats[r.categoria]) cats[r.categoria] = { icone: r.icone, receitas: 0, despesas: 0 };
        if (r.tipo === 'Receita') cats[r.categoria].receitas += Number(r.valor);
        else cats[r.categoria].despesas += Number(r.valor);
      });
      doc.fontSize(13).fillColor('#1f2937').text('Por Categoria:');
      doc.moveDown(0.3);
      Object.entries(cats).sort((a, b) => b[1].despesas - a[1].despesas).forEach(([cat, v]) => {
        doc.fontSize(10).fillColor('#374151')
           .text(`${v.icone || ''} ${cat}  —  Despesas: R$${v.despesas.toFixed(2)}  |  Receitas: R$${v.receitas.toFixed(2)}`);
      });
    } else {
      // Analítico — todas as transações
      doc.fontSize(13).fillColor('#1f2937').text('Transações:');
      doc.moveDown(0.3);
      rows.forEach(t => {
        const d    = t.data_transacao instanceof Date ? t.data_transacao.toISOString().slice(0,10) : String(t.data_transacao).slice(0,10);
        const sinal = t.tipo === 'Receita' ? '+' : '-';
        const cor   = t.tipo === 'Receita' ? '#059669' : '#ef4444';
        doc.fontSize(9).fillColor('#374151').text(`${d}  ${t.icone || ''} ${t.categoria || 'Outros'}  ${t.descricao}`, { continued: true });
        doc.fillColor(cor).text(`  ${sinal}R$${Number(t.valor).toFixed(2)}`);
      });
    }

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

// GET /api/reports/excel?periodo=...  (order bump)
router.get('/excel', requireExportacao, async (req, res) => {
  const { periodo = '30dias', start, end } = req.query;
  const [s, e] = resolvePeriod(periodo, start, end);

  try {
    const rows = await fetchTransacoes(req.userId, s, e, []);
    const wb   = new ExcelJS.Workbook();
    wb.creator  = 'ZapFinanças';

    const ws = wb.addWorksheet('Transações');
    ws.columns = [
      { header: 'Data',            key: 'data',      width: 14 },
      { header: 'Descrição',       key: 'descricao', width: 32 },
      { header: 'Categoria',       key: 'cat',       width: 18 },
      { header: 'Forma Pagamento', key: 'fp',        width: 20 },
      { header: 'Tipo',            key: 'tipo',      width: 10 },
      { header: 'Valor (R$)',      key: 'valor',     width: 14 },
      { header: 'Status',          key: 'status',    width: 12 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FF059669' } };
    rows.forEach(t => ws.addRow({
      data:      String(t.data_transacao).slice(0, 10),
      descricao: t.descricao,
      cat:       t.categoria || '',
      fp:        t.forma_pagamento || '',
      tipo:      t.tipo,
      valor:     Number(t.valor),
      status:    t.status,
    }));
    ws.addRow({});
    const tr = rows.reduce((a, r) => r.tipo === 'Receita' ? a + Number(r.valor) : a, 0);
    const td = rows.reduce((a, r) => r.tipo === 'Despesa' ? a + Number(r.valor) : a, 0);
    ws.addRow({ descricao: 'TOTAL RECEITAS', valor: tr });
    ws.addRow({ descricao: 'TOTAL DESPESAS', valor: td });
    ws.addRow({ descricao: 'SALDO',          valor: tr - td });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="zapfinancas-${s}-${e}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar Excel' });
  }
});

module.exports = router;
