// src/data/SynapseNodes.js
// Patch 29.1: node data for the Synapse Tree, the 31-node meta-progression graph
// that replaces the 4 flat SaveManager.upgrades rows. Nothing imports this file
// yet — the resolver (Patch 29.4) and renderer (Patch 29.6) are later patches.
//
// Schema: { id, name, desc, branch, tier, cost, requires, minPatientLevel, effects }
// - requires: array of node ids. Default semantics are AND (every id must be
//   owned). The three capstones need "any N of" instead of strict AND, so they
//   additionally carry `requireMode: 'any'` + `requireCount: N` — undefined on
//   every branch node, where plain AND is correct.
// - minPatientLevel: null for tier-1 nodes (no gate, available from the start).
// - effects: numeric deltas keyed by resolver stat name, and/or a single
//   `grant: '<string>'` for discrete unlocks (never mixed into the numeric sum).
//   Legacy-stat deltas (sanity/speed/light/magnet) are integer multiples of the
//   legacy step (20 / 5% / 10% / 30px) per the hard constraint in the handoff,
//   so SaveManager's derived-mirror math (Patch 29.4) stays lossless.
//
// Note on T5/T7: the source table names these "tokenDropRate +25%" and
// "tokenDrop +25%" respectively — clearly the same underlying stat under two
// shorthand spellings, not two different mechanics. Normalized to one
// canonical key, tokenDropRate, so the resolver only needs to know one name.

const RESILIENCE = '#8b0000';
const FOCUS = '#c5a059';
const MOTOR = '#0ea5e9';
const FORTUNE = '#94a3b8';
const CAPSTONE = '#e8e0cc';

