import { useEffect, useRef, useState } from 'react';
import PlanetScene from './PlanetScene.jsx';
import WorldControls from './WorldControls.jsx';
import WorldSharing from './WorldSharing.jsx';
import {
  generateNextWorld,
  readSharedWorld,
  rememberWorld,
} from './world/documentWorld.js';
import { changePreset, getDefaultSettings, resetSettings } from './world/worldConfig.js';
import { decodeWorld } from './world/worldCode.js';

export default function App({ documentWorld }) {
  const sceneRef = useRef(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [world, setWorld] = useState(() => ({
    config: documentWorld.config,
    revision: documentWorld.revision,
    requestedAt: performance.now(),
  }));
  const requested = useRef(world);
  const [importError, setImportError] = useState('');

  function commitWorld(config) {
    if (config === requested.current.config) return;
    const next = rememberWorld(documentWorld, config);
    requested.current = next;
    setWorld(next);
    setImportError('');
  }

  function loadWorld(text) {
    try {
      commitWorld(decodeWorld(text));
      return true;
    } catch (error) {
      setImportError(error.message);
      return false;
    }
  }

  useEffect(() => {
    function loadFragment() {
      try {
        const shared = readSharedWorld(window.location.hash);
        if (shared) commitWorld(shared);
      } catch (error) {
        setImportError(error.message);
      }
    }
    window.addEventListener('hashchange', loadFragment);
    return () => window.removeEventListener('hashchange', loadFragment);
  }, []);

  if (documentWorld.type === 'invalid') {
    return (
      <main className="invalid-world">
        <h1>World unavailable</h1>
        <p role="alert">{documentWorld.message}</p>
        <a href="/">Open a new random world</a>
      </main>
    );
  }

  const { config } = world;
  const defaults = getDefaultSettings(config);
  const modified = Object.keys(defaults).some(
    (key) => defaults[key] !== config.settings[key],
  );

  function updateSlider(key, value) {
    const current = requested.current.config;
    commitWorld({ ...current, settings: { ...current.settings, [key]: value } });
  }

  return (
    <main className={`studio ${drawerOpen ? 'drawer-open' : ''}`}>
      <PlanetScene ref={sceneRef} drawerOpen={drawerOpen} world={world} />
      <div className="interface">
        <header className="identity">
          <svg viewBox="0 0 32 36" aria-hidden="true">
            <path d="m16 1 15 9v17l-15 8L1 27V10Z" />
            <path d="m1 10 15 8 15-8M16 18v17M1 27l15-9 15 9" />
          </svg>
          <h1>Strata Studio</h1>
        </header>
        <section className="preset-panel" aria-label="World preset">
          <label htmlFor="preset">Preset</label>
          <select
            id="preset"
            value={config.preset}
            onChange={(event) =>
              commitWorld(changePreset(requested.current.config, event.target.value))
            }
          >
            <option value="earthlike">Earthlike</option>
            <option value="frozen">Frozen</option>
            <option value="alien">Alien</option>
          </select>
          <p className="world-description">Keep the one you discover.</p>
          <span className="modified-state">
            {modified ? 'Modified' : 'Starting world'}
          </span>
        </section>
        <button className="reset-button" onClick={() => sceneRef.current?.reset()}>
          Reset view
        </button>
        <button
          className="generate-button"
          onClick={() => commitWorld(generateNextWorld(documentWorld))}
        >
          Generate a New Seed
        </button>
        <aside className="control-panel" id="world-controls" aria-label="World controls">
          <WorldControls settings={config.settings} onChange={updateSlider} />
          <button
            className="reset-sliders"
            onClick={() => commitWorld(resetSettings(requested.current.config))}
          >
            Reset Sliders
          </button>
          <WorldSharing
            requested={requested}
            revision={world.revision}
            seed={config.seed}
            onLoad={loadWorld}
            error={importError}
          />
        </aside>
        <button
          className="drawer-toggle"
          aria-expanded={drawerOpen}
          aria-controls="world-controls"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          {drawerOpen ? 'Close controls' : 'Explore controls'}
        </button>
      </div>
    </main>
  );
}
