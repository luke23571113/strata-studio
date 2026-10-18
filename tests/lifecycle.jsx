import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { resolveDocumentWorld } from '../src/world/documentWorld.js';
import '../src/styles.css';

// This harness exercises the actual App lifecycle without adding app mutation hooks.
const documentWorld = resolveDocumentWorld('/world/123', '');
let root;
document.getElementById('mount').onclick = () => {
  if (root) return;
  root = createRoot(document.getElementById('root'));
  root.render(
    <StrictMode>
      <App documentWorld={documentWorld} />
    </StrictMode>,
  );
};
document.getElementById('unmount').onclick = () => {
  root?.unmount();
  root = undefined;
};

// Observe WebGL allocation ownership in this dev-only harness. The app is untouched.
const textureRecords = new WeakMap();
const contexts = new WeakMap();
window.__textureAudit = [];
window.__contextAudit = [];
const glPrototype = WebGL2RenderingContext.prototype;
const originalCreateTexture = glPrototype.createTexture;
const originalDeleteTexture = glPrototype.deleteTexture;
const originalBindTexture = glPrototype.bindTexture;
const originalTexStorage2D = glPrototype.texStorage2D;
function contextRecord(context) {
  let record = contexts.get(context);
  if (!record) {
    record = { id: window.__contextAudit.length + 1, lost: false, bound: new Map() };
    contexts.set(context, record);
    window.__contextAudit.push(record);
    context.canvas.addEventListener('webglcontextlost', () => {
      record.lost = true;
    });
  }
  return record;
}
glPrototype.createTexture = function (...args) {
  const texture = originalCreateTexture.apply(this, args);
  const record = {
    id: window.__textureAudit.length + 1,
    context: contextRecord(this).id,
    deleted: false,
  };
  textureRecords.set(texture, record);
  window.__textureAudit.push(record);
  return texture;
};
glPrototype.deleteTexture = function (texture) {
  const record = textureRecords.get(texture);
  if (record) record.deleted = true;
  return originalDeleteTexture.call(this, texture);
};
glPrototype.bindTexture = function (target, texture) {
  contextRecord(this).bound.set(target, texture);
  return originalBindTexture.call(this, target, texture);
};
glPrototype.texStorage2D = function (target, levels, internalFormat, width, height) {
  const texture = contextRecord(this).bound.get(target);
  const record = textureRecords.get(texture);
  if (record) Object.assign(record, { levels, internalFormat, width, height });
  return originalTexStorage2D.call(this, target, levels, internalFormat, width, height);
};
