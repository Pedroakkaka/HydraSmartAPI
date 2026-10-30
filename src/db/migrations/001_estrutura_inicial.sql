-- HydraSmart — estrutura inicial do banco de dados

CREATE TABLE IF NOT EXISTS bueiros (
  id                  TEXT PRIMARY KEY,
  codigo_curto        TEXT NOT NULL,
  nome                TEXT NOT NULL,
  pino_trig           TEXT,
  pino_echo           TEXT,
  altura_total_cm     NUMERIC(7,2) NOT NULL DEFAULT 20,
  distancia_cega_cm   NUMERIC(7,2) NOT NULL DEFAULT 2,
  volume_total_ml     NUMERIC(12,2) NOT NULL DEFAULT 2000,
  limite_atencao_pct  NUMERIC(5,2) NOT NULL DEFAULT 50,
  limite_critico_pct  NUMERIC(5,2) NOT NULL DEFAULT 80,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bueiros_latitude_valida  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  CONSTRAINT bueiros_longitude_valida CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

INSERT INTO bueiros (id, codigo_curto, nome, pino_trig, pino_echo) VALUES
  ('bueiro_1', '01', 'Bueiro 01 (Entrada / Montante)', 'D9', 'D10'),
  ('bueiro_2', '02', 'Bueiro 02 (Saída / Jusante)',    'D6', 'D7')
ON CONFLICT (id) DO NOTHING;

-- Leituras físicas reais (Arduino via USB ou dispositivos via HTTP).
-- Dados do modo demonstração NÃO são gravados aqui.
CREATE TABLE IF NOT EXISTS leituras (
  id              BIGSERIAL PRIMARY KEY,
  bueiro_id       TEXT NOT NULL REFERENCES bueiros(id),
  origem          TEXT NOT NULL,
  distancia_cm    NUMERIC(7,1),
  altura_agua_cm  NUMERIC(7,1) NOT NULL,
  nivel_pct       NUMERIC(5,1) NOT NULL,
  volume_ml       INTEGER NOT NULL,
  risco           TEXT NOT NULL,
  raw             INTEGER,
  registrado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leituras_bueiro_tempo_idx ON leituras (bueiro_id, registrado_em DESC);
CREATE INDEX IF NOT EXISTS leituras_tempo_idx ON leituras (registrado_em DESC);

-- Alertas críticos (abertos quando o nível passa do limiar crítico, fechados quando normaliza).
CREATE TABLE IF NOT EXISTS alertas (
  id              BIGSERIAL PRIMARY KEY,
  bueiro_id       TEXT NOT NULL REFERENCES bueiros(id),
  nivel_pct_pico  NUMERIC(5,1) NOT NULL,
  mensagem        TEXT NOT NULL,
  simulado        BOOLEAN NOT NULL DEFAULT false,
  iniciado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  encerrado_em    TIMESTAMPTZ,
  reconhecido_em  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alertas_abertos_idx ON alertas (bueiro_id) WHERE encerrado_em IS NULL;
