"""Synthetic outer-driver interruption tests; no product or provider runtime."""
import ctypes,json,os,signal,subprocess,sys,tempfile,time,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent

def probe(signum):
    # Scope orphan adoption to this disposable test process, never the test runner.
    assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
    with tempfile.TemporaryDirectory() as d:
        work=Path(d);marker=work/'started'
        driver='''import sys,os,subprocess
from pathlib import Path
sys.path.insert(0,sys.argv[1]);import prerequisites as pre
os.environ.pop('NODE_OPTIONS',None);os.environ.pop('NODE_PATH',None)
j=pre.Job.__new__(pre.Job);j.work=Path(sys.argv[2]);j.evidence=j.work/'evidence';j.evidence.mkdir();j.seq=0;j.binding=lambda:{'schema':2,'run_id':'12','attempt':'1','controller_commit':'a'*40}
real=pre.subprocess.Popen
def capture(*a,**k):
 p=real(*a,**k);(j.work/'wrapper').write_text(str(p.pid));return p
pre.subprocess.Popen=capture
command="import os,sys,time,json,subprocess;from pathlib import Path;c=subprocess.Popen([sys.executable,'-c','import time;time.sleep(15)'],start_new_session=True);Path(sys.argv[1]).write_text(json.dumps([os.getpid(),c.pid]));time.sleep(15)"
j.command([sys.executable,'-c',command,str(j.work/'started')],timeout=10)
'''
        p=subprocess.Popen([sys.executable,'-c',driver,str(HERE),str(work)],stderr=subprocess.DEVNULL)
        sibling=subprocess.Popen([sys.executable,'-c','import time;time.sleep(15)'])
        wrapper=None;reaped=False
        try:
            deadline=time.monotonic()+4
            while not marker.exists() and time.monotonic()<deadline:time.sleep(.02)
            assert marker.exists(),'Command did not start'
            wrapper=int((work/'wrapper').read_text());children=json.loads(marker.read_text())
            private=next(work.glob('command-private-*'))
            os.kill(p.pid,signum);p.wait(timeout=5)
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                try:
                    if os.waitpid(wrapper,os.WNOHANG)[0]:reaped=True;break
                except ChildProcessError:reaped=True;break # Driver already reaped it on SIGINT.
                time.sleep(.02)
            assert reaped,'Supervisor survived driver interruption'
            for pid in children:
                try:os.kill(pid,0)
                except ProcessLookupError:continue
                raise AssertionError('Owned command descendant survived')
            assert sibling.poll() is None,'Unrelated sibling was changed'
            if signum==signal.SIGINT:
                assert not private.exists(),'Private files removed before supervisor completion'
                row=json.loads((work/'evidence/command-0001.json').read_text())
                assert row['cleanup_status']=='FAIL' and row['errors']==['KeyboardInterrupt']
            else:
                row=json.loads((private/'result.json').read_text())
                assert row['interrupted'] and row['cleanup_status']=='PASS'
                assert row['remaining_owned_processes']==row['remaining_children']==0
                assert not (work/'evidence/command-0001.json').exists(),'Dead driver cannot attest success'
            print(json.dumps({'signal':signum,'owned_descendants_gone':True,'sibling_unchanged':True,'positive_driver_receipt':False}))
        finally:
            if p.poll() is None:p.kill();p.wait(timeout=2)
            if wrapper and not reaped:
                try:os.kill(wrapper,signal.SIGTERM)
                except ProcessLookupError:pass
                deadline=time.monotonic()+5
                while time.monotonic()<deadline:
                    try:
                        if os.waitpid(wrapper,os.WNOHANG)[0]:break
                    except ChildProcessError:break
                    time.sleep(.02)
                else:os.kill(wrapper,signal.SIGKILL);os.waitpid(wrapper,0)
            sibling.terminate();sibling.wait(timeout=2)

class DriverLifecycleRegression(unittest.TestCase):
    def test_actual_job_driver_term_kill_interrupt_clean_owned_only(self):
        for signum in [signal.SIGTERM,signal.SIGKILL,signal.SIGINT]:
            with self.subTest(signum=signum):
                result=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--probe',str(signum)],capture_output=True,text=True,timeout=15)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertTrue(json.loads(result.stdout)['owned_descendants_gone'])
    def test_already_missing_expected_parent_prevents_launch(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d)/'private';directory.mkdir(mode=0o700);marker=Path(d)/'must-not-start'
            p=subprocess.run([sys.executable,str(HERE/'supervisor.py'),'--directory',str(directory),'--timeout','1','--parent-pid',str(os.getpid()+1000000),'--',sys.executable,'-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text("wrong")',str(marker)],timeout=5,capture_output=True)
            self.assertNotEqual(p.returncode,0);self.assertFalse(marker.exists())
            row=json.loads((directory/'result.json').read_text());self.assertTrue(row['interrupted']);self.assertEqual(row['tracked_processes'],0);self.assertEqual(row['cleanup_status'],'PASS');self.assertIsNone(row['exit'])

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--probe':probe(int(sys.argv[2]))
    else:unittest.main()
