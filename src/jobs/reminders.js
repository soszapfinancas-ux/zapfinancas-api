// Job de lembretes — roda a cada minuto via node-cron
// Envia aviso antecipado (avisar_antes_horas) E aviso no vencimento
const cron  = require('node-cron');
const pool  = require('../db');
const axios = require('axios');

const UAZAPI_BASE = process.env.UAZAPI_BASE_URL || '';
const UAZAPI_TOK  = process.env.UAZAPI_TOKEN    || '';

async function enviarWhatsApp(remotejid, texto) {
  if (!UAZAPI_BASE || !UAZAPI_TOK) return;
  await axios.post(
    `${UAZAPI_BASE}/send/text`,
    { number: remotejid, text: texto, readchat: 'true' },
    { headers: { token: UAZAPI_TOK } }
  );
}

async function processarLembretes() {
  const client = await pool.connect();
  try {
    // ── 1. Avisos antecipados ────────────────────────────────
    const { rows: antecipados } = await client.query(
      `SELECT l.id, l.usuario_id, l.titulo, l.descricao, l.data_lembrete,
              u.remotejid, u.nome
       FROM lembretes l
       JOIN usuarios u ON l.usuario_id = u.id
       JOIN contas   c ON u.conta_id   = c.id
       WHERE l.ativo              = TRUE
         AND l.enviado_aviso      = FALSE
         AND l.avisar_antes_horas IS NOT NULL
         AND NOW() >= l.data_lembrete - (l.avisar_antes_horas || ' hours')::INTERVAL
         AND l.data_lembrete      > NOW()    -- ainda não venceu
         AND c.status             = 'ativo'`
    );

    for (const l of antecipados) {
      try {
        const horas = Math.round((new Date(l.data_lembrete) - new Date()) / 3600000);
        const quando = horas >= 24
          ? `em ${Math.round(horas / 24)} dia(s)`
          : `em ${horas} hora(s)`;

        const msg = `⏰ *Lembrete Antecipado — ZapFinanças*\n\nOlá, ${l.nome?.split(' ')[0]}!\n\n${l.titulo ? `*${l.titulo}*\n` : ''}${l.descricao || ''}\n\n🗓 Vence ${quando}\n_Código: #${l.id}_`;
        await enviarWhatsApp(l.remotejid, msg);
        await client.query('UPDATE lembretes SET enviado_aviso=TRUE WHERE id=$1', [l.id]);
        console.log(`[Lembretes] Aviso antecipado → ${l.remotejid} (id: ${l.id})`);
      } catch (e) {
        console.error(`[Lembretes] Erro aviso antecipado ${l.id}:`, e.message);
      }
    }

    // ── 2. Lembretes no vencimento ───────────────────────────
    const { rows: vencidos } = await client.query(
      `SELECT l.id, l.usuario_id, l.titulo, l.descricao, l.data_lembrete,
              u.remotejid, u.nome
       FROM lembretes l
       JOIN usuarios u ON l.usuario_id = u.id
       JOIN contas   c ON u.conta_id   = c.id
       WHERE l.ativo   = TRUE
         AND l.enviado = FALSE
         AND l.data_lembrete <= NOW()
         AND c.status = 'ativo'`
    );

    for (const l of vencidos) {
      try {
        const data = new Date(l.data_lembrete).toLocaleDateString('pt-BR');
        const msg  = `🔔 *Lembrete ZapFinanças*\n\nOlá, ${l.nome?.split(' ')[0]}!\n\n${l.titulo ? `*${l.titulo}*\n` : ''}${l.descricao || ''}\n\n🗓 ${data}\n_Código: #${l.id}_`;
        await enviarWhatsApp(l.remotejid, msg);
        await client.query('UPDATE lembretes SET enviado=TRUE WHERE id=$1', [l.id]);
        console.log(`[Lembretes] Enviado → ${l.remotejid} (id: ${l.id})`);
      } catch (e) {
        console.error(`[Lembretes] Erro envio ${l.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('[Lembretes] Erro no job:', err);
  } finally {
    client.release();
  }
}

function iniciarJob() {
  cron.schedule('* * * * *', processarLembretes);
  console.log('[Lembretes] Job iniciado (a cada minuto) — avisos antecipados + vencimentos');
}

module.exports = { iniciarJob };
