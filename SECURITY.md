# Security

## Reporting a problem

If you find a security problem in sloptube, please do not open a public issue.
Report it privately through GitHub instead:

1. Go to the [Security tab](https://github.com/myfilehero/sloptube/security) of the repository.
2. Click **Report a vulnerability** and describe what you found and how to reproduce it.

You should get a reply within a few days. Once it is fixed, the fix and a short
note go into the repository.

Please do not include working keys or other people's personal data in the
report. If you found a leaked key, say where it is and we will rotate it.

## Supported versions

Only the latest commit on `main` gets fixes. If you run your own copy, keep it
up to date and keep your Supabase secret key and R2 keys out of the repository
(see `.env.example`).

## Scope

- The code in this repository and the way it uses Supabase (row level security,
  database functions, storage policies).
- Leaked keys or personal data in the repository history.

## Bounty

There is no bug bounty yet. Credit in the fix commit is offered if you want it.
