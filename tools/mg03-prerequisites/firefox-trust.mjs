// Firefox Linux needs explicit Certificates.Install; OS trust alone is insufficient.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [phase,repo,work]=process.argv.slice(2);
const marker=join(work,'firefox-policy.json');
const hash=b=>createHash('sha256').update(b).digest('hex');
if(phase==='install'){
 const require=createRequire(join(repo,'apps/storefront/package.json'));
 const executable=realpathSync(require('playwright').firefox.executablePath());
 const distribution=join(dirname(executable),'distribution');
 if(existsSync(distribution))assert.ok(!lstatSync(distribution).isSymbolicLink());
 mkdirSync(distribution,{recursive:true});
 const path=join(distribution,'policies.json');
 assert.ok(!existsSync(path),'Existing Firefox policy must not be overwritten');
 const policy=JSON.stringify({policies:{Certificates:{Install:[join(work,'tls/ca.pem')]}}});
 writeFileSync(marker,JSON.stringify({path,sha256:hash(policy)}),{mode:0o600,flag:'wx'});
 writeFileSync(path,policy,{mode:0o600,flag:'wx'});
 console.log('PASS: own Firefox certificate policy installed; strict TLS still required');
}else if(phase==='remove'){
 if(existsSync(marker)){
  const {path,sha256}=JSON.parse(readFileSync(marker));
  if(existsSync(path)){
   assert.ok(!lstatSync(path).isSymbolicLink());
   assert.equal(hash(readFileSync(path)),sha256,'Changed policy retained for review');
   unlinkSync(path);
  }
  unlinkSync(marker);
 }
 console.log('PASS: own Firefox policy removed or absent');
}else throw Error('Unknown phase');
