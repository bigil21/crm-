const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Sales Pipeline has a real final navigation item and view title", () => {
  const html = read("index.html");
  const app = read("app.js");
  const settingsPosition = html.indexOf('data-view="company"');
  const pipelinePosition = html.indexOf('data-view="pipeline"');
  assert.ok(settingsPosition >= 0, "Settings navigation item is missing");
  assert.ok(pipelinePosition > settingsPosition, "Sales Pipeline must remain at the end of navigation");
  assert.match(html, /data-view="pipeline"[\s\S]*?<span>Sales Pipeline<\/span>/);
  assert.match(app, /pipeline:\s*"Sales Pipeline"/);
  assert.match(app, /item\.classList\.toggle\("active", item\.dataset\.view === state\.view\)/);
});

test("pipeline renderer computes open and weighted values before drawing the board", () => {
  const app = read("app.js");
  const renderer = app.slice(app.indexOf("function renderPipeline()"), app.indexOf("function renderLeadCard"));
  const declaration = renderer.indexOf("const pipelineValue = activeRows.reduce");
  const use = renderer.indexOf("money.format(pipelineValue)");
  assert.ok(declaration >= 0, "pipelineValue is not calculated");
  assert.ok(use > declaration, "pipelineValue is used before it is calculated");
  assert.match(renderer, /const weightedForecast = activeRows\.reduce/);
  assert.match(renderer, /pipelineStageWeight\(job\.salesStage, stages\)/);
  assert.match(renderer, /!\["Lost", stages\.at\(-1\)\]\.includes\(job\.salesStage\)/);
});
