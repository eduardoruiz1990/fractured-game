# The boss that ended every run

**Type:** Game design · **Image:** a screenshot of The Panopticon fight (take one on floor 3, or use the dev panel's SPAWN ALL 5 BOSSES with `0` on the title screen)

---

FRACTURED has five floors and five bosses. The fifth, the Architect, is meant to be the wall. For a long time it wasn't, because almost nobody reached it.

The third boss, **The Panopticon**, was ending runs. I didn't know how badly until I built a tool to measure it.

## Letting the game play itself

I wrote a simulator that plays complete runs with no screen: a scripted player that moves, dodges and picks upgrades, at a few different skill levels, from a brand-new player to someone who has unlocked a lot. It reports where each run ends and what did the damage.

Ten runs per profile. Before the fix, **The Panopticon killed 100% of them.** Every skill level. Every time.

## What was wrong

The Panopticon is a giant eye that sweeps a beam across the room and finishes with a ring of bolts. On paper that's fine. In practice:

- Its beam turned faster than you could get out of it.
- It followed you a little too well, so running around it didn't work.
- The final ring had 18 bolts out of a possible 30, with gaps too small to slip through.
- It had so much health that you had to survive all of that for too long.

## What changed

- Health: 4,000 → **2,600**
- Sweep speed: 15 → **9**, and a shorter sweep
- Tracking: slightly slower, so circling it now works
- Final ring: **14 bolts out of 16**, with real gaps you can read and dodge
- Contact damage: 40 → **26**

## After

Same simulator, same profiles:

- Brand-new players: **10%** now die to it.
- Competent players: **about half** do. It's still the first real test.
- The Architect is now where most runs end, which is where they should.
- One simulated brand-new player cleared all five floors.

That last one is my favourite number. The run is beatable on your first try, if you play well.

If you've been stuck on floor 3, give it another go and let me know how it feels.
