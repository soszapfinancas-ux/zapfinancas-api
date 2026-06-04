-- ============================================================
-- ZapFinanças — Migração v2
-- Execute após o schema.sql inicial
-- ============================================================

-- Sessões do painel web (login via OTP WhatsApp)
CREATE TABLE IF NOT EXISTS sessions (
  id              SERIAL PRIMARY KEY,
  usuario_id      INT REFERENCES usuarios(id) ON DELETE CASCADE,
  code            VARCHAR(10),
  token           VARCHAR(100) UNIQUE,
  code_expires_at TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_usuario ON sessions(usuario_id);

-- Lembretes: aviso antecipado
ALTER TABLE lembretes
  ADD COLUMN IF NOT EXISTS avisar_antes_horas INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS enviado_aviso       BOOLEAN DEFAULT FALSE;

-- Permite que o middleware de auth aceite tokens de sessão (prefixo sess_)
-- (Lógica tratada no código, sem alteração no BD)
