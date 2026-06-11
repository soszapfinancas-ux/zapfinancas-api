// Webhook Asaas — ativa/renova contas automaticamente via pagamento direto
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const axios   = require('axios');

const ASAAS_TOKEN    = process.env.ASAAS_TOKEN || '';
const ASAAS_BASE_URL = process.env.ASAAS_ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://sandbox.asaas.com/api/v3';

// Busca dados do customer no Asaas para obter telefone/email
async function getAsaasCustomer(customerId) {
  if (!ASAAS_TOKEN || !customerId) return null;
  try {
    const { data } = await axios.get(`${ASAAS_BASE_URL}/customers/${customerId}`, {
      headers: { access_token: ASAAS_TOKEN },
      timeout: 6000,
    });
    return data;
  } catch {
    return null;
  }
}

// Normaliza telefone para formato remotejid WhatsApp
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length >= 12) return `${digits}@s.whatsapp.net`;
  return `55${digits}@s.whatsapp.net`;
}

// Notifica usuário via n8n webhook de ativação
async function notificarAtivacao(telefone, nome, contaId) {
  const webhookUrl = process.env.N8N_WEBHOOK_ATIVACAO;
  if (!webhookUrl || !telefone) return;
  const payload = {
    evento:    'usuario_ativado',
    timestamp: new Date().toISOString(),
    dominio:   process.env.APP_URL || 'https://zapfinancas.orbitarosa.com',
    id:        contaId,
    nome,
    telefone:  telefone.replace(/\D/g, ''),
    mensagem_ativacao: {
      titulo:   'Plano ativado!',
      mensagem: `Olá, ${nome.split(' ')[0]}! 🎉 Seu plano *ZapFinanças* foi ativado com sucesso!\n\nAgora você pode registrar gastos e receitas aqui pelo WhatsApp. Acesse também o painel web:`,
    },
  };
  try {
    await axios.post(webhookUrl, payload, { timeout: 8000 });
  } catch (e) {
    console.warn('[Asaas] Falha ao chamar webhook de ativação:', e.message);
  }
}

// Determina plano pelo valor pago (R$ 87 = Base, >=R$ 124 = Familiar)
function planIdByValue(valor) {
  return Number(valor) >= 124 ? 2 : 1;
}

// POST /webhook/asaas
router.post('/', async (req, res) => {
  const event   = req.body.event;
  const payment = req.body.payment;

  console.log(`[Asaas] evento: ${event}`);

  // Só processa pagamentos confirmados/recebidos
  if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) {
    return res.json({ received: true, ignored: true });
  }
  if (!payment) return res.status(400).json({ error: 'Payload inválido' });

  const asaasPaymentId = payment.id       || '';
  const valor          = payment.value    || 0;
  const customerId     = payment.customer || '';
  const externalRef    = payment.externalReference || ''; // pode conter o remotejid do usuário

  // Busca dados do pagador no Asaas
  const customer = await getAsaasCustomer(customerId);
  const email    = customer?.email   || payment.billingType && '';
  const nome     = customer?.name    || 'Usuário';
  const telefone = customer?.mobilePhone || customer?.phone || externalRef || '';

  const remotejid = normalizePhone(telefone);
  const planoId   = planIdByValue(valor);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Evita processar o mesmo pagamento duas vezes
    const dupCheck = await client.query(
      'SELECT id FROM pagamentos_asaas WHERE asaas_payment_id=$1',
      [asaasPaymentId]
    );
    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`[Asaas] Pagamento ${asaasPaymentId} já processado — ignorando`);
      return res.json({ received: true, duplicate: true });
    }

    // Tenta encontrar a conta pelo remotejid ou email
    let contaId = null;
    let nomeAtivacao = nome;

    if (remotejid) {
      const byPhone = await client.query(
        `SELECT c.id, u.nome FROM contas c
         JOIN usuarios u ON u.conta_id = c.id
         WHERE u.remotejid = $1
         ORDER BY c.created_at DESC LIMIT 1`,
        [remotejid]
      );
      if (byPhone.rows.length > 0) {
        contaId      = byPhone.rows[0].id;
        nomeAtivacao = byPhone.rows[0].nome || nome;
      }
    }

    if (!contaId && email) {
      const byEmail = await client.query(
        `SELECT id FROM contas WHERE email_comprador = $1 ORDER BY created_at DESC LIMIT 1`,
        [email]
      );
      if (byEmail.rows.length > 0) contaId = byEmail.rows[0].id;
    }

    if (contaId) {
      // Renova conta existente (+1 ano)
      await client.query(
        `UPDATE contas SET
           status = 'ativo',
           plano_id = $2,
           data_ativacao = NOW(),
           data_expiracao = NOW() + INTERVAL '1 year',
           asaas_customer_id = $3
         WHERE id = $1`,
        [contaId, planoId, customerId || null]
      );
    } else {
      // Cria nova conta (usuário pagou mas ainda não mandou mensagem)
      const contaRes = await client.query(
        `INSERT INTO contas
           (plano_id, status, email_comprador, nome_comprador, telefone_comprador,
            data_ativacao, data_expiracao, asaas_customer_id)
         VALUES ($1,'ativo',$2,$3,$4,NOW(),NOW() + INTERVAL '1 year',$5)
         RETURNING id`,
        [planoId, email || null, nome, telefone || null, customerId || null]
      );
      contaId = contaRes.rows[0].id;

      // Se o usuário já tinha enviado mensagem (conta inativa), vincula
      if (remotejid) {
        await client.query(
          `UPDATE usuarios SET conta_id=$1, ativo=TRUE
           WHERE remotejid=$2 AND (conta_id IS NULL OR conta_id IN (
             SELECT id FROM contas WHERE status != 'ativo'
           ))`,
          [contaId, remotejid]
        );
      }
    }

    // Log do pagamento
    await client.query(
      `INSERT INTO pagamentos_asaas
         (conta_id, asaas_payment_id, asaas_event, valor, email_pagador, telefone_pagador, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [contaId, asaasPaymentId, event, valor, email || null, telefone || null, JSON.stringify(req.body)]
    );

    await client.query('COMMIT');

    // Notifica usuário via WhatsApp (não bloqueia resposta)
    notificarAtivacao(telefone, nomeAtivacao, contaId);

    res.json({ success: true, contaId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Asaas] Erro:', err);
    res.status(500).json({ error: 'Erro ao processar pagamento' });
  } finally {
    client.release();
  }
});

module.exports = router;
