// lib/db.js
// Supabase サーバー用クライアント（Service Roleで使用）
// 環境変数: SUPABASE_URL / SUPABASE_SERVICE_ROLE
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE;

if (!url || !serviceKey) {
  console.warn('[lib/db] SUPABASE_URL / SUPABASE_SERVICE_ROLE が未設定です。DB操作は失敗します。');
}

export const supabase = createClient(url || '', serviceKey || '', {
  auth: { persistSession: false },
});
