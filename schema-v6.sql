-- ============================================================
-- ZapFinanças — Migração v6
-- Execute após schema.sql + schema-v2.sql + schema-v3.sql + schema-v4.sql + schema-v5.sql
--
-- contas.email_comprador guardava o e-mail real do comprador, mas
-- esse valor não é usado por nada crítico (não aparece em nenhuma
-- tela do usuário) e o rastreio de e-mail/telefone de clientes vai
-- passar a viver numa planilha separada. Renomeia a coluna pra
-- telefone_identificador e passa a guardar o mesmo formato que
-- usuarios.remotejid (telefone completo + @s.whatsapp.net) — usado
-- pra localizar conta existente na hora de ativar/renovar.
--
-- O e-mail real de cada compra continua preservado nos logs de
-- transação (compras_hotmart.email_comprador e
-- pagamentos_asaas.email_pagador), que não mudam nesta migração.
-- ============================================================

ALTER TABLE contas RENAME COLUMN email_comprador TO telefone_identificador;
