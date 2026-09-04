# The par/pool controls in the editor: the automatic pool follows par, a custom
# pool is taken as given and floored at par, and both survive a round trip
# through Test play (the field must reach the autosave, not only the DOM).
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1200, 'height': 900})
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8123/editor.html'); pg.wait_for_timeout(600)
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(800)
    ok = True

    def check(label, got, want):
        global ok
        if got != want:
            ok = False; print('FAIL %s: %r != %r' % (label, got, want))
        else:
            print('ok   %s: %r' % (label, got))

    pg.fill('#p-orders', '3'); pg.wait_for_timeout(200)
    check('auto par 3', pg.inner_text('#pool-view'), 'players get 10 orders')
    check('custom field hidden', pg.is_visible('#p-pool'), False)
    pg.fill('#p-orders', '6'); pg.wait_for_timeout(200)
    check('auto par 6', pg.inner_text('#pool-view'), 'players get 15 orders')

    pg.select_option('#p-pool-mode', 'custom'); pg.wait_for_timeout(200)
    check('custom field shown', pg.is_visible('#p-pool'), True)
    pg.fill('#p-pool', '8'); pg.wait_for_timeout(200)
    check('custom 8 over par 6', pg.inner_text('#pool-view'), 'players get 8 orders (2 more than par)')
    pg.fill('#p-pool', '6'); pg.wait_for_timeout(200)
    check('custom equal to par', pg.inner_text('#pool-view'), 'players get exactly par — no slack at all')
    pg.fill('#p-pool', '2'); pg.wait_for_timeout(200)
    check('custom below par is floored', pg.inner_text('#pool-view'), 'players get exactly par — no slack at all')

    # and it reaches the autosave, which is what Test play and submit read
    pg.fill('#p-pool', '9'); pg.wait_for_timeout(300)
    saved = pg.evaluate('JSON.parse(localStorage.getItem("owpuzzle-editor-autosave")||"{}")')
    check('autosaved pool', saved.get('pool'), 9)
    check('autosaved par', saved.get('orders'), 6)

    pg.reload(); pg.wait_for_timeout(900)
    check('restored mode', pg.input_value('#p-pool-mode'), 'custom')
    check('restored pool', pg.input_value('#p-pool'), '9')

    pg.select_option('#p-pool-mode', 'auto'); pg.wait_for_timeout(300)
    saved = pg.evaluate('JSON.parse(localStorage.getItem("owpuzzle-editor-autosave")||"{}")')
    check('auto drops the pool field', 'pool' in saved, False)

    print('errors:', errs)
    b.close()
    sys.exit(0 if ok and not errs else 1)
