## What this changes

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## How it was checked

- [ ] `npm run typecheck`
- [ ] `npm run lint` (includes the secret scan)
- [ ] `npm test`
- [ ] `npm run build` and `node scripts/smoke.mjs` against `next start`
- [ ] `npm ci --prefix worker && node --test worker/` (if `worker/` changed)
- [ ] Screenshots for UI changes, light and dark

## Checklist

- [ ] New behavior is behind a feature flag (`flagOn` / `useFlag`)
- [ ] Database changes are a new numbered, re-runnable migration with row level security
- [ ] No secrets, real user data, internal hostnames or IP addresses
- [ ] Docs updated (README, `.env.example`, `ops/` READMEs) if settings or setup changed
