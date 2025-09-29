// pages/api/threads/post.js
// ────────────────────────────────────────────────────────────────
import { IncomingForm } from 'formidable';
import { tokenStore } from '../../../lib/tokenStore.js';
import { createTextAndMaybePublish, createImageContainer, publish } from '../../../lib/threadsApi.js';


export const config = {
api: { bodyParser: false } // formidable を使うため Next.js の標準パーサを無効化
};


function parseForm(req) {
return new Promise((resolve, reject) => {
const form = new IncomingForm({ multiples: false });
form.parse(req, (err, fields/*, files*/) => {
if (err) return reject(err);
resolve(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
});
});
}


async function parseBody(req) {
const ct = req.headers['content-type'] || '';
if (ct.startsWith('application/json')) {
const raw = await new Promise((r) => {
let buf = '';
req.on('data', (c) => (buf += c));
req.on('end', () => r(buf));
});
return JSON.parse(raw || '{}');
}
// form-data / x-www-form-urlencoded
return parseForm(req);
}


export default async function handler(req, res) {
if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');


try {
const body = await parseBody(req);
const text = body.text || '';
const imageUrl = body.imageUrl || '';


if (!text && !imageUrl) {
return res.status(400).json({ error: 'text または imageUrl のいずれかは必須です。' });
}


const token = await tokenStore.get();
if (!token?.accessToken) {
return res.status(401).json({ error: '未連携です。先に /api/auth/threads/start で認可してください。' });
}


if (imageUrl) {
// 1) 画像コンテナ作成
const cont = await createImageContainer({ accessToken: token.accessToken, text, imageUrl });
// 2) publish
const pub = await publish({ accessToken: token.accessToken, creationId: cont.id });
return res.status(200).json({ ok: true, step: 'image+publish', container: cont, published: pub });
} else {
// テキストのみ（auto_publish_text=true で即時公開）
const r = await createTextAndMaybePublish({ accessToken: token.accessToken, text });
return res.status(200).json({ ok: true, step: 'text-auto-publish', result: r });
}
} catch (e) {
console.error('[threads/post] error', e);
const msg = e?.message || String(e);
const status = /403/.test(msg) ? 403 : /401/.test(msg) ? 401 : 500;
return res.status(status).json({ error: msg });
}
}
