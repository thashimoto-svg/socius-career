 # Socius Career

就活生向け、対話型の自己分析アプリ。

## 開発

```bash
npm install --prefix apps/web
npm run dev            # http://localhost:3000
```

**3000 番以外では起動しません。** Google サインインは Firebase Auth の承認済み
ドメインに登録されたホスト名からしか通らず、登録されているのは `-3000` で終わる
ものだからです。Next の dev サーバーは既定では使用中のポートを避けて 3001 に
逃げるので、そのままでは昨日の消し忘れが一つあるだけで、見た目は正常なのに
サインインだけが `auth/unauthorized-domain` で失敗する状態になります。

塞がっていたら、逃げずに止まります。古いプロセスを落としてから、もう一度:

```bash
npm run stop           # 3000 番を掴んでいるプロセスに SIGTERM
npm run dev
```

新しい Codespace ではホスト名も新しくなります。ログイン画面がエラーに表示する
ホスト名を、Firebase Console → Authentication → Settings → 承認済みドメイン に
そのまま貼り付けてください(ワイルドカードは使えません)。

詳細は [apps/web/README.md](apps/web/README.md)。デプロイは
[docs/deploy.md](docs/deploy.md)。
