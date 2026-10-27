import test from 'node:test';
import assert from 'node:assert/strict';
import { preservePreviewRuntime, previewWorker, previewAccount } from './prepare-storefront-cloud-build.mjs';

const fixture=()=>({name:previewWorker,main:'index.js',compatibility_date:'2026-09-01',compatibility_flags:['nodejs_compat','global_fetch_strictly_public'],assets:{directory:'../client',binding:'ASSETS'},vars:{PUBLIC_API_URL:'https://placeholder.invalid',CHECKOUT_PROTECTION_ENABLED:'false',PUBLIC_CHECKOUT_TURNSTILE_SITE_KEY:''},observability:{enabled:true}});
test('repository placeholders cannot overwrite the existing preview variables',()=>{
  const original=fixture(),before=structuredClone(original),ready=preservePreviewRuntime(original);
  assert.deepEqual(ready.vars,{});assert.equal(ready.keep_vars,true);assert.equal(ready.account_id,previewAccount);
  assert.deepEqual(original,before);assert.deepEqual(ready.assets,original.assets);assert.deepEqual(ready.observability,original.observability);
});
test('rejects another Worker, account, missing protection flags and unbuilt source',()=>{
  for(const change of [{name:'provide-bs-api-preview'},{name:'production-worker'},{account_id:'another-account'},{compatibility_flags:['nodejs_compat']},{main:undefined},{assets:{}},{env:{production:{}}}])assert.throws(()=>preservePreviewRuntime({...fixture(),...change}));
});
test('configuration preparation is repeatable without changing resource bindings',()=>{
  const input=fixture();input.services=[{binding:'EXAMPLE_SERVICE',service:'synthetic-service'}];
  const once=preservePreviewRuntime(input);assert.deepEqual(preservePreviewRuntime(once),once);assert.deepEqual(once.services,input.services);
});
