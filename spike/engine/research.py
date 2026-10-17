"""Capture dated first-party metadata, not stars-as-quality conclusions."""
import subprocess,json,datetime
from pathlib import Path
A=Path(__file__).parent/'artifacts'
def gh(path):return json.loads(subprocess.check_output(['gh','api',path],text=True))
from typing import Any
r: dict[str, Any] = {'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
for repo in ['WebAV-Tech/WebAV','Vanilagy/mediabunny','diffusionstudio/core','Augani/openreel-video']:
 meta=gh('repos/'+repo);commit=gh('repos/'+repo+'/commits?per_page=1')[0];r[repo]={k:meta[k] for k in ['pushed_at','archived','default_branch','open_issues_count']};r[repo]['head']={'sha':commit['sha'],'date':commit['commit']['committer']['date']};r[repo]['license']=gh('repos/'+repo+'/license')['license']
r['webavIssues']=[{k:x[k] for k in ['number','title','updated_at','html_url']} for x in gh('repos/WebAV-Tech/WebAV/issues?state=open&per_page=100')]
pages=json.loads(subprocess.check_output(['gh','api','repos/WebAV-Tech/WebAV/forks?sort=newest&per_page=100','--paginate','--slurp'],text=True));forks=sum(pages,[]);r['forksScanned']=len(forks);r['recentForks']=[]
for f in forks:
 if f['pushed_at']>r['WebAV-Tech/WebAV']['pushed_at']:
  c=gh('repos/WebAV-Tech/WebAV/compare/main...'+f['owner']['login']+':WebAV:'+f['default_branch'])
  r['recentForks'].append({'name':f['full_name'],'pushed_at':f['pushed_at'],**{k:c[k] for k in ['status','ahead_by','behind_by']},'commits':[{'sha':x['sha'],'message':x['commit']['message']}for x in c['commits']]})
for interface in ['VideoEncoder','VideoDecoder','AudioEncoder','AudioDecoder']:
 raw=subprocess.check_output(['curl','-fsSL','https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/'+interface+'.json'],text=True);data=json.loads(raw)['api'][interface]['__compat'];r[interface+'BrowserCompat']={'support':data['support'],'source':data.get('mdn_url')}
(A/'research.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
