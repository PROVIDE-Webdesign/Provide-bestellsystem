"""VM prerequisites only. Never import Runner/preflight or start a product stack."""
from pathlib import Path
import argparse, hashlib, importlib.util, json, os, platform, re, shutil, signal, socket, stat, subprocess, time, zipfile, sys, tempfile

HEAD='cbc78a2240eba05840b6cd712c89025bb6377635'
TREE='ddb303c30e0346194cbd28eb5d64e4e0f8cb3310'
MAIN='c3530b2dacdb814cfc2cc47664ab23b11ce878d0'
ZIP_HASH='7b083e761a2d113c6d91055261789971c752eb9ed38426558a65c42e527713ab'
BASE=Path(__file__).resolve().parent
from evidence import validate
PORTS=(54320,54321,54322,54324,4319)

def require(condition,message):
    if not condition:raise ValueError(message)

def safe_environment(parent,extra=None):
    extra=extra or {}
    for source in [parent,extra]:
        require(source.get('NODE_TLS_REJECT_UNAUTHORIZED') in (None,'1'),'Unsafe TLS override rejected before launch')
        require(not source.get('NODE_OPTIONS') and not source.get('NODE_PATH'),'Uncontrolled Node runtime override rejected')
    require(set(extra)<=set(['DOCKER_HOST','NODE_EXTRA_CA_CERTS']),'Uncontrolled command environment additions')
    env={k:v for k,v in parent.items() if not re.search(r'(TOKEN|SECRET|PASSWORD|SUPABASE|STRIPE|CLOUDFLARE|RENDER|DATABASE_|TEST_|AWS_|AZURE_|GOOGLE_|NODE_)',k)}
    env.update(extra);env['NODE_TLS_REJECT_UNAUTHORIZED']='1'
    return env

def owned_job(env):
    require(env.get('GITHUB_ACTIONS')=='true' and env.get('RUNNER_ENVIRONMENT')=='github-hosted','New GitHub-hosted VM required')
    require(env.get('GITHUB_REPOSITORY')=='PROVIDE-Webdesign/Provide-bestellsystem','Wrong repository')
    require(env.get('GITHUB_EVENT_NAME')=='workflow_dispatch','Manual dispatch required')
    run,attempt=env.get('GITHUB_RUN_ID',''),env.get('GITHUB_RUN_ATTEMPT','')
    require(run.isdigit() and attempt.isdigit(),'Missing run identity')
    parent=Path(env['RUNNER_TEMP']).resolve()
    job=Path(env['MG03_JOB_DIR'])
    require(job.is_absolute() and job.name==f'provide-mg03-prerequisites-{run}-{attempt}' and job.parent.resolve()==parent and not job.is_symlink(),'Unowned job path')
    return job

def local_docker(context,env):
    require(not env.get('DOCKER_CONTEXT'),'Docker override rejected')
    endpoint=env.get('DOCKER_HOST') or context['Endpoints']['docker']['Host']
    require(endpoint.startswith('unix:///') and not any(x in endpoint for x in ['?', '#','\n']),'Remote Docker rejected')
    return endpoint

def unpack(source,target):
    require(hashlib.sha256(source.read_bytes()).hexdigest()==ZIP_HASH,'V003 ZIP hash mismatch')
    require(not target.exists(),'Package directory already exists')
    with zipfile.ZipFile(source) as archive:
        names=archive.namelist();require(len(names)==len(set(names))==67,'V003 member set mismatch')
        for item in archive.infolist():
            p=Path(item.filename)
            require(not p.is_absolute() and '..' not in p.parts and not stat.S_ISLNK(item.external_attr >> 16),'Unsafe archive member')
        require(archive.testzip() is None,'ZIP CRC failure')
        archive.extractall(target)
    manifest=json.loads((target/'manifest.json').read_text())
    expected={r['path'] for r in manifest['files']}
    actual={p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file() and p.name!='manifest.json'}
    require(actual==expected,'Manifest member mismatch')
    for row in manifest['files']:
        data=(target/row['path']).read_bytes()
        require(len(data)==row['size'] and hashlib.sha256(data).hexdigest()==row['sha256'],'Manifest payload mismatch')
    require((manifest['main'],manifest['head'],manifest['tree'])==(MAIN,HEAD,TREE),'Manifest pins differ')
    return manifest

