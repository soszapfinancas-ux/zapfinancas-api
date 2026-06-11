// Job diário: marca contas com data_expiracao vencida como 'expirado'
const cron = require('node-cron');
const pool = require('../db');

async function expirarPlanos() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE contas
       SET status = 'expirado'
       WHERE status = 'ativo'
         AND data_expiracao IS NOT NULL
         AND data_expiracao < NOW()`
    );
    if (rowCount > 0) {
      console.log(`[ExpirePlans] ${rowCount} conta(s) expirada(s)`);
    }
  } catch (err) {
    console.error('[ExpirePlans] Erro:', err);
  }
}

function iniciarJob() {
  // Executa todo dia às 03:00 (horário do servidor)
  cron.schedule('0 3 * * *', expirarPlanos);
  // Executa uma vez na inicialização para cobrir qualquer atraso
  expirarPlanos();
  console.log('[ExpirePlans] Job de expiração de planos iniciado');
}

module.exports = { iniciarJob, expirarPlanos };
