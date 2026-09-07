# Stacking in the editor: a unit may be placed on a friendly scout because the
# game lets them share a tile (Tile.canBothUnitsOccupy, Tile.cs:10428 — allies,
# exactly one able to damage). Anything the game refuses is a SELECT, not a
# stack: a warrior on a warrior, a red unit on a blue scout.
#   usage: PORT=8123 server running, then python3 test/e2e/stacking.py
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
    units = lambda: (pg.evaluate("JSON.parse(localStorage.getItem('owpuzzle-editor-autosave')||'{}')").get('units') or [])
    at = lambda q, r: [u for u in units() if u['q']==q and u['r']==r]

    # a blue scout, then a blue horseman on it -> two units on 0,0
    pg.select_option('#u-side','0'); pg.select_option('#u-type','UNIT_SCOUT'); pg.wait_for_timeout(150)
    pg.click('polygon[data-t="0,0"]'); pg.wait_for_timeout(300)
    pg.select_option('#u-type','UNIT_HORSEMAN'); pg.wait_for_timeout(150)
    pg.click('#board-wrap polygon[data-t="0,0"]', force=True); pg.wait_for_timeout(300)
    check('horseman stacks on the friendly scout', sorted(u['type'] for u in at(0,0))==['UNIT_HORSEMAN','UNIT_SCOUT'], at(0,0))
    check('placing leaves nothing selected', 'Placing' in pg.inner_text('#u-mode'), pg.inner_text('#u-mode'))

    # a warrior on a warrior: the second click selects, the count stays
    pg.select_option('#u-type','UNIT_WARRIOR'); pg.wait_for_timeout(150)
    pg.click('#board-wrap polygon[data-t="1,0"]', force=True); pg.wait_for_timeout(300)
    pg.click('#board-wrap polygon[data-t="1,0"]', force=True); pg.wait_for_timeout(300)
    check('warrior on warrior selects instead', len(at(1,0))==1 and 'Editing' in pg.inner_text('#u-mode'), (at(1,0), pg.inner_text('#u-mode')))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # both units of the stack are reachable by clicking: first, second, then placing
    pg.click('#board-wrap polygon[data-t="0,0"]', force=True); pg.wait_for_timeout(300)
    # the panel now describes a warrior, which cannot stack on a horseman -> select
    first = pg.input_value('#u-type')
    check('first click on the stack selects one of them', 'Editing' in pg.inner_text('#u-mode') and first in ('UNIT_SCOUT','UNIT_HORSEMAN'), (pg.inner_text('#u-mode'), first))
    pg.click('#board-wrap polygon[data-t="0,0"]', force=True); pg.wait_for_timeout(300)
    second = pg.input_value('#u-type')
    check('second click selects the other one', 'Editing' in pg.inner_text('#u-mode') and second != first and second in ('UNIT_SCOUT','UNIT_HORSEMAN'), (pg.inner_text('#u-mode'), second))
    pg.click('#board-wrap polygon[data-t="0,0"]', force=True); pg.wait_for_timeout(300)
    check('third click returns to placing', 'Placing' in pg.inner_text('#u-mode'), pg.inner_text('#u-mode'))
    check('cycling did not add or remove units', len(at(0,0))==2, at(0,0))

    # a red unit on the blue stack: hostiles never share -> select
    pg.select_option('#u-side','1'); pg.select_option('#u-type','UNIT_ARCHER'); pg.wait_for_timeout(150)
    pg.click('#board-wrap polygon[data-t="0,0"]', force=True); pg.wait_for_timeout(300)
    check('a red unit does not stack on blue', len(at(0,0))==2 and 'Editing' in pg.inner_text('#u-mode'), (at(0,0), pg.inner_text('#u-mode')))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # a red scout with a red spearman on it, then targets mode picks the spearman first
    pg.select_option('#u-type','UNIT_SCOUT'); pg.wait_for_timeout(150)
    pg.click('#board-wrap polygon[data-t="-1,0"]', force=True); pg.wait_for_timeout(300)
    pg.select_option('#u-type','UNIT_SPEARMAN'); pg.wait_for_timeout(150)
    pg.click('#board-wrap polygon[data-t="-1,0"]', force=True); pg.wait_for_timeout(300)
    check('a red spearman stacks on the red scout', sorted(u['type'] for u in at(-1,0))==['UNIT_SCOUT','UNIT_SPEARMAN'], at(-1,0))
    pg.select_option('#p-objective','killList'); pg.wait_for_timeout(300)
    pg.click('#mode-row [data-mode="targets"]'); pg.wait_for_timeout(300)
    pg.click('#board-wrap polygon[data-t="-1,0"]', force=True); pg.wait_for_timeout(300)
    def targeted():
        saved = pg.evaluate("JSON.parse(localStorage.getItem('owpuzzle-editor-autosave')||'{}')")
        us = saved.get('units') or []
        return [us[i]['type'] for i in ((saved.get('objective') or {}).get('targets') or [])]
    check('first target click picks the unit that can damage', targeted()==['UNIT_SPEARMAN'], targeted())
    pg.click('#board-wrap polygon[data-t="-1,0"]', force=True); pg.wait_for_timeout(300)
    check('second click moves the target to the scout', targeted()==['UNIT_SCOUT'], targeted())
    pg.click('#board-wrap polygon[data-t="-1,0"]', force=True); pg.wait_for_timeout(300)
    check('third click clears it', targeted()==[], targeted())

    check('no page errors', errs==[], errs)
    b.close()
print('FAILURES:', fails if fails else 'none')
