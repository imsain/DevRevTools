// Drives the `uidiff` CLI so one command can answer both halves of a data
// change: what the numbers became, and what the page showing them looks like
// now. They stay separate tools — this is the seam between them.
//
// datadiff owns the git swap and asks uidiff for one frame at a time, rather
// than handing the whole before/after dance to `uidiff compare`. That is what
// lets the change and the page live in different repos: a backend edit is
// swapped here while the frame is captured against the frontend dev server
// over there. It also means one swap covers both halves, so the table and the
// screenshots are describing the same moment.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataDiffError } from './project.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Same resolution order the skills use for their own binaries: an explicit
 * override, then the PATH, then the sibling plugin in this repo. The last one
 * is what makes `--ui` work for someone who installed the suite and never put
 * anything on their PATH.
 */
export function resolveUidiff() {
  if (process.env.UIDIFF_BIN) {
    return { command: process.env.UIDIFF_BIN, args: [] };
  }
  // `sh -c` rather than `shell: true`, which Node now warns about because it
  // concatenates arguments instead of escaping them.
  const onPath = spawnSync('/bin/sh', ['-c', 'command -v uidiff'], {
    encoding: 'utf8'
  });
  if (onPath.status === 0 && onPath.stdout.trim()) {
    return { command: onPath.stdout.trim(), args: [] };
  }
  const sibling = join(here, '..', '..', 'uidiff', 'bin', 'uidiff.mjs');
  if (existsSync(sibling)) {
    return { command: process.execPath, args: [sibling] };
  }
  return null;
}

/** `--ui-click`, `--ui-wait`, `--ui-wait-for` and `--ui-hover` forwarded to
 * uidiff's own step flags, in the order they were given. Without these, a
 * page that opens behind a welcome dialog can only ever be photographed with
 * the dialog in the way. */
const STEP_FLAGS = {
  'ui-click': '--click',
  'ui-hover': '--hover',
  'ui-wait': '--wait',
  'ui-wait-for': '--wait-for'
};

export function uiSteps(args) {
  return args.ordered
    .filter((entry) => entry.name in STEP_FLAGS)
    .map((entry) => {
      if (entry.value === true) {
        throw new DataDiffError(`--${entry.name} needs a value`);
      }
      return [STEP_FLAGS[entry.name], entry.value];
    });
}

export function requireUidiff() {
  const uidiff = resolveUidiff();
  if (!uidiff) {
    throw new DataDiffError(
      'could not find the uidiff CLI for --ui. Install the uidiff plugin ' +
        'alongside this one, put `uidiff` on your PATH, or set UIDIFF_BIN.'
    );
  }
  return uidiff;
}

/**
 * One frame of `route`, captured in whatever state the tree is in right now.
 * `uiRoot` is the repo whose `.uidiff.json` names the dev server — the
 * frontend, when the code being diffed is a backend module.
 */
export function captureFrame({
  uidiff,
  uiRoot,
  route,
  label,
  settle,
  fullPage,
  steps = []
}) {
  const args = [...uidiff.args, 'capture', route, '--label', label];
  // Steps keep the order they were written in, because reaching a state is
  // sequential: dismiss the dialog, then wait, then open the panel.
  for (const [flag, value] of steps) {
    args.push(flag, String(value));
  }
  if (settle) {
    args.push('--settle', String(settle));
  }
  if (fullPage) {
    args.push('--full-page');
  }

  const run = spawnSync(uidiff.command, args, {
    cwd: uiRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  for (const line of output.split('\n').filter(Boolean)) {
    console.log(`  [uidiff] ${line}`);
  }
  if (run.status !== 0) {
    throw new DataDiffError(
      `uidiff could not capture ${route}. Its own output is above.`
    );
  }

  const match = output.match(/^capture:\s*(.+\.png)\s*$/m);
  if (!match) {
    throw new DataDiffError(
      `uidiff captured ${route} but did not report where it saved the frame.`
    );
  }
  return match[1];
}
