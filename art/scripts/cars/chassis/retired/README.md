# Retired chassis

These fifteen chassis models (Needle, Turtle, Crab, Cobra, Scorpion, Buggy, Chameleon, Brick,
Wagon, Rammer, Drifter, Kangaroo, Horseshoe, Twins, Platform) were retired by product-owner
decision on October 11, 2026 (docs/DECISIONS.md, entry 87). The game ships five chassis:
Beetle, Arrow, Pickup, Spider and Trike.

Nothing here is registered in `registry-chassis.ts`, so nothing here is baked, and the catalog
has no definitions for these ids. The files still compile and are kept as reference models.
To bring one back it needs a catalog definition in `packages/content/src/chassis.ts`, a line
in the registry and a full bake.
