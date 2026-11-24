// Release workflow test: two people, one estimate (to-do item 2).
//
// Starts the local test copy of the CRM and drives two real browser sessions,
// a sales rep and an admin, signed in at the same time:
//
//   1. the rep creates an estimate and types four lines quickly;
//   2. the rep's connection is cut part-way through and comes back;
//   3. the rep saves, attaches a file to the job, and reloads the page;
//   4. the admin, in a separate session, reopens the same job's estimate.
//
// It passes only if the admin sees the same four lines, prices and total on
// the correct job, the PDF the admin downloads says the same, and the attached
// file comes back byte for byte. "Save showed a green message" is not the test.
//
// Run:  npm run test:workflow
// Needs Chrome or Edge on this computer (or CHROME_PATH pointing at one), and
// Node 22 or newer. It talks to nothing but localhost, and every record in it
// is made up.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const localCloud = require('./local-cloud.js');

const PORTS = { appPort: 4520, cloudPort: 4521, staticPort: 4522 };
const LINES = [
  { title: 'TEST Tear off existing shingles', description: 'Two layers, haul away', quantity: '24', unit: 'sq', rate: '85' },
  { title: 'TEST Install architectural shingles', description: 'Synthetic underlayment included', quantity: '24', unit: 'sq', rate: '310.50' },
  { title: 'TEST Replace damaged decking', description: 'Per sheet, as found', quantity: '6', unit: 'sheet', rate: '95.25' },
  { title: 'TEST Permit and disposal', description: 'County permit and dumpster', quantity: '1', unit: 'ea', rate: '650' },
];
// 24 x 85 + 24 x 310.50 + 6 x 95.25 + 650
const EXPECTED_SUBTOTAL = 10713.5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const steps = [];
function step(text) { steps.push(text); console.log(`  ok  ${text}`); }
function check(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// ------------------------------------------------------------------ browser
function findBrowser() {
  const candidates = [process.env.CHROME_PATH];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const found = spawnSync('which', [name], { encoding: 'utf8' });
      if (found.status === 0) candidates.push(found.stdout.trim());
    }
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

async function launchBrowser() {
  if (typeof WebSocket !== 'function') throw new Error(`This test needs Node 22 or newer. This is Node ${process.versions.node}.`);
  const executable = findBrowser();
  if (!executable) throw new Error('No Chrome or Edge was found. Install one, or set CHROME_PATH to its program file.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-workflow-browser-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--window-size=1440,1000', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`The browser did not start in time.\n${output.slice(-600)}`)), 30000);
    child.stderr.on('data', (chunk) => {
      output += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The browser closed while starting (code ${code}).\n${output.slice(-600)}`)); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Could not connect to the browser.')), { once: true }); });
  let nextId = 0;
  const waiting = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject, method } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`)); else resolve(message.result);
      return;
    }
    listeners.forEach((listener) => listener(message));
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    nextId += 1;
    waiting.set(nextId, { resolve, reject, method });
    socket.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  // One person: their own browser context, so their sign-in is theirs alone.
  async function person(name) {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), `jobcrest-workflow-${name}-`));
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Network.enable', {}, sessionId);
    await send('DOM.enable', {}, sessionId);
    await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', browserContextId, downloadPath: downloads, eventsEnabled: true });
    const consoleErrors = [];
    const finishedDownloads = [];
    listeners.add((message) => {
      if (message.method === 'Browser.downloadProgress' && message.params.state === 'completed') finishedDownloads.push(path.join(downloads, message.params.guid));
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'page error');
      // Nobody is there to answer a "Leave site?" question; say yes so the test cannot hang on one.
      if (message.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {});
    });
    // Runs code in the page. Pass a function and JSON-able arguments.
    async function run(pageFunction, ...args) {
      const expression = `(${pageFunction.toString()})(...${JSON.stringify(args)})`;
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
      if (result.exceptionDetails) throw new Error(`${name}'s page: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
      return result.result.value;
    }
    async function waitFor(pageFunction, { timeout = 30000, message = 'condition', args = [] } = {}) {
      const started = Date.now();
      let last;
      while (Date.now() - started < timeout) {
        try { last = await run(pageFunction, ...args); if (last) return last; } catch (error) { last = error.message; }
        await sleep(200);
      }
      throw new Error(`${name}: timed out waiting for ${message}${last ? ` (last: ${JSON.stringify(last).slice(0, 300)})` : ''}`);
    }
    return {
      name, run, waitFor, consoleErrors, finishedDownloads,
      async open(url) {
        await send('Page.navigate', { url }, sessionId);
        await waitFor(() => document.readyState === 'complete', { message: 'the page to load' });
      },
      async reload() {
        await send('Page.reload', { ignoreCache: true }, sessionId);
        await sleep(300);
        await waitFor(() => document.readyState === 'complete', { message: 'the page to reload' });
      },
      setOffline: (offline) => send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId),
      async chooseFiles(selector, files) {
        const { root } = await send('DOM.getDocument', { depth: 0 }, sessionId);
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }, sessionId);
        if (!nodeId) throw new Error(`${name}: ${selector} is not on the page`);
        await send('DOM.setFileInputFiles', { files, nodeId }, sessionId);
      },
      async screenshot(file) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        return file;
      },
    };
  }

  return {
    executable, person,
    async close() {
      try { await send('Browser.close'); } catch { /* already closing */ }
      await sleep(300);
      child.kill();
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold a file for a moment */ }
    },
  };
}

// ------------------------------------------------------------ CRM helpers
async function signIn(person, copy, role) {
  const account = copy.accounts.find((item) => item.role === role);
  await person.open(`${copy.appUrl}/login`);
  await person.waitFor(() => Boolean(document.getElementById('loginEmail')), { message: 'the sign-in form' });
  await person.run((email, password) => {
    const set = (id, value) => { const field = document.getElementById(id); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); };
    set('loginEmail', email);
    set('loginPassword', password);
    document.getElementById('loginEmail').form.requestSubmit();
  }, account.email, account.password);
  await appReady(person);
  check(await person.run(() => currentRole()) === (role === 'sales' ? 'sales' : 'admin'), `${person.name} is signed in with the wrong role`);
}

// Signed in, every record loaded, nothing waiting to be saved.
async function appReady(person) {
  await person.waitFor(() => location.pathname === '/' && window.JobCrestApp?.ready === true && typeof coreRecordsArePartial === 'function'
    && !coreRecordsArePartial() && !durableSaveInFlight && !hasPendingDurableChanges(), { timeout: 60000, message: 'the CRM to finish loading' });
}

async function settled(person, message = 'the save to finish') {
  await person.waitFor(() => !durableSaveInFlight && !hasPendingDurableChanges() && !document.querySelector('.estimate-save-status[data-tone="saving"]'), { timeout: 45000, message });
}

const readEstimate = (person, estimateId) => person.run((id) => {
  const estimate = state.estimates.find((item) => item.id === id);
  if (!estimate) return null;
  const totals = totalsFor(estimate);
  return {
    contactId: estimate.contactId, jobId: estimate.jobId, estimateNumber: estimate.estimateNumber,
    lines: estimate.items.map((item) => ({ title: item.title, description: item.description, quantity: String(number(item.quantity)), unit: item.unit, rate: String(number(item.rate)) })),
    subtotal: totals.subtotal, total: totals.total, totalText: money.format(totals.total),
  };
}, estimateId);

const normalLines = (lines) => lines.map((line) => ({ ...line, quantity: String(Number(line.quantity)), rate: String(Number(line.rate)) }));

// A made-up photo: a real PNG, grainy so that it is a realistic size on disk.
function testPhoto(width, height, seed) {
  const zlib = require('node:zlib');
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let noise = (seed * 2654435761) >>> 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
      const grain = noise >>> 26;
      const offset = row + 1 + x * 3;
      raw[offset] = Math.min(255, 60 + (x * 150) / width + grain + seed * 12);
      raw[offset + 1] = Math.min(255, 70 + (y * 130) / height + grain);
      raw[offset + 2] = Math.min(255, 90 + grain + ((x + y) % 97));
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 });
  const document = await task.promise;
  let text = '';
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    text += ` ${content.items.map((item) => item.str).join(' ')}`;
  }
  await task.destroy();
  return text.replace(/\s+/g, ' ');
}

// --------------------------------------------------------------------- run
async function main() {
  console.log('Release workflow test: two people, one estimate');
  const copy = await localCloud.start({ ...PORTS, quiet: true });
  let browser;
  let rep;
  let admin;
  try {
    browser = await launchBrowser();
    console.log(`  browser: ${path.basename(browser.executable)}`);
    rep = await browser.person('rep');
    admin = await browser.person('admin');
    const repAccount = copy.accounts.find((item) => item.role === 'sales');
    const adminAccount = copy.accounts.find((item) => item.role === 'admin');
    const startedAt = new Date().toISOString();

    // A job of the rep's own that is ready for an estimate.
    const picked = (await copy.query(`select j.id as job_id, j.lead_id from public.crm_records j
      where j.record_type='job' and j.owner_id=$1 and j.data->>'division'='roofing' and j.data->>'status'='Inspection'
        and (select count(*) from public.crm_records x where x.record_type='job' and x.lead_id=j.lead_id)=1 order by j.id limit 1`, [repAccount.id])).rows[0];
    check(picked, 'The test data has no roofing job at Inspection owned by the rep');

    await signIn(rep, copy, 'sales');
    await signIn(admin, copy, 'admin');
    step('a rep and an admin are signed in at the same time, each in their own session');

    // ---- 1. The rep starts the estimate and types four lines quickly.
    const estimateId = await rep.run(async (leadId, jobId) => (await createEstimate(leadId, true, jobId))?.id || '', picked.lead_id, picked.job_id);
    check(estimateId, 'The rep could not start an estimate');
    await rep.waitFor(() => document.querySelectorAll('#estimateForm .line-item').length > 0, { message: 'the estimate editor' });
    // The division template adds starter lines; the editor always keeps one.
    await rep.run(async () => {
      for (let guard = 0; guard < 40 && document.querySelectorAll('#estimateForm .line-item').length > 1; guard += 1) {
        document.querySelector('#estimateForm [data-action="remove-line"]').click();
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    });
    const typeLineAs = (person, index, line) => person.run((lineIndex, values) => {
      if (!document.querySelector(`#estimateForm .line-item[data-line-index="${lineIndex}"]`)) document.getElementById('addLineItemButton').click();
      const row = document.querySelector(`#estimateForm .line-item[data-line-index="${lineIndex}"]`);
      if (!row) throw new Error(`line ${lineIndex + 1} did not appear`);
      // No pauses between fields: this is someone typing fast and tabbing on.
      for (const [field, value] of Object.entries(values)) {
        const input = row.querySelector(`[data-line-field="${field}"]`);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, index, line);
    const typeLine = (index, line) => typeLineAs(rep, index, line);
    await typeLine(0, LINES[0]);
    await typeLine(1, LINES[1]);
    step('the rep typed the first two lines');

    // ---- 2. The connection drops while the rep keeps typing, then returns.
    await rep.setOffline(true);
    await typeLine(2, LINES[2]);
    await typeLine(3, LINES[3]);
    await sleep(2500);
    const offline = await rep.run(() => ({ online: navigator.onLine, lines: getSelectedEstimate().items.length }));
    check(offline.online === false && offline.lines === 4, 'The connection was not cut as intended', offline);
    await rep.setOffline(false);
    step('the connection was cut while the rep typed lines three and four, then restored');

    // ---- 3. The rep saves, attaches a file, and reloads.
    await rep.run(() => document.getElementById('saveEstimateButton').click());
    await settled(rep, 'the estimate to be saved');
    const repSaved = await readEstimate(rep, estimateId);
    check(repSaved && repSaved.lines.length === 4, 'The rep does not have four lines after saving', repSaved);

    const attachment = path.join(os.tmpdir(), `jobcrest-workflow-attachment-${Date.now()}.txt`);
    const attachmentBytes = Buffer.from(`TEST attachment for the release workflow test\n${crypto.randomBytes(24).toString('hex')}\n`);
    fs.writeFileSync(attachment, attachmentBytes);
    const attachmentHash = crypto.createHash('sha256').update(attachmentBytes).digest('hex');
    await rep.run((leadId, jobId) => openLeadDetail(leadId, 'documents', jobId), picked.lead_id, picked.job_id);
    await rep.waitFor(() => Boolean(document.getElementById('leadDocumentInput')), { message: 'the documents tab' });
    // The tab is drawn again once the lead's documents have loaded. A person
    // takes seconds to pick a file; the test must not pick one mid-redraw.
    await rep.run(async (leadId) => { await durableHeavyLeadLoads.get(leadId); await new Promise((resolve) => setTimeout(resolve, 150)); }, picked.lead_id);
    await rep.waitFor(() => Boolean(document.getElementById('leadDocumentInput')), { message: 'the documents tab after its documents loaded' });
    await rep.chooseFiles('#leadDocumentInput', [attachment]);
    const attachmentName = path.basename(attachment);
    await rep.waitFor((leadId, name) => (state.contacts.find((item) => item.id === leadId)?.documents || []).some((file) => file.name === name && file.storagePath),
      { timeout: 45000, message: 'the attachment to upload', args: [picked.lead_id, attachmentName] });
    await settled(rep, 'the attachment record to be saved');
    step('the rep saved the estimate and attached a file to the job');

    await rep.reload();
    await appReady(rep);
    const repAfterReload = await readEstimate(rep, estimateId);
    check(repAfterReload, 'After a reload the rep no longer has the estimate');
    check(JSON.stringify(repAfterReload.lines) === JSON.stringify(normalLines(LINES)), 'After a reload the rep sees different lines', repAfterReload.lines);
    step('after reloading, the rep still has the same four lines');

    // ---- 4. The admin, separately, reopens the same job's estimate.
    await admin.reload();
    await appReady(admin);
    const adminSees = await readEstimate(admin, estimateId);
    check(adminSees, 'The admin cannot find the estimate the rep saved');
    check(adminSees.contactId === picked.lead_id && adminSees.jobId === picked.job_id, 'The estimate is not on the job it was written for', adminSees);
    check(JSON.stringify(adminSees.lines) === JSON.stringify(normalLines(LINES)), 'The admin sees different lines from the ones the rep typed', adminSees.lines);
    check(adminSees.subtotal === EXPECTED_SUBTOTAL, `The admin's subtotal is ${adminSees.subtotal}, not ${EXPECTED_SUBTOTAL}`);
    check(adminSees.total === repAfterReload.total && adminSees.estimateNumber === repAfterReload.estimateNumber, 'The admin and the rep disagree on the total or the estimate number', { admin: adminSees.total, rep: repAfterReload.total });
    step(`the admin sees the same four lines, prices and total (${adminSees.totalText}) on the correct job`);

    // What is on the admin's screen, not only what is in memory.
    await admin.run((id) => { const estimate = state.estimates.find((item) => item.id === id); openExistingEstimate(estimate, estimate.contactId, true); }, estimateId);
    const onScreen = await admin.waitFor(() => {
      const rows = [...document.querySelectorAll('#estimateForm .line-item')];
      return rows.length ? rows.map((row) => Object.fromEntries(['title', 'description', 'quantity', 'unit', 'rate'].map((field) => [field, row.querySelector(`[data-line-field="${field}"]`).value]))) : null;
    }, { message: 'the estimate editor on the admin\'s screen' });
    check(JSON.stringify(normalLines(onScreen)) === JSON.stringify(normalLines(LINES)), 'The admin\'s estimate editor shows different lines', onScreen);

    // The database itself.
    const stored = (await copy.query("select lead_id, job_id, data from public.crm_records where record_type='estimate' and id=$1 and deleted_at is null", [estimateId])).rows[0];
    check(stored && stored.lead_id === picked.lead_id && stored.job_id === picked.job_id, 'The database holds the estimate under a different lead or job', stored && { lead: stored.lead_id, job: stored.job_id });
    check(stored.data.items.length === 4 && stored.data.items.every((item, index) => item.title === LINES[index].title && Number(item.rate) === Number(LINES[index].rate) && Number(item.quantity) === Number(LINES[index].quantity)),
      'The database holds different lines', stored.data.items);
    step('the database holds the same four lines under the same lead and job');

    // ---- The PDF the admin downloads.
    await admin.run(() => { void downloadEstimatePdf(); });
    const started = Date.now();
    while (!admin.finishedDownloads.length && Date.now() - started < 45000) await sleep(250);
    check(admin.finishedDownloads.length, 'The admin\'s PDF did not download');
    const pdf = admin.finishedDownloads.at(-1);
    check(fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-', 'The downloaded file is not a PDF');
    const text = await pdfText(pdf);
    for (const line of LINES) check(text.includes(line.title), `The PDF is missing the line "${line.title}"`, text.slice(0, 400));
    check(text.includes(adminSees.totalText), `The PDF does not show the total ${adminSees.totalText}`, text.slice(-400));
    step(`the PDF the admin downloaded lists the same four lines and the total ${adminSees.totalText}`);

    // ---- The attachment.
    await admin.run((leadId, jobId) => openLeadDetail(leadId, 'documents', jobId), picked.lead_id, picked.job_id);
    const file = await admin.waitFor((leadId, name) => (state.contacts.find((item) => item.id === leadId)?.documents || []).find((item) => item.name === name && item.storagePath) || null,
      { timeout: 30000, message: 'the attachment on the admin\'s side', args: [picked.lead_id, attachmentName] });
    check(file.jobId === picked.job_id, 'The attachment is filed under a different job', { jobId: file.jobId });
    const downloadedHash = await admin.run(async (storagePath) => {
      const { data, error } = await cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET).createSignedUrl(storagePath, 300);
      if (error) throw new Error(error.message);
      const bytes = await (await fetch(data.signedUrl)).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }, file.storagePath);
    check(downloadedHash === attachmentHash, 'The file the admin opened is not the file the rep attached');
    step('the admin opened the attachment and it is the same file, byte for byte');

    // ---- The admin only looked. Downloading a PDF that is already filed
    // under the lead must not file a second copy of it, and nothing may be
    // saved in the admin's name: a save by someone who is only looking can
    // collide with the person who is really editing.
    for (const person of [rep, admin]) await settled(person, `${person.name}'s page to finish saving`);
    const filedPdfs = (await copy.query("select id, data->>'versionNumber' as version, data->>'uploadedBy' as filed_by from public.crm_records where record_type='document' and deleted_at is null and data->>'estimateId'=$1", [estimateId])).rows;
    check(filedPdfs.length === 1 && Number(filedPdfs[0].version) === 1, 'The estimate should have exactly one filed PDF, in its first version', filedPdfs);
    const savedByAdmin = (await copy.query('select record_type, id, version from public.crm_records where updated_by = $1 and updated_at > $2::timestamptz', [adminAccount.id, startedAt])).rows;
    check(savedByAdmin.length === 0, 'The admin only looked, but records were saved in the admin\'s name', savedByAdmin.slice(0, 5));
    const uploads = copy.state.requests.filter((entry) => entry.method === 'POST' && /\/storage\/v1\/object\/(?!sign\/)/.test(entry.path)).length;
    check(uploads === 2, 'Only the rep\'s PDF and the rep\'s attachment should have been uploaded', { uploads });
    step('the admin\'s viewing and downloading filed no second PDF and saved nothing');

    // ---- Nothing was left unsaved or refused along the way.
    const refusals = copy.state.errors.filter((entry) => !/crm_sales_numbers|realtime/i.test(entry.label));
    check(refusals.length === 0, 'The database refused something during the test', refusals.slice(0, 3));
    for (const person of [rep, admin]) {
      const status = await person.run(() => {
        const projection = durableStateProjection();
        const key = durableRecordKey;
        return { pending: hasPendingDurableChanges(), blocked: durableWriteBlocked, saving: durableSaveInFlight, indicator: document.getElementById('saveIndicator')?.innerText || '',
          changed: projection.rows.filter((row) => durableRecordFingerprints.get(key(row)) !== projection.fingerprints.get(key(row))).map(key).slice(0, 5),
          fields: projection.rows.filter((row) => durableRecordFingerprints.get(key(row)) !== projection.fingerprints.get(key(row))).slice(0, 2).map((row) => {
            const saved = durableFinancialBaseline.get(key(row)) || {};
            return [...new Set([...Object.keys(saved), ...Object.keys(row.data)])].filter((name) => JSON.stringify(saved[name]) !== JSON.stringify(row.data[name]))
              .map((name) => `${name}: ${JSON.stringify(saved[name])?.slice(0, 80)} -> ${JSON.stringify(row.data[name])?.slice(0, 80)}`);
          }),
          removed: [...durableRecordFingerprints.keys()].filter((name) => !projection.currentKeys.has(name)).slice(0, 5),
          history: projection.auditRows.filter((row) => !durableAuditIds.has(row.id)).map((row) => `${row.event_type}: ${row.message}`).slice(0, 5) };
      });
      check(!status.pending && !status.blocked, `${person.name} still has unsaved changes`, status);
      check(person.consoleErrors.length === 0, `${person.name}'s page raised an error`, person.consoleErrors.slice(0, 3));
    }
    step('nothing was left unsaved, and the database refused nothing');
    fs.rmSync(attachment, { force: true });

    // ---- 5. Two people add a line to the same estimate. Neither line may be
    // lost: this is how a rep's line item used to disappear.
    const DRIP = { title: 'TEST Drip edge', description: 'Added by the office', quantity: '180', unit: 'ft', rate: '2.75' };
    const RIDGE = { title: 'TEST Ridge vent', description: 'Added by the rep on site', quantity: '40', unit: 'ft', rate: '9' };
    const GUTTER = { title: 'TEST Gutter apron', description: 'Typed just before the connection died', quantity: '120', unit: 'ft', rate: '3.5' };
    const titlesOf = (...groups) => JSON.stringify(groups.flat().map((line) => line.title));
    const openEditor = async (person) => {
      await person.run((id) => { const estimate = state.estimates.find((item) => item.id === id); state.view = 'estimates'; openExistingEstimate(estimate, estimate.contactId, true); }, estimateId);
      await person.waitFor(() => document.querySelectorAll('#estimateForm .line-item').length >= 4, { message: 'the estimate editor on ' + person.name + "'s screen" });
    };
    const storedItems = async () => (await copy.query("select data->'items' as items from public.crm_records where record_type='estimate' and id=$1", [estimateId])).rows[0].items;
    const storedTitles = async () => JSON.stringify((await storedItems()).map((item) => item.title));
    const refusedBefore = copy.state.errors.length;

    // The rep loses the connection and goes on typing a fifth line.
    await openEditor(rep);
    await rep.setOffline(true);
    await typeLineAs(rep, 4, RIDGE);
    // Meanwhile the office adds a line of its own and saves it.
    await openEditor(admin);
    await typeLineAs(admin, 4, DRIP);
    await admin.run(() => document.getElementById('saveEstimateButton').click());
    await settled(admin, "the office's line to be saved");
    check(await storedTitles() === titlesOf(LINES, DRIP), "The office's line was not saved", await storedTitles());

    // The rep's connection returns and the rep saves, one version behind.
    await rep.setOffline(false);
    await rep.run(() => document.getElementById('saveEstimateButton').click());
    await settled(rep, "the rep's save to be combined with the office's");
    check(copy.state.errors.slice(refusedBefore).some((entry) => /crm_commit_records/.test(entry.label) && entry.status === 409),
      "The rep's first attempt should have been turned away as out of date", copy.state.errors.slice(refusedBefore).map((entry) => entry.label + ' ' + entry.status));
    check(await storedTitles() === titlesOf(LINES, DRIP, RIDGE), "The estimate should hold the four lines, the office's line and the rep's line", await storedTitles());
    const combined = await storedItems();
    check(Number(combined[4].quantity) === 180 && Number(combined[4].rate) === 2.75 && Number(combined[5].quantity) === 40 && Number(combined[5].rate) === 9, 'A combined line lost its numbers', combined.slice(4));
    check(new Set(combined.map((item) => item.id)).size === 6 && combined.every((item) => item.id), 'Every line should have an id of its own', combined.map((item) => item.id));
    const repAfter = await rep.run((id) => ({ blocked: durableWriteBlocked, pending: hasPendingDurableChanges(), status: document.getElementById('estimateSaveStatus')?.textContent || '',
      onScreen: [...document.querySelectorAll('#estimateForm .line-item [data-line-field="title"]')].map((input) => input.value), inMemory: state.estimates.find((item) => item.id === id).items.map((item) => item.title) }), estimateId);
    check(!repAfter.blocked && !repAfter.pending, 'The rep should be left with nothing unsaved and saving not paused', repAfter);
    check(!/not saved/i.test(repAfter.status), 'The rep was told the estimate was not saved, although it was', repAfter.status);
    check(JSON.stringify(repAfter.inMemory) === titlesOf(LINES, DRIP, RIDGE), "The rep's copy should now include the office's line", repAfter.inMemory);
    step("two people added a line to the same estimate at once; both lines were saved and the rep's screen says so");

    // ---- 6. A line that never reaches the database is offered back.
    // The rep types a seventh line, the saving service stops answering, and the
    // rep's tab is reloaded before the line is saved.
    await openEditor(rep);
    copy.state.faults = [{ match: 'crm_commit_records', method: 'POST', status: 503, remaining: 1000 }];
    await typeLineAs(rep, 6, GUTTER);
    await rep.waitFor(async (id) => {
      const entries = recoveryCache ? await recoveryCache.entries('jobcrest-pending:v2:') : [];
      return entries.some((entry) => (entry.value?.pending || []).includes('estimate:' + id) && entry.value.state.estimates.some((item) => item.id === id && item.items.length === 7));
    }, { timeout: 30000, message: "the copy of the rep's unsaved work to be kept on the device", args: [estimateId] });
    check(await storedTitles() === titlesOf(LINES, DRIP, RIDGE), 'The seventh line should not have reached the database', await storedTitles());
    copy.state.faults = [];
    await rep.reload();
    await appReady(rep);
    await openEditor(rep);
    check((await rep.run((id) => state.estimates.find((item) => item.id === id).items.length, estimateId)) === 6, 'After the reload the rep should see the six saved lines');
    const offer = await rep.waitFor(() => document.getElementById('estimateRecoverButton')?.textContent || '', { timeout: 20000, message: 'the "Recover unsaved lines" button' });
    check(/Recover unsaved lines \(1\)/.test(offer), 'Exactly one line should be offered back', offer);
    check(!(await rep.run(() => Boolean(document.getElementById('estimateRecoveryPanel')))), 'The unsaved lines should stay behind the button until it is pressed');
    await rep.run(() => document.getElementById('estimateRecoverButton').click());
    const panel = await rep.waitFor(() => document.getElementById('estimateRecoveryPanel')?.textContent || '', { message: 'the list of unsaved lines' });
    check(panel.includes(GUTTER.title) && ![...LINES, DRIP, RIDGE].some((line) => panel.includes(line.title)), "The list should hold the rep's lost line and nothing else", panel.replace(/\s+/g, ' ').slice(0, 300));
    await rep.run(() => document.querySelector('#estimateRecoveryPanel [data-recover-line="0"][data-recover-mode="add"]').click());
    await settled(rep, 'the recovered line to be saved');
    check(await storedTitles() === titlesOf(LINES, DRIP, RIDGE, GUTTER), 'The recovered line should now be saved after the other six', await storedTitles());
    const gutter = (await storedItems())[6];
    check(Number(gutter.quantity) === 120 && Number(gutter.rate) === 3.5 && gutter.description === GUTTER.description, 'The recovered line lost its numbers or description', gutter);
    const after = await rep.run(() => ({ button: Boolean(document.getElementById('estimateRecoverButton')), blocked: durableWriteBlocked, pending: hasPendingDurableChanges() }));
    check(!after.button && !after.blocked && !after.pending, 'After recovering, nothing should be left to recover or to save', after);
    step('a line typed just before the connection died was put back with one click after the reload');

    // ---- 7. One person deletes a lead. Everyone else's tab must carry on.
    // Found on the live site: after a lead was deleted, another delete was
    // sent for its job with an out-of-date version, the database refused it,
    // and saving in the tab was paused.
    const spare = (await copy.query(`select c.id from public.crm_records c
      where c.record_type='contact' and c.deleted_at is null and c.owner_id=$1 and c.id<>$2
        and (select count(*) from public.crm_records j where j.record_type='job' and j.lead_id=c.id and j.deleted_at is null)=1
        and not exists (select 1 from public.crm_records j where j.record_type='job' and j.lead_id=c.id
          and (jsonb_array_length(case when jsonb_typeof(j.data->'manualPayments')='array' then j.data->'manualPayments' else '[]'::jsonb end)>0
            or coalesce(nullif(j.data->>'paidAmount',''),'0')::numeric>0 or coalesce(j.data->>'squareInvoiceId','')<>''))
        and not exists (select 1 from public.crm_records x where x.record_type in ('estimate','task','document') and x.lead_id=c.id)
      order by c.id limit 2`, [repAccount.id, picked.lead_id])).rows.map((row) => row.id);
    check(spare.length === 2, 'The test data needs two plain leads owned by the rep', spare);
    const deleteLeadInCrm = (person, leadId) => person.run(async (id) => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let done = false;
      void deleteContact(id).then(() => { done = true; });
      let dialog = null;
      for (let i = 0; i < 50 && !dialog; i += 1) { await wait(100); dialog = document.querySelector('dialog.app-dialog[open]'); }
      if (dialog?.querySelector('.app-dialog-title')?.textContent !== 'Delete lead') throw new Error('The "Delete lead" question did not appear');
      dialog.querySelector('button[type="submit"]').click();
      for (let i = 0; i < 120 && !done; i += 1) await wait(250);
      return { done, gone: !getContact(id) };
    }, leadId);
    // What the database tells every other open tab after a change, in the order
    // it happened: the lead, then its job. The local copy has no live channel,
    // so the test hands these to the page the same way the channel would.
    const changeNotices = async (leadId) => (await copy.query(`select to_jsonb(r) as row from public.crm_records r where r.id=$1 or r.lead_id=$1
      order by case r.record_type when 'contact' then 0 else 1 end, r.id`, [leadId])).rows.map((item) => item.row);
    const deliver = (person, rows) => person.run((notices) => { notices.forEach((row) => handleDurableRecordEvent({ eventType: 'UPDATE', new: row, old: { id: row.id } })); }, rows);
    const tabState = (person, leadId) => person.run((id) => ({ blocked: durableWriteBlocked, paused: Boolean(document.getElementById('crmSavePausedNotice')),
      pending: hasPendingDurableChanges(), saving: durableSaveInFlight, leadListed: Boolean(getContact(id)) }), leadId);
    const refusedBeforeDelete = copy.state.errors.length;

    check(await rep.run((id) => Boolean(getContact(id)), spare[0]), 'The rep should have the lead before it is deleted');
    const first = await deleteLeadInCrm(admin, spare[0]);
    check(first.done && first.gone, 'The office could not delete the lead', first);
    await settled(admin, 'the delete to be saved');
    const firstNotices = await changeNotices(spare[0]);
    check(firstNotices.length === 2 && firstNotices.every((row) => row.deleted_at), 'The lead and its job should both be in the bin', firstNotices.map((row) => `${row.record_type} ${row.deleted_at}`));
    await deliver(rep, firstNotices);
    await sleep(3500); // longer than the wait before a queued save or refresh
    const repTab = await tabState(rep, spare[0]);
    check(!repTab.blocked && !repTab.paused, 'Saving was paused in the rep\'s tab because someone else deleted a lead', repTab);
    check(!repTab.pending && !repTab.saving && !repTab.leadListed, 'The rep\'s tab should have dropped the lead and have nothing to save', repTab);
    check(copy.state.errors.slice(refusedBeforeDelete).length === 0, 'Nothing should have been refused by the database', copy.state.errors.slice(refusedBeforeDelete).map((entry) => `${entry.label} ${entry.status} ${entry.message}`));
    step('the office deleted a lead; the rep\'s tab dropped it and went on saving normally');

    // ---- 8. A background refresh that began before a delete must not bring
    // the lead back afterwards.
    await admin.run(() => {
      window.__readRecords = fetchDurableRows;
      window.__letRefreshFinish = null;
      // The refresh reads the records now and is held before it is applied.
      fetchDurableRows = async () => { const snapshot = await window.__readRecords(); await new Promise((resolve) => { window.__letRefreshFinish = resolve; }); return snapshot; };
      window.__refresh = reloadDurableRecords();
    });
    await admin.waitFor(() => typeof window.__letRefreshFinish === 'function', { message: 'the background refresh to have read the records' });
    const second = await deleteLeadInCrm(admin, spare[1]);
    check(second.done && second.gone, 'The office could not delete the second lead', second);
    await settled(admin, 'the second delete to be saved');
    await admin.run(async () => { fetchDurableRows = window.__readRecords; window.__letRefreshFinish(); await window.__refresh; });
    const afterRefresh = await tabState(admin, spare[1]);
    check(!afterRefresh.leadListed, 'The deleted lead came back when a refresh that had started earlier finished', afterRefresh);
    // The office's own tab then hears about its own delete, as every tab does.
    await deliver(admin, await changeNotices(spare[1]));
    await sleep(3500);
    const adminTab = await tabState(admin, spare[1]);
    check(!adminTab.blocked && !adminTab.paused && !adminTab.pending && !adminTab.leadListed, 'The office\'s tab should be left with nothing to save and saving not paused', adminTab);
    check(copy.state.errors.slice(refusedBeforeDelete).length === 0, 'Nothing should have been refused by the database', copy.state.errors.slice(refusedBeforeDelete).map((entry) => `${entry.label} ${entry.status} ${entry.message}`));
    const stillDeleted = (await copy.query("select count(*)::int as n from public.crm_records where (id = any($1) or lead_id = any($1)) and deleted_at is null", [spare])).rows[0].n;
    check(stillDeleted === 0, 'Both leads and their jobs should still be in the bin', stillDeleted);
    step('a background refresh that began before a delete did not bring the lead back');

    // ---- 9. Five photos, one of which fails on its way. The rep must see
    // which one, and sending it again must not send the other four again.
    const photoFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-workflow-photos-'));
    const photoFiles = [1, 2, 3, 4, 5].map((number) => {
      const file = path.join(photoFolder, `TEST-photo-${number}.png`);
      fs.writeFileSync(file, testPhoto(800, 600, number));
      return file;
    });
    const originalsSent = () => copy.state.requests.filter((entry) => entry.method === 'POST' && /\/storage\/v1\/object\//.test(entry.path)
      && !entry.path.includes('/object/sign/') && /TEST-photo-\d\.png$/.test(entry.path));
    const photoRows = () => rep.run(() => [...document.querySelectorAll('#leadPhotoUploadList .upload-status-row')].map((row) => ({
      name: row.querySelector('.upload-status-name').textContent, state: row.querySelector('.upload-status-state').textContent, retry: Boolean(row.querySelector('[data-upload-retry]')) })));
    const storedPhotos = async () => (await copy.query(`select data->>'name' as name, data->>'storagePath' as path, coalesce(data->>'previewPath','') as preview, lead_id, job_id
      from public.crm_records where record_type='document' and deleted_at is null and data->>'kind'='photo' and data->>'name' like 'TEST-photo-%' order by data->>'name'`)).rows;
    const jobName = await rep.run((leadId, jobId) => contactJobs(getContact(leadId)).find((job) => job.id === jobId).name, picked.lead_id, picked.job_id);

    await rep.run((leadId, jobId) => openLeadDetail(leadId, 'photos', jobId), picked.lead_id, picked.job_id);
    await rep.waitFor(() => Boolean(document.getElementById('leadPhotoInput')), { message: 'the photos tab' });
    await rep.run(async (leadId) => { await durableHeavyLeadLoads.get(leadId); await new Promise((resolve) => setTimeout(resolve, 150)); }, picked.lead_id);
    copy.state.faults = [{ match: 'TEST-photo-3', method: 'POST', status: 500, remaining: 1 }];
    await rep.chooseFiles('#leadPhotoInput', photoFiles);
    await rep.waitFor(() => leadUploads.length >= 5 && leadUploads.every((item) => !LEAD_UPLOAD_ACTIVE.includes(item.status)), { timeout: 120000, message: 'the five photos to finish' });
    copy.state.faults = [];
    const firstPass = await photoRows();
    check(firstPass.length === 5, 'Each photo should have its own line', firstPass);
    const failedRows = firstPass.filter((row) => row.retry);
    check(failedRows.length === 1 && failedRows[0].name === 'TEST-photo-3.png', 'Exactly the photo that failed should offer "Retry this file"', firstPass);
    check(firstPass.filter((row) => row.state === `Saved to ${jobName}`).length === 4, 'The other four should read "Saved to" the job', firstPass);
    const summaryText = await rep.run(() => document.getElementById('leadPhotoUploadStatus').textContent);
    check(/4 of 5 photos saved\. 1 did not go through/.test(summaryText), 'The summary should say four of five were saved', summaryText);
    const afterFirstPass = await storedPhotos();
    check(afterFirstPass.length === 4 && afterFirstPass.every((row) => row.lead_id === picked.lead_id && row.job_id === picked.job_id && row.path && row.preview),
      'Four photos should be filed under the job, each with its small copy', afterFirstPass);
    check(originalsSent().length === 5, 'Five originals should have been sent so far, one of them refused', originalsSent().map((entry) => `${entry.status} ${entry.path.split('/').pop()}`));
    step('five photos sent, one failed: four read "Saved to" the job and the fifth offers "Retry this file"');

    await rep.run(() => document.querySelector('#leadPhotoUploadList [data-upload-retry]').click());
    await rep.waitFor(() => leadUploads.every((item) => item.status === 'saved'), { timeout: 60000, message: 'the retried photo to be saved' });
    await settled(rep, 'the photo records to be saved');
    const secondPass = await photoRows();
    check(secondPass.length === 5 && secondPass.every((row) => !row.retry && row.state === `Saved to ${jobName}`), 'All five should now read "Saved to" the job', secondPass);
    check((await storedPhotos()).length === 5, 'Five photos should be filed under the job', await storedPhotos());
    const sent = originalsSent();
    check(sent.length === 6 && sent.at(-1).path.endsWith('TEST-photo-3.png'), 'The retry should have sent that one photo again and no other', sent.map((entry) => `${entry.status} ${entry.path.split('/').pop()}`));
    step('retrying sent that one photo again, and none of the other four');

    // The gallery shows the small copies, not the full-size originals.
    await rep.run(() => document.getElementById('leadPhotosGrid').scrollIntoView({ block: 'start' }));
    const thumbnails = await rep.waitFor(() => {
      const images = [...document.querySelectorAll('#leadPhotosGrid [data-photo-preview]')].filter((image) => image.alt.startsWith('TEST-photo-'));
      return images.length === 5 && images.every((image) => image.naturalWidth > 0)
        ? images.map((image) => ({ name: image.alt, width: image.naturalWidth, small: new URL(image.src).pathname.endsWith('/preview.jpg') })) : null;
    }, { timeout: 30000, message: 'the five photos to show in the gallery' });
    // The rep is not a manager, so the file rules apply to them in full: they
    // may read a small copy only because their own photo record names it.
    check(thumbnails.every((image) => image.small && image.width <= 480), 'The gallery should load each photo\'s small copy for the rep', thumbnails);
    const strangersFile = await rep.run(async () => {
      const { data, error } = await cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET).createSignedUrl(`${supabaseStateId()}/lead-of-someone-else/job_photos/photo-x/v1/preview.jpg`, 60);
      return { refused: Boolean(error), url: data?.signedUrl || '' };
    });
    check(strangersFile.refused && !strangersFile.url, 'The rep should be refused a file that no record of theirs names', strangersFile);
    const sizes = [...copy.state.storage.entries()].filter(([name]) => /TEST-photo-\d\.png$|preview\.jpg$/.test(name));
    const originalBytes = sizes.filter(([name]) => name.endsWith('.png')).reduce((sum, [, stored]) => sum + stored.bytes.length, 0);
    const previewBytes = sizes.filter(([name]) => name.endsWith('preview.jpg')).reduce((sum, [, stored]) => sum + stored.bytes.length, 0);
    check(previewBytes > 0 && previewBytes * 5 < originalBytes, 'The small copies should be a fraction of the originals', { originalBytes, previewBytes });
    const repAfterPhotos = await tabState(rep, picked.lead_id);
    check(!repAfterPhotos.blocked && !repAfterPhotos.pending, 'Nothing should be left unsaved after the photos', repAfterPhotos);
    check(rep.consoleErrors.length === 0, 'The rep\'s page raised an error', rep.consoleErrors.slice(0, 3));
    fs.rmSync(photoFolder, { recursive: true, force: true });
    step(`the gallery shows small copies (${Math.round(previewBytes / 1024)} KB for five photos, against ${Math.round(originalBytes / 1024)} KB of originals)`);

    // ---- 10. A payment recorded on a job's Payments tab is a row in the
    // payments table, filed by the database in the same save. The screen adds
    // money up from the job records it holds; the database adds it up from the
    // table. The two must agree before, after recording and after deleting.
    const moneyNow = async () => ({
      screen: await admin.run(() => ledgerTotals().collected),
      database: (await copy.query('select public.crm_ledger_totals() as totals')).rows[0].totals,
      rows: (await copy.query(`select id, amount::float8 as amount, method, reference, origin, lead_id from public.crm_payments where job_id=$1 order by id`, [picked.job_id])).rows,
      proof: (await copy.query('select public.crm_payments_reconciliation() as proof')).rows[0].proof,
    });
    const agree = (figures) => Math.abs(Number(figures.database.collected) - figures.screen) < 0.005 && Number(figures.database.unsyncedJobPayments) === 0 && figures.proof.matched === true;
    const beforePayment = await moneyNow();
    check(beforePayment.rows.length === 0 && agree(beforePayment), 'Before the payment, the screen, the database and the payments table should agree', beforePayment);
    await admin.run((leadId, jobId) => openLeadDetail(leadId, 'payments', jobId), picked.lead_id, picked.job_id);
    await admin.waitFor(() => state.leadDetailTab === 'payments' && Boolean(els.manualPaymentForm?.elements?.amount), { message: 'the payments tab' });
    await admin.run(() => {
      const form = els.manualPaymentForm;
      form.elements.amount.value = '125.75';
      form.elements.reference.value = 'TEST-CHK-9';
      form.requestSubmit();
    });
    // Saved means: on the job, the form cleared for the next one, nothing in flight.
    await admin.waitFor((jobId) => contactJobs(getSelectedContact()).find((item) => item.id === jobId)?.manualPayments?.some((item) => item.reference === 'TEST-CHK-9')
      && !durableSaveInFlight && !els.manualPaymentSaveButton.disabled && els.manualPaymentForm.elements.amount.value === '',
      { timeout: 45000, message: 'the payment to be saved', args: [picked.job_id] });
    await settled(admin, 'the payment to be saved');
    const afterPayment = await moneyNow();
    check(afterPayment.rows.length === 1 && afterPayment.rows[0].amount === 125.75 && afterPayment.rows[0].origin === 'job'
      && afterPayment.rows[0].reference === 'TEST-CHK-9' && afterPayment.rows[0].lead_id === picked.lead_id,
      'The payment should be one row in the payments table, under the same lead and job', afterPayment.rows);
    check(Math.abs(afterPayment.screen - beforePayment.screen - 125.75) < 0.005 && agree(afterPayment),
      'After the payment, the screen and the database should both be $125.75 higher and agree', { before: beforePayment.screen, after: afterPayment.screen, database: afterPayment.database, proof: afterPayment.proof });
    step(`the admin recorded a $125.75 payment: it is one row in the payments table, and the screen and the database both read ${await admin.run((amount) => money.format(amount), afterPayment.screen)}`);

    const deleted = await admin.run(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelector('#manualPaymentList [data-action="delete-manual-payment"]').click();
      let dialog = null;
      for (let i = 0; i < 50 && !dialog; i += 1) { await wait(100); dialog = document.querySelector('dialog.app-dialog[open]'); }
      if (dialog?.querySelector('.app-dialog-title')?.textContent !== 'Delete payment') return 'The "Delete payment" question did not appear';
      dialog.querySelector('button[type="submit"]').click();
      return 'asked';
    });
    check(deleted === 'asked', deleted);
    await admin.waitFor((jobId) => !contactJobs(getSelectedContact()).find((item) => item.id === jobId)?.manualPayments?.length && !durableSaveInFlight,
      { timeout: 45000, message: 'the payment to be deleted', args: [picked.job_id] });
    await settled(admin, 'the deletion to be saved');
    const afterDelete = await moneyNow();
    check(afterDelete.rows.length === 0, 'The deleted payment should be gone from the payments table', afterDelete.rows);
    check(Math.abs(afterDelete.screen - beforePayment.screen) < 0.005 && agree(afterDelete), 'After deleting it, the screen and the database should be back where they were and agree', { screen: afterDelete.screen, database: afterDelete.database });
    const adminAfterPayment = await tabState(admin, picked.lead_id);
    check(!adminAfterPayment.blocked && !adminAfterPayment.pending, 'Nothing should be left unsaved after the payment', adminAfterPayment);
    check(admin.consoleErrors.length === 0, 'The admin\'s page raised an error', admin.consoleErrors.slice(0, 3));
    step('deleting the payment removed its row, and the totals went back to what they were');

    // Force BOTH separate sessions to see the first filing as absent before either uploads.
    const raceId = await rep.run(async (lead, job) => (await createEstimate(lead, true, job, { forceNew: true })).id, picked.lead_id, picked.job_id);
    check(raceId && raceId !== estimateId, 'A separate test estimate is needed');
    await settled(rep, 'the new estimate before simultaneous filing');
    await admin.reload(); await appReady(admin);
    await Promise.all([rep, admin].map(person => person.run(async (id) => {
      const estimate = state.estimates.find(e => e.id === id);
      if (!estimate) throw Error('Missing shared race estimate');
      const original = findFiledEstimatePdf;
      findFiledEstimatePdf = async (...args) => {
        const answer = await original(...args);
        findFiledEstimatePdf = original;
        if (!answer.known || answer.document) throw Error('First filing precondition failed');
        await new Promise(resolve => { window.releasePdfBarrier = resolve; });
        return answer;
      };
      const Pdf = await loadEstimatePdfGenerator();
      const doc = new Pdf(); doc.text('Concurrent filing, identical estimate', 10, 20);
      window.racePdf = saveEstimatePdfDocument(estimate, getContact(estimate.contactId), doc)
        .then(saved => ({ id: saved.id, path: saved.storagePath }), error => ({ error: error.message }));
      return true;
    }, raceId)));
    await Promise.all([rep, admin].map(person => person.waitFor(() => Boolean(window.releasePdfBarrier), { message: 'both sessions at the filing barrier' })));
    const outcomes = await Promise.all([rep, admin].map(person => person.run(async () => { window.releasePdfBarrier(); return await window.racePdf; })));
    const raceRows = (await copy.query("select id,data from public.crm_records where record_type='document' and deleted_at is null and data->>'estimateId'=$1", [raceId])).rows;
    check(raceRows.length === 1 && raceRows[0].data.versionNumber === 1 &&
      outcomes.every(item => item.id === raceRows[0].id && item.path === raceRows[0].data.storagePath),
      'Both first filings must confirm the same single version', { outcomes, count: raceRows.length });
    check([...copy.state.storage.keys()].filter(key => key.includes('/' + raceRows[0].id + '/')).length === 1, 'Only one PDF object should be stored');
    step('simultaneous first filing in two signed-in sessions produced one PDF record, one version and one stored file');

    // That PDF is now removed from the lead's documents with the CRM's own
    // Remove, and the estimate's PDF is filed again. A removed record keeps
    // its id and can never be written again, so the new filing must take the
    // next id in the series: before this was handled, it was refused for good.
    await rep.run((leadId, jobId) => openLeadDetail(leadId, 'documents', jobId), picked.lead_id, picked.job_id);
    await rep.run(async (leadId) => { await loadDurableLeadHeavyRecords(leadId); }, picked.lead_id);
    await rep.waitFor((docId) => (getSelectedContact()?.documents || []).some((item) => item.id === docId), { message: 'the filed PDF among the lead\'s documents', args: [raceRows[0].id] });
    await rep.run((docId) => removeLeadDocument(docId), raceRows[0].id);
    await settled(rep, 'the removal to be saved');
    const afterRemoval = (await copy.query("select id, deleted_at is not null as removed from public.crm_records where record_type='document' and data->>'estimateId'=$1 order by id", [raceId])).rows;
    check(afterRemoval.length === 1 && afterRemoval[0].removed === true, 'The filed PDF should be marked removed, and still be there', afterRemoval);
    const refiled = await rep.run(async (id) => {
      const estimate = state.estimates.find((item) => item.id === id);
      const Pdf = await loadEstimatePdfGenerator();
      const doc = new Pdf(); doc.text('Filed again after it was removed', 10, 20);
      try {
        const saved = await saveEstimatePdfDocument(estimate, getContact(estimate.contactId), doc);
        return { id: saved.id, version: saved.versionNumber, listed: (getContact(estimate.contactId).documents || []).filter((item) => item.estimateId === id).length };
      } catch (error) { return { error: error.message }; }
    }, raceId);
    const afterRefiling = (await copy.query("select id, deleted_at is not null as removed, (data->>'versionNumber')::int as version from public.crm_records where record_type='document' and data->>'estimateId'=$1 order by id", [raceId])).rows;
    check(!refiled.error && refiled.id === `${raceRows[0].id}-2` && refiled.version === 1 && refiled.listed === 1, 'The PDF should be filed again, under the next id, and listed once on the lead', refiled);
    check(afterRefiling.length === 2 && afterRefiling[0].removed === true && afterRefiling[1].removed === false && afterRefiling[1].id === refiled.id,
      'The database should hold the removed PDF and one filed PDF for the estimate', afterRefiling);
    const repAfterRefiling = await tabState(rep, picked.lead_id);
    check(!repAfterRefiling.blocked && !repAfterRefiling.pending, 'Nothing should be left unsaved or paused after filing again', repAfterRefiling);
    step('the filed PDF was removed from the lead and the estimate\'s PDF was filed again: one removed record, one filed');

    console.log(`\nPASS  ${steps.length} checks`);
  } catch (error) {
    console.error(`\nFAIL  ${error.message}`);
    for (const person of [rep, admin]) {
      if (!person) continue;
      try { console.error(`      screenshot: ${await person.screenshot(path.join(os.tmpdir(), `jobcrest-workflow-${person.name}-failure.png`))}`); } catch { /* the page may be gone */ }
    }
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await copy.stop();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((error) => { console.error(error); process.exit(1); });
