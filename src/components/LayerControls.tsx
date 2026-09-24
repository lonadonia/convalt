import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { LAYERS, MODULE } from '../content/story';
import { markOverlayLayoutDirty, overlay } from '../state/overlay';
import { story, ui, useUI, type LayerId } from '../state/store';

/**
 * Three disclosure buttons (accordion pattern). Selecting one highlights the matching group in the
 * 3D assembly and reveals a short explanation. Works with pointer, touch and keyboard
 * (Tab / Enter / Space, plus Arrow Up/Down, Home, End between layers).
 */
export function LayerControls() {
  const active = useUI((s) => s.activeLayer);
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    markOverlayLayoutDirty();
    story.invalidate();
  }, [active]);

  const select = (id: LayerId) => {
    ui.set({ activeLayer: ui.get().activeLayer === id ? null : id });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.layer__button') ?? [])];
    let next = -1;
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next >= 0) { e.preventDefault(); buttons[next]?.focus(); }
  };

  return (
    <div className="layers" role="group" aria-labelledby="layers-label">
      <p id="layers-label" className="layers__label">{MODULE.layersLabel}</p>
      <ul className="layers__list" ref={listRef}>
        {LAYERS.map((layer, i) => {
          const expanded = active === layer.id;
          return (
            <li key={layer.id} className="layer" data-active={expanded || undefined}>
              <h3 className="layer__heading">
                <button
                  type="button"
                  className="layer__button"
                  id={`layer-button-${layer.id}`}
                  aria-expanded={expanded}
                  aria-controls={`layer-panel-${layer.id}`}
                  onClick={() => select(layer.id)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  ref={(el) => { overlay.layerButtons[layer.id] = el ?? undefined; }}
                >
                  <span className="layer__index" aria-hidden="true">{layer.index}</span>
                  <span className="layer__title">{layer.title}</span>
                  <span className="layer__icon" aria-hidden="true" />
                </button>
              </h3>
              <div className="layer__panel" id={`layer-panel-${layer.id}`} hidden={!expanded}>
                <p>{layer.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="layers__hint" hidden={Boolean(active)}>{MODULE.hint}</p>
    </div>
  );
}
