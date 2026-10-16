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

test("read-only burn inspection retries two transient errors and stops", async () => {
 let attempts=0, waits=[];
 const r=await runSmokeStep("inspect burn",async()=>{
   attempts++;
   throw Object.assign(new Error("RPC unavailable"),{status:503});
 },{safeToRetry:true,retries:2,baseDelayMs:10,sleep:async ms=>{waits.push(ms)},log:silent});
 assert.equal(r.status,"FAIL");
 assert.equal(r.attempts,3);
 assert.equal(attempts,3);
 assert.deepEqual(waits,[10,20]);
});
test("a non-retryable 404 stops read-only inspection", async () => {
 let attempts=0;
 const r=await runSmokeStep("inspect burn",async()=>{
   attempts++; throw Object.assign(new Error("not indexed"),{status:404});
 },{safeToRetry:true,sleep:async()=>{},log:silent});
 assert.equal(r.status,"FAIL");
 assert.equal(attempts,1);
});
test("read-only inspection never changes transfer operation count", async () => {
 let transferCount=0, lookups=0;
 const transferResult=await runSmokeStep("transfer",async()=>{
   transferCount++;
   throw Object.assign(new Error("RPC timeout"),{status:503,burnTxHash:"0x123"});
 },{safeToRetry:false,sleep:async()=>{},log:silent});
 assert.equal(transferResult.status,"FAIL");
 const inspect=await runSmokeStep("inspect burn",async()=>{
   lookups++;
   if(lookups<3)throw Object.assign(new Error("temporary outage"),{status:502});
   return {burnTxHash:"0x123"};
 },{safeToRetry:true,retries:2,sleep:async()=>{},log:silent});
 assert.equal(inspect.status,"PASS");
 assert.equal(inspect.attempts,3);
 assert.equal(transferCount,1);
});
test("invalid retry budget is rejected",async()=>{
 await assert.rejects(()=>runSmokeStep("bad",async()=>1,{retries:99}),RangeError);
});
