/**
 * run.js – Lädt alle Testdateien, führt sie aus und zeigt die Ergebnisse an.
 */
import { runTests, renderResults } from './harness.js';
import './rules.test.js';
import './sheet.test.js';

const results = runTests();
window.testResults = results;
renderResults(results, document.getElementById('results'), document.getElementById('summary'));
