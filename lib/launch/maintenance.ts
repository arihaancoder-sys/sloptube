// Maintenance mode (feature 15). proxy.ts answers every page with this one
// static page (status 503) while the maintenance flag is on, except for
// admins, and every API route with { error: "maintenance" }. No database, no
// React: it works even when the rest of the site does not. No imports, so the mark
// below is a copy of lib/brand.ts (tests/brand.test.mjs keeps them in step).

/** Paths that still work during maintenance, so an admin can sign in and check the site. */
export function maintenanceOpen(path: string): boolean {
  return (
    path === "/login" ||
    path === "/signup" ||
    path.startsWith("/auth/") ||
    path === "/robots.txt" ||
    path === "/api/health" ||
    path === "/api/version"
  );
}

/** How long browsers and crawlers are asked to wait before trying again, in seconds. */
export const RETRY_AFTER_S = 600;

/** How long proxy.ts keeps the maintenance flag before reading it again, in milliseconds. */
export const FLAG_TTL_MS = 15_000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The whole page: the logo, one line, one grey line, the 2019 look in light or dark like the rest of the site. */
export function maintenanceHtml(siteName = "sloptube"): string {
  const name = escapeHtml(siteName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Back soon | ${name}</title>
<script>try{if(localStorage.getItem("sloptube-theme")==="dark")document.documentElement.className="dark"}catch(e){}</script>
<style>
:root{--page:#f9f9f9;--text:#030303;--text-2:#606060;--word:#15803d;--card:#ffffff;--line:#e5e5e5}
.dark{--word:#4ade80;--page:#181818;--text:#ffffff;--text-2:#aaaaaa;--card:#202020;--line:#383838}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--page);color:var(--text);font-family:Roboto,Arial,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center}
.logo{display:flex;align-items:center;gap:4px;margin-bottom:32px}
.logo span{font-size:24px;font-weight:700;letter-spacing:-1px;color:var(--word)}
.card{max-width:480px;background:var(--card);border:1px solid var(--line);border-radius:2px;padding:32px 24px}
h1{margin:0;font-size:20px;font-weight:400;line-height:28px}
p{margin:8px 0 0;font-size:14px;line-height:20px;color:var(--text-2)}
</style>
</head>
<body>
<main data-error-state="maintenance">
<div class="logo" aria-label="${name}"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2a8.5 8.5 0 0 1 4.8 15.5V20a1.2 1.2 0 0 1-2.4 0v-1.6a8.5 8.5 0 0 1-4.6.3v1.7a1.6 1.6 0 0 1-3.2 0v-2.9A8.5 8.5 0 0 1 12 2z" fill="#16a34a"/><path d="M6.9 10.6c1.3-1.8 2.5-1.8 3.8 0s2.5 1.8 3.8 0 2.5-1.8 3.8 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg><span>${name}</span></div>
<div class="card">
<h1>We're doing some maintenance.</h1>
<p>${name} will be back in a few minutes. Thanks for your patience.</p>
</div>
</main>
</body>
</html>
`;
}
