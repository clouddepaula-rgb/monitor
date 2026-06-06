-- Create depeg_configs table
CREATE TABLE IF NOT EXISTS public.depeg_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    symbol TEXT NOT NULL,
    coingecko_id TEXT,
    target_peg NUMERIC DEFAULT 1.00 NOT NULL,
    peg_currency TEXT DEFAULT 'USD' NOT NULL,
    threshold_pct NUMERIC DEFAULT 0.50 NOT NULL,
    is_active BOOLEAN DEFAULT true,
    network TEXT DEFAULT 'Global',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, symbol)
);

-- Enable RLS for depeg_configs
ALTER TABLE public.depeg_configs ENABLE ROW LEVEL SECURITY;

-- Policies for depeg_configs
CREATE POLICY "Users can view their own configs" 
    ON public.depeg_configs FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own configs" 
    ON public.depeg_configs FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own configs" 
    ON public.depeg_configs FOR UPDATE 
    USING (auth.uid() = user_id) 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own configs" 
    ON public.depeg_configs FOR DELETE 
    USING (auth.uid() = user_id);

-- Create depeg_alerts_history table
CREATE TABLE IF NOT EXISTS public.depeg_alerts_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    symbol TEXT NOT NULL,
    price NUMERIC NOT NULL,
    target_peg NUMERIC NOT NULL,
    deviation_pct NUMERIC NOT NULL,
    status TEXT NOT NULL, -- e.g., 'DEPEG_DOWN', 'DEPEG_UP', 'RECOVERED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for depeg_alerts_history
ALTER TABLE public.depeg_alerts_history ENABLE ROW LEVEL SECURITY;

-- Policies for depeg_alerts_history
CREATE POLICY "Users can view their own history" 
    ON public.depeg_alerts_history FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own history" 
    ON public.depeg_alerts_history FOR INSERT 
    WITH CHECK (auth.uid() = user_id);
