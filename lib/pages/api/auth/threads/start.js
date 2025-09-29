// pages/api/auth/threads/start.js
// ────────────────────────────────────────────────────────────────
// ブラウザを Threads の認可画面へリダイレクトします。


export default async function handler(req, res) {
if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');


const { THREADS_APP_ID, THREADS_REDIRECT_URL } = process.env;
if (!THREADS_APP_ID || !THREADS_REDIRECT_URL) {
return res.status(500).json({ error: '環境変数 THREADS_APP_ID/THREADS_REDIRECT_URL を設定してください。' });
}


const scope = [
'threads_basic',
'threads_content_publish',
'threads_manage_insights' // インサイトを使わない場合でも付与しておくと後で便利
// 'threads_manage_replies' // 自動返信も行うなら将来追加
].join(',');


const authUrl = new URL('https://threads.net/oauth/authorize'); // 出典: 公式説明/実践記事 citeturn5search10
authUrl.searchParams.set('client_id', THREADS_APP_ID);
authUrl.searchParams.set('redirect_uri', THREADS_REDIRECT_URL);
authUrl.searchParams.set('scope', scope);
authUrl.searchParams.set('response_type', 'code');


return res.redirect(authUrl.toString());
}
