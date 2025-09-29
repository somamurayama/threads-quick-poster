// pages/api/auth/threads/start.js
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { THREADS_APP_ID, THREADS_REDIRECT_URL } = process.env;
  if (!THREADS_APP_ID || !THREADS_REDIRECT_URL) {
    return res.status(500).json({ error: '環境変数 THREADS_APP_ID / THREADS_REDIRECT_URL を設定してください。' });
  }

  // 必要権限（最低限）
  const scope = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_insights'
  ].join(',');

  // ★ 重要：ドメインは www.threads.net を使う
  const authUrl = new URL('https://www.threads.net/oauth/authorize');
  authUrl.searchParams.set('client_id', THREADS_APP_ID); // 一般的なキー
  authUrl.searchParams.set('app_id', THREADS_APP_ID);    // こちらを見るケース対策
  authUrl.searchParams.set('redirect_uri', THREADS_REDIRECT_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);

  // デバッグ表示: /api/auth/threads/start?debug=1 でURL文字列を返す
  if (req.query.debug === '1') {
    return res.status(200).send(authUrl.toString());
  }

  return res.redirect(authUrl.toString());
}
