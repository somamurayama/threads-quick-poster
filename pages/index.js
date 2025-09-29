// pages/index.js
import { useEffect, useState } from "react";

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [text, setText] = useState("Hello from API 🎉");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState("");

  useEffect(() => {
    // 認可成功後は /?connected=1 に戻るようにしてある
    const params = new URLSearchParams(window.location.search);
    setConnected(params.get("connected") === "1");
  }, []);

  const startOAuth = () => {
    // サーバーの OAuth 開始ルートへ
    window.location.href = "/api/auth/threads/start";
  };

  const postNow = async () => {
    setLoading(true);
    setLog("投稿中…");
    try {
      const res = await fetch("/api/threads/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          imageUrl: imageUrl.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || res.statusText);
      setLog("✅ 成功: " + JSON.stringify(json, null, 2));
    } catch (e) {
      setLog("❌ 失敗: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: 24,
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Helvetica, Arial",
      }}
    >
      <h1>Threads Quick Poster</h1>

      <section
        style={{
          width: "min(720px, 100%)",
          display: "grid",
          gap: 12,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
        }}
      >
        <div>
          <button
            onClick={startOAuth}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              cursor: "pointer",
              background: connected ? "#f0fdf4" : "#f8fafc",
            }}
          >
            {connected ? "✅ Threads 連携済み（再連携）" : "Threads 連携をはじめる"}
          </button>
          <p style={{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
            先に「連携」を押して認可してください（テスター承認済みが前提）。
          </p>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span>本文テキスト</span>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="投稿本文"
            style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>画像URL（任意・公開URL）</span>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/sample.jpg（空ならテキストのみ）"
            style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
        </label>

        <button
          onClick={postNow}
          disabled={loading}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            cursor: "pointer",
            background: loading ? "#e5e7eb" : "#eef2ff",
            fontWeight: 600,
          }}
        >
          {loading ? "投稿中…" : "テキスト投稿テスト（画像URLを入れると画像付き）"}
        </button>

        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            background: "#0a0a0a",
            color: "#e5e7eb",
            padding: 12,
            borderRadius: 10,
            fontSize: 12,
          }}
        >
{log || "結果はここに表示されます"}
        </pre>
      </section>

      <p style={{ color: "#6b7280", fontSize: 12 }}>
        ヒント: 401→未連携 / 403→権限 or テスター未承認 / 画像エラー→URL公開・形式/サイズ確認
      </p>
    </main>
  );
}
