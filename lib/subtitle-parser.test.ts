import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestamp, cleanSubtitleText, parseSubtitles } from './subtitle-parser.ts';

test('parseTimestamp parses HH:MM:SS.mmm, MM:SS.mmm, and SRT commas', () => {
  assert.equal(parseTimestamp('00:01:30.500'), 90.5);
  assert.equal(parseTimestamp('01:30.500'), 90.5);
  assert.equal(parseTimestamp('00:02:15,250'), 135.25);
  assert.equal(parseTimestamp('invalid'), null);
});

test('cleanSubtitleText strips HTML and WebVTT cue tags', () => {
  const raw = '<c.yellow><b>Eren:</b></c> What is <i class="emphasis">that</i>?!';
  assert.equal(cleanSubtitleText(raw), 'Eren: What is that?!');
});

test('parseSubtitles correctly parses WebVTT format with header and settings', () => {
  const vtt = `WEBVTT
Kind: captions
Language: en

1
00:00:01.000 --> 00:00:04.500 line:80%
<v Narrator>On that day, mankind received a grim reminder.

2
00:00:05.200 --> 00:00:08.000
We lived in fear of the Titans.
`;

  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startTime, 1);
  assert.equal(cues[0].endTime, 4.5);
  assert.equal(cues[0].text, 'On that day, mankind received a grim reminder.');
  assert.equal(cues[1].startTime, 5.2);
  assert.equal(cues[1].endTime, 8);
  assert.equal(cues[1].text, 'We lived in fear of the Titans.');
});

test('parseSubtitles correctly parses SRT format', () => {
  const srt = `1
00:00:10,000 --> 00:00:14,000
First line of dialog
Second line of dialog

2
00:00:15,500 --> 00:00:18,500
Next scene
`;

  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startTime, 10);
  assert.equal(cues[0].endTime, 14);
  assert.equal(cues[0].text, 'First line of dialog\nSecond line of dialog');
  assert.equal(cues[1].startTime, 15.5);
  assert.equal(cues[1].endTime, 18.5);
  assert.equal(cues[1].text, 'Next scene');
});
