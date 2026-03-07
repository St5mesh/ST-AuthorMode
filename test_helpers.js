// Tests for getProseTrail, detectPOV, calcMaxBeats
import { getProseTrail, detectPOV, calcMaxBeats } from './index.js';

function test_getProseTrail() {
    const state = {
        proseHistory: [
            { beatIdx: 0, prose: 'First expansion.' },
            { beatIdx: 1, prose: 'Second expansion.' },
            { beatIdx: 0, prose: 'First expansion, revision.' }
        ]
    };
    global.state = state;
    const result = getProseTrail(0);
    console.log('getProseTrail(0):', result);
}

function test_detectPOV() {
    console.log('detectPOV("I went home."):', detectPOV('I went home.'));
    console.log('detectPOV("You are here."):', detectPOV('You are here.'));
    console.log('detectPOV("He ran fast."):', detectPOV('He ran fast.'));
    console.log('detectPOV("The cat sat."):', detectPOV('The cat sat.'));
}

function test_calcMaxBeats() {
    global.state = { maxBeats: 7 };
    console.log('calcMaxBeats() with state.maxBeats:', calcMaxBeats());
    global.state = {};
    console.log('calcMaxBeats() default:', calcMaxBeats());
}

// Run all tests
console.log('--- getProseTrail ---');
test_getProseTrail();
console.log('--- detectPOV ---');
test_detectPOV();
console.log('--- calcMaxBeats ---');
test_calcMaxBeats();
