// pages/api/jobs/run.js
// 自動投稿ジョブ（Threads複数画像対応）
// 使い方: https://<あなたのURL>/api/jobs/run?key=YOUR_SECRET[&dry=1]

import { supabase } from '../../../lib/db.js';
import { createTextAndMaybePublish, createImageContainer, publish } from '../../../lib/threadsApi.js';

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
    // スケジュール取得
    const { data: due, error: err1 } = await supabase
      .from('schedules')
      .select('id, account_id, mode, interval_minutes, next_run')
      .lte('next_run', new Date().toISOString())
      .eq('active', true)
      .limit(10);
    if (err1) throw err1;

    const results = [];

    for (const sch of due || []) {
      // アカウント取得
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

      // 投稿本文とメディアを決定
      const mode = (sch.mode || 'TEMPLATE').toUpperCase();
      let text = '';
      let mediaUrls = []; // ←ここを複数対応

      if (mode === 'TEMPLATE' || mode === 'MIX' || mode === 'AI') {
        // --- pick_next_template 呼び出し ---
        const rpcUrl = process.env.SUPABASE_URL + '/rest/v1/rpc/pick_next_template';
        const rpcRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: process.env.SUPABASE_SERVICE_ROLE,
            Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE,
          },
          body: JSON.stringify({ _account_id: acct.id }),
        });
        if (!rpcRes.ok)
          throw new Error('pick_next_template failed: ' + (await rpcRes.text()));

        const templateId = await rpcRes.json();

        // テンプレート取得
        const tRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/templates?id=eq.${templateId}`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE,
              Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE,
            },
          }
        );
        const [tpl] = await tRes.json();

        if (!tpl) {
          text = '（テンプレートが見つかりません）';
          mediaUrls = [];
        } else {
          text = tpl.body || '（本文なし）';

          // --- 複数URL対応: カンマ・改行・スペースで分割 ---
          if (tpl.media_url) {
            mediaUrls = tpl.media_url
              .split(/[\n, ]+/)
              .map((u) => u.trim())
              .filter((u) => u.length > 0);
          }
        }

        // AIモードの場合（任意）
        if (mode !== 'TEMPLATE' && process.env.OPENAI_API_KEY) {
          try {
            const prompt = `次の内容を参考に、Threads向けに自然で短めの日本語ポストを1つ生成してください。禁止: 個人情報、誹謗中傷、差別。\n\n参考:\n${text}\n`;
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: 'You are a concise Japanese copywriter for social media.',
                  },
                  { role: 'user', content: prompt },
                ],
                temperature: 0.7,
                max_tokens: 120,
              }),
            });
            const json = await resp.json();
            const ai = json?.choices?.[0]?.message?.content?.trim();
            if (ai) text = ai;
          } catch (e) {
            console.warn('[AI generate skipped]', e?.message);
          }
        }
      }

      // 投稿処理
      let postResult = null;
      if (!dryRun) {
        try {
          if (mediaUrls.length > 0) {
            // --- 複数画像を順にアップして、最後をpublish ---
            let lastContainer = null;
            for (const [i, url] of mediaUrls.entries()) {
              const cont = await createImageContainer({
                accessToken: acct.access_token,
                text: i === 0 ? text : '', // 最初のみに本文
                imageUrl: url,
              });
              lastContainer = cont;
            }

            if (lastContainer) {
              const pub = await publish({
                accessToken: acct.access_token,
                creationId: lastContainer.id,
              });
              postResult = { published: pub };
            }
          } else {
            // テキストのみ
            const r = await createTextAndMaybePublish({
              accessToken: acct.access_token,
              text,
            });
            postResult = r;
          }
        } catch (e) {
          await supabase.from('logs').insert({
            account_id: acct.id,
            action: 'POST',
            payload: { text, mediaUrls, schedule_id: sch.id },
            result: { error: e?.message || String(e) },
            ok: false,
          });
          results.push({
            schedule: sch.id,
            ok: false,
            error: e?.message || String(e),
          });
          await supabase
            .from('schedules')
            .update({
              last_run: new Date().toISOString(),
              next_run: new Date(
                Date.now() + sch.interval_minutes * 60 * 1000
              ).toISOString(),
            })
            .eq('id', sch.id);
          continue;
        }
      }

      // 成功ログ
      await supabase.from('logs').insert({
        account_id: acct.id,
        action: 'POST',
        payload: { text, mediaUrls, schedule_id: sch.id },
        result: postResult || { dry: true },
        ok: true,
      });

      // 次回時刻更新
      await supabase
        .from('schedules')
        .update({
          last_run: new Date().toISOString(),
          next_run: new Date(
            Date.now() + sch.interval_minutes * 60 * 1000
          ).toISOString(),
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
