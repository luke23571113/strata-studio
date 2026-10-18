import { useEffect, useRef, useState } from 'react';
import { encodeWorld, createWorldLink } from './world/worldCode.js';

export default function WorldSharing({ requested, revision, seed, onLoad, error }) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  const copyRequest = useRef(0);

  useEffect(() => {
    copyRequest.current += 1;
    setMessage('');
    setFallback('');
  }, [revision]);

  async function copy(kind) {
    const snapshot = requested.current;
    const request = ++copyRequest.current;
    let text;
    let successMessage;
    if (kind === 'seed') {
      text = String(snapshot.config.seed);
      successMessage = 'Seed copied.';
    } else if (kind === 'link') {
      text = createWorldLink(snapshot.config, window.location.origin);
      successMessage = 'Link copied.';
    } else {
      text = encodeWorld(snapshot.config);
      successMessage = 'World Code copied.';
    }
    try {
      await navigator.clipboard.writeText(text);
      if (request === copyRequest.current && snapshot === requested.current) {
        setMessage(successMessage);
        setFallback('');
      }
    } catch {
      if (request === copyRequest.current && snapshot === requested.current) {
        setFallback(text);
        setMessage('Copy unavailable. Select the text below to copy it manually.');
      }
    }
  }

  function importWorld(event) {
    event.preventDefault();
    if (onLoad(draft)) setDraft('');
  }

  return (
    <section className="share-panel" aria-label="World and sharing">
      <details open>
        <summary>World &amp; sharing</summary>
        <div className="seed-heading">
          <span>Seed</span>
          <button onClick={() => copy('seed')}>Copy seed</button>
        </div>
        <output className="seed-value" aria-label="Current seed">
          {seed}
        </output>
        <p className="control-description">Save a code or link to keep every edit.</p>
        <div className="share-actions">
          <button onClick={() => copy('code')}>Copy World Code</button>
          <button onClick={() => copy('link')}>Copy Link</button>
        </div>
        <p className="copy-status" role="status">
          {message}
        </p>
        {fallback && (
          <label className="copy-fallback">
            Manual copy
            <textarea
              readOnly
              value={fallback}
              onFocus={(event) => event.target.select()}
            />
          </label>
        )}
        <details className="import-panel">
          <summary>Load a world</summary>
          <form onSubmit={importWorld}>
            <label htmlFor="world-code">World Code or link</label>
            <textarea
              id="world-code"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Paste a saved code or link"
              spellCheck="false"
            />
            <button type="submit">Load World</button>
          </form>
        </details>
        {error && (
          <p className="import-error" role="alert">
            {error}
          </p>
        )}
      </details>
    </section>
  );
}
