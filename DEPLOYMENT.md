# PickleJ — Deployment & Versioning Guide

## Version Management

The app version lives in **two places** — both must be updated together:

1. `package.json` → `"version"` field
2. `src/components/Header.tsx` → `APP_VERSION` constant (displayed in the UI)

When bumping the version:

```bash
# 1. Update both files
# package.json:  "version": "1.4.0"
# Header.tsx:    const APP_VERSION = "1.4.0";

# 2. Commit and push
git add package.json src/components/Header.tsx
git commit -m "Bump version to 1.4.0"
git push
```

## Deploying to Vercel

The app is hosted on Vercel under the project **picklej**.

**Auto-deploy is currently not triggered by git push.** You need to deploy manually.

### Manual deploy (production)

```bash
vercel --prod
```

This builds and deploys to the production URL: **https://picklej.vercel.app**

### Preview deploy (non-production)

```bash
vercel
```

Creates a preview deployment with a unique URL for testing before going live.

### Check deployment status

```bash
vercel ls
```

Shows recent deployments with their status, age, and URLs.

### Inspect logs for a deployment

```bash
vercel inspect <deployment-url> --logs
```

### Redeploy a previous deployment

```bash
vercel redeploy <deployment-url>
```

## Full Release Checklist

1. Make your code changes
2. Update version in `package.json` and `src/components/Header.tsx`
3. Commit and push to `main`
4. Deploy: `vercel --prod`
5. Verify at https://picklej.vercel.app that the new version appears in the header

## Environment Variables

Environment variables are managed in the Vercel dashboard:
**Settings → Environment Variables**

If you add a new env var, it won't take effect until the next deployment.

## Tech Stack Reference

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Framework   | Next.js 16 (App Router)           |
| Database    | PostgreSQL via Neon (serverless)   |
| ORM         | Prisma 6                          |
| Auth        | NextAuth v5 (JWT)                 |
| Hosting     | Vercel                            |
| Storage     | Vercel Blob (file uploads)        |
