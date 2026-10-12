import hashlib, importlib.util, json, os, tempfile, unittest, zipfile
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('pre',Path(__file__).with_name('prerequisites.py'));pre=importlib.util.module_from_spec(spec);spec.loader.exec_module(pre)

class Guards(unittest.TestCase):
    def test_firefox_policy_is_owned_and_changed_policy_not_removed(self):
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);repo=root/'product';app=repo/'apps/storefront';app.mkdir(parents=True);(app/'package.json').write_text('{}')
            mod=app/'node_modules/playwright';mod.mkdir(parents=True)
            exe=root/'fake-firefox/firefox';exe.parent.mkdir();exe.write_text('offline placeholder')
            (mod/'index.js').write_text('exports.firefox={executablePath:()=>'+json.dumps(str(exe))+'};')
            work=root/'work';work.mkdir();helper=Path(__file__).with_name('firefox-trust.mjs')
            args=['node',str(helper)]
            subprocess.run([*args,'install',str(repo),str(work)],check=True,capture_output=True)
            policy=exe.parent/'distribution/policies.json';original=policy.read_bytes()
            self.assertEqual(json.loads(original)['policies']['Certificates']['Install'],[str(work/'tls/ca.pem')])
            self.assertNotEqual(subprocess.run([*args,'install',str(repo),str(work)],capture_output=True).returncode,0)
            policy.write_text('{"changed":true}')
            self.assertNotEqual(subprocess.run([*args,'remove',str(repo),str(work)],capture_output=True).returncode,0)
            self.assertTrue(policy.exists())
            policy.write_bytes(original)
            subprocess.run([*args,'remove',str(repo),str(work)],check=True,capture_output=True)
            self.assertFalse(policy.exists());self.assertFalse((work/'firefox-policy.json').exists())
    def test_manual_new_vm_and_owned_path_required(self):
        with tempfile.TemporaryDirectory() as d:
            e={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY':'PROVIDE-Webdesign/Provide-bestellsystem','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_RUN_ID':'12','GITHUB_RUN_ATTEMPT':'1','RUNNER_TEMP':d,'MG03_JOB_DIR':d+'/provide-mg03-prerequisites-12-1'}
            self.assertEqual(pre.owned_job(e),Path(e['MG03_JOB_DIR']))
            for key,value in [('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_EVENT_NAME','push'),('MG03_JOB_DIR',d+'/foreign')]:
                with self.assertRaises(ValueError):pre.owned_job({**e,key:value})
    def test_remote_docker_and_override_rejected(self):
        for endpoint in ['tcp://127.0.0.1:2375','ssh://host','unix:///var/run/docker.sock?x']:
            with self.assertRaises(ValueError):pre.local_docker({'Endpoints':{'docker':{'Host':endpoint}}},{})
        c={'Endpoints':{'docker':{'Host':'unix:///var/run/docker.sock'}}}
        self.assertEqual(pre.local_docker(c,{}),'unix:///var/run/docker.sock')
        with self.assertRaises(ValueError):pre.local_docker(c,{'DOCKER_CONTEXT':'remote'})
    def test_actual_v003_integrity_and_pin(self):
        with tempfile.TemporaryDirectory() as d:
            m=pre.unpack(Path(__file__).with_name('v003.zip'),Path(d)/'package')
            self.assertEqual(m['head'],pre.HEAD)
            with self.assertRaises(ValueError):pre.unpack(Path(__file__).with_name('v003.zip'),Path(d)/'package')
    def test_modified_zip_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'x.zip';p.write_bytes(Path(__file__).with_name('v003.zip').read_bytes()+b'changed')
            with self.assertRaises(ValueError):pre.unpack(p,Path(d)/'package')
    def test_cleanup_keeps_removing_private_keys_after_trust_error(self):
        with tempfile.TemporaryDirectory() as d:
            j=pre.Job.__new__(pre.Job);j.work=Path(d);j.evidence=Path(d)/'evidence';j.evidence.mkdir();j.tls=Path(d)/'tls';j.tls.mkdir();(j.tls/'key.pem').write_text('PRIVATE_TEST_SENTINEL');j.ca_path=Path(d)/'ca.crt';j.nss=Path(d)/'nss';j.nickname='owned';j.repo=Path(d)/'repo';j.binding=lambda:{'schema':2,'run_id':'12','attempt':'1','controller_commit':'a'*40}
            (j.evidence/'trust-created.json').write_text('{}')
            attempts=[]
            def command(args,**kwargs):
                attempts.append(args)
                if args[:2]==['sudo','rm']:raise OSError('synthetic')
                return ''
            j.command=command
            with patch.object(pre.subprocess,'run',return_value=type('Result',(),{'returncode':0,'stdout':b''})()):
                with self.assertRaises(ValueError):j.cleanup()
            self.assertFalse(j.tls.exists())
            self.assertIn(['sudo','update-ca-certificates'],attempts)
            self.assertEqual(json.loads((j.evidence/'cleanup.json').read_text())['status'],'FAIL')
            self.assertEqual(json.loads((j.evidence/'summary.json').read_text())['status'],'PREREQUISITES_INCOMPLETE_OR_FAILED')

if __name__=='__main__':unittest.main()
