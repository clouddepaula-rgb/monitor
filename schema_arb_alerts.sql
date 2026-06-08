-- ============================================
-- TABELA DE COOLDOWNS PARA O BOT DE ARBITRAGEM
-- Executar no Supabase SQL Editor
-- ============================================

-- Tabela simples para rastrear o último alerta enviado por rota
-- Previne spam no Telegram (cooldown de 3 minutos por rota)
CREATE TABLE IF NOT EXISTS public.arb_alert_cooldowns (
    route_key TEXT PRIMARY KEY,
    last_alert_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

-- SEM RLS — esta tabela é acessada apenas pela serverless function do cron
-- Não contém dados sensíveis (apenas chaves de rota e timestamps)

-- Limpeza automática: remove cooldowns antigos (>1 hora) para manter a tabela enxuta
-- Pode ser executado periodicamente ou ignorado (a tabela nunca fica grande)
-- DELETE FROM public.arb_alert_cooldowns WHERE last_alert_at < now() - interval '1 hour';
