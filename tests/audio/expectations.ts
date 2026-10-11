/**
 * What each showcase scenario must sound like, written by hand from Section 13.4 and the
 * event timelines in docs/COMBAT_API.md, NOT derived from the audio code. Each list is a
 * subsequence: those sounds must start, in that order, with anything else allowed between.
 * An entry ending in `_` matches any sound id with that prefix (`hit_` is "whatever the struck
 * surface sounds like"). The listener is car 0, the scenario's scripted player.
 */
export const SCENARIO_SOUNDS: Readonly<Record<string, readonly string[]>> = {
  kinetic_impact: ['mg_fire', 'hit_', 'mg_fire', 'hit_', 'shotgun_fire', 'hit_pellets'],
  rocket_hit: [
    'rocket_launch',
    'rocket_fly',
    'hit_',
    'explode_rocket',
    'rocket_launch',
    'rocket_fly',
    'explode_rocket',
  ],
  mortar_strike: [
    'refuse_tick',
    'mortar_lock',
    'mortar_launch',
    'mortar_whistle',
    'explode_mortar',
    'impact_heavy',
  ],
  emp_burst: ['emp_charge', 'emp_burst', 'status_emp', 'shield_down'],
  repair_burst: [
    'repair_work',
    'spare_start',
    'part_repaired',
    'spare_done',
    'repair_start',
    'part_repaired',
    'repair_done',
  ],
  wet_road: [
    'rocket_launch',
    'rocket_fly',
    'explode_rocket',
    'frost_fire',
    'frost_crackle',
    'frost_shatter',
    'oil_spill',
  ],
  oil_fire: [
    'oil_spill',
    'flame_ignite',
    'flame_stream',
    'fire_ignite',
    'status_burn',
    'burn_tick',
  ],
  flame_frost: [
    'flame_ignite',
    'flame_stream',
    'status_burn',
    'burn_tick',
    'frost_fire',
    'frost_crackle',
    'frost_shatter',
  ],
  frost_thaw: [
    'frost_fire',
    'frost_crackle',
    'frost_shatter',
    'flame_ignite',
    'flame_stream',
    'status_burn',
    'frost_melt',
    'burn_tick',
  ],
  missile_defense: [
    'seeker_lock',
    'seeker_launch',
    'seeker_fly',
    'interceptor_fire',
    'intercept_pop',
    'seeker_lock',
    'seeker_launch',
    'seeker_fly',
    'explode_seeker',
    'seeker_lock',
    'decoy_hum',
    'decoy_launch',
    'seeker_launch',
    'interceptor_fire',
    'intercept_pop',
  ],
  mine_sweeper: [
    'mine_drop',
    'mine_blink',
    'warn_trap',
    'mine_armed',
    'sweeper_zap',
    'trap_cleared',
    'mine_drop',
    'mine_blink',
    'warn_trap',
    'mine_armed',
  ],
  ram: ['ram_crunch', 'hit_'],
  shield_break: [
    'mg_fire',
    'shield_down',
    'hit_shield',
    'mg_fire',
    'armor_break',
    'rocket_launch',
    'reactive_puff',
    'explode_rocket',
  ],
  weapon_front_mg: ['mg_fire', 'mg_fire', 'hit_', 'mg_fire', 'mg_fire', 'mg_fire'],
  weapon_rear_mg: [
    'sentry_pivot',
    'sentry_fire',
    'hit_',
    'sentry_fire',
    'sentry_fire',
    'sentry_fire',
    'sentry_pivot',
  ],
  weapon_turret: ['turret_lock', 'turret_fire', 'turret_fire', 'hit_', 'turret_fire'],
  weapon_shotgun: ['shotgun_fire', 'hit_pellets'],
  weapon_railshot: ['rail_charge', 'rail_fire', 'hit_', 'hit_rail', 'impact_heavy'],
  weapon_rocket: ['rocket_launch', 'rocket_fly', 'hit_', 'explode_rocket'],
  weapon_homing: ['seeker_lock', 'seeker_launch', 'seeker_fly', 'hit_', 'explode_seeker'],
  weapon_mine: ['mine_drop', 'mine_blink', 'mine_armed', 'hit_', 'status_slow', 'explode_mine'],
  weapon_oil: ['oil_spill', 'oil_slip'],
  weapon_foam: ['foam_launch', 'foam_fall', 'foam_splat', 'status_slow'],
  weapon_emp: ['emp_charge', 'emp_burst', 'status_emp'],
  weapon_tesla: ['tesla_arc', 'hit_', 'status_jam'],
  weapon_flame: ['flame_ignite', 'flame_stream', 'status_burn', 'burn_tick'],
  weapon_frost: ['frost_fire', 'frost_crackle', 'frost_shatter'],
  weapon_hammer: ['hammer_draw', 'hammer_swing', 'hit_', 'hammer_clang', 'impact_heavy'],
  weapon_saw: ['saw_bite', 'hit_', 'saw_bite', 'saw_bite'],
  weapon_harpoon: [
    'harpoon_fire',
    'harpoon_hook',
    'tether_tension',
    'ram_crunch',
    'harpoon_release',
  ],
  weapon_air: ['air_blast', 'hit_'],
  weapon_boomerang: [
    'boomerang_throw',
    'boomerang_spin',
    'hit_',
    'boomerang_slash',
    'boomerang_catch',
  ],
  weapon_mortar: [
    'mortar_lock',
    'mortar_launch',
    'mortar_whistle',
    'explode_mortar',
    'hit_',
    'impact_heavy',
  ],
};

/** The first expected sound that the started sounds do not contain in order, or null. */
export function firstMissing(
  started: readonly string[],
  expected: readonly string[],
): string | null {
  let at = 0;
  for (const want of expected) {
    let found = -1;
    for (let i = at; i < started.length; i++) {
      const id = started[i]!;
      if (want.endsWith('_') ? id.startsWith(want) : id === want) {
        found = i;
        break;
      }
    }
    if (found < 0) return want;
    at = found + 1;
  }
  return null;
}
