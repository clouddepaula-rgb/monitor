-- Deleta a tabela antiga se ela existir para recriar com a estrutura global
DROP TABLE IF EXISTS public.ultimas_oportunidades;

-- Cria a tabela com rastreamento opcional por usuário (para ser global)
CREATE TABLE public.ultimas_oportunidades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- opcional
    tipo TEXT NOT NULL, 
    buy_ex TEXT NOT NULL,
    sell_ex TEXT NOT NULL,
    moeda_destino TEXT DEFAULT 'BRL',
    profit_brl NUMERIC NOT NULL,
    profit_pct NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.ultimas_oportunidades ENABLE ROW LEVEL SECURITY;

-- Limpar politicas antigas se existirem
DROP POLICY IF EXISTS "Permitir leitura de oportunidades para todos" ON public.ultimas_oportunidades;
DROP POLICY IF EXISTS "Permitir insercao com proprio user_id" ON public.ultimas_oportunidades;
DROP POLICY IF EXISTS "Permitir leitura apenas de dados proprios" ON public.ultimas_oportunidades;

-- Permitir que usuarios leiam APENAS suas proprias oportunidades
CREATE POLICY "Permitir leitura apenas de dados proprios" 
    ON public.ultimas_oportunidades FOR SELECT 
    USING (auth.uid() = user_id);

-- Permitir que os usuarios insiram
CREATE POLICY "Permitir insercao com proprio user_id" 
    ON public.ultimas_oportunidades FOR INSERT 
    WITH CHECK (auth.uid() = user_id);
