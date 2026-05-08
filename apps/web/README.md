This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Google Calendar OAuth (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/), enable **Google Calendar API** for your project.
2. Configure the **OAuth consent screen** and add scopes `.../auth/calendar.events` and `.../auth/calendar.readonly`.
3. Create an **OAuth 2.0 Client ID** (Web application). Add authorized redirect URI:
   - `${NEXT_PUBLIC_SITE_URL}/api/integrations/google/callback` (e.g. `http://localhost:3000/api/integrations/google/callback` in dev).
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local` (see `.env.example`).
5. Run DB migration `00005_google_calendar.sql` (adds `user_integrations.expires_at` for token refresh).
6. Users connect from **Ajustes** → **Conectar Google Calendar**.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
