"""Strict bound prerequisite evidence validation; no existence-only success."""
from pathlib import Path
import json,re

PHASES=('init','sources','installed','utilities','tls','verify')
EXPECTED_STATUS={'init':'PASS','sources':'PASS','installed':'PASS','utilities':'PASS','tls':'PASS','verify':'PREREQUISITES_PASSED_REVIEW_REQUIRED'}

def require(value,label):
    if not value:raise ValueError(label)

def load_bound(directory,name,binding):
    path=directory/(name+'.json')
    require(path.is_file() and not path.is_symlink(),'Missing/unsafe '+name)
    data=json.loads(path.read_text())
    require(isinstance(data,dict) and data.get('binding')==binding,'Invalid binding '+name)
    return data

def validate(directory,binding,head,tree,main,zip_hash):
    require(set(binding)=={'schema','run_id','attempt','controller_commit'} and binding['schema']==2,'Binding schema')
    require(binding['run_id'].isdigit() and binding['attempt'].isdigit() and re.fullmatch('[0-9a-f]{40}',binding['controller_commit']),'Run/controller binding')
    require(not list(directory.glob('failure-*.json')),'Recorded phase failure')
    rows={}
    for phase in PHASES:
        state=load_bound(directory,'phase-'+phase,binding)
        require(state.get('status')=='PASS' and state.get('phase')==phase,'Incomplete phase '+phase)
        rows[phase]=load_bound(directory,phase,binding)
        require(rows[phase].get('status')==EXPECTED_STATUS[phase],'Failed result '+phase)
    require(rows['init'].get('v003_sha256')==zip_hash and rows['init'].get('native_product_run')=='NOT_RUN','Init package/scope')
    source=rows['sources']
    require((source.get('head'),source.get('tree'),source.get('main'),source.get('migration_count'))==(head,tree,main,46),'Source pin/count')
    require(isinstance(source.get('lockfile_sha256'),str) and re.fullmatch('[0-9a-f]{64}',source['lockfile_sha256']),'Lockfile binding')
    versions=rows['installed']
    require(re.fullmatch(r'v24\.\d+\.\d+',versions.get('node','')) and versions.get('pnpm')=='11.19.0' and versions.get('cli')=='2.117.0','Installed versions')
    require(rows['utilities'].get('trust_tools_present') is True,'Missing trust utilities')
    require(rows['tls'].get('trust_status')=='INSTALLED_NOT_VERIFIED','TLS preparation status')
    verified=rows['verify']
    require((verified.get('head'),verified.get('tree'))==(head,tree),'Verify pins')
    require(verified.get('tls_node_three_browsers')=='PASS' and verified.get('ports_checked')==[54320,54321,54322,54324,4319],'TLS/port result')
    require(isinstance(verified.get('docker_endpoint'),str) and verified['docker_endpoint'].startswith('unix:///'),'Local Docker result')
    require(verified.get('runner_os')=='Linux' and isinstance(verified.get('image_version'),str) and verified['image_version'] and isinstance(verified.get('docker_server_version'),str) and verified['docker_server_version'],'Runner/runtime identity')
    for key,minimum in [('docker_memory_bytes',7*1024**3),('disk_free_bytes',10*1024**3)]:
        require(type(verified.get(key)) is int and verified[key]>=minimum,'Capacity '+key)
    require(verified.get('native_product_run')=='NOT_RUN' and verified.get('mg03_closed') is False and verified.get('vm_survives_job') is False and verified.get('postgres_running_version')=='NOT_RUN' and verified.get('runtime_images')=='NOT_PREPARED','Verify scope')
    cleanup=load_bound(directory,'cleanup',binding)
    require(cleanup.get('status')=='PASS' and cleanup.get('failures')==[] and cleanup.get('tls_directory_absent') is True and cleanup.get('own_system_ca_absent') is True,'Cleanup result')
    commands=sorted(directory.glob('command-*.json'))
    require(commands,'Missing command receipts')
    require([p.name for p in commands]==[f'command-{i:04d}.json' for i in range(1,len(commands)+1)],'Command sequence')
    for path in commands:
        row=load_bound(directory,path.stem,binding)
        require(type(row.get('exit')) is int and row['exit']==0 and row.get('cleanup_status')=='PASS' and row.get('remaining_owned_processes')==0 and row.get('remaining_children')==0,'Failed command/resource receipt')
        require(all(row.get(key) is False for key in ['timeout','interrupted','residual_on_exit','output_limit']),'Incomplete command execution')
        require(row.get('errors')==[],'Command supervision error')
        require(isinstance(row.get('args'),list) and row['args'] and all(isinstance(x,str) for x in row['args']),'Command identity')
        require(all(isinstance(row.get(k),str) and re.fullmatch('[0-9a-f]{64}',row[k]) for k in ['stdout_sha256','stderr_sha256']),'Output hash binding')
        require(type(row.get('tracked_processes')) is int and row['tracked_processes']>=1,'Missing process observation')
    return {'status':'PREREQUISITES_PASSED_REVIEW_REQUIRED','native_product_run':'NOT_RUN','mg03_closed':False,'vm_survives_job':False,'cleanup_status':'PASS','validated_phases':list(PHASES),'validated_commands':len(commands)}
