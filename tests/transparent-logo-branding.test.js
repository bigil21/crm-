const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

test('Coastal Crest uses the shipped transparent mark while custom uploads remain supported', () => {
  assert.match(app, /COASTAL_CREST_TRANSPARENT_MARK = "\/coastal-crest-mark\.png"/);
  assert.match(app, /company\.logoAssetVersion === "custom"/);
  assert.match(app, /logoAssetVersion: "custom"/);
  assert.match(app, /companyLogoDataUrlForPdf/);
});

test('navigation and estimate logos are rendered at the enlarged sizes without a white tile', () => {
  assert.match(css, /\.brand-icon\s*\{[\s\S]*?width: 86px;[\s\S]*?height: 86px;[\s\S]*?background: transparent;/);
  assert.match(css, /\.est-logo\s*\{[\s\S]*?width: 88px;[\s\S]*?height: 76px;/);
  assert.match(css, /\.doc-logo\s*\{[\s\S]*?width: 76px;[\s\S]*?height: 68px;/);
  assert.match(app, /doc\.addImage\(pdfLogoDataUrl,[\s\S]*?left, 12, 76, 70\)/);
});
