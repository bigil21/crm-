const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const workflow = fs.readFileSync(path.join(__dirname, '../workflow-checklists-v65.js'), 'utf8');
function source(name) {
  const match = workflow.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  }`, 'm'));
  assert.ok(match, name);
  return match[0];
}
function harness(manager) {
  const context = vm.createContext({
    pipelineStagesFor: division => ({ roofing: ['New', 'Contacted', 'Inspection'],
      services: ['New', 'Request', 'Scheduled', 'Completed', 'Invoiced'],
      construction: ['New', 'Consultation', 'Design & Selections', 'Paid'] })[division],
    canManageTeamData: () => manager, jobHasFullPayment: () => false,
    escapeHtml: String, itemComplete: () => false,
  });
  vm.runInContext(workflow.match(/const progressionStages = \[[^]*?\];/)[0] +
    'const checklistDefinitions={ New:[{id:"phone",label:"Phone",mode:"auto"}] };' +
    ['stageIndex', 'nextStage', 'stageChecklist', 'transitionCheck', 'checklistStageMarkup'].map(source).join('\n'), context);
  return context;
}
test('Jeff service-lead progression chooses Request rather than the roofing Contacted stage', () => {
  const h = harness(true), job = { division: 'services', status: 'New' };
  const target = h.nextStage(job.status, job, {});
  assert.equal(target, 'Request');
  assert.equal(h.transitionCheck({}, job, target).allowed, true);
  const markup = h.checklistStageMarkup(job.status, job, {});
  assert.match(markup, /Request/);
  assert.doesNotMatch(markup, /Contacted|Inspection/);
});
test('next actions follow each division and inherit the lead division when needed', () => {
  const h = harness(false);
  assert.equal(h.nextStage('New', {division:'roofing'}), 'Contacted');
  assert.equal(h.nextStage('New', {division:'construction'}), 'Consultation');
  assert.equal(h.nextStage('Request', {}, {division:'services'}), 'Scheduled');
  assert.equal(h.nextStage('Invoiced', {division:'services'}), '');
});
test('service stages do not inherit roofing checklist requirements', () => {
  const h = harness(true);
  assert.equal(h.stageChecklist({}, {division:'services',status:'New'}).ready, true);
  assert.equal(h.stageChecklist({}, {division:'roofing',status:'New'}).ready, false);
});
test('owners can correct stages while forward, skip, and payment rules remain intact', () => {
  const owner = harness(true), rep = harness(false), job = {division:'services',status:'Scheduled'};
  assert.equal(owner.transitionCheck({},job,'Request').allowed,true);
  assert.equal(rep.transitionCheck({},job,'Request').allowed,false);
  assert.equal(rep.transitionCheck({},job,'Completed').allowed,true);
  assert.equal(owner.transitionCheck({}, {...job,status:'New'}, 'Completed').allowed,false);
  assert.match(owner.transitionCheck({}, {...job,status:'New'}, 'Contacted').reason,/not a services stage/);
  assert.equal(owner.transitionCheck({}, {division:'construction',status:'Design & Selections'}, 'Paid').allowed,false);
});

test('the service advance button saves the configured next stage through the durable record path', async () => {
  const h = harness(true);
  const contact = { id:'lead',status:'New',division:'services',jobs:[{id:'job',division:'services',status:'New'}] };
  const saves = [];
  Object.assign(h, {
    state:{currentUser:{name:'Owner'}}, requireAction:()=>true,
    getContact:()=>contact, contactJobs:value=>value.jobs, primaryJob:value=>value.jobs[0],
    window:{clearTimeout(){}}, checklistSaveTimers:new Map(), checklistSaveStates:new Map(),
    queueWorkflowLocalSave(){},renderActiveWorkflowLead(){},canUseCloudSync:()=>true,
    originalApplyStatusUpdate(_id,target){contact.status=target;contact.jobs[0].status=target;contact.updates=[{id:'update'}];return contact;},
    async persistLeadJobRecord(jobId,updateId){saves.push({jobId,updateId,status:contact.jobs[0].status});return true;},
  });
  vm.runInContext(source('checklistSaveKey') + source('advanceWorkflowJob'),h);
  await h.advanceWorkflowJob('lead','job');
  assert.deepEqual(saves,[{jobId:'job',updateId:'update',status:'Request'}]);
  assert.equal(contact.status,'Request');
});
