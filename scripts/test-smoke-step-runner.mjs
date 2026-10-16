import test from "node:test";
import assert from "node:assert/strict";
import { runSmokeStep, transientInfrastructureError, formatStepSummary } from "./smoke-step-runner.mjs";
const silent = {warn(){}};
test("read-only temporary outage retries then succeeds", async () => {
 let n=0; const r=await runSmokeStep("rpc",async()=>{if(++n===1)throw Object.assign(new Error("unavailable"),{status:503});return 1;},{safeToRetry:true,sleep:async()=>{},log:silent});
 assert.equal(r.status,"PASS"); assert.equal(n,2);
});
test("validation errors do not retry",async()=>{
 let n=0;const r=await runSmokeStep("validate",async()=>{n++;throw new Error("bad address");},{safeToRetry:true,sleep:async()=>{},log:silent});
 assert.equal(r.status,"FAIL");assert.equal(n,1);
});
test("burn and transfer are never repeated after ambiguous infrastructure errors",async()=>{
 let n=0;const r=await runSmokeStep("transfer",async()=>{n++;throw Object.assign(new Error("timeout"),{status:503});},{safeToRetry:false,sleep:async()=>{},log:silent});
 assert.equal(r.status,"FAIL");assert.equal(n,1);
});
test("post-burn failures never trigger replay",async()=>{
 let n=0;const r=await runSmokeStep("mint",async()=>{n++;throw Object.assign(new Error("post-burn outage"),{status:502,burnTxHash:"0x1"});},{safeToRetry:false,sleep:async()=>{},log:silent});
 assert.equal(r.status,"FAIL");assert.equal(n,1);
});
test("summary reports pass/fail and attempts",()=>{
 assert.match(formatStepSummary([{name:"fund/check",status:"PASS",durationMs:2,attempts:2},{name:"burn",status:"FAIL",durationMs:3,attempts:1}]),/FAIL burn \(3ms; attempts=1\)/);
});
test("transient error detection",()=>{
 assert.equal(transientInfrastructureError({code:"ECONNRESET"}),true);
 assert.equal(transientInfrastructureError({status:503}),true);
 assert.equal(transientInfrastructureError(new Error("insufficient funds")),false);
});
