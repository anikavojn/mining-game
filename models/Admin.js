require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function createAdmin() {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const { data, error } = await supabase
        .from('admins')
        .insert({
            username: 'admin',
            password: hashedPassword
        })
        .select();
    
    if (error) {
        console.error('❌ Ошибка:', error.message);
    } else {
        console.log('✅ Админ создан:', data);
    }
}

createAdmin();