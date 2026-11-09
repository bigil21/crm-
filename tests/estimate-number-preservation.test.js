const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function load(names, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}

test('durable writes retain database-issued sales numbers while preserving estimate edits', () => {
  const baseline = new Map([['estimate:estimate-A', {
    estimateNumber: 'EST-1070', leadNumber: 'LD-20261109-000001', projectNumber: 'LD-20261109-000001-P01',
  }]]);
  const c = load(['durableRecordKey', 'preserveImmutableSalesNumbers'], {
    durableFinancialBaseline: baseline,
    immutableSalesNumberFields: {
      contact: ['leadNumber'], job: ['projectNumber'], estimate: ['estimateNumber', 'leadNumber', 'projectNumber'],
    },
  });
  const rows = [{ record_type: 'estimate', id: 'estimate-A', data: {
    estimateNumber: 'EST-1069', leadNumber: 'wrong-lead', projectNumber: 'wrong-project',
    items: [{ title: 'Saved line item', quantity: 2, rate: 125.75 }],
  } }];
  c.preserveImmutableSalesNumbers(rows);
  assert.equal(rows[0].data.estimateNumber, 'EST-1070');
  assert.equal(rows[0].data.leadNumber, 'LD-20261109-000001');
  assert.equal(rows[0].data.projectNumber, 'LD-20261109-000001-P01');
  assert.equal(JSON.stringify(rows[0].data.items), JSON.stringify([{ title: 'Saved line item', quantity: 2, rate: 125.75 }]));
});

test('explicit estimate save restores authoritative numbers before taking the PDF snapshot', async () => {
  const estimate = {
    id: 'estimate-A', contactId: 'lead-A', jobId: 'job-A', estimateNumber: 'EST-1069',
    leadNumber: 'wrong-lead', projectNumber: 'wrong-project', items: [{ title: 'Final item', quantity: 1, rate: 500 }],
  };
  let queued = 0;
  let captured;
  const statuses = [];
  const c = load(['restoreEstimateSalesNumbersFromBaseline', 'saveCurrentEstimateAndPdf'], {
    state: { estimates: [estimate] },
    durableFinancialBaseline: new Map([['estimate:estimate-A', {
      estimateNumber: 'EST-1070', leadNumber: 'LD-1', projectNumber: 'LD-1-P01',
    }]]),
    immutableSalesNumberFields: { estimate: ['estimateNumber', 'leadNumber', 'projectNumber'] },
    estimateExplicitSaves: new Set(), estimateSaveRevisions: new Map(), estimateCompletedSaveRevisions: new Map(),
    estimateSaveStates: new Map(),
    getSelectedEstimate: () => estimate,
    queueLocalStateSave: () => { queued++; },
    flushQueuedLocalStateSave() {},
    flushEstimateVerifiedSave: async () => true,
    downloadEstimatePdf: async options => { captured = options.estimateSnapshot; return true; },
    durableRecordDataMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    setEstimateSaveState: (...args) => statuses.push(args),
    canAction: () => true,
    els: { saveEstimateButton: { disabled: false } },
  });
  assert.equal(await c.saveCurrentEstimateAndPdf(), true);
  assert.equal(queued, 1);
  assert.equal(captured.estimateNumber, 'EST-1070');
  assert.equal(captured.leadNumber, 'LD-1');
  assert.equal(captured.projectNumber, 'LD-1-P01');
  assert.equal(captured.items[0].title, 'Final item');
  assert.equal(statuses.at(-1)[2], 'success');
});

test('sales-number validation errors are recoverable business rejections', () => {
  const c = load(['durableRejectionReason', 'durableBusinessRuleRejection'], {
    durableRejectionReasons: {
      sales_number_is_immutable: 'Original number restored.',
      sales_number_not_reserved: 'Reservation required.',
      estimate_sales_numbers_do_not_match: 'Numbers do not match.',
      authentication_required: 'Sign in again.',
    },
  });
  assert.equal(c.durableBusinessRuleRejection({ message: 'sales_number_is_immutable' }), 'sales_number_is_immutable');
  assert.equal(c.durableBusinessRuleRejection({ message: 'estimate_sales_numbers_do_not_match' }), 'estimate_sales_numbers_do_not_match');
  assert.equal(c.durableRejectionReason({ message: 'sales_number_not_reserved' }), 'Reservation required.');
});
