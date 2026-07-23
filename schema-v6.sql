-- ============================================================
-- ZapFinanças — Migração v6
-- Execute após schema.sql + schema-v2.sql + schema-v3.sql + schema-v4.sql + schema-v5.sql
--
-- vincular_usuario_conta() gravava o remotejid também na coluna
-- `email` de usuarios (nunca recebia o e-mail real do comprador).
-- Agora aceita um p_email opcional — quem tem e-mail de verdade
-- (compra na Hotmart, cadastro manual no admin) passa ele; quem não
-- tem (primeiro contato via WhatsApp, membro adicionado à família)
-- continua caindo no fallback antigo (remotejid).
-- ============================================================

DROP FUNCTION IF EXISTS vincular_usuario_conta(INT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION vincular_usuario_conta(
  p_conta_id  INT,
  p_remotejid TEXT,
  p_nome      TEXT,
  p_telefone  TEXT,
  p_tipo      TEXT DEFAULT 'titular',
  p_email     TEXT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_usuario_id INT;
  v_foi_criado BOOLEAN;
BEGIN
  INSERT INTO usuarios (conta_id, remotejid, nome, email, telefone, tipo, ativo)
  VALUES (p_conta_id, p_remotejid, p_nome, COALESCE(p_email, p_remotejid), p_telefone, p_tipo, TRUE)
  ON CONFLICT (remotejid) DO UPDATE SET
    conta_id = EXCLUDED.conta_id,
    ativo    = TRUE,
    email    = COALESCE(EXCLUDED.email, usuarios.email)
  RETURNING id, (xmax = 0) INTO v_usuario_id, v_foi_criado;

  IF v_foi_criado THEN
    INSERT INTO api_tokens (usuario_id, token, nome, descricao, ativo, master, rotacionavel)
    VALUES (v_usuario_id, 'fin_' || encode(gen_random_bytes(32), 'hex'),
            'MasterToken', 'Token principal do usuário', TRUE, TRUE, TRUE);

    INSERT INTO carteiras (usuario_id, nome, descricao, saldo_atual)
    VALUES (v_usuario_id, 'Principal', 'Carteira principal criada automaticamente', 0.00);

    INSERT INTO categorias (usuario_id, nome, icone, cor, tipo) VALUES
      (v_usuario_id, 'Alimentação', '🍔', '#FF6384', 'ambos'),
      (v_usuario_id, 'Saúde',       '💊', '#36A2EB', 'ambos'),
      (v_usuario_id, 'Educação',    '🎓', '#FFCE56', 'ambos'),
      (v_usuario_id, 'Moradia',     '🏠', '#4BC0C0', 'ambos'),
      (v_usuario_id, 'Transporte',  '🚌', '#9966FF', 'ambos'),
      (v_usuario_id, 'Lazer',       '🎉', '#FF9F40', 'ambos'),
      (v_usuario_id, 'Vestuário',   '👕', '#E7E9ED', 'ambos'),
      (v_usuario_id, 'Salário',     '💼', '#2ecc71', 'receita'),
      (v_usuario_id, 'Outros',      '🔖', '#C9CBCF', 'ambos');

    INSERT INTO formas_pagamento (usuario_id, nome) VALUES
      (v_usuario_id, 'PIX'),
      (v_usuario_id, 'Cartão de Crédito'),
      (v_usuario_id, 'Cartão de Débito'),
      (v_usuario_id, 'Dinheiro'),
      (v_usuario_id, 'Transferência');
  END IF;

  RETURN v_usuario_id;
END;
$$ LANGUAGE plpgsql;
