import test from 'node:test';
import assert from 'node:assert/strict';

import { normalize, words, hasStem, scoreMatch, searchExercises } from '../js/text.js';

test('vereinheitlicht Schreibweisen', () => {
  assert.equal(normalize('Bankdrücken'), 'bankdruecken');
  assert.equal(normalize('KH-Rudern'), 'kh rudern');
  assert.equal(normalize('Straße'), 'strasse');
});

test('findet Wortstämme auch in Zusammensetzungen', () => {
  assert.equal(hasStem('Schrägbankdrücken', 'druecken'), true);
  assert.equal(hasStem('Frontkniebeuge', 'front'), true);
  assert.equal(hasStem('Bankdrücken', 'rudern'), false);
});

test('kurze Eingaben genügen', () => {
  const bank = { name: 'Bankdrücken' };

  assert.ok(scoreMatch('bank', bank) > 0.5);
  assert.ok(scoreMatch('Bankdrücken', bank) === 1);
  assert.equal(scoreMatch('kniebeuge', bank), null);
  assert.equal(scoreMatch('', bank), null);
});

/**
 * Im Studio meint "rudern" fast immer die Ruderübung, die auch letzte Woche
 * dran war -- deshalb entscheidet bei gleicher Treffergüte die Geschichte.
 */
test('bei gleichem Treffer steht vorn, was zuletzt trainiert wurde', () => {
  const alt = { name: 'Rudern breit', lastDoneAt: '2026-01-01T10:00:00Z' };
  const neu = { name: 'Rudern eng', lastDoneAt: '2026-08-01T10:00:00Z' };

  assert.deepEqual(searchExercises('rudern', [alt, neu]), [neu, alt]);
});

test('was nicht passt, fällt heraus', () => {
  const treffer = searchExercises('bank', [{ name: 'Bankdrücken' }, { name: 'Kniebeugen' }]);
  assert.equal(treffer.length, 1);
});
