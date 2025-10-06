// pages/api/jobs/run.js
// 自動投稿ジョブ（Threads 複数画像 + 時間帯フィルタ[time_start/time_end]対応 + 429対策）
// 使い方: https://<あなたのURL>/api/jobs/run?key=YOUR_SECRET[&dry=1]

import { supabase } from '../../../lib/db.js';
import { createTextAndMaybePublish, createImageContainer, publish } from '../../../lib/threadsApi.js';

/** ---- レート制限対策ユーティリティ ---- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch で 429/5xx を指数バックオフ付きでリトライ */
async function safeFetch(url, options, { max = 4, base = 800 } = {}) {
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, options);
    if (res.status !== 429 && res.status < 500) return res; // 成功 or 4xx(429以外)は即返す
    if (attempt >= max) return res; // もうリトライしない（呼び出し側で res.ok 判定）
    const backoff = base * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
    await sleep(backoff);
    attempt++;
  }
}

/** 任意の非同期関数に 429/5xx リトライを付与（Threads API 呼び出し用） */
async function requestWithRetry(fn, { max = 4, base = 800 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/429|5\d\d/.test(msg) || attempt >= max) throw e;
      const backoff = base * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
      await sleep(backoff);
      attempt++;
    }
  }
}

/** "HH:MM[:SS]" → 分（0〜1439）に変換。null/空は全時間帯扱いとして null を返す */
function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const [hh, mm = '0'] = t.split(':');
  const h = Math.max(0, Math.min(23, parseInt(hh, 10)));
  const m = Math.max(0, Math.min(59, parseInt(mm, 10)));
  return h * 60 + m;
}

/** JST 現在分（0〜1439） */
function nowMinutesJST() {
  const now = new Date();
  const h = (now.getUTCHours() + 9 + 24) % 24;
  const m = now.getUTCMinutes();
  return h * 60 + m;
}