class Job:
    def __init__(self):
        self.work=owned_job(os.environ)
        self.repo=Path(os.environ['GITHUB_WORKSPACE'])/'product'
        self.package=self.work/'v003';self.evidence=self.work/'evidence';self.tls=self.work/'tls'
        self.nickname='provide-mg03-'+self.work.name
        self.ca_path=Path('/usr/local/share/ca-certificates')/(self.nickname+'.crt')
        self.nss=Path.home()/'.pki/nssdb'
        self.seq=0
        if self.evidence.exists():self.seq=len(list(self.evidence.glob('command-*.json')))
    def binding(self):
        return {'schema':2,'run_id':os.environ['GITHUB_RUN_ID'],'attempt':os.environ['GITHUB_RUN_ATTEMPT'],'controller_commit':os.environ['GITHUB_SHA']}
    def command(self,args,timeout=180,cwd=None,extra=None):
        env=safe_environment(os.environ,extra)
        self.seq+=1
        private=Path(tempfile.mkdtemp(prefix='command-private-',dir=self.work))
        wrapper=None
        try:
            wrapper=subprocess.Popen([sys.executable,str(BASE/'supervisor.py'),'--directory',str(private),'--timeout',str(timeout),'--parent-pid',str(os.getpid()),'--',*args],cwd=cwd,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
            try:wrapper.wait(timeout=timeout+8)
            except subprocess.TimeoutExpired:
                wrapper.terminate()
                try:wrapper.wait(timeout=5)
                except subprocess.TimeoutExpired:wrapper.kill();wrapper.wait(timeout=2)
                raise ValueError('Supervisor failed to produce a bounded result')
            receipt=json.loads((private/'result.json').read_text())
            output=[]
            for name in ['stdout','stderr']:
                path=private/(name+'.bin')
                truncated=path.stat().st_size>8*1024*1024
                with path.open('rb') as stream:data=stream.read(8*1024*1024)
                receipt[name+'_truncated']=truncated
                receipt['output_limit']=receipt['output_limit'] or truncated
                output.append(data);receipt[name+'_sha256']=hashlib.sha256(data).hexdigest()
            self.record(f'command-{self.seq:04d}',{**receipt,'args':args})
            require(wrapper.returncode==0 and receipt['exit']==0 and receipt['cleanup_status']=='PASS' and receipt['remaining_owned_processes']==0 and receipt['remaining_children']==0 and not any(receipt[k] for k in ['timeout','interrupted','residual_on_exit','output_limit']),'Prerequisite command failed or resources remained: '+args[0])
            return output[0].decode('utf8',errors='strict')
        except BaseException as exc:
            # KeyboardInterrupt must stop supervision before private files are
            # removed. SIGTERM/SIGKILL of this driver is covered by PDEATHSIG.
            if wrapper is not None and wrapper.poll() is None:
                wrapper.terminate()
                try:wrapper.wait(timeout=5)
                except subprocess.TimeoutExpired:wrapper.kill();wrapper.wait(timeout=2)
            if not (self.evidence/f'command-{self.seq:04d}.json').exists():
                self.record(f'command-{self.seq:04d}',{'args':args,'exit':None,'cleanup_status':'FAIL','errors':[type(exc).__name__],'resource_state':'UNVERIFIED'})
            raise
        finally:
            shutil.rmtree(private)
    def init(self):
        require(not self.work.exists(),'Job directory already exists')
        self.work.mkdir(mode=0o700);self.evidence.mkdir(mode=0o700)
        unpack(BASE/'v003.zip',self.package)
        self.record('phase-init',{'phase':'init','status':'RUNNING'})
        self.record('init',{'status':'PASS','v003_sha256':ZIP_HASH,'run_id':os.environ['GITHUB_RUN_ID'],'attempt':os.environ['GITHUB_RUN_ATTEMPT'],'controller_commit':os.environ['GITHUB_SHA'],'native_product_run':'NOT_RUN'})
    def record(self,name,data):
        payload={**data,'binding':self.binding()}
        temporary=self.evidence/(name+'.tmp')
        temporary.write_text(json.dumps(payload,indent=2));os.chmod(temporary,0o600)
        os.replace(temporary,self.evidence/(name+'.json'))
    def sources(self):
        git=lambda *args:self.command(['git',*args],cwd=self.repo).strip()
        require(git('rev-parse','HEAD')==HEAD and git('rev-parse','HEAD^{tree}')==TREE,'Candidate pin differs')
        require(not git('status','--porcelain','--untracked-files=normal'),'Candidate is dirty')
        git('merge-base','--is-ancestor',MAIN,HEAD)
        for group,ref in [('baseline',MAIN),('additions',HEAD)]:
            for f in (self.package/group).glob('*.sql'):
                # Compare raw bytes, not text decoding/newline transformations.
                blob=git('rev-parse',ref+':supabase/migrations/'+f.name)
                require(blob==hashlib.sha1(b'blob '+str(f.stat().st_size).encode()+b'\0'+f.read_bytes()).hexdigest(),'Original migration differs')
        pkg=json.loads((self.repo/'package.json').read_text());require(pkg['packageManager']=='pnpm@11.19.0','Project pnpm differs')
        self.record('sources',{'status':'PASS','head':HEAD,'tree':TREE,'main':MAIN,'migration_count':46,'lockfile_sha256':hashlib.sha256((self.repo/'pnpm-lock.yaml').read_bytes()).hexdigest()})
    def installed(self):
        node=self.command(['node','--version']).strip();pnpm=self.command(['pnpm','--version']).strip();cli=self.command(['supabase','--version']).strip().splitlines()[0]
        require(node.startswith('v24.') and pnpm=='11.19.0' and cli=='2.117.0','Installed version pins differ')
        self.record('installed',{'status':'PASS','node':node,'pnpm':pnpm,'cli':cli})
    def utilities(self):
        require(all(shutil.which(x) for x in ['openssl','certutil','sudo','update-ca-certificates']),'Trust tools absent')
        self.record('utilities',{'status':'PASS','trust_tools_present':True})
    def make_tls(self):
        self.tls.mkdir(mode=0o700)
        cfg=self.tls/'openssl.cnf'
        cfg.write_text('[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=MG03 local prerequisites\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n')
        # A private directory plus umask protects keys from their creation onward.
        prior=os.umask(0o077)
        try:
            self.command(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',str(cfg),'-extensions','ca','-keyout',str(self.tls/'ca.key'),'-out',str(self.tls/'ca.pem')])
            self.command(['openssl','req','-new','-newkey','rsa:2048','-nodes','-config',str(cfg),'-keyout',str(self.tls/'key.pem'),'-out',str(self.tls/'server.csr')])
            self.command(['openssl','x509','-req','-in',str(self.tls/'server.csr'),'-CA',str(self.tls/'ca.pem'),'-CAkey',str(self.tls/'ca.key'),'-CAcreateserial','-days','1','-extfile',str(cfg),'-extensions','server','-out',str(self.tls/'cert.pem')])
        finally:os.umask(prior)
        require(not self.ca_path.exists(),'Own CA trust name already exists')
        self.record('trust-created',{'status':'PENDING','system_ca':str(self.ca_path),'nss_nickname':self.nickname})
        self.command(['sudo','install','-m','0644',str(self.tls/'ca.pem'),str(self.ca_path)])
        self.command(['sudo','update-ca-certificates'])
        require(not self.nss.is_symlink(),'NSS path is symlink')
        self.nss.mkdir(parents=True,exist_ok=True)
        if not (self.nss/'cert9.db').exists():self.command(['certutil','-N','-d','sql:'+str(self.nss),'--empty-password'])
        self.command(['certutil','-A','-d','sql:'+str(self.nss),'-n',self.nickname,'-t','C,,','-i',str(self.tls/'ca.pem')])
        self.command(['node',str(BASE/'firefox-trust.mjs'),'install',str(self.repo),str(self.work)])
        self.record('trust-created',{'status':'INSTALLED_NOT_VERIFIED','system_ca':str(self.ca_path),'nss_nickname':self.nickname})
        self.record('tls',{'status':'PASS','trust_status':'INSTALLED_NOT_VERIFIED'})
    def verify(self):
        require(platform.system()=='Linux' and platform.machine()=='x86_64','Linux x64 required')
        require(self.command(['node','--version']).strip().startswith('v24.'),'Node pin differs')
        require(self.command(['pnpm','--version']).strip()=='11.19.0','pnpm pin differs')
        require(self.command(['supabase','--version']).strip().splitlines()[0]=='2.117.0','CLI pin differs')
        context=json.loads(self.command(['docker','context','inspect']));require(len(context)==1,'Ambiguous Docker context')
        endpoint=local_docker(context[0],os.environ)
        require(Path(endpoint[len('unix://'):]).is_socket(),'Local Docker socket absent')
        info=json.loads(self.command(['docker','info','--format','{{json .}}'],extra={'DOCKER_HOST':endpoint}))
        require(info['MemTotal']>=7*1024**3,'Docker memory below 8-GB class')
        for cmd in [['supabase','start','--help'],['supabase','stop','--help'],['supabase','migration','up','--help'],['supabase','db','advisors','--help']]:self.command(cmd,cwd=self.repo)
        for port in PORTS:
            with socket.socket() as sock:sock.bind(('127.0.0.1',port))
        free=shutil.disk_usage(self.work).free;require(free>=10*1024**3,'Less than 10 GiB free after installation')
        for name in ['ca.key','key.pem']:require(stat.S_IMODE((self.tls/name).stat().st_mode)==0o600,'Private TLS permissions differ')
        self.command(['openssl','verify','-CAfile',str(self.tls/'ca.pem'),str(self.tls/'cert.pem')])
        self.command(['openssl','x509','-in',str(self.tls/'cert.pem'),'-noout','-checkip','127.0.0.1'])
        self.command(['node',str(BASE/'imports.mjs'),str(self.repo)],timeout=90)
        self.command(['node',str(self.package/'tls-preflight.mjs'),str(self.repo),str(self.tls)],timeout=120,extra={'NODE_EXTRA_CA_CERTS':str(self.tls/'ca.pem')})
        self.sources()  # Freeze checks again after install/build/TLS; no tracked mutation allowed.
        # A prerequisite PASS never represents a DB/PG image or surviving VM.
        self.record('verify',{'status':'PREREQUISITES_PASSED_REVIEW_REQUIRED','head':HEAD,'tree':TREE,'docker_server_version':info['ServerVersion'],'docker_endpoint':endpoint,'docker_memory_bytes':info['MemTotal'],'disk_free_bytes':free,'image_version':os.environ.get('ImageVersion'),'runner_os':os.environ.get('RUNNER_OS'),'ports_checked':list(PORTS),'tls_node_three_browsers':'PASS','native_product_run':'NOT_RUN','postgres_running_version':'NOT_RUN','runtime_images':'NOT_PREPARED','mg03_closed':False,'vm_survives_job':False})
    def cleanup(self):
        failures=[]
        def attempt(name,fn):
            try:fn()
            except Exception as exc:failures.append({'step':name,'error_class':type(exc).__name__})
        if (self.evidence/'trust-created.json').exists():
            attempt('firefox-own-policy',lambda:self.command(['node',str(BASE/'firefox-trust.mjs'),'remove',str(self.repo),str(self.work)]))
            def remove_nss():
                # Listing own nickname distinguishes absent from failed removal.
                listing=self.command(['certutil','-L','-d','sql:'+str(self.nss)],timeout=30)
                if self.nickname in listing:self.command(['certutil','-D','-d','sql:'+str(self.nss),'-n',self.nickname])
            attempt('nss-own-trust',remove_nss)
            attempt('system-own-trust',lambda:self.command(['sudo','rm','-f','--',str(self.ca_path)]))
            attempt('refresh-system-trust',lambda:self.command(['sudo','update-ca-certificates']))
        attempt('private-tls-files',lambda:shutil.rmtree(self.tls) if self.tls.exists() else None)
        if self.evidence.exists():
            self.record('cleanup',{'status':'FAIL' if failures else 'PASS','failures':failures,'tls_directory_absent':not self.tls.exists(),'own_system_ca_absent':not self.ca_path.exists()})
            try:summary=validate(self.evidence,self.binding(),HEAD,TREE,MAIN,ZIP_HASH)
            except Exception as exc:summary={'status':'PREREQUISITES_INCOMPLETE_OR_FAILED','validation_error_class':type(exc).__name__,'native_product_run':'NOT_RUN','mg03_closed':False,'vm_survives_job':False,'cleanup_status':'FAIL' if failures else 'PASS'}
            self.record('summary',summary)
        require(not failures,'Prerequisite cleanup incomplete')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['init','sources','installed','utilities','tls','verify','cleanup']);args=parser.parse_args()
    job=Job()
    try:
        if args.phase not in ['init','cleanup']:job.record('phase-'+args.phase,{'phase':args.phase,'status':'RUNNING'})
        getattr(job,{'tls':'make_tls'}.get(args.phase,args.phase))()
        if args.phase!='cleanup':job.record('phase-'+args.phase,{'phase':args.phase,'status':'PASS'})
    except Exception as exc:
        if job.evidence.exists():
            job.record('failure-'+args.phase,{'status':'FAIL','phase':args.phase,'error_class':type(exc).__name__,'native_product_run':'NOT_RUN'})
            if args.phase!='cleanup':job.record('phase-'+args.phase,{'phase':args.phase,'status':'FAIL'})
        raise

if __name__=='__main__':main()
