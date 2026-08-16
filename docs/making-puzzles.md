# Making puzzles

How to design an Old World combat puzzle that is worth solving, and prove it is
what you claim. Written for whoever picks this up next.

## The one thing that separates a good puzzle from a bad one

**The trick must be required, not merely available.**

Three of the five puzzles drafted in one sitting had to be withdrawn. Not
because they were easy — because the verifier found a line that reached the
same ceiling *without ever using the idea the puzzle was built around*. A
board where the clever move exists but a dull move scores the same is worse
than an easy puzzle: its lesson text is a lie, and a strong player who finds
the dull line learns to distrust everything the site tells them.

So the test is never "is there a beautiful line here?" It is:

> Does every line that reaches the ceiling go through the idea?

You cannot answer that by staring at the board. You designed the intended
line, so you are the last person who will spot the shortcut. Run the search.

## The shape that works

Pick **one** central paradox, then build a threshold that closes every other
door. The two puzzles that survived both work the same way:

- **The Ground He Wins** — the palton's first kill is worth almost nothing;
  what it buys is the *hill the dead man was standing on*, because from high
  ground its range goes 1 → 2 and reaches a longbowman screened behind the
  enemy line. The gate has **one more hit point than every support unit
  together can muster**, so the palton must land the last blow — and only the
  palton profits from the ground it wins.
- **Broken Sword** — the champion has 20 hp and the army, swinging in any
  order, musters exactly **19**. The shotelai's disarm buys the missing point,
  so it must strike first.

That is the design rule worth keeping: **pick the number that makes every
alternative fall exactly one short.** One is enough. One is better than ten,
because it is discoverable — the player can count.

## Mechanics worth building on

All verified against the game's source (see CLAUDE.md for where it lives).

| Idea | The rule that makes it work |
|---|---|
| **Rout chain** | A kill advances you into the vacated tile *if a further enemy is attackable from there*, and grants another attack — but **no movement**. |
| **Rout as transport** | The advance puts a unit where it could never walk. A palton routing onto a hill gains range 2. |
| **Seat manufacture** | Killing a unit creates the flank seat for the next kill. This is the key to Aran's *Left flank, right flank*. |
| **Tile reuse** | One unit takes a seat, routs away, a second walks in. A single tile serves two units in a turn. |
| **Flanking** | An ally on the tile **directly opposite** cancels the counterattack and adds an *additive* percent (COMMANDER_LEADER +100%). It is not a doubling. |
| **Polearm walls** | Spear/pike/conscript/hoplite/phalangite are immune to ROUT — they break chains — and they pin cavalry that ignores zone of control. |
| **Height** | A shot reaches `range + max(fromHeight − toHeight, 0)`. Hills give **no defence bonus**. |
| **Line of sight** | Mountains block shots; units never do. |
| **Disarm** | −20% strength for 2 turns, so it is a discount on every blow *after* it. Order matters. Worth +3 per maceman against a pikeman, +1 against a swordsman — check before designing around it. |
| **Panic / no escape** | A pushed target with nowhere to go is disarmed instead. Blocking the escape tiles with your own bodies is a real play. |
| **Zealot last stand** | Damage cannot take it below 1 hp — but splash can finish it. |

## Prove it against the POOL, not against par

Par is the tight number. **Play is not played at par**: `poolOrders` grants
par + 5 rounded up to a multiple of 5, so a par-2 board hands the player
**ten** orders. Every "is the idea required?" probe must run at the pool, or
it is answering a question nobody is asked.

This is not a hypothetical. Two of the nine promotion puzzles passed the
required-ness check at par and failed it at the pool:

- **Wounded and Meaner** — the spare orders bought a **rout chain**: the fresh
  axeman killed the soft target, advanced, and swung again, so the promotion
  was never needed. Fixed by making both reds polearms, which are rout-immune,
  so exactly two blows exist.
- **Don't Step Closer** — the spare orders bought a **walk around the water**
  to the "unreachable" archer. An undeclared tile is open ground; only some
  tiles had been walled.

