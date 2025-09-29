// lib/tokenStore.js
// アクセストークン保存先を「メモリ → Supabase(accounts)」に変更
import { supabase } from './db.js';

/**
 * 保存: Threads ユーザーIDごとにUpsert
 * @param {{userId:string, accessToken:string, label?:string, proxyUrl?:string}} rec
 */
async function save(rec) {
  if (!supabase) throw new Error('Supabase 未設定です');
  const { userId, accessToken, label, proxyUrl } = rec;
  if (!userId || !accessToken) throw new Error('userId / accessToken は必須です');

  // accounts(threads_user_id 一意) に upsert
  const { data, error } = await supabase
    .from('accounts')
    .upsert(
      {
        threads_user_id: userId,
        access_token: accessToken,
        label: label || `acct_${userId}`,
        proxy_url: proxyUrl || null,
        updated_at: new Date().toISOString(),
        enabled: true,
      },
      { onConflict: 'threads_user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * 取得: userId 指定があればその1件、なければ enabled な先頭1件
 * @param {string=} userId
 */
async function get(userId) {
  if (!supabase) throw new Error('Supabase 未設定です');

  if (userId) {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('threads_user_id', userId)
      .eq('enabled', true)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('enabled', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** 全削除（デバッグ用） */
async function clear() {
  if (!supabase) throw new Error('Supabase 未設定です');
  const { error } = await supabase.from('accounts').delete().neq('threads_user_id', '');
  if (error) throw error;
  return true;
}

export const tokenStore = { save, get, clear };
