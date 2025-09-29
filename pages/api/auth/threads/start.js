// pages/api/auth/threads/start.js
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { THREADS_APP_ID, THREADS_REDIRECT_URL } = process.env;
  if (!THREADS_APP_ID || !THREADS_REDIRECT_URL) {
    return res.status(500).json({ error: '環境変数 THREADS_APP_ID/THREADS_REDIRECT_URL を設定してください。' });
  }

  const scope = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_insights'
    // 'threads_manage_replies'
  ].join(',');

  const authUrl = new URL('https://threads.net/oauth/authorize');
  authUrl.searchParams.set('client_id', THREADS_APP_ID);
  authUrl.searchParams.set('redirect_uri', THREADS_REDIRECT_URL);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('response_type', 'code');

  // ここがデバッグ用：?debug=1 ならURLを文字で返す
  if (req.query.debug === '1') {
    return res.status(200).send(authUrl.toString());
  }

  return res.redirect(authUrl.toString());
}
