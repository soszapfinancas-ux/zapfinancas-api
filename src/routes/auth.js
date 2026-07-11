// Login do painel via OTP enviado pelo WhatsApp
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const axios   = require('axios');

const UAZAPI_BASE = process.env.UAZAPI_BASE_URL || '';
const UAZAPI_TOK  = process.env.UAZAPI_TOKEN    || '';

// Números brasileiros podem chegar via WhatsApp/UAZAPI SEM o 9º dígito
// (ex: 553187053782), mesmo quando o usuário digita o telefone completo
// no login. Gera os dois formatos possíveis pra não perder o match.
function remotejidCandidates(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return [];
  const withCountry = digits.length >= 12 ? digits : `55${digits}`;
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

async function sendWhatsApp(remotejid, text) {
  if (!UAZAPI_BASE || !UAZAPI_TOK) {
    console.warn('[Auth] UAZAPI não configurado — OTP não enviado');
    return;
  }
  await axios.post(
    `${UAZAPI_BASE}/send/text`,
    { number: remotejid, text, readchat: 'false' },
    { headers: { token: UAZAPI_TOK } }
  );
}

// POST /api/auth/request-code  {phone: "41999999999"}
router.post('/request-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Campo obrigatório: phone' });

  const candidatos = remotejidCandidates(phone);

  try {
    const userRes = await pool.query(
      `SELECT u.id, u.nome, u.remotejid, c.status AS conta_status
       FROM usuarios u
       JOIN contas c ON u.conta_id = c.id
       WHERE u.remotejid = ANY($1)
       LIMIT 1`,
      [candidatos]
    );

    if (userRes.rows.length === 0)
      return res.status(404).json({ error: 'Telefone não encontrado. Envie uma mensagem para o bot primeiro.' });

    const user = userRes.rows[0];
    if (user.conta_status !== 'ativo')
      return res.status(403).json({ error: 'Conta inativa. Adquira o ZapFinanças em zapfinancas.orbitarosa.com' });

    // Gera código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    await pool.query(
      `INSERT INTO sessions (usuario_id, code, code_expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [user.id, code, codeExpires]
    );
    // Limpa códigos antigos do mesmo usuário
    await pool.query(
      `DELETE FROM sessions WHERE usuario_id=$1 AND token IS NULL AND created_at < NOW() - INTERVAL '10 minutes'`,
      [user.id]
    );
    // Insere novo código
    await pool.query(
      `INSERT INTO sessions (usuario_id, code, code_expires_at) VALUES ($1,$2,$3)`,
      [user.id, code, codeExpires]
    );

    const nome = user.nome?.split(' ')[0] || 'usuário';
    await sendWhatsApp(
      user.remotejid,
      `🔐 *ZapFinanças — Código de acesso*\n\nOlá, ${nome}!\n\nSeu código de acesso ao painel é:\n\n*${code}*\n\n_Válido por 5 minutos. Não compartilhe._`
    );

    res.json({ success: true, message: 'Código enviado via WhatsApp' });
  } catch (err) {
    console.error('[Auth] request-code:', err);
    res.status(500).json({ error: 'Erro ao gerar código' });
  }
});

// POST /api/auth/verify-code  {phone, code}
router.post('/verify-code', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Campos obrigatórios: phone, code' });

  const candidatos = remotejidCandidates(phone);

  try {
    const userRes = await pool.query(
      'SELECT id, nome FROM usuarios WHERE remotejid = ANY($1) LIMIT 1',
      [candidatos]
    );
    if (userRes.rows.length === 0)
      return res.status(404).json({ error: 'Usuário não encontrado' });

    const userId = userRes.rows[0].id;

    // Verifica código válido
    const sessRes = await pool.query(
      `SELECT id FROM sessions
       WHERE usuario_id=$1 AND code=$2 AND token IS NULL
         AND code_expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, code]
    );
    if (sessRes.rows.length === 0)
      return res.status(401).json({ error: 'Código inválido ou expirado' });

    // Gera token de sessão (7 dias)
    const token    = 'sess_' + require('crypto').randomBytes(32).toString('hex');
    const expires  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      'UPDATE sessions SET token=$1, expires_at=$2, code=NULL WHERE id=$3',
      [token, expires, sessRes.rows[0].id]
    );

    // Retorna dados do usuário + token
    const { rows } = await pool.query(
      `SELECT u.id, u.nome, u.remotejid, u.tipo,
              c.status AS conta_status, c.plano_id,
              p.nome AS plano, p.tem_exportacao, p.max_telefones
       FROM usuarios u
       JOIN contas c ON u.conta_id = c.id
       JOIN planos p ON c.plano_id = p.id
       WHERE u.id=$1`,
      [userId]
    );

    res.json({ token, expires_at: expires, user: rows[0] });
  } catch (err) {
    console.error('[Auth] verify-code:', err);
    res.status(500).json({ error: 'Erro ao verificar código' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.headers['apikey'] || req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    await pool.query('DELETE FROM sessions WHERE token=$1', [token]).catch(() => {});
  }
  res.json({ success: true });
});

module.exports = router;
