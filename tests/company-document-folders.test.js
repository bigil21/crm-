const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

test('workspace documents provide durable folders and a compact file list', () => {
  assert.match(page, /id="createCompanyDocumentFolderButton"/);
  assert.match(page, /id="companyDocumentCategory"><\/select>/);
  assert.match(app, /companyDocumentFoldersWithLegacy/);
  assert.match(app, /folderId: folder\.id/);
  assert.match(app, /data-action="open-company-document-folder"/);
  assert.match(app, /data-action="close-company-document-folder"/);
  assert.match(app, /function renderCompanyDocumentRow/);
  assert.match(app, /function moveCompanyDocumentToFolder/);
  assert.match(app, /data-company-document-folder/);
  assert.match(styles, /\.company-folder-row/);
  assert.match(styles, /\.company-document-row/);
  assert.match(styles, /\.company-document-row-actions \.secondary-button/);
});

test('legacy company documents remain visible through folder name matching', () => {
  assert.match(app, /documentCategoryNameKey\(folder\.name\) === documentCategoryNameKey\(document\.category \|\| "Other"\)/);
  assert.match(app, /companyDocumentFoldersWithLegacy\(state\.company\.companyDocumentFolders, state\.companyDocuments\)/);
});