Two habits fall out of that, and both are cheap:

- **Declare every tile** on a board whose difficulty depends on somewhere
  being unreachable. Undeclared is open.
- **Count the blows, not the orders.** Attacking sets `cooldown = 'ATTACK'`
  and nothing clears it, so each unit swings once — unless a kill routs it,
  which grants another attack and is exactly how an order surplus turns into
  extra damage. Polearms break that chain.

Watch for **collateral** too: an axeman's cleave splashed 2 onto a second red
standing next to its target and let a plain 7 finish a gate set at 9. Adjacent
reds share damage; separate them or budget for it.

`tools/promo_check.js` runs all of this — damage matrix, solvable at par, par
tight at par-1, and the idea required at the pool.

## Numbers first, board second

Damage is `6 × attackStrength / defendStrength` with all modifiers additive.
Never guess it. Common traps that have cost real time:

- a **spearman defending against cavalry** takes +50%, so it is the worst
  possible gate for a palton to break
- that bonus only applies **against melee attackers** — a palton *shooting* a
  spearman gets no penalty
- a **longbowman defends at strength 8**, so a palton's shot does 4, not the 8
  it does to an archer

Workflow that avoids all of this:

1. Sketch the board as a def file (`module.exports = {…}` in engine coords).
2. Print the damage matrix — every unit against every enemy from every seat it
   can reach. There is a helper pattern in `test/helpers.js`; a scratch script
   of twenty lines does it.
3. **Then** choose hit points, so the intended line works and every rival line
   is one short.
4. Verify. Tune. Verify again.

## Verifying

```
node tools/deploy_fight.js <puzzle.json|def.js> [pool] [seconds] [seedStrX10]
    LATE=n        cap on mid-fight moves (default: deepen 0,1,2,3)
    TOPK=n        keep only each unit's n best seats — finder mode, not a proof
    MODE=deploy   best-first over whole deployments, for large boards
node tools/verify2.js <puzzle.json|def.js> [pool] [seconds] [seedStrX10]
                  # kill-set bounds + deployment search; the big-board tool.
                  # Prints PROVEN only with its assumptions attached; a found
                  # line that meets the kill-set bound proves the ceiling
                  # without exhaustion. V2_WORKERS=n parallelises big boards.
node tools/compute_ceilings.js <id…>      # the independent implementation
```

Read the output carefully. **"search complete" is a claim, not a fact** — a
bound bug once had `deploy_fight` report 11 STR as complete on a puzzle whose
real answer was 19. What caught it was the *other* tool disagreeing. When a
ceiling matters, run both.

A search that times out gives a **lower bound**: the ceiling is at least this.
That is honest and publishable as best-known, but say so.

### Verification is a design constraint

Search cost scales with how many tiles the blue units might want. Few blue
units, and terrain that constrains where they can usefully stand, keeps a board
provable. A six-unit open board can be beyond exhaustive proof. **A puzzle
nobody can verify is a puzzle whose ceiling is a guess** — decide up front
whether you are building something provable or something you will publish as
best-known and monitor.

## Publishing checklist

1. The ceiling is proven (or explicitly best-known).
2. The intended line **is** the optimum — not merely *a* line that reaches it.
3. The trick is **required**: no cheaper line reaches the same ceiling.
4. Par is the fewest orders that reach the ceiling.
5. `npm test` passes, and `npm run test:ceilings` still proves every published
   ceiling — a rules change can invalidate an old puzzle silently.

House puzzles go in `web/puzzles.js` with `author: 'owpuzzle'` and a
`difficulty` (1 basics / 2 tactics / 3 challenges). Community puzzles live in
the database; approve them through the admin page.

To playtest without publishing, insert with `status: 'pending'` — the author
and admins can reach it by URL, and it stays out of the library.

## When a puzzle turns out to be beatable

The site records any line that beats a published par and flags it in the admin
panel with its replayable actions. That is either a better solution to fold in
or an engine bug that let it through, and only a human can tell which. Step
through it in the reviewer before deciding.
