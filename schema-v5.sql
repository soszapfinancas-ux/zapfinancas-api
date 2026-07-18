-- ============================================================
-- ZapFinanças — Migração v5
-- Execute após schema.sql + schema-v2.sql + schema-v3.sql + schema-v4.sql
--
-- Corrige 2 furos que deixavam compradores sem acesso ao painel:
--
-- 1) Venda aprovada na Hotmart criava a `conta` (ativo) mas só
--    religava um `usuarios` se ele já existisse e estivesse numa
--    conta inativa. Comprador que nunca falou com o bot ficava
--    sem NENHUM usuário — logo, sem login.
-- 2) Cadastrar membro pelo painel admin (`adicionar_membro_familia`)
--    fazia um INSERT puro. Se o remotejid já existisse em outra
--    conta (pessoa que já usava o sistema), estourava erro de
--    UNIQUE em vez de simplesmente realocar o usuário.
--
-- `vincular_usuario_conta()` resolve os dois: religa o usuário se
-- ele já existir (em qualquer conta), ou cria na hora (com carteira,
-- categorias e formas de pagamento padrão) se for a primeira vez.
-- ============================================================

CREATE OR REPLACE FUNCTION vincular_usuario_conta(
  p_conta_id  INT,
  p_remotejid TEXT,
  p_nome      TEXT,
  p_telefone  TEXT,
  p_tipo      TEXT DEFAULT 'titular'
) RETURNS INT AS $$
DECLARE
  v_usuario_id INT;
  v_foi_criado BOOLEAN;
BEGIN
  INSERT INTO usuarios (conta_id, remotejid, nome, email, telefone, tipo, ativo)
  VALUES (p_conta_id, p_remotejid, p_nome, p_remotejid, p_telefone, p_tipo, TRUE)
  ON CONFLICT (remotejid) DO UPDATE SET
    conta_id = EXCLUDED.conta_id,
    ativo    = TRUE
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

-- adicionar_membro_familia passa a reaproveitar vincular_usuario_conta:
-- se o número já existir em outra conta, realoca em vez de estourar
-- erro de UNIQUE em `usuarios.remotejid`.
CREATE OR REPLACE FUNCTION adicionar_membro_familia(
  p_conta_id  INT,
  p_remotejid TEXT,
  p_nome      TEXT,
  p_telefone  TEXT
) RETURNS TABLE(
  usuario_id INT,
  api_token  TEXT
) AS $$
DECLARE
  v_usuario_id    INT;
  v_token         TEXT;
  v_max_telefones INT;
  v_count         INT;
BEGIN
  SELECT p.max_telefones INTO v_max_telefones
  FROM contas c
  JOIN planos p ON c.plano_id = p.id
  WHERE c.id = p_conta_id;

  SELECT COUNT(*) INTO v_count
  FROM usuarios
  WHERE conta_id = p_conta_id AND ativo = TRUE;

  IF v_count >= v_max_telefones THEN
    RAISE EXCEPTION 'Limite de telefones atingido para este plano (máximo: %)', v_max_telefones;
  END IF;

  v_usuario_id := vincular_usuario_conta(p_conta_id, p_remotejid, p_nome, p_telefone, 'membro');

  SELECT token INTO v_token FROM api_tokens WHERE usuario_id = v_usuario_id AND master = TRUE LIMIT 1;

  RETURN QUERY SELECT v_usuario_id, v_token;
END;
$$ LANGUAGE plpgsql;