/** [start,end) の半開区間で判定。夜跨ぎ(例: 22:00-03:00)も対応。start/endがnullなら常時OK */
function isWithinWindowJST(tStart, tEnd, nowMin) {
  const s = timeToMinutes(tStart); // null 可
  const e = timeToMinutes(tEnd);   // null 可
  if (s === null || e === null) return true; // どちらか未設定→制限なし
  if (s === e) return true; // 同値なら24h許可
  if (s < e) return nowMin >= s && nowMin < e; // 同日内
  return nowMin >= s || nowMin < e; // 夜跨ぎ
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).end('Method Not Allowed');

  const { JOBS_SECRET } = process.env;
  const key = req.query.key || req.headers['x-jobs-key'];
  if (!JOBS_SECRET || key !== JOBS_SECRET) {
    return res
      .status(401)
      .json({ error: 'unauthorized: set ?key=JOBS_SECRET or x-jobs-key header' });
  }

  const dryRun = String(req.query.dry || '') === '1';

  try {
    const nowMin = nowMinutesJST();

    // 一回のrunで処理するスケジュール数を抑制（ピーク抑止）
    const MAX_PER_RUN = 5;

    // next_run <= now, active=true のスケジュールを取得
    const { data: due, error: err1 } = await supabase
      .from('schedules')
      .select('id, account_id, mode, interval_minutes, next_run')
      .lte('next_run', new Date().toISOString())
      .eq('active', true)
      .order('next_run', { ascending: true })
      .limit(MAX_PER_RUN);
    if (err1) throw err1;

    const results = [];

    for (const sch of due || []) {
      // アカウント取得（無効ならスキップ）
      const { data: acct, error: err2 } = await supabase
        .from('accounts')
        .select('id, threads_user_id, access_token, proxy_url, enabled')
        .eq('id', sch.account_id)
        .eq('enabled', true)
        .maybeSingle();
      if (err2) throw err2;
      if (!acct) {
        results.push({
          schedule: sch.id,
          ok: false,
          reason: 'account_not_found_or_disabled',
        });
        continue;
      }

      // 投稿内容の決定
      const mode = (sch.mode || 'TEMPLATE').toUpperCase();
      let text = '';
      let mediaUrls = []; // 複数URL対応

      if (mode === 'TEMPLATE' || mode === 'MIX' || mode === 'AI') {
        // 1) 未使用テンプレを1件ピック（使用履歴はDB側で記録される想定）
        const rpcUrl = process.env.SUPABASE_URL + '/rest/v1/rpc/pick_next_template';
        const rpcRes = await safeFetch(
          rpcUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: process.env.SUPABASE_SERVICE_ROLE,
              Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE,
            },
            body: JSON.stringify({ _account_id: acct.id }),
          },
          { max: 4, base: 800 }
        );
        if (!rpcRes.ok)
          throw new Error('pick_next_template failed: ' + (await rpcRes.text()));

        const templateId = await rpcRes.json();

        // 2) テンプレ取得（time_start/time_end も一緒に取る）
        const tRes = await safeFetch(
          `${process.env.SUPABASE_URL}/rest/v1/templates?id=eq.${templateId}`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE,
              Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE,
            },
          },
          { max: 4, base: 800 }
        );
        const arr = await tRes.json();
        const tpl = Array.isArray(arr) ? arr[0] : arr;

        // 3) 存在しない → スキップ
        if (!tpl) {
          await supabase.from('logs').insert({
            account_id: acct.id,
            action: 'SKIP',
            payload: { schedule_id: sch.id },
            result: { reason: 'template_not_found' },
            ok: true,
          });
          // 次回は少しジッターを加えて衝突回避
          const jitterMs = Math.floor(Math.random() * 30000); // 0〜30秒
          await supabase
            .from('schedules')
            .update({
              last_run: new Date().toISOString(),
              next_run: new Date(Date.now() + sch.interval_minutes * 60 * 1000 + jitterMs).toISOString(),
            })
            .eq('id', sch.id);
          results.push({ schedule: sch.id, ok: true, skipped: true, reason: 'template_not_found' });
          continue;
        }

        // 4) 時間帯フィルタ（time_start/time_end は time 型想定）
        const okWindow = isWithinWindowJST(tpl.time_start, tpl.time_end, nowMin);
        if (!okWindow) {
          await supabase.from('logs').insert({
            account_id: acct.id,
            action: 'SKIP',
            payload: {
              schedule_id: sch.id,
              nowMin,
              time_start: tpl.time_start || null,
              time_end: tpl.time_end || null,
            },
            result: { reason: 'out_of_time_window' },
            ok: true,
          });
          const jitterMs = Math.floor(Math.random() * 30000);
          await supabase
            .from('schedules')
            .update({
              last_run: new Date().toISOString(),
              next_run: new Date(Date.now() + sch.interval_minutes * 60 * 1000 + jitterMs).toISOString(),
            })
            .eq('id', sch.id);
          results.push({
            schedule: sch.id,
            ok: true,
            skipped: true,
            reason: 'out_of_time_window',
          });
          continue;
        }

        // 5) 本文・メディア
        text = tpl.body || '（本文なし）';
        if (tpl.media_url) {
          mediaUrls = tpl.media_url
            .split(/[\n, ]+/)
            .map((u) => u.trim())
            .filter((u) => u.length > 0);
        }

        // 6) AIモードなら上書き生成（任意）
        if (mode !== 'TEMPLATE' && process.env.OPENAI_API_KEY) {
          try {
            const prompt = `次の内容を参考に、Threads向けに自然で短めの日本語ポストを1つ生成してください。禁止: 個人情報、誹謗中傷、差別。\n\n参考:\n${text}\n`;
            const resp = await safeFetch(
              'https://api.openai.com/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [
                    { role: 'system', content: 'You are a concise Japanese copywriter for social media.' },
                    { role: 'user', content: prompt },
                  ],
                  temperature: 0.7,
                  max_tokens: 120,
                }),
              },
              { max: 3, base: 800 }
            );
            const json = await resp.json();
            const ai = json?.choices?.[0]?.message?.content?.trim();
            if (ai) text = ai;
          } catch (e) {
            console.warn('[AI generate skipped]', e?.message);
          }
        }
      }

      // ===== 投稿処理 =====
      let postResult = null;
      if (!dryRun) {
        try {
          if (mediaUrls.length > 0) {
            // 複数画像：順にアップして最後を publish（各リクエスト間に待機）
            let lastContainer = null;

            for (const [i, url] of mediaUrls.entries()) {
              lastContainer = await requestWithRetry(() =>
                createImageContainer({
                  accessToken: acct.access_token,
                  text: i === 0 ? text : '', // 最初のメディアにだけ本文を付与
                  imageUrl: url,
                })
              );
              // スロットリング：1.2〜1.8秒待機
              await sleep(1200 + Math.floor(Math.random() * 600));
            }

            if (lastContainer) {
              const pub = await requestWithRetry(() =>
                publish({ accessToken: acct.access_token, creationId: lastContainer.id })
              );
              postResult = { published: pub };
            }
          } else {
            // テキストのみ（auto_publish_text=true）
            const r = await requestWithRetry(() =>
              createTextAndMaybePublish({ accessToken: acct.access_token, text })
            );
            postResult = r;
          }
        } catch (e) {
          // 失敗ログ
          await supabase.from('logs').insert({
            account_id: acct.id,
            action: 'POST',
            payload: { text, mediaUrls, schedule_id: sch.id, nowMin },
            result: { error: e?.message || String(e) },
            ok: false,
          });
          // 次回へ（ジッター付き）
          const jitterMs = Math.floor(Math.random() * 30000);
          await supabase
            .from('schedules')
            .update({
              last_run: new Date().toISOString(),
              next_run: new Date(Date.now() + sch.interval_minutes * 60 * 1000 + jitterMs).toISOString(),
            })
            .eq('id', sch.id);

          results.push({
            schedule: sch.id,
            ok: false,
            error: e?.message || String(e),
          });
          continue;
        }
      }

      // 成功ログ
      await supabase.from('logs').insert({
        account_id: acct.id,
        action: 'POST',
        payload: { text, mediaUrls, schedule_id: sch.id, nowMin },
        result: postResult || { dry: true },
        ok: true,
      });

      // 次回実行時刻を更新（ジッター付きで衝突回避）
      const jitterMs = Math.floor(Math.random() * 30000); // 0〜30秒
      await supabase
        .from('schedules')
        .update({
          last_run: new Date().toISOString(),
          next_run: new Date(Date.now() + sch.interval_minutes * 60 * 1000 + jitterMs).toISOString(),
        })
        .eq('id', sch.id);

      results.push({ schedule: sch.id, ok: true, dry: dryRun });
    }

    return res.status(200).json({ ran: (due || []).length, results });
  } catch (e) {
    console.error('[jobs/run] error', e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
