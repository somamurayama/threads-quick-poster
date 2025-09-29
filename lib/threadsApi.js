// lib/threadsApi.js
const BASE = 'https://graph.threads.net';

// 認可コード → 短期アクセストークン
export async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
  const url = `${BASE}/oauth/access_token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code
  });
  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${text}`);
  }
  return res.json(); // { access_token, user_id }
}

// 短期 → 長期（任意だが推奨）
export async function exchangeToLongLived({ clientSecret, accessToken }) {
  const url = new URL(`${BASE}/access_token`);
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`long-lived exchange failed: ${res.status} ${text}`);
  }
  return res.json(); // { access_token, token_type, expires_in }
}

// テキスト（即時公開）
export async function createTextAndMaybePublish({ accessToken, text }) {
  const url = new URL(`${BASE}/me/threads`);
  url.searchParams.set('media_type', 'TEXT');
  url.searchParams.set('text', text);
  url.searchParams.set('auto_publish_text', 'true');
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create text failed: ${res.status} ${t}`);
  }
  return res.json();
}

// 画像コンテナ作成
export async function createImageContainer({ accessToken, text, imageUrl, altText }) {
  const url = new URL(`${BASE}/me/threads`);
  url.searchParams.set('media_type', 'IMAGE');
  if (text) url.searchParams.set('text', text);
  url.searchParams.set('image_url', imageUrl);
  if (altText) url.searchParams.set('alt_text', altText);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create image container failed: ${res.status} ${t}`);
  }
  return res.json(); // { id: creation_id }
}

// publish
export async function publish({ accessToken, creationId }) {
  const url = new URL(`${BASE}/me/threads_publish`);
  url.searchParams.set('creation_id', creationId);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`publish failed: ${res.status} ${t}`);
  }
  return res.json(); // { id: post_id }
}