export const SYNAPSE_NODES = [
    // ---- RESILIENCE ----
    { id: 'R1', name: 'Thickened Skin', desc: 'The first callus. Pain starts to feel further away.', branch: 'RESILIENCE', color: RESILIENCE, tier: 1, cost: 150, requires: [], minPatientLevel: null, effects: { sanity: 20 } },
    { id: 'R2', name: 'Scar Tissue', desc: 'Old wounds harden into something load-bearing.', branch: 'RESILIENCE', color: RESILIENCE, tier: 2, cost: 350, requires: ['R1'], minPatientLevel: 2, effects: { sanity: 20 } },
    { id: 'R3', name: 'Numbed Response', desc: 'The flinch reflex is the first thing to go.', branch: 'RESILIENCE', color: RESILIENCE, tier: 3, cost: 800, requires: ['R2'], minPatientLevel: 3, effects: { sanity: 40 } },
    { id: 'R4', name: 'Deadened Nerves', desc: 'A half-second where nothing can touch you.', branch: 'RESILIENCE', color: RESILIENCE, tier: 4, cost: 1400, requires: ['R2'], minPatientLevel: 4, effects: { iframes: 20 } },
    { id: 'R5', name: 'Clinical Detachment', desc: 'Watch it happen to someone else, from a safe distance.', branch: 'RESILIENCE', color: RESILIENCE, tier: 5, cost: 2600, requires: ['R3'], minPatientLevel: 5, effects: { sanity: 40 } },
    { id: 'R6', name: 'Second Opinion', desc: 'The shield reforms. It was never really gone.', branch: 'RESILIENCE', color: RESILIENCE, tier: 6, cost: 3800, requires: ['R4'], minPatientLevel: 6, effects: { grant: 'denial_recharge' } },
    { id: 'R7', name: 'Institutional Body', desc: 'Processed, hardened, discharged — and still standing.', branch: 'RESILIENCE', color: RESILIENCE, tier: 7, cost: 7000, requires: ['R5', 'R6'], minPatientLevel: 8, effects: { sanity: 60, iframes: 10 } },

    // ---- FOCUS ----
    { id: 'F1', name: 'Fresh Batteries', desc: 'A little more reach into the dark.', branch: 'FOCUS', color: FOCUS, tier: 1, cost: 150, requires: [], minPatientLevel: null, effects: { light: 10 } },
    { id: 'F2', name: 'Polished Lens', desc: 'Less scatter, more beam.', branch: 'FOCUS', color: FOCUS, tier: 2, cost: 350, requires: ['F1'], minPatientLevel: 2, effects: { light: 10 } },
    { id: 'F3', name: 'Wide Beam', desc: 'A broader cone means fewer places to hide.', branch: 'FOCUS', color: FOCUS, tier: 3, cost: 800, requires: ['F2'], minPatientLevel: 3, effects: { flashlightAngle: 15 } },
    { id: 'F4', name: 'Halogen Upgrade', desc: 'Brighter than the room can swallow.', branch: 'FOCUS', color: FOCUS, tier: 4, cost: 1400, requires: ['F2'], minPatientLevel: 4, effects: { light: 20 } },
    { id: 'F5', name: 'Focused Intent', desc: 'Attention, sharpened into a tool.', branch: 'FOCUS', color: FOCUS, tier: 5, cost: 2600, requires: ['F3'], minPatientLevel: 5, effects: { tagDamage: { light: 10, focus: 10 } } },
    { id: 'F6', name: 'Steady Hand', desc: 'It stopped shaking a while ago.', branch: 'FOCUS', color: FOCUS, tier: 6, cost: 3800, requires: ['F4'], minPatientLevel: 6, effects: { light: 20 } },
    { id: 'F7', name: 'Perfect Clarity', desc: 'Everything, finally, exactly where it is.', branch: 'FOCUS', color: FOCUS, tier: 7, cost: 7000, requires: ['F5', 'F6'], minPatientLevel: 8, effects: { light: 30, tagDamage: { light: 15, focus: 15 } } },

    // ---- MOTOR ----
    { id: 'M1', name: 'Restless Legs', desc: 'Can\'t sit still. Won\'t need to.', branch: 'MOTOR', color: MOTOR, tier: 1, cost: 150, requires: [], minPatientLevel: null, effects: { speed: 5 } },
    { id: 'M2', name: 'Quick Feet', desc: 'The floor stops arguing with you.', branch: 'MOTOR', color: MOTOR, tier: 2, cost: 350, requires: ['M1'], minPatientLevel: 2, effects: { speed: 5 } },
    { id: 'M3', name: 'Muscle Memory', desc: 'The body remembers how to leave a room.', branch: 'MOTOR', color: MOTOR, tier: 3, cost: 800, requires: ['M2'], minPatientLevel: 3, effects: { dashCooldown: -15 } },
    { id: 'M4', name: 'Adrenaline', desc: 'The chemical answer to a physical problem.', branch: 'MOTOR', color: MOTOR, tier: 4, cost: 1400, requires: ['M2'], minPatientLevel: 4, effects: { speed: 10 } },
    { id: 'M5', name: 'Extra Step', desc: 'One more stride than the room expects.', branch: 'MOTOR', color: MOTOR, tier: 5, cost: 2600, requires: ['M3'], minPatientLevel: 5, effects: { dashDuration: 4 } },
    { id: 'M6', name: 'Sprinter\'s Heart', desc: 'Built for the exit, not the fight.', branch: 'MOTOR', color: MOTOR, tier: 6, cost: 3800, requires: ['M4'], minPatientLevel: 6, effects: { speed: 10 } },
    { id: 'M7', name: 'Flight Response', desc: 'The body learns to leave twice.', branch: 'MOTOR', color: MOTOR, tier: 7, cost: 7000, requires: ['M5', 'M6'], minPatientLevel: 8, effects: { grant: 'dash_charge_2' } },

    // ---- FORTUNE ----
    { id: 'T1', name: 'Keen Eye', desc: 'You start noticing what\'s worth picking up.', branch: 'FORTUNE', color: FORTUNE, tier: 1, cost: 150, requires: [], minPatientLevel: null, effects: { magnet: 30 } },
    { id: 'T2', name: 'Sticky Fingers', desc: 'Things find their way into your pockets.', branch: 'FORTUNE', color: FORTUNE, tier: 2, cost: 350, requires: ['T1'], minPatientLevel: 2, effects: { magnet: 30 } },
    { id: 'T3', name: 'Clarity Dividend', desc: 'Every fracture pays a little more, in the end.', branch: 'FORTUNE', color: FORTUNE, tier: 3, cost: 800, requires: ['T2'], minPatientLevel: 3, effects: { lucidityGain: 10 } },
    { id: 'T4', name: 'Deep Pockets', desc: 'There\'s always room for one more thing.', branch: 'FORTUNE', color: FORTUNE, tier: 4, cost: 1400, requires: ['T2'], minPatientLevel: 4, effects: { magnet: 60 } },
    { id: 'T5', name: 'Salvager', desc: 'Nothing left behind is really left behind.', branch: 'FORTUNE', color: FORTUNE, tier: 5, cost: 2600, requires: ['T3'], minPatientLevel: 5, effects: { tokenDropRate: 25 } },
    { id: 'T6', name: 'Compound Interest', desc: 'The fracture, reinvested.', branch: 'FORTUNE', color: FORTUNE, tier: 6, cost: 3800, requires: ['T4'], minPatientLevel: 6, effects: { lucidityGain: 15 } },
    { id: 'T7', name: 'Hoarder\'s Instinct', desc: 'You keep everything now. Everything.', branch: 'FORTUNE', color: FORTUNE, tier: 7, cost: 7000, requires: ['T5', 'T6'], minPatientLevel: 8, effects: { tokenDropRate: 25, lucidityGain: 15 } },

    // ---- CAPSTONES (absorbed Patch 30) ----
    // Cross-branch "any N of" requirements, not strict AND — see file header.
    { id: 'C1', name: 'Preparation', desc: 'Walk in already holding something.', branch: 'CAPSTONE', color: CAPSTONE, tier: 'capstone', cost: 6000, requires: ['R4', 'F4', 'M4', 'T4'], requireMode: 'any', requireCount: 2, minPatientLevel: 7, effects: { grant: 'start_boon' } },
    { id: 'C2', name: 'Personal Effects', desc: 'One thing from before the fracture, carried in.', branch: 'CAPSTONE', color: CAPSTONE, tier: 'capstone', cost: 8000, requires: ['R7', 'F7', 'M7', 'T7'], requireMode: 'any', requireCount: 1, minPatientLevel: 9, effects: { grant: 'start_weapon:<choice>' } },
    { id: 'C3', name: 'Second Guess', desc: 'A cheaper way to change your mind mid-run.', branch: 'CAPSTONE', color: CAPSTONE, tier: 'capstone', cost: 6500, requires: ['F5', 'T5'], requireMode: 'any', requireCount: 1, minPatientLevel: 7, effects: { rerollCost: -10 } }
];

export const SYNAPSE_NODES_BY_ID = SYNAPSE_NODES.reduce((acc, node) => {
    acc[node.id] = node;
    return acc;
}, {});
