import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://vaahwukpupiiimnuagfa.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_5NbtFzk47B5qmGqNJbIL5A_PlTmSwjC';

// Inicializa o cliente do Supabase
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


