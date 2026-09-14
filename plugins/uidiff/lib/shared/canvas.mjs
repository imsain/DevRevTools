// Generated from shared/lib/canvas.mjs — do not edit this copy.
// Change the shared file, then run: node scripts/sync-shared.mjs

// The parts of writing a Cursor Canvas — a live React app the IDE opens
// beside the chat — that are the same whatever the canvas is showing: where
// the file goes, how an image gets embedded, and the drag-to-compare frame.
//
// Canvases embed their data inline (no fetch, no relative imports), so images
// go in as base64 data URIs.
//
// What each plugin builds out of these differs enough to stay its own code:
// uidiff's canvas is a column of sliders, datadiff's is a table and a chart
// with an optional slider on top.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The width/height a PNG's own IHDR chunk declares, read directly rather than
 * shelling out to ImageMagick — a canvas should not need it installed.
 */
export function pngSize(file) {
  const buffer = readFileSync(file);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function dataUri(file) {
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

/**
 * Cursor's own convention for naming a workspace's project folder under
 * `~/.cursor/projects/`: the absolute path with every `/` and `_` turned into
 * a `-` (so `/Users/al_ex/app` becomes `Users-al-ex-app`).
 */
export function workspaceSlug(root) {
  return root.replace(/^\/+/, '').replace(/[/_]+/g, '-');
}

export function canvasDir(root) {
  return join(homedir(), '.cursor', 'projects', workspaceSlug(root), 'canvases');
}

/**
 * Source text for the slider, spliced into the generated canvas. It needs
 * `Pill`, `Stack`, `Text`, `useHostTheme`, `useRef` and `useState` imported
 * from "cursor/canvas" by whoever embeds it.
 */
export function sliderComponent() {
  return `
function Slider({ label, before, after, width, height }) {
  const theme = useHostTheme();
  const frameRef = useRef(null);
  const [position, setPosition] = useState(50);

  const moveTo = (clientX) => {
    const bounds = frameRef.current.getBoundingClientRect();
    const next = ((clientX - bounds.left) / bounds.width) * 100;
    setPosition(Math.max(0, Math.min(100, next)));
  };

  return (
    <Stack gap={6}>
      <Text weight="medium">{label}</Text>
      <div
        ref={frameRef}
        role="slider"
        tabIndex={0}
        aria-label={label + ': reveal before or after'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          moveTo(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) moveTo(event.clientX);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 2;
          if (event.key === 'ArrowLeft') setPosition((p) => Math.max(0, p - step));
          if (event.key === 'ArrowRight') setPosition((p) => Math.min(100, p + step));
        }}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: Math.min(width, 900),
          aspectRatio: width + ' / ' + height,
          overflow: 'hidden',
          border: '1px solid ' + theme.stroke.primary,
          borderRadius: 6,
          cursor: 'ew-resize',
          touchAction: 'none'
        }}
      >
        <img src={after} alt="After" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', userSelect: 'none', pointerEvents: 'none' }} />
        <img src={before} alt="Before" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', userSelect: 'none', pointerEvents: 'none', clipPath: 'inset(0 ' + (100 - position) + '% 0 0)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: position + '%', width: 1, background: theme.accent.primary, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '50%', left: position + '%', width: 20, height: 20, marginTop: -10, marginLeft: -10, borderRadius: '50%', background: theme.accent.primary, border: '2px solid ' + theme.bg.editor, pointerEvents: 'none' }} />
        <Pill tone="neutral" style={{ position: 'absolute', top: 8, left: 8, opacity: position > 12 ? 1 : 0 }}>BEFORE</Pill>
        <Pill tone="neutral" style={{ position: 'absolute', top: 8, right: 8, opacity: position < 88 ? 1 : 0 }}>AFTER</Pill>
      </div>
    </Stack>
  );
}`;
}

/** Writes the canvas file, creating `canvases/` if this is the first one. */
export function writeCanvas(root, name, code) {
  const dir = canvasDir(root);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const file = join(dir, `${name}.canvas.tsx`);
  writeFileSync(file, code);
  return file;
}
