// Writes a Cursor Canvas — a live React app the IDE opens beside the chat —
// with the same drag-to-compare slider as the standalone HTML report, so a
// reviewer never has to leave the editor to look at a capture.
//
// The slider, the data-URI embedding and the file location are shared with
// the other plugins; what is built out of them is uidiff's own.

import { dataUri, pngSize, sliderComponent } from './shared/canvas.mjs';

export { canvasDir, pngSize, workspaceSlug, writeCanvas } from './shared/canvas.mjs';

function jsString(value) {
  return JSON.stringify(String(value));
}

function pairConst(name, pair) {
  return [
    `const ${name}Before = ${jsString(dataUri(pair.before))};`,
    `const ${name}After = ${jsString(dataUri(pair.after))};`
  ].join('\n');
}

/**
 * Builds the `.canvas.tsx` source. `pairs` is the same shape `buildHtml` in
 * report.mjs takes — `{ label, before, after }` file paths — but only a
 * handful should be passed: each embedded image inflates the file by roughly
 * 4/3 its PNG size, and a canvas is meant to open instantly.
 */
export function buildCanvasCode({ target, meta, metric, pairs }) {
  const sized = pairs.map((pair) => ({ ...pair, ...pngSize(pair.after) }));
  const constNames = sized.map((_, index) => `pair${index}`);
  const consts = sized.map((pair, index) => pairConst(constNames[index], pair)).join('\n\n');

  const metricLine =
    metric?.differing !== undefined
      ? `<Stat label="Pixels changed" value={${jsString(
          `${metric.differing.toLocaleString()} / ${metric.total.toLocaleString()} (${(metric.fraction * 100).toFixed(3)}%)`
        )}} />`
      : '';

  const sliders = sized
    .map(
      (pair, index) =>
        `<Slider label={${jsString(pair.label)}} before={${constNames[index]}Before} after={${constNames[index]}After} width={${pair.width}} height={${pair.height}} />`
    )
    .join('\n        ');

  return `import { Pill, Stack, Stat, Text, useHostTheme, useRef, useState } from "cursor/canvas";

${consts}
${sliderComponent()}

export default function UiDiffCanvas() {
  return (
    <Stack gap={20} style={{ padding: 24 }}>
      <Stack gap={4}>
        <Text weight="medium" style={{ fontSize: 18 }}>{${jsString(target)}}</Text>
        <Text tone="secondary" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{${jsString(meta)}}</Text>
      </Stack>
      ${metricLine}
      <Stack gap={28}>
        ${sliders}
      </Stack>
      <Text tone="secondary" style={{ fontSize: 12 }}>Drag any frame, or focus it and use the arrow keys.</Text>
    </Stack>
  );
}
`;
}

