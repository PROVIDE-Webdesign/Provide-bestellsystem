import copy,importlib.util,json,os,subprocess,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import prerequisites as pre
from evidence import PHASES,validate

BINDING={'schema':2,'run_id':'12','attempt':'1','controller_commit':'a'*40}
HERE=Path(__file__).resolve().parent

def fixture(directory):
    rows={
      'init':{'status':'PASS','v003_sha256':pre.ZIP_HASH,'native_product_run':'NOT_RUN'},
      'sources':{'status':'PASS','head':pre.HEAD,'tree':pre.TREE,'main':pre.MAIN,'migration_count':46,'lockfile_sha256':'b'*64},
      'installed':{'status':'PASS','node':'v24.19.0','pnpm':'11.19.0','cli':'2.117.0'},
      'utilities':{'status':'PASS','trust_tools_present':True},
      'tls':{'status':'PASS','trust_status':'INSTALLED_NOT_VERIFIED'},
      'verify':{'status':'PREREQUISITES_PASSED_REVIEW_REQUIRED','head':pre.HEAD,'tree':pre.TREE,'tls_node_three_browsers':'PASS','ports_checked':list(pre.PORTS),'docker_endpoint':'unix:///var/run/docker.sock','docker_memory_bytes':8*1024**3,'disk_free_bytes':11*1024**3,'native_product_run':'NOT_RUN','mg03_closed':False,'vm_survives_job':False,'postgres_running_version':'NOT_RUN','runtime_images':'NOT_PREPARED','image_version':'synthetic-ubuntu','runner_os':'Linux','docker_server_version':'synthetic-version'},
      'cleanup':{'status':'PASS','failures':[],'tls_directory_absent':True,'own_system_ca_absent':True},
      'command-0001':{'exit':0,'cleanup_status':'PASS','remaining_owned_processes':0,'remaining_children':0,'timeout':False,'interrupted':False,'residual_on_exit':False,'output_limit':False,'errors':[],'args':['synthetic'],'stdout_sha256':'c'*64,'stderr_sha256':'d'*64,'tracked_processes':1}}
    for phase in PHASES:rows['phase-'+phase]={'phase':phase,'status':'PASS'}
    for name,row in rows.items():(directory/(name+'.json')).write_text(json.dumps({**row,'binding':BINDING}))

def checked(directory):return validate(directory,BINDING,pre.HEAD,pre.TREE,pre.MAIN,pre.ZIP_HASH)

class EvidenceRegression(unittest.TestCase):
    def test_complete_bound_success(self):
        with tempfile.TemporaryDirectory() as d:
            fixture(Path(d));self.assertEqual(checked(Path(d))['status'],'PREREQUISITES_PASSED_REVIEW_REQUIRED')
    def test_empty_malformed_failed_missing_verify_rejected(self):
        for text in ['{}','{','{"status":"FAIL"}',None]:
            with self.subTest(text=text),tempfile.TemporaryDirectory() as d:
                p=Path(d);fixture(p)
                if text is None:(p/'verify.json').unlink()
                else:(p/'verify.json').write_text(text)
                with self.assertRaises((ValueError,KeyError,TypeError)):checked(p)
    def test_wrong_run_controller_pins_and_scope_rejected(self):
        variants=[('binding',{'schema':2,'run_id':'99','attempt':'1','controller_commit':'a'*40}),('binding',{**BINDING,'attempt':'2'}),('binding',{**BINDING,'controller_commit':'e'*40}),('head','wrong'),('tree','wrong'),('tls_node_three_browsers','FAIL'),('mg03_closed',True),('ports_checked',[]),('image_version',None)]
        for key,value in variants:
            with self.subTest(key=key,value=value),tempfile.TemporaryDirectory() as d:
                p=Path(d);fixture(p);row=json.loads((p/'verify.json').read_text());row[key]=value;(p/'verify.json').write_text(json.dumps(row))
                with self.assertRaises(ValueError):checked(p)
    def test_every_required_phase_and_failure_marker(self):
        for phase in PHASES:
            for mode in ['missing','RUNNING','FAIL']:
                with self.subTest(phase=phase,mode=mode),tempfile.TemporaryDirectory() as d:
                    p=Path(d);fixture(p);path=p/('phase-'+phase+'.json')
                    if mode=='missing':path.unlink()
                    else:path.write_text(json.dumps({'phase':phase,'status':mode,'binding':BINDING}))
                    with self.assertRaises(ValueError):checked(p)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);fixture(p);(p/'failure-installed.json').write_text('{}')
            with self.assertRaises(ValueError):checked(p)
    def test_cleanup_and_command_failure_or_residue_rejected(self):
        for name,key,value in [('cleanup','status','FAIL'),('cleanup','tls_directory_absent',False),('command-0001','exit',7),('command-0001','timeout',True),('command-0001','remaining_owned_processes',1),('command-0001','cleanup_status','FAIL'),('command-0001','stdout_sha256','bad'),('command-0001','tracked_processes',0)]:
            with self.subTest(name=name,key=key),tempfile.TemporaryDirectory() as d:
                p=Path(d);fixture(p);path=p/(name+'.json');row=json.loads(path.read_text());row[key]=value;path.write_text(json.dumps(row))
                with self.assertRaises(ValueError):checked(p)
    def test_e73_existence_counterexample_cleanup_now_incomplete(self):
        with tempfile.TemporaryDirectory() as d:
            j=pre.Job.__new__(pre.Job);j.work=Path(d);j.evidence=j.work/'evidence';j.evidence.mkdir();j.tls=j.work/'tls';j.ca_path=j.work/'absent';j.binding=lambda:BINDING
            (j.evidence/'verify.json').write_text('{}');j.cleanup()
            self.assertEqual(json.loads((j.evidence/'summary.json').read_text())['status'],'PREREQUISITES_INCOMPLETE_OR_FAILED')

