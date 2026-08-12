import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1200,'height':900})
    ctx.add_cookies([{'name':'owp_session','value':'a'*64,'domain':'localhost','path':'/'}])
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8123/editor.html'); pg.wait_for_timeout(800)
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(800)
    pg.select_option('#u-side','0'); pg.select_option('#u-type','UNIT_SWORDSMAN')
    pg.click('polygon[data-t="0,0"]'); pg.wait_for_timeout(200)
    pg.select_option('#u-side','1'); pg.select_option('#u-type','UNIT_ARCHER'); pg.fill('#u-hp','')
    pg.click('polygon[data-t="1,0"]'); pg.wait_for_timeout(200)
    pg.select_option('#p-objective','maxKill')          # <-- the objective Aran used
    pg.fill('#p-name','MaxKill Draft Test'); pg.wait_for_timeout(300)
    pg.click('#btn-test'); pg.wait_for_timeout(1500)
    pg.click('#board-wrap polygon[data-t="0,0"]', force=True); pg.wait_for_timeout(400)
    pg.click('#board-wrap polygon[data-t="1,0"]', force=True); pg.wait_for_timeout(700)
    if pg.is_visible('#btn-endturn'):
        pg.click('#btn-endturn'); pg.wait_for_timeout(900)
    else:
        print('(turn ended on its own — no actions left)')
    print('result screen:', pg.inner_text('#result-body')[:90].replace(chr(10),' '))
    print('recording written:', pg.evaluate('!!localStorage.getItem("owpuzzle-draft-solution")'))
    pg.click('#btn-next'); pg.wait_for_timeout(1500)
    pg.click('#btn-submit'); pg.wait_for_timeout(2500)
    msg = pg.inner_text('#out')[:170].replace(chr(10),' ')
    print('submit says:', msg)
    print('errors:', errs)
    b.close()
    sys.exit(0 if msg.startswith('✓') else 1)
