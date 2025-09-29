// lib/tokenStore.js
// ────────────────────────────────────────────────────────────────
// 最小実装：サーバープロセスのメモリに保存します。
// 本番では永続DB（Postgres 等）に差し替えてください（README に手順）。


/**
* トークンレコード型
* @typedef {Object} ThreadsToken
* @property {string} userId - Threads ユーザーID（graph.threads.net が返す）
* @property {string} accessToken - アクセストークン（長期/短期どちらでも可）
* @property {number} [expiresAt] - 期限の epoch 秒（任意）
*/


// メモリ KVS（最小）
const _memory = new Map(); // key: userId → ThreadsToken
let _lastUserId = null; // 単一ユーザー運用を想定したフォールバック


export const tokenStore = {
/**
* 保存（既存は上書き）
* @param {ThreadsToken} rec
*/
async save(rec) {
_memory.set(rec.userId, rec);
_lastUserId = rec.userId;
},
/**
* 取得（userId 指定なしの場合は直近の userId を使用）
* @param {string} [userId]
* @returns {Promise<ThreadsToken|null>}
*/
async get(userId) {
const uid = userId || _lastUserId;
if (!uid) return null;
return _memory.get(uid) || null;
},
/** 全削除（デバッグ用） */
async clear() {
_memory.clear();
_lastUserId = null;
}
};


// 将来の差し替え用の薄いラッパー（例）
// export const tokenStore = createPostgresAdapter(process.env.DATABASE_URL)