class EnvironmentRegression(unittest.TestCase):
    def test_tls_and_node_overrides_rejected_before_spawn(self):
        for env in [{'NODE_TLS_REJECT_UNAUTHORIZED':'0'},{'NODE_TLS_REJECT_UNAUTHORIZED':''},{'NODE_OPTIONS':'--use-openssl-ca'},{'NODE_PATH':'/foreign'}]:
            with self.subTest(env=env):
                with self.assertRaises(ValueError):pre.safe_environment(env)
        with self.assertRaises(ValueError):pre.safe_environment({}, {'NODE_TLS_REJECT_UNAUTHORIZED':'0'})
        with tempfile.TemporaryDirectory() as d:
            j=pre.Job.__new__(pre.Job)
            with patch.dict(os.environ,{'NODE_TLS_REJECT_UNAUTHORIZED':'0'}),patch.object(pre.subprocess,'Popen') as spawn:
                with self.assertRaises(ValueError):j.command(['node','synthetic'])
                spawn.assert_not_called()
    def test_safe_ca_and_environment_no_parent_mutation(self):
        parent={'PATH':'/synthetic','NODE_EXTRA_CA_CERTS':'/uncontrolled','NODE_TLS_REJECT_UNAUTHORIZED':'1','GITHUB_TOKEN':'PRIVATE_SYNTHETIC','STRIPE_KEY':'PRIVATE_SYNTHETIC'};original=parent.copy()
        child=pre.safe_environment(parent,{'NODE_EXTRA_CA_CERTS':'/private-own-ca.pem'})
        self.assertEqual(child['NODE_TLS_REJECT_UNAUTHORIZED'],'1');self.assertEqual(child['NODE_EXTRA_CA_CERTS'],'/private-own-ca.pem');self.assertNotIn('GITHUB_TOKEN',child);self.assertNotIn('STRIPE_KEY',child);self.assertEqual(parent,original)

