"""Offline DOM regression checks. No provider or real prospect calls.
Source scripts run on about:blank; a test-only Python SHA-256 bridge substitutes
for unavailable WebCrypto there. Node tests exercise native WebCrypto.
Run: python experiments/prospect-desk/batch-ui-smoke.py [output-directory]
Requires Playwright and Chromium. Not a deployed-page or real sending test.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import re, json, hashlib, tempfile, shutil, os, sys
root=Path(__file__).resolve().parents[2]
assets=root/'web/public/prospect-desk'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='pipeline-batch-'))
out.mkdir(parents=True,exist_ok=True)
checks=[]
def check(name,value):
    assert value,name
    checks.append(name)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or pw.chromium.executable_path,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1388,'height':840})
    errors=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append(r.url))
    page.expose_function('testDigest',lambda data:list(hashlib.sha256(bytes(data)).digest()))
    page.set_content(re.sub(r'<script\b[^>]*>.*?</script>','',(assets/'index.html').read_text(),flags=re.S))
    page.evaluate("Object.defineProperty(globalThis,'crypto',{value:{subtle:{digest:async(_,b)=>new Uint8Array(await window.testDigest(Array.from(b))).buffer}},configurable:true})")
    source='\n'.join((assets/f).read_text() for f in ['prospect-core.mjs','fixtures.mjs','batch-fixtures.mjs','batch-core.mjs','ui.mjs'])
    source=re.sub(r'^import .*?;\n','',source,flags=re.M)
    source=re.sub(r'^export \{.*?\} from .*?;\n','',source,flags=re.M)
    source=re.sub(r'^export ','',source,flags=re.M)
    page.evaluate('()=>{'+source+'}')
    check('5 messages ready from 8 fixtures',page.locator('#batchCount').inner_text()=='5 messages prêts sur 8 contacts')
    check('three samples only',page.locator('#samples [data-message]').count()==3)
    check('batch approval directly available',page.locator('#approveBatch').is_enabled())
    check('no individual approval button',page.get_by_role('button',name=re.compile('suivant|valider ce message',re.I)).count()==0)
    check('exceptions separate and collapsed',not page.locator('.pp-checks').get_attribute('open'))
    check('no horizontal overflow desktop',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    check('main truly centered',page.evaluate("()=>{const r=document.querySelector('.pp-shell').getBoundingClientRect();return Math.abs(r.left-(innerWidth-r.width)/2)<2}"))
    check('batch action reachable at initial viewport',page.evaluate("()=>{const r=document.querySelector('#approveBatch').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}"))
    page.screenshot(path=str(out/'desktop.png'),full_page=True)
    # Approve without opening a single sample. All five, not only three, included.
    page.locator('#approveBatch').click();expect(page.locator('#batchSuccess')).to_be_visible()
    check('single click approves five',page.locator('#batchCount').inner_text()=='5 messages validés en une fois')
    check('no false send claim','Aucun message envoyé' in page.locator('#batchSuccess').inner_text())
    page.locator('#moreSamples').click()
    check('browsing other examples does not invalidate batch',page.locator('#batchSuccess').is_visible())
    check('other two drafts accessible',page.locator('#samples [data-message]').count()==2)
    page.locator('#moreSamples').click()
    page.locator('[data-message=p1]').click()
    expect(page.locator('#messageDialog')).to_be_visible()
    original=page.locator('#messageBody').input_value()
    page.locator('#messageBody').fill(original+' Merci.')
    page.locator('#saveMessage').click()
    check('edit invalidates full batch',page.locator('#batchSuccess').is_hidden() and page.locator('#approveBatch').is_enabled())
    check('no per-message validation introduced by edit','annulée' in page.locator('#batchNotice').inner_text())
    page.locator('#approveBatch').click();expect(page.locator('#batchSuccess')).to_be_visible()
    page.locator('[data-message=p1]').click()
    page.locator('#removeMessage').click()
    check('remove recalculates batch to four',page.locator('#batchCount').inner_text()=='4 messages prêts sur 8 contacts')
    check('remove invalidates approval',page.locator('#batchSuccess').is_hidden())
    page.locator('.pp-checks summary').click()
    page.locator('[data-restore=p1]').click()
    check('restore goes back to five',page.locator('#batchCount').inner_text()=='5 messages prêts sur 8 contacts')
    check('blocked cases have no restore controls',page.locator('[data-restore=p5],[data-restore=p6]').count()==0)
    page.locator('.pp-checks summary').click()
    page.locator('[data-message=p1]').click()
    page.locator('#messageBody').fill(original+' {Prenom}')
    page.locator('#saveMessage').click()
    check('bad edited draft is an exception not part of approval',page.locator('#batchCount').inner_text()=='4 messages prêts sur 8 contacts' and '2 à vérifier' in page.locator('#exceptionsSummary').inner_text())
    page.locator('#approveBatch').click();expect(page.locator('#batchSuccess')).to_be_visible()
    check('one click still approves other four',page.locator('#batchCount').inner_text()=='4 messages validés en une fois')
    page.locator('#reopenBatch').click()
    page.locator('.pp-checks summary').click()
    page.locator('[data-message=p1]').click();page.locator('#messageBody').fill(original);page.locator('#saveMessage').click()
    page.locator('.pp-checks summary').click()
    # Model the optional known Netlify injection. Its external iframe remains
    # forbidden by CSP and hidden, not allowed through a new frame-src exception.
    page.evaluate("()=>{const w=document.createElement('div');w.setAttribute('data-netlify-site-id','demo');w.setAttribute('data-netlify-deploy-id','fixture');w.style.cssText='position:fixed;bottom:0;height:100px;width:100%;z-index:999999';const f=document.createElement('iframe');f.src='https://app.netlify.com/';w.append(f);document.body.append(w)}")
    check('injected feedback wrapper cannot cover footer',page.locator('[data-netlify-site-id]').is_hidden())
    for width,height in [(390,844),(320,720),(1388,500)]:
        page.set_viewport_size({'width':width,'height':height})
        page.locator('#approveBatch').scroll_into_view_if_needed()
        check(f'no horizontal overflow at {width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        check(f'action visible and unobstructed at {width}',page.evaluate("()=>{const b=document.querySelector('#approveBatch');const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&b.contains(hit)}"))
        if width==390:page.screenshot(path=str(out/'mobile.png'),full_page=True)
    check('zero JavaScript errors',not errors)
    check('zero network requests',not requests)
    browser.close()
(out/'browser-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'networkRequests':requests,'scope':'Offline DOM, test SHA-256 bridge, simulated Netlify injection; not live deployment'},ensure_ascii=False,indent=2))
print(len(checks),'checks passed. Output:',out)
