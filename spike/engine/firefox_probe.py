"""Firefox uses stock WebDriver, because system Firefox lacks Playwright's Juggler patch."""
import json,os
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait
for k in ['DISPLAY','WAYLAND_DISPLAY']:os.environ.pop(k,None)
opts=Options();opts.binary_location='/usr/bin/firefox';opts.add_argument('-headless')
r={}
try:
 with webdriver.Firefox(options=opts) as driver:
  driver.set_script_timeout(60);driver.get('http://127.0.0.1:5197');WebDriverWait(driver,30).until(lambda d:d.execute_script('return !!window.lab'))
  r['caps']=driver.execute_async_script('const done=arguments[0];lab.caps().then(done,e=>done({error:String(e)}));')
  r['init']=driver.execute_async_script('const done=arguments[0];lab.init().then(done,e=>done({error:String(e)}));')
  r['export']=driver.execute_async_script('const done=arguments[0];lab.exportFilm().then(done,e=>done({error:String(e)}));')
except Exception as e:r['error']=str(e)
Path('artifacts/firefox.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
