// Supabase client setup — shared across all pages
const SUPABASE_URL = 'https://ukizfpiobuapeoyeftjp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_DY0DGoXistrn5vEdIHnN3Q_0tV1Fz14';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
