// pages/api/auth/threads/callback.js
// ────────────────────────────────────────────────────────────────
import { exchangeCodeForToken, exchangeToLongLived } from '../../../../lib/threadsApi.js';
import { tokenStore } from '../../../../lib/tokenStore.js';


export default async function handler(req, res) {
const { code, error } = req.query;
if (error) return res.status(400).send(`OAuth エラー: ${error}`);
if (!code) return res.status(400).send('code が見つかりません');


try {
const { THREADS_APP_ID, THREADS_APP_SECRET, THREADS_REDIRECT_URL } = process.env;
if (!THREADS_APP_ID || !THREADS_APP_SECRET || !THREADS_REDIRECT_URL) {
return res.status(500).send('環境変数 THREADS_APP_ID/THREADS_APP_SECRET/THREADS_REDIRECT_URL を設定してください');
}


// 1) 短期トークンに交換
const shortLived = await exchangeCodeForToken({
clientId: THREADS_APP_ID,
clientSecret: THREADS_APP_SECRET,
redirectUri: THREADS_REDIRECT_URL,
code
}); // { access_token, user_id }


// 2) 任意：長期トークンへ交換（推奨）
let accessToken = shortLived.access_token;
try {
const ll = await exchangeToLongLived({ clientSecret: THREADS_APP_SECRET, accessToken });
if (ll?.access_token) accessToken = ll.access_token; // expires_in(秒) も返る
} catch (e) {
// テスター段階では短期のままでも動作確認可。失敗しても続行。
console.warn('[long-lived exchange skipped]', e?.message);
}


// 3) ストアに保存
await tokenStore.save({ userId: shortLived.user_id, accessToken });


// 4) UI に戻す（/ に成功メッセージ表示させる）
res.setHeader('Content-Type', 'text/html; charset=utf-8');
return res.end(`
<html><body>
<script>
window.location.href = '/?connected=1';
</script>
認可に成功しました。<a href="/">トップへ戻る</a>
</body></html>
`);
} catch (e) {
console.error('[callback] error', e);
return res.status(500).send('トークン取得に失敗しました: ' + e.message);
}
}