class SupervisorRegression(unittest.TestCase):
    def launch(self,command,timeout=1):
        directory=Path(self.temp.name)/'private';directory.mkdir(mode=0o700)
        started=time.monotonic()
        p=subprocess.run([sys.executable,str(HERE/'supervisor.py'),'--directory',str(directory),'--timeout',str(timeout),'--',*command],timeout=timeout+7,capture_output=True)
        result=json.loads((directory/'result.json').read_text());self.assertLess(time.monotonic()-started,timeout+5)
        self.assertEqual(result['cleanup_status'],'PASS');self.assertEqual(result['remaining_owned_processes'],0);self.assertEqual(result['remaining_children'],0)
        return p,result
    def setUp(self):self.temp=tempfile.TemporaryDirectory()
    def tearDown(self):self.temp.cleanup()
    def test_normal_command_success_and_failed_exit(self):
        p,result=self.launch([sys.executable,'-c','print("OK")']);self.assertEqual(p.returncode,0);self.assertEqual(result['exit'],0)
        Path(self.temp.name,'private').rename(Path(self.temp.name,'old'))
        p,result=self.launch([sys.executable,'-c','raise SystemExit(7)']);self.assertNotEqual(p.returncode,0);self.assertEqual(result['exit'],7)
    def test_timeout_detached_child_inherited_streams_and_foreign_sibling(self):
        sibling=subprocess.Popen([sys.executable,'-c','import time;time.sleep(15)'])
        try:
            command="import subprocess,sys,time;subprocess.Popen([sys.executable,'-c','import time;time.sleep(15)'],start_new_session=True);time.sleep(15)"
            p,result=self.launch([sys.executable,'-c',command],.25)
            self.assertNotEqual(p.returncode,0);self.assertTrue(result['timeout']);self.assertGreaterEqual(result['tracked_processes'],2);self.assertIsNone(sibling.poll())
        finally:sibling.terminate();sibling.wait(timeout=2)
    def test_normal_exit_with_detached_residue_is_failed_and_cleaned(self):
        command="import subprocess,sys;subprocess.Popen([sys.executable,'-c','import time;time.sleep(15)'],start_new_session=True)"
        p,result=self.launch([sys.executable,'-c',command]);self.assertNotEqual(p.returncode,0);self.assertTrue(result['residual_on_exit']);self.assertGreaterEqual(result['tracked_processes'],2)
    def test_double_fork_adoption(self):
        command="import os,time;pid=os.fork();\nif pid==0:\n os.setsid();pid2=os.fork();\n if pid2==0:time.sleep(15)\n os._exit(0)\ntime.sleep(15)"
        p,result=self.launch([sys.executable,'-c',command],.25);self.assertNotEqual(p.returncode,0);self.assertTrue(result['timeout']);self.assertGreaterEqual(result['tracked_processes'],2)
    def test_external_term_cleans_owned_descendants(self):
        directory=Path(self.temp.name)/'private';directory.mkdir(mode=0o700);marker=Path(self.temp.name)/'started'
        command="import subprocess,sys,time;from pathlib import Path;subprocess.Popen([sys.executable,'-c','import time;time.sleep(15)'],start_new_session=True);Path(sys.argv[1]).write_text('started');time.sleep(15)"
        p=subprocess.Popen([sys.executable,str(HERE/'supervisor.py'),'--directory',str(directory),'--timeout','10','--',sys.executable,'-c',command,str(marker)])
        try:
            deadline=time.monotonic()+3
            while not marker.exists() and time.monotonic()<deadline:time.sleep(.02)
            self.assertTrue(marker.exists());p.terminate();p.wait(timeout=5)
            result=json.loads((directory/'result.json').read_text());self.assertTrue(result['interrupted']);self.assertEqual(result['cleanup_status'],'PASS');self.assertEqual(result['remaining_children'],0)
        finally:
            if p.poll() is None:p.terminate();p.wait(timeout=5)
    def test_job_command_integration_binds_receipt_and_deletes_private_files(self):
        with patch.dict(os.environ,{'NODE_OPTIONS':'','NODE_PATH':''}):self.check_job_command_integration()
    def check_job_command_integration(self):
        j=pre.Job.__new__(pre.Job);j.work=Path(self.temp.name);j.evidence=j.work/'evidence';j.evidence.mkdir();j.seq=0;j.binding=lambda:BINDING
        self.assertEqual(j.command([sys.executable,'-c','print("OK")']),'OK\n')
        row=json.loads((j.evidence/'command-0001.json').read_text());self.assertEqual(row['binding'],BINDING);self.assertEqual(row['cleanup_status'],'PASS');self.assertFalse(list(j.work.glob('command-private-*')))
        with self.assertRaises(ValueError):j.command([sys.executable,'-c','import time;time.sleep(10)'],timeout=.2)
        row=json.loads((j.evidence/'command-0002.json').read_text());self.assertTrue(row['timeout']);self.assertEqual(row['remaining_owned_processes'],0);self.assertFalse(list(j.work.glob('command-private-*')))
    def test_output_overflow_is_bounded_failed_receipt(self):
        j=pre.Job.__new__(pre.Job);j.work=Path(self.temp.name);j.evidence=j.work/'evidence';j.evidence.mkdir();j.seq=0;j.binding=lambda:BINDING
        with patch.dict(os.environ,{'NODE_OPTIONS':'','NODE_PATH':''}):
            with self.assertRaises(ValueError):j.command([sys.executable,'-c','import sys;sys.stdout.write("X"*(9*1024*1024))'],timeout=2)
        row=json.loads((j.evidence/'command-0001.json').read_text());self.assertTrue(row['output_limit']);self.assertTrue(row['stdout_truncated']);self.assertFalse(list(j.work.glob('command-private-*')))

if __name__=='__main__':unittest.main()
