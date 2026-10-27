const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const helperSource = source.match(/const number = \(value\) => \{[\s\S]*?\r?\n\};/)[0];
const parserSource = source.match(/function parseCurrencyInput[\s\S]*?\r?\n}/)[0];
const context = {};
vm.runInNewContext(`${helperSource}\n${parserSource}\nthis.parseCurrencyInput = parseCurrencyInput;`, context);

test("currency parser accepts formatted dollars and preserves cents", () => {
  assert.equal(context.parseCurrencyInput("$35,250.75"), 35250.75);
  assert.equal(context.parseCurrencyInput("0.10"), 0.1);
  assert.equal(context.parseCurrencyInput(""), 0);
});

test("currency parser rounds calculations to cents", () => {
  assert.equal(context.parseCurrencyInput("10.999"), 11);
  assert.equal(context.parseCurrencyInput("1.005"), 1.01);
});
