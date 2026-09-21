/* Local authenticated test server. Never loads production environment files. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, '.env.staging.local');
const config = Object.fromEntries(fs.readFileSync(configPath, 'utf8').split(/\r?\n/)
  .filter(line => line.trim() && !line.trim().startsWith('#'))
  .map(line => { const i = line.indexOf('='); if (i < 1) throw Error('Invalid staging config'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
const stagingOrigin = 'https://ixksmfiektzsunmmwejz.supabase.co';
if (config.SUPABASE_URL !== stagingOrigin || !config.SUPABASE_ANON_KEY?.startsWith('sb_publishable_')) {
  throw Error('Only the approved staging project and its public publishable key are permitted.');
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(SUPABASE|NEXT_PUBLIC_SUPABASE|SQUARE|AUTH_|CRM_|ADMIN_|OWNER_|ALLOWED_|DEFAULT_AUTH|ALLOW_LOCAL_DEMO)/i.test(key)));
Object.assign(env, {
  NODE_ENV: 'development', CRM_SKIP_ENV_FILES: 'true', CRM_STAGING_ACCESS: 'true',
  AUTH_REQUIRED: 'true', ALLOW_LOCAL_DEMO: 'false', SUPABASE_SYNC_ENABLED: 'true',
  SUPABASE_URL: stagingOrigin, SUPABASE_ANON_KEY: config.SUPABASE_ANON_KEY,
  SUPABASE_STATE_ID: 'coastal-crest', ALLOWED_EMAIL_DOMAIN: 'coastalcrestroofing.com',
  DEFAULT_AUTH_ROLE: 'viewer', ADMIN_EMAILS: 'gil@coastalcrestroofing.com,devon@coastalcrestroofing.com',
  CRM_STAGING_TEST_EMAIL: config.CRM_STAGING_TEST_EMAIL, CRM_STAGING_TEST_USER_ID: config.CRM_STAGING_TEST_USER_ID,
  PORT: '4176',
});
const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
