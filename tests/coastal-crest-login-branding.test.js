const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("login preserves every authentication action inside the Coastal Crest layout", () => {
  const html = read("login.html");
  for (const id of [
    "loginForm", "loginEmail", "loginPassword", "confirmPassword", "loginStatus",
    "createAccountButton", "magicLinkButton", "resetPasswordButton", "clearSessionButton",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /coastal-crest-mark\.png/);
  assert.match(html, /COASTAL CREST/);
  assert.match(html, /TEAM WORKSPACE/);
  assert.match(html, /The workday starts here/);
});

test("verified entry is one-time, personalized, skippable, and reduced-motion aware", () => {
  const html = read("index.html");
  const app = read("app.js");
  assert.match(html, /id="signInWelcomeName"/);
  assert.match(html, /id="signInWelcomeEmail"/);
  assert.match(html, /id="signInOpenDashboard"/);
  assert.match(html, /Verifying your access/);
  assert.match(html, /Syncing leads and jobs/);
  assert.match(html, /Loading today's schedule/);
  assert.match(html, /Preparing your dashboard/);
  assert.match(app, /sessionStorage\.removeItem\(SIGN_IN_UNLOCK_KEY\)/);
  assert.match(app, /authSession\?\.user\?\.email/);
  assert.match(app, /Promise\.race/);
  assert.match(app, /prefers-reduced-motion: reduce/);
});

test("brand asset is public and the experience is responsive", () => {
  const server = read("server.js");
  const worker = read("sw.js");
  const css = read("styles.css");
  assert.ok(fs.statSync(path.join(root, "coastal-crest-mark.png")).size > 10000);
  assert.match(server, /coastal-crest-mark\.png/);
  assert.match(worker, /coastal-crest-mark\.png/);
  assert.match(css, /--auth-rose:\s*#d89799/);
  assert.match(css, /\.brand-entry\.is-active \.brand-entry-mark/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
