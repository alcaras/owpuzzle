# The unit panel does two jobs with one set of controls: it describes the
# unit you are about to PLACE, or the one you have SELECTED. Every check
# here is a way that ambiguity has confused an author.
#   usage: PORT=8123 server running, then python3 test/e2e/unit-panel.py
from playwright.sync_api import sync_playwright
fails=[]
def check(name, cond, extra=''):
    print(('  ok  ' if cond else '  FAIL')+' '+name+(('  '+str(extra)) if not cond else ''))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1200,'height':900})
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8123/editor.html'); pg.wait_for_timeout(600)
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(900)

    order = "(()=>{const h=document.getElementById('unit-tools');const k=[...h.children].map(c=>c.id).filter(Boolean);return k.indexOf('u-promo-block')<k.indexOf('u-type-block')})()"

    # --- placing mode ---
    check('mode line says placing', 'Placing' in pg.inner_text('#u-mode'), pg.inner_text('#u-mode'))
    check('type block is first while placing', pg.evaluate(order)==False)

    # set up a promoted unit to place, exactly the flow that looked broken
    pg.select_option('#u-type','UNIT_AXEMAN'); pg.wait_for_timeout(200)
    check('mode line names the picked type', 'axeman' in pg.inner_text('#u-mode'), pg.inner_text('#u-mode'))
    boxes = pg.query_selector_all('#u-promo-list input')
    val = boxes[0].get_attribute('value'); boxes[0].check(); pg.wait_for_timeout(150)

    # place two units
    pg.click('polygon[data-t="0,0"]'); pg.wait_for_timeout(300)
    saved = pg.evaluate("JSON.parse(localStorage.getItem('owpuzzle-editor-autosave')||'{}')")
    u0 = (saved.get('units') or [{}])[0]
    check('the unit I placed carries the promotion I checked',
          val in (u0.get('promotions') or []), u0)
    pg.click('polygon[data-t="1,0"]'); pg.wait_for_timeout(250)

    # --- select one: promos must come first, mode line must say editing ---
    pg.click('#board-wrap polygon[data-t="0,0"]', force=True); pg.wait_for_timeout(400)
    check('mode line says editing', 'Editing' in pg.inner_text('#u-mode'), pg.inner_text('#u-mode'))
    check('promotions come first when editing', pg.evaluate(order)==True)
    check('delete button is offered', pg.is_visible('#btn-unit-delete'))

    # --- Esc returns to placing AND restores what we were placing ---
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    check('Esc returns to placing', 'Placing' in pg.inner_text('#u-mode'), pg.inner_text('#u-mode'))
    check('type block is first again', pg.evaluate(order)==False)
    still = pg.evaluate("(v)=>{const b=[...document.querySelectorAll('#u-promo-list input')].find(x=>x.value===v);return b?b.checked:null}", val)
    check('the promotion I had queued up survived selecting a unit', still==True, still)

    check('no page errors', errs==[], errs)
    b.close()
print('FAILURES:', fails if fails else 'none')
