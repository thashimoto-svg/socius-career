This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Port 3000, and nothing else

`dev` and `start` both refuse to run on any other port.

That is deliberate. Google sign-in only works from a hostname listed in Firebase
Auth's 承認済みドメイン, and the listed hostname ends in `-3000`. Next's dev
server, left alone, treats a busy port as something to route around — it retries
up to ten times and carries on with a warning. So a forgotten server from
yesterday is enough to land you on 3001, where the app looks completely normal
until you press サインイン and get `auth/unauthorized-domain`: an error whose text
is about domains and whose cause is a stale process.

A warning that scrolls past is not a guard, so `npm run dev` now stops instead:

```
❌ ポート 3000 は既に使われています。
```

Clear it and try again:

```bash
npm run stop     # SIGTERM to whatever is listening on 3000
npm run dev
```

`npm run stop` sends SIGTERM rather than SIGKILL, so the dev server gets to
flush `.next/dev` — a cache killed mid-write reads as a compile bug tomorrow.

If you are on a **new Codespace**, its hostname is new too, and no amount of
port discipline will help until you add it. Firebase Console → Authentication →
Settings → 承認済みドメイン, and paste the host the login screen now prints in
its own error message. Wildcards are not supported; it has to be the exact host.

Because both scripts want 3000, the dev server and a production build cannot run
at the same time. `npm run stop` between them.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy

This app ships to **Firebase App Hosting**, not Vercel. See [`docs/deploy.md`](../../docs/deploy.md)
for the one-time setup and the day-to-day `firebase deploy --only apphosting`.
