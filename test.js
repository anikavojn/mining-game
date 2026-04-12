const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://vfzktbabutxjtwdlalbv.supabase.co';
const supabaseAnonKey = 'ВАШ_НАСТОЯЩИЙ_ANON_KEY'; // замените на настоящий из Supabase

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
    // Проверяем, есть ли таблица users
    const { data, error } = await supabase.from('users').select('*').limit(1);
    console.log('Результат:', data, error);
}

test();