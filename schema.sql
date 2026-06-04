-- ============================================================
-- ZapFinanças — Schema PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- PLANOS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planos (
  id                       SERIAL PRIMARY KEY,
  nome                     VARCHAR(100) NOT NULL,
  descricao                TEXT,
  max_telefones            INT DEFAULT 2,
  tem_exportacao           BOOLEAN DEFAULT FALSE,
  tem_lembretes_avancados  BOOLEAN DEFAULT FALSE,
  preco                    DECIMAL(10,2),
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- CONTAS  (unidade de assinatura — 1 conta = 1 compra Hotmart)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contas (
  id                        SERIAL PRIMARY KEY,
  plano_id                  INT REFERENCES planos(id) DEFAULT 1,
  status                    VARCHAR(20) DEFAULT 'inativo',   -- inativo | ativo | cancelado | expirado
  email_comprador           VARCHAR(255),
  nome_comprador            VARCHAR(255),
  telefone_comprador        VARCHAR(50),
  hotmart_transaction_id    VARCHAR(100),
  hotmart_subscription_code VARCHAR(100),
  data_ativacao             TIMESTAMPTZ,
  data_expiracao            TIMESTAMPTZ,
  observacoes               TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- USUÁRIOS  (cada telefone = 1 usuário, vinculado a 1 conta)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  conta_id      INT REFERENCES contas(id),
  remotejid     VARCHAR(100) UNIQUE NOT NULL,
  nome          VARCHAR(255) NOT NULL,
  email         VARCHAR(255),
  telefone      VARCHAR(50),
  tipo          VARCHAR(20) DEFAULT 'titular',   -- titular | membro
  ativo         BOOLEAN DEFAULT TRUE,
  ultimo_acesso TIMESTAMPTZ,
  data_cadastro TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- API TOKENS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_tokens (
  id             SERIAL PRIMARY KEY,
  usuario_id     INT REFERENCES usuarios(id) ON DELETE CASCADE,
  token          VARCHAR(100) UNIQUE NOT NULL,
  nome           VARCHAR(100),
  descricao      TEXT,
  ativo          BOOLEAN DEFAULT TRUE,
  master         BOOLEAN DEFAULT FALSE,
  rotacionavel   BOOLEAN DEFAULT TRUE,
  data_criacao   TIMESTAMPTZ DEFAULT NOW(),
  data_expiracao TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- CARTEIRAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carteiras (
  id           SERIAL PRIMARY KEY,
  usuario_id   INT REFERENCES usuarios(id) ON DELETE CASCADE,
  nome         VARCHAR(100) DEFAULT 'Principal',
  descricao    TEXT,
  saldo_atual  DECIMAL(12,2) DEFAULT 0.00,
  data_criacao TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- CATEGORIAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
  id         SERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
  nome       VARCHAR(100) NOT NULL,
  descricao  TEXT,
  icone      VARCHAR(50),
  cor        VARCHAR(7) DEFAULT '#000000',
  tipo       VARCHAR(20) DEFAULT 'ambos',   -- receita | despesa | ambos
  ativo      BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- FORMAS DE PAGAMENTO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formas_pagamento (
  id         SERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
  nome       VARCHAR(100) NOT NULL,
  ativo      BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TRANSAÇÕES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transacoes (
  id                 SERIAL PRIMARY KEY,
  usuario_id         INT REFERENCES usuarios(id) ON DELETE CASCADE,
  carteira_id        INT REFERENCES carteiras(id),
  categoria_id       INT REFERENCES categorias(id),
  forma_pagamento_id INT REFERENCES formas_pagamento(id),
  descricao          TEXT NOT NULL,
  valor              DECIMAL(12,2) NOT NULL,
  tipo               VARCHAR(20) NOT NULL,     -- Receita | Despesa
  data_transacao     DATE NOT NULL,
  status             VARCHAR(20) DEFAULT 'Efetivada',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- LEMBRETES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lembretes (
  id             SERIAL PRIMARY KEY,
  usuario_id     INT REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo         VARCHAR(255),
  descricao      TEXT,
  data_lembrete  TIMESTAMPTZ NOT NULL,
  enviado        BOOLEAN DEFAULT FALSE,
  ativo          BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- MENSAGENS DE BOAS-VINDAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS welcome_messages (
  id         SERIAL PRIMARY KEY,
  type       VARCHAR(50) UNIQUE NOT NULL,
  message    TEXT NOT NULL,
  ativo      BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- LOG DE COMPRAS HOTMART
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compras_hotmart (
  id                     SERIAL PRIMARY KEY,
  conta_id               INT REFERENCES contas(id),
  hotmart_transaction_id VARCHAR(100),
  produto_id             VARCHAR(100),
  produto_nome           VARCHAR(255),
  valor                  DECIMAL(10,2),
  tipo                   VARCHAR(20),   -- principal | order_bump
  status                 VARCHAR(20),
  email_comprador        VARCHAR(255),
  payload                JSONB,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÍNDICES
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_usuarios_remotejid      ON usuarios(remotejid);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token        ON api_tokens(token);
CREATE INDEX IF NOT EXISTS idx_transacoes_usuario      ON transacoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_data         ON transacoes(data_transacao);
CREATE INDEX IF NOT EXISTS idx_transacoes_tipo         ON transacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_lembretes_data          ON lembretes(data_lembrete);
CREATE INDEX IF NOT EXISTS idx_lembretes_pendentes     ON lembretes(enviado, ativo) WHERE enviado = FALSE AND ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_contas_email            ON contas(email_comprador);
CREATE INDEX IF NOT EXISTS idx_contas_transaction      ON contas(hotmart_transaction_id);

-- ============================================================
-- DADOS INICIAIS
-- ============================================================

INSERT INTO planos (nome, descricao, max_telefones, tem_exportacao, tem_lembretes_avancados, preco) VALUES
  ('Base',     'Plano base — até 2 telefones na mesma conta',                              2, FALSE, FALSE,  87.00),
  ('Familiar', 'Plano familiar — até 5 telefones + exportação PDF/Excel + agenda pessoal', 5, TRUE,  TRUE,  124.00)
ON CONFLICT DO NOTHING;

INSERT INTO welcome_messages (type, message) VALUES
(
  'new_user',
  E'Olá, {nome}! 👋 Seja bem-vindo ao *ZapFinanças*! 💰\n\nEstou aqui para te ajudar a controlar suas finanças pelo WhatsApp de forma simples e prática.\n\nAssim que sua conta for ativada, é só me mandar um gasto ou receita:\n• _"Paguei 50 reais de gasolina"_\n• _"Recebi 1500 de salário"_\n• _"Gastei 120 no mercado"_\n\nAcesse também: zapfinancas.orbitarosa.com 🚀'
),
(
  'inactive_user',
  E'Olá, {nome}! 😊\n\nSua conta ainda não está ativa no *ZapFinanças*.\n\nPara começar a controlar suas finanças pelo WhatsApp:\n\n👉 Acesse: zapfinancas.orbitarosa.com\n\nQualquer dúvida, estamos aqui! 💬'
)
ON CONFLICT (type) DO NOTHING;

-- ============================================================
-- FUNÇÃO: Registrar novo usuário (cria conta + token + carteira + categorias + formas de pagamento)
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_novo_usuario(
  p_remotejid TEXT,
  p_nome      TEXT,
  p_telefone  TEXT
) RETURNS TABLE(
  usuario_id INT,
  conta_id   INT,
  api_token  TEXT
) AS $$
DECLARE
  v_conta_id   INT;
  v_usuario_id INT;
  v_token      TEXT;
BEGIN
  INSERT INTO contas (plano_id, status)
  VALUES (1, 'inativo')
  RETURNING id INTO v_conta_id;

  INSERT INTO usuarios (conta_id, remotejid, nome, email, telefone, tipo, ativo)
  VALUES (v_conta_id, p_remotejid, p_nome, p_remotejid, p_telefone, 'titular', TRUE)
  RETURNING id INTO v_usuario_id;

  v_token := 'fin_' || encode(gen_random_bytes(32), 'hex');
  INSERT INTO api_tokens (usuario_id, token, nome, descricao, ativo, master, rotacionavel)
  VALUES (v_usuario_id, v_token, 'MasterToken', 'Token principal do usuário, não removível.', TRUE, TRUE, TRUE);

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

  RETURN QUERY SELECT v_usuario_id, v_conta_id, v_token;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNÇÃO: Adicionar membro à família (valida limite do plano)
-- ============================================================
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

  INSERT INTO usuarios (conta_id, remotejid, nome, email, telefone, tipo, ativo)
  VALUES (p_conta_id, p_remotejid, p_nome, p_remotejid, p_telefone, 'membro', TRUE)
  RETURNING id INTO v_usuario_id;

  v_token := 'fin_' || encode(gen_random_bytes(32), 'hex');
  INSERT INTO api_tokens (usuario_id, token, nome, descricao, ativo, master, rotacionavel)
  VALUES (v_usuario_id, v_token, 'MasterToken', 'Token principal do usuário', TRUE, TRUE, TRUE);

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

  RETURN QUERY SELECT v_usuario_id, v_token;
END;
$$ LANGUAGE plpgsql;
