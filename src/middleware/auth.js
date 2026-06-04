const pool = require('../db');

async function authenticate(req, res, next) {
  const apikey =
    req.headers['apikey'] ||
    req.headers['authorization']?.replace('Bearer ', '');

  if (!apikey) return res.status(401).json({ error: 'API key não fornecida' });

  try {
    let row;

    if (apikey.startsWith('sess_')) {
      // Token de sessão do painel web
      const result = await pool.query(
        `SELECT
           s.usuario_id,
           u.conta_id,
           u.ativo AS usuario_ativo,
           c.status AS conta_status,
           c.plano_id,
           p.max_telefones,
           p.tem_exportacao,
           p.tem_lembretes_avancados
         FROM sessions s
         JOIN usuarios u ON s.usuario_id = u.id
         JOIN contas   c ON u.conta_id   = c.id
         JOIN planos   p ON c.plano_id   = p.id
         WHERE s.token = $1 AND s.expires_at > NOW()`,
        [apikey]
      );
      if (result.rows.length === 0)
        return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
      row = result.rows[0];
    } else {
      // Token de API (fin_xxx) — usado pelo n8n bot
      const result = await pool.query(
        `SELECT
           t.usuario_id,
           u.conta_id,
           u.ativo AS usuario_ativo,
           c.status AS conta_status,
           c.plano_id,
           p.max_telefones,
           p.tem_exportacao,
           p.tem_lembretes_avancados
         FROM api_tokens t
         JOIN usuarios u ON t.usuario_id = u.id
         JOIN contas   c ON u.conta_id   = c.id
         JOIN planos   p ON c.plano_id   = p.id
         WHERE t.token = $1 AND t.ativo = TRUE
           AND (t.data_expiracao IS NULL OR t.data_expiracao > NOW())`,
        [apikey]
      );
      if (result.rows.length === 0)
        return res.status(401).json({ error: 'Token inválido ou expirado' });
      row = result.rows[0];
    }

    req.auth   = row;
    req.userId = row.usuario_id;

    pool.query(
      'UPDATE usuarios SET ultimo_acesso=NOW() WHERE id=$1',
      [req.userId]
    ).catch(() => {});

    next();
  } catch (err) {
    console.error('Erro na autenticação:', err);
    res.status(500).json({ error: 'Erro interno de autenticação' });
  }
}

module.exports = authenticate;
