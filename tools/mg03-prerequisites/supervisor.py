"""Isolated Linux command supervisor; only its descendants may be signalled."""
from pathlib import Path
import argparse,ctypes,json,os,select,signal,stat,subprocess,time

MAX_OUTPUT=8*1024*1024
CLEANUP_SECONDS=3

def proc_identity(host_pid,level):
    base=Path('/proc')/str(host_pid)
    fields=(base/'stat').read_text().rsplit(')',1)[1].split()
    status=(base/'status').read_text().splitlines()
    ns=next(x for x in status if x.startswith('NSpid:')).split()[1:]
    return {'host':host_pid,'pid':int(ns[level]),'parent':int(fields[1]),'start':int(fields[19])}

def run(args,directory,timeout,parent_pid=None):
    if not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal'):raise RuntimeError('pidfd supervision required')
    libc=ctypes.CDLL(None,use_errno=True)
    if libc.prctl(36,1,0,0,0)!=0:raise OSError(ctypes.get_errno(),'Subreaper unavailable')
    host_self=int(Path('/proc/self/stat').read_text().split()[0])
    ns=next(x for x in Path('/proc/self/status').read_text().splitlines() if x.startswith('NSpid:')).split()[1:]
    level=len(ns)-1
    def child_map():
        # Only kernel ancestry is read; no process-name/environment matching.
        # /proc task/children is not available on every Linux kernel.
        result={}
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit():continue
            try:
                data=(entry/'stat').read_text();host=int(data.split(' ',1)[0]);fields=data.rsplit(')',1)[1].split()
                result.setdefault(int(fields[1]),[]).append(host)
            except (FileNotFoundError,ProcessLookupError,PermissionError):continue
        return result
    if child_map().get(host_self):raise RuntimeError('Supervisor must begin without children')
    tracked={};errors=[];interrupted=[False];p=None
    signal.signal(signal.SIGTERM,lambda *_:interrupted.__setitem__(0,True))
    signal.signal(signal.SIGINT,lambda *_:interrupted.__setitem__(0,True))
    # Arm before launching anything; an already-dead expected parent must
    # prevent launch, because Linux does not replay a missed parent-death signal.
    expected_parent=os.getppid() if parent_pid is None else parent_pid
    if libc.prctl(1,signal.SIGTERM,0,0,0)!=0:raise OSError(ctypes.get_errno(),'Parent-death supervision unavailable')
    if os.getppid()!=expected_parent:interrupted[0]=True
    def discover():
        ancestry=child_map()
        pending=[host_self];seen=set()
        while pending:
            parent=pending.pop()
            if parent in seen:continue
            seen.add(parent)
            own=ancestry.get(parent,[])
            for host in own:
                fd=None
                try:
                    identity=proc_identity(host,level)
                    if identity['parent']!=parent:continue # Reparented: discovered on next own-tree pass.
                    key=(host,identity['start'])
                    if key not in tracked:
                        fd=os.pidfd_open(identity['pid'])
                        if proc_identity(host,level)!=identity:os.close(fd);fd=None;continue
                        tracked[key]={**identity,'fd':fd};fd=None
                    pending.append(host)
                except (FileNotFoundError,ProcessLookupError):pass
                except Exception as exc:errors.append(type(exc).__name__)
                finally:
                    if fd is not None:os.close(fd)
    def alive(row):return not select.select([row['fd']],[],[],0)[0]
    def terminate_owned():
        for row in tracked.values():
            if alive(row):
                try:signal.pidfd_send_signal(row['fd'],signal.SIGKILL)
                except ProcessLookupError:pass
                except Exception as exc:errors.append(type(exc).__name__)
    def reap():
        if p is not None:p.poll()
        for row in tracked.values():
            if p is not None and row['pid']==p.pid:continue
            try:os.waitpid(row['pid'],os.WNOHANG)
            except ChildProcessError:pass # Still parented to the command, not yet adopted.
    started=time.monotonic();timedout=False;residual=False;output_limit=False
    paths=[directory/'stdout.bin',directory/'stderr.bin']
    streams=[]
    try:
        for path in paths:
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);streams.append(os.fdopen(fd,'wb'))
        if not interrupted[0]:p=subprocess.Popen(args,stdout=streams[0],stderr=streams[1],start_new_session=True)
        while p is not None:
            discover();reap()
            output_limit=any(path.stat().st_size>MAX_OUTPUT for path in paths)
            timedout=time.monotonic()-started>=timeout
            if p.poll() is not None or timedout or output_limit or errors or interrupted[0]:break
            time.sleep(.02)
        discover()
        residual=p is not None and p.poll() is not None and any(alive(row) for row in tracked.values())
    except Exception as exc:errors.append(type(exc).__name__)
    finally:
        deadline=time.monotonic()+CLEANUP_SECONDS
        while time.monotonic()<deadline:
            try:discover();terminate_owned();reap()
            except Exception as exc:errors.append(type(exc).__name__)
            if not any(alive(row) for row in tracked.values()) and not child_map().get(host_self):break
            time.sleep(.02)
        reap()
        remaining=sum(alive(row) for row in tracked.values())
        untracked_children=len(child_map().get(host_self,[]))
        for stream in streams:stream.close()
        result={'exit':p.returncode if p else None,'timeout':timedout,'interrupted':interrupted[0],'residual_on_exit':residual,'output_limit':output_limit,'cleanup_status':'PASS' if not remaining and not untracked_children and not errors else 'FAIL','remaining_owned_processes':remaining,'remaining_children':untracked_children,'errors':errors,'tracked_processes':len(tracked),'seconds':round(time.monotonic()-started,3)}
        for row in tracked.values():os.close(row['fd'])
        temporary=directory/'result.tmp';temporary.write_text(json.dumps(result));os.chmod(temporary,0o600);os.replace(temporary,directory/'result.json')
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--timeout',type=float,required=True);parser.add_argument('--parent-pid',type=int);parser.add_argument('command',nargs=argparse.REMAINDER);args=parser.parse_args()
    directory=args.directory
    if directory.is_symlink() or not directory.is_dir() or stat.S_IMODE(directory.stat().st_mode)!=0o700:raise ValueError('Private owned command directory required')
    command=args.command[1:] if args.command[:1]==['--'] else args.command
    if not command or not 0<args.timeout<=600:raise ValueError('Bounded command required')
    if args.parent_pid is not None and args.parent_pid<=0:raise ValueError('Invalid parent identity')
    result=run(command,directory,args.timeout,args.parent_pid)
    return 0 if result['exit']==0 and result['cleanup_status']=='PASS' and not any(result[x] for x in ['timeout','interrupted','residual_on_exit','output_limit']) else 1

if __name__=='__main__':raise SystemExit(main())
