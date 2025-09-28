export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Helvetica, Arial'
    }}>
      <h1>Threads Quick Poster（準備中）</h1>
      <p>この画面はプレースホルダーです。次のステップで機能を追加します。</p>
      <ol style={{ maxWidth: 680, lineHeight: 1.7 }}>
        <li>Step 2: API Routes（OAuth, 投稿API）を実装</li>
        <li>Step 3: 日本語UI（/ ページにボタン2つ）を実装</li>
        <li>Step 4: README（Meta設定、Renderデプロイ、動作確認、エラー対処）を追加</li>
      </ol>
    </main>
  );
}
