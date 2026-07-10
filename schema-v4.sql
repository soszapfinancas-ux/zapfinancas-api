-- ============================================================
-- ZapFinanças — Migração v4
-- Execute após schema.sql + schema-v2.sql + schema-v3.sql
-- Exclusão lógica de contas: some do painel, mas mantém os
-- dados do comprador e o histórico (evita duplicidade caso o
-- mesmo comprador seja reativado por uma nova compra).
-- ============================================================

ALTER TABLE contas
  ADD COLUMN IF NOT EXISTS excluida    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS excluida_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contas_excluida ON contas(excluida);
