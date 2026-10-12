// Dependency resolution/import only; no product server or database connection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const repo=process.argv[2];
const api=createRequire(join(repo,'apps/api/package.json'));
const front=createRequire(join(repo,'apps/storefront/package.json'));
assert.equal(typeof api('pg').Client,'function');
const supabase=await import(api.resolve('@supabase/supabase-js'));
assert.equal(typeof supabase.createClient,'function');
await import(api.resolve('@provide/contracts'));
const vite=await import(front.resolve('vite'));
assert.equal(typeof vite.createServer,'function');
const react=await import(front.resolve('@vitejs/plugin-react'));
assert.equal(typeof react.default,'function');
const pw=front('playwright');
for(const name of ['chromium','firefox','webkit'])assert.equal(typeof pw[name].launch,'function');
console.log('PASS: dependency imports only; no product/DB startup');
