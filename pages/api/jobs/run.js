// pages/api/jobs/run.js
// 自動投稿ジョブの入口。
// 使い方: https://<あなたのURL>/api/jobs/run?key=YOUR_SECRET[&dry=1]
// - key で簡易認証
// - dry=1 なら投稿せず計画と結果だけ返す
import { supabase } from '../../../lib/db.js';
import { createTextAndMaybePublish, createImageContainer, publish } from '../../../lib/threadsApi.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { JOBS_SECRET } = process.env;
  const key = req.query.key || req.headers['x-jobs-key'];
  if (!JOBS_SECRET || key !== JOBS_SECRET) {
    return res.status(401).json({ error: 'unauthorized: set ?key=JOBS_SECRET or x-jobs-key header' });
  }

  const dryRun = String(req.query.dry || '') === '1';

  try {
    // due schedules を取得（next_run <= now, active=true）
    const { data: due, error: err1 } = await supabase
      .from('schedules')
      .select('id, account_id, mode, interval_minutes, next_run')
      .lte('next_run', new Date().toISOString())
      .eq('active', true)
      .limit(10);
    if (err1) throw err1;

    const results = [];

    for (const sch of due || []) {
      // アカウントを取得
      const { data: acct, error: err2 } = await supabase
        .from('accounts')
        .select('id, threads_user_id, access_token, proxy_url, enabled')
        .eq('id', sch.account_id)
        .eq('enabled', true)
        .maybeSingle();
      if (err2) throw err2;
      if (!acct) {
        results.push({ schedule: sch.id, ok: false, reason: 'account_not_found_or_disabled' });
        continue;
      }

      // 投稿本文とメディアを決める（まずは TEMPLATE 優先。AIは後で）
      const mode = (sch.mode || 'TEMPLATE').toUpperCase();
      let text = '';
      let mediaUrl = '';

      if (mode === 'TEMPLATE' || mode === 'MIX' || mode === 'AI') {
        if (mode === 'TEMPLATE' || mode === 'MIX' || mode === 'AI') {
  // --- pick_next_template 関数を呼び出して、未使用テンプレを取得する ---
  const rpcUrl = process.env.SUPABASE_URL + '/rest/v1/rpc/pick_next_template';
  const rpcRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_ROLE,
      'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE,
    },
    body: JSON.stringify({ _account_id: acct.id }),
  });
  if (!rpcRes.ok) throw new Error('pick_next_template failed: ' + (await rpcRes.text()));

  const templateId = await rpcRes.json();

  // テンプレート本体を取得
  const tRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/templates?id=eq.${templateId}`,
    {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE,
      },
    }
  );
  const [tpl] = await tRes.json();

  if (!tpl) {
    text = '（テンプレートが見つかりません）';
    mediaUrl = '';
  } else {
    text = tpl.body || '（本文なし）';
    mediaUrl = tpl.media_url || '';
  }
}


        // AIモードが指定されており OPENAI_API_KEY がある場合は、上書き生成（任意）
        if (mode !== 'TEMPLATE' && process.env.OPENAI_API_KEY) {
          try {
            const prompt = `次の内容を参考に、Threads向けに自然で短めの日本語ポストを1つ生成してください。禁止: 個人情報、誹謗中傷、差別。:\n\n参考:\n${text}\n`;
            // 依存を増やさないため fetch で直接叩く（gpt-4o-mini を想定）
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                  { role: 'system', content: 'You are a concise Japanese copywriter for social media.' },
                  { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 120
              })
            });
            const json = await resp.json();
            const ai = json?.choices?.[0]?.message?.content?.trim();
            if (ai) text = ai;
          } catch (e) {
            // 失敗時はテンプレ文のまま
            console.warn('[AI generate skipped]', e?.message);
          }
        }
      }

      let postResult = null;
      if (!dryRun) {
        try {
          if (mediaUrl) {
            // 画像/動画URLがある場合：コンテナ作成→publish
            const cont = await createImageContainer({ accessToken: acct.access_token, text, imageUrl: mediaUrl });
            const pub = await publish({ accessToken: acct.access_token, creationId: cont.id });
            postResult = { container: cont, published: pub };
          } else {
            // テキストのみ：auto_publish_text=true
            const r = await createTextAndMaybePublish({ accessToken: acct.access_token, text });
            postResult = r;
          }
        } catch (e) {
          // 失敗もログに書く
          await supabase.from('logs').insert({
            account_id: acct.id,
            action: 'POST',
            payload: { text, mediaUrl, schedule_id: sch.id },
            result: { error: e?.message || String(e) },
            ok: false
          });
          results.push({ schedule: sch.id, ok: false, error: e?.message || String(e) });
          // 次のスケジュールだけ更新して継続
          await supabase
            .from('schedules')
            .update({
              last_run: new Date().toISOString(),
              next_run: new Date(Date.now() + sch.interval_minutes * 60 * 1000).toISOString()
            })
            .eq('id', sch.id);
          continue;
        }
      }

      // 成功ログ
      await supabase.from('logs').insert({
        account_id: acct.id,
        action: 'POST',
        payload: { text, mediaUrl, schedule_id: sch.id },
        result: postResult || { dry: true },
        ok: true
      });

      // 次回実行時刻を更新
      await supabase
        .from('schedules')
        .update({
          last_run: new Date().toISOString(),
          next_run: new Date(Date.now() + sch.interval_minutes * 60 * 1000).toISOString()
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
