"""Offline DOM tests: no network, no real prospect, no provider calls.
Browser navigation is disabled in the review environment; about:blank with
set_content and the exact source scripts is used. SHA-256 is bridged to Python
only in this test harness. This is not a deployed HTTPS/Safari/Retell test.
Run: python experiments/prospect-desk/simple-ui-smoke.py
Requires: Python, Playwright and Chromium (or set CHROMIUM_PATH).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import re, json, hashlib, tempfile, shutil, os
root = Path(__file__).resolve().parents[2]
assets = root / 'web/public/prospect-desk'
output = Path(tempfile.mkdtemp(prefix='pipeline-simple-'))
results = []
def check(name, condition):
    assert condition, name
    results.append(name)

with sync_playwright() as pw:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or pw.chromium.executable_path
    browser = pw.chromium.launch(executable_path=executable, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':1080})
    errors = []; requests = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    page.expose_function('testDigest', lambda data: list(hashlib.sha256(bytes(data)).digest()))
    page.set_content(re.sub(r'<script type="module".*?</script>', '', (assets/'index.html').read_text()))
    page.evaluate("Object.defineProperty(globalThis, 'crypto', {value:{subtle:{digest: async(_,bytes)=>new Uint8Array(await window.testDigest(Array.from(bytes))).buffer}}, configurable:true})")
    source = '\n'.join((assets/f).read_text() for f in ['prospect-core.mjs','fixtures.mjs','ui.mjs'])
    source = re.sub(r'^import .*?;\n', '', source, flags=re.M)
    source = re.sub(r'^export ', '', source, flags=re.M)
    page.evaluate('()=>{'+source+'}')
    check('four relevant prospects only', page.locator('#remaining').inner_text()=='4 messages à relire')
    check('first contact displayed', page.locator('#company').inner_text()=='Aster Boucle')
    check('details hidden by default', page.locator('#contextDetails').get_attribute('open') is None)
    check('channels hidden by default', page.locator('#channelDetails').get_attribute('open') is None)
    check('no mission selector', page.locator('select').count()==0)
    check('no send button', page.get_by_role('button',name=re.compile('envoyer',re.I)).count()==0)
    check('approval available', page.locator('#approve').is_enabled())
    page.screenshot(path=str(output/'desktop.png'),full_page=True)
    original=page.locator('#message').input_value()
    page.locator('#message').fill(original+' {Prenom}')
    check('unresolved variable blocks approval',page.locator('#approve').is_disabled())
    page.locator('#message').fill(original)
    page.locator('#channelDetails summary').click()
    check('no WhatsApp without consent',page.locator('[data-channel=whatsapp]').is_disabled())
    page.locator('[data-channel=linkedin]').click()
    check('LinkedIn offered manually',page.locator('#channelLabel').inner_text()=='LinkedIn' and 'manuelles' in page.locator('#channelNotice').inner_text())
    page.locator('[data-channel=email]').click()
    check('edited draft preserved when switching channel',page.locator('#message').input_value()==original)
    page.locator('#approve').click()
    expect(page.locator('#company')).to_have_text('Boréal Calcul')
    check('approve advances automatically',page.locator('#approvedCount').inner_text()=='1')
    page.locator('#undoButton').click()
    check('undo restores previous contact',page.locator('#company').inner_text()=='Aster Boucle' and page.locator('#approvedCount').inner_text()=='0')
    page.locator('#approve').click();expect(page.locator('#company')).to_have_text('Boréal Calcul')
    page.locator('#skip').click()
    check('skip advances without excluding',page.locator('#company').inner_text()=='Hameau Études')
    page.locator('#approve').click();expect(page.locator('#company')).to_have_text('Récif Capital')
    page.locator('#channelDetails summary').click()
    check('fictitious consent enables WhatsApp draft',page.locator('[data-channel=whatsapp]').is_enabled())
    page.locator('[data-channel=whatsapp]').click()
    check('WhatsApp content explicit draft-only',not page.locator('#subjectWrap').is_visible() and 'Brouillon seulement' in page.locator('#channelNotice').inner_text())
    page.locator('#approve').click();page.wait_for_selector('#done',state='visible')
    check('end state does not imply sent','3 messages validés' in page.locator('#doneText').inner_text() and 'Rien' in page.locator('#doneText').inner_text())
    page.locator('#showApproved').click();page.wait_for_selector('#historyDialog[open]')
    check('history distinguishes passed','Pour plus tard' in page.locator('#history').inner_text())
    check('blocked cases still excluded',page.locator('#heldSummary').inner_text()=='3 contacts non proposés')
    page.locator('[data-open=p1]').click()
    check('reopening demands fresh approval',page.locator('#approvedCount').inner_text()=='2' and page.locator('#company').inner_text()=='Aster Boucle')
    page.locator('#message').fill(original.replace('20 minutes','quinze minutes'))
    page.locator('#approve').click();expect(page.locator('#done')).to_be_visible()
    page.locator('#resume').click()
    check('passed contact recoverable',page.locator('#company').inner_text()=='Boréal Calcul')
    page.set_viewport_size({'width':390,'height':844})
    check('mobile no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
    check('mobile has direct editing',page.locator('#message').is_editable())
    page.screenshot(path=str(output/'mobile.png'),full_page=True)
    check('zero Javascript errors',not errors)
    check('zero network requests',not requests)
    browser.close()
(output/'browser-results.json').write_text(json.dumps({'passed':len(results),'tests':results,'errors':errors,'networkRequests':requests,'scope':'offline DOM; test-only SHA-256 bridge; not a deployed browser or live provider test'},ensure_ascii=False,indent=2))
print(len(results),'checks passed. Output:',output)
