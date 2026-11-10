"""Preview and apply retention for generated static archives and desktop installers."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import stat
import sys

ARCHIVE = re.compile(r'backups/web-static-(\d{8}-\d{6})-[A-Za-z0-9]+/out\.tar\.gz$')
INSTALLER = re.compile(r'Helstera-(?:Setup-)?(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9_-]+)?\.(?:exe|dmg|AppImage|zip)(?:\.blockmap)?$')
MAX_FILES = 2000

def identity(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.resolve() != path.absolute(): raise ValueError('Retention only accepts regular files without linked parents')
    return {'size':info.st_size, 'mtimeNs':info.st_mtime_ns, 'inode':info.st_ino, 'device':info.st_dev, 'links':info.st_nlink}

def generated_path(root, relative):
    part = pathlib.PurePosixPath(relative)
    if part.is_absolute() or '..' in part.parts or '\\' in relative: raise ValueError('Unsafe retention path')
    archive = bool(ARCHIVE.fullmatch(relative))
    installer = relative.startswith('apps/web/out/downloads/') and INSTALLER.fullmatch(part.name)
    if not archive and not installer: raise ValueError('Path is not a generated release artifact')
    if installer and len(part.parts) not in (5,7): raise ValueError('Unexpected installer directory')
    if installer and len(part.parts)==7 and (part.parts[4]!='updates' or part.parts[5] not in ('windows-x64','macos-x64','macos-arm64','linux-x64')): raise ValueError('Unexpected update channel')
    target=root.joinpath(*part.parts)
    if root not in target.resolve().parents: raise ValueError('Retention path leaves root')
    return target

def channel_snapshot(downloads):
    snapshot = {}; versions = set()
    if not downloads.exists(): return snapshot, versions
    manifests = list(downloads.glob('desktop-release-*.json')) + list(downloads.glob('latest*.yml')) + list(downloads.glob('updates/*/latest*.yml'))
    for path in manifests:
        identity(path)
        text = path.read_text(encoding='utf-8')
        snapshot[path.relative_to(downloads).as_posix()] = hashlib.sha256(text.encode()).hexdigest()
        for match in re.finditer(r'(?<!\d)(\d+)\.(\d+)\.(\d+)(?!\d)',text): versions.add(tuple(map(int,match.groups())))
    return snapshot, versions

def preview(root):
    root = pathlib.Path(root).resolve(strict=True); downloads = root/'apps/web/out/downloads'
    channels, protected = channel_snapshot(downloads); files=[]
    archives=[]
    for path in (root/'backups').glob('web-static-*/out.tar.gz'):
        relative=path.relative_to(root).as_posix(); match=ARCHIVE.fullmatch(relative)
        if match: archives.append((match[1],relative,path))
    for _,relative,path in sorted(archives,reverse=True)[2:]: files.append({'path':relative, 'reason':'older_static_archive', **identity(path)})
    installers=[]
    for folder in [downloads, *[downloads/'updates'/platform for platform in ['windows-x64','macos-x64','macos-arm64','linux-x64']]]:
        for path in folder.glob('Helstera-*'):
            match=INSTALLER.fullmatch(path.name)
            if match: installers.append((tuple(map(int,match.groups())),path))
    # The fixed legacy AppImage upgrade acceptance needs 0.2.27 and 0.2.28.
    protected.update({(0,2,27),(0,2,28)})
    protected.update(sorted({version for version,_ in installers},reverse=True)[:3])
    for version,path in installers:
        if version not in protected:
            relative=path.relative_to(root).as_posix();generated_path(root,relative)
            files.append({'path':relative,'reason':'older_desktop_version',**identity(path)})
    if len(files)>MAX_FILES: raise RuntimeError('Retention inventory exceeds review limit')
    return {'version':1,'root':str(root),'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'channels':channels,'protectedVersions':['.'.join(map(str,v)) for v in sorted(protected)],'files':files,'candidateBytes':sum(file['size'] for file in files),'exclusiveBytes':sum(file['size'] for file in files if file['links']==1)}

def apply(root, plan):
    root=pathlib.Path(root).resolve(strict=True)
    if plan.get('version')!=1 or plan.get('root')!=str(root) or not isinstance(plan.get('files'),list) or len(plan['files'])>MAX_FILES: raise ValueError('Invalid retention plan')
    created=datetime.datetime.fromisoformat(plan['createdAt'])
    age=(datetime.datetime.now(datetime.timezone.utc)-created).total_seconds()
    if not 0<=age<=3600: raise ValueError('Retention preview has expired')
    current=preview(root); allowed={item['path']:item for item in current['files']}
    if current['channels']!=plan['channels']: raise RuntimeError('Published channels changed; preview again')
    seen=set()
    for entry in plan['files']:
        path=generated_path(root,entry['path'])
        if entry['path'] in seen or entry['path'] not in allowed: raise ValueError('Plan includes a protected or duplicate file')
        seen.add(entry['path'])
        if identity(path)!={key:entry[key] for key in ['size','mtimeNs','inode','device','links']}: raise RuntimeError('Retention file changed; nothing removed')
    assert_not_open(plan['files'])
    removed=[];errors=[];deleted_links={};released_bytes=0
    for entry in plan['files']:
        try:
            path=generated_path(root,entry['path'])
            inode=(entry['device'],entry['inode'])
            expected={key:entry[key] for key in ['size','mtimeNs','inode','device','links']}
            expected['links']-=deleted_links.get(inode,0)
            if identity(path)!=expected: raise RuntimeError('File changed during retention')
            path.unlink();removed.append(entry)
            deleted_links[inode]=deleted_links.get(inode,0)+1
            if expected['links']==1: released_bytes+=entry['size']
        except (OSError,ValueError,RuntimeError) as error:errors.append({'path':entry['path'],'error':str(error)});break
    return {'removedFiles':len(removed),'unlinkedBytes':sum(entry['size'] for entry in removed),'exclusiveBytes':released_bytes,'paths':[entry['path'] for entry in removed],'errors':errors}

def assert_not_open(entries):
    if sys.platform!='linux': return
    candidates={(entry['device'],entry['inode']) for entry in entries}
    for process in pathlib.Path('/proc').iterdir():
        if not process.name.isdigit(): continue
        try:
            for descriptor in (process/'fd').iterdir():
                try: info=descriptor.stat()
                except FileNotFoundError: continue
                if (info.st_dev,info.st_ino) in candidates:
                    raise RuntimeError('A retention candidate is open in process '+process.name)
        except FileNotFoundError: continue

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--plan');parser.add_argument('--apply');args=parser.parse_args()
    if args.apply:report=apply(args.root,json.loads(pathlib.Path(args.apply).read_text()))
    else:
        report=preview(args.root)
        if args.plan:
            path=pathlib.Path(args.plan);path.write_text(json.dumps(report,indent=2));os.chmod(path,0o600)
    print(json.dumps(report))
    if report.get('errors'):raise SystemExit(1)
if __name__=='__main__':main()
