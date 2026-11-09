-- Inscrições voluntárias de notificações para simulação do HydraSmart.
-- Endpoint e chaves são material técnico sensível: não expor por API de listagem.
CREATE TABLE IF NOT EXISTS push_inscricoes (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_inscricoes_atualizado ON push_inscricoes (atualizado_em);
