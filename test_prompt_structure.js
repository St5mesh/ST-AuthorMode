// Standalone test script for promptExpandBeat and expandBeatCore
// Usage: node test_prompt_structure.js

const { promptExpandBeat } = require('./index.node');

function testPromptVariants() {
    const sourceText = 'Seraphina stood at the edge of the forest, her heart pounding. The moonlight revealed shadows that danced between the trees.';
    const prevContext = '[Previous beat] Seraphina hesitated, recalling her grandmother\'s warning.';
    const currentBeat = 'Seraphina steps into the forest, determined to find the truth.';
    const nextContext = 'A mysterious figure appears in the moonlight.';

    // Beat 1: No prose trail
    const prompt1 = promptExpandBeat('', currentBeat, nextContext, sourceText);
    console.log('--- Prompt for Beat 1 (no trail) ---\n', prompt1);

    // Beat 2: With prose trail
    const prompt2 = promptExpandBeat(prevContext, currentBeat, nextContext, sourceText);
    console.log('--- Prompt for Beat 2 (with trail) ---\n', prompt2);
}

testPromptVariants();
