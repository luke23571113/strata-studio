import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorldGenerator } from './world/generator.js';
import {
  applyTerrainPositions,
  createTerrainTopology,
  fingerprintTerrain,
} from './world/terrainMesh.js';

let createdScenes = 0;
let disposedScenes = 0;

function createGlowTexture(brightCore = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.15, brightCore ? 'white' : 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(
    0.4,
    brightCore ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.15)',
  );
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function createStarLayer(glowTexture, { count, size, opacity, inBand = false }) {
  const positions = [];

  for (let index = 0; index < count; index++) {
    const position = new THREE.Vector3().randomDirection();

    // Flatten some stars into a band, then place them back on the distant sky.
    if (inBand) {
      position.y *= 0.12;
      position.normalize();
    }

    position.multiplyScalar(60);
    positions.push(position.x, position.y, position.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xe2ebff,
    size,
    map: glowTexture,
    sizeAttenuation: false,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  return new THREE.Points(geometry, material);
}

function createStars(glowTexture) {
  const stars = new THREE.Group();
  const background = createStarLayer(glowTexture, { count: 4000, size: 4.5, opacity: 1 });
  const mediumStars = createStarLayer(glowTexture, { count: 200, size: 7, opacity: 1 });
  const brightStars = createStarLayer(glowTexture, { count: 50, size: 11, opacity: 1 });
  const galacticBand = createStarLayer(glowTexture, {
    count: 5000,
    size: 3.8,
    opacity: 1,
    inBand: true,
  });

  galacticBand.rotation.z = 0.55;
  stars.add(background, mediumStars, brightStars, galacticBand);
  return stars;
}

export default function PlanetScene({ ref, drawerOpen, world }) {
  const containerRef = useRef(null);
  const sceneActions = useRef(null);
  const latestWorld = useRef(world);
  latestWorld.current = world;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useImperativeHandle(
    ref,
    () => ({
      reset() {
        sceneActions.current?.reset();
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError(
        'This scene needs WebGL. Try a browser with hardware acceleration enabled.',
      );
      setLoading(false);
      return;
    }
    renderer.setClearColor(0x060809);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      'Interactive low-poly planet. Drag or use arrow keys to orbit, scroll, pinch or use plus and minus to zoom.',
    );
    container.append(canvas);

    const scene = new THREE.Scene();
    createdScenes += 1;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 150);
    camera.position.set(0, 0.12, 5.3);
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.autoRotate = false;
    controls.minDistance = 3.4;
    controls.maxDistance = 14;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.65;
    controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    controls.saveState();

    const topologyStart = performance.now();
    const topology = createTerrainTopology(
      latestWorld.current.config.recipe.topology.detail,
    );
    const topologyMs = performance.now() - topologyStart;
    const geometry = topology.geometry;
    const generator = createWorldGenerator(topology.directions, topology.cornerIndices);
    const colorAttribute = new THREE.BufferAttribute(
      new Float32Array(geometry.getAttribute('position').array.length),
      3,
    );
    geometry.setAttribute('color', colorAttribute);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      flatShading: true,
    });
    const planet = new THREE.Mesh(geometry, material);
    planet.rotation.set(0.15, 0.4, 0.1);
    scene.add(planet);
    const oceanGeometry = new THREE.SphereGeometry(1, 128, 96);
    const oceanMaterial = new THREE.MeshStandardMaterial({
      color: 0x265b78,
      roughness: 0.8,
      metalness: 0,
    });
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
    scene.add(ocean);
    scene.add(new THREE.HemisphereLight(0xc6d8eb, 0x27291e, 1.1));
    // Gentle fill keeps the unlit side readable without another directional shadow.
    scene.add(new THREE.AmbientLight(0xdce4ef, 0.35));

    // The sun and its light share a fixed world position. Only the camera orbits.
    const sunGroup = new THREE.Group();
    sunGroup.position.set(-5.5, 5.5, -20);
    scene.add(sunGroup);
    const sunlight = new THREE.PointLight(0xffe5b7, 1800);
    sunGroup.add(sunlight);
    const sunGeometry = new THREE.SphereGeometry(1, 24, 16);
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff4d6,
      toneMapped: false,
    });
    const sun = new THREE.Mesh(sunGeometry, sunMaterial);
    sunGroup.add(sun);

    // A small soft sprite gives the sun a halo without a bloom pipeline or shader.
    const glowTexture = createGlowTexture();
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffd08a,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sunGlow = new THREE.Sprite(glowMaterial);
    sunGlow.scale.setScalar(5);
    sunGroup.add(sunGlow);
    const starTexture = createGlowTexture(true);
    const stars = createStars(starTexture);
    scene.add(stars);

    let contextLost = false;
    let disposed = false;
    const render = () => {
      if (!disposed && !contextLost && !document.hidden) renderer.render(scene, camera);
    };
    let currentWorld = null;
    let pendingWorld = null;
    let updateFrame = 0;
    let updateCount = 0;
    let requestedRevision = world.revision;

    function applyWorld(nextWorld) {
      if (currentWorld?.appliedRevision === nextWorld.revision) return;
      const start = performance.now();
      const terrain = generator.update(nextWorld.config);
      const generationMs = performance.now() - start;
      if (terrain.geometryChanged) applyTerrainPositions(topology, terrain.positions);
      colorAttribute.array.set(terrain.colors);
      colorAttribute.needsUpdate = true;
      ocean.scale.setScalar(terrain.oceanRadius);
      oceanMaterial.color.set(nextWorld.config.palette.ocean);
      render();
      const updateMs = performance.now() - start;
      updateCount += 1;
      currentWorld = {
        config: nextWorld.config,
        settings: nextWorld.config.settings,
        preset: nextWorld.config.preset,
        seed: nextWorld.config.seed,
        fingerprint: terrain.geometryChanged
          ? fingerprintTerrain(terrain.positions)
          : currentWorld.fingerprint,
        normalFingerprint: terrain.geometryChanged
          ? fingerprintTerrain(geometry.getAttribute('normal').array)
          : currentWorld.normalFingerprint,
        colorFingerprint: fingerprintTerrain(terrain.colors),
        oceanRadius: terrain.oceanRadius,
        appliedRevision: nextWorld.revision,
        revision: nextWorld.revision,
        updateCount,
        generationMs,
        updateMs,
        inputLatencyMs: performance.now() - nextWorld.requestedAt,
        ...terrain.stats,
      };
    }

    function flushWorld() {
      updateFrame = 0;
      if (!pendingWorld || disposed || contextLost || document.hidden) return;
      const nextWorld = pendingWorld;
      pendingWorld = null;
      applyWorld(nextWorld);
    }

    function updateWorld(nextWorld) {
      requestedRevision = nextWorld.revision;
      pendingWorld = nextWorld;
      if (!updateFrame) updateFrame = requestAnimationFrame(flushWorld);
    }

    // Optional read-only diagnostics for reproducibility and performance checks.
    const inspect = () => ({
      ...structuredClone(currentWorld),
      requestedRevision,
      topologyMs,
      terrainTriangles: geometry.getAttribute('position').count / 3,
      uniqueVertices: topology.directions.length / 3,
      oceanTriangles: oceanGeometry.index.count / 3,
      cameraPosition: camera.position.toArray(),
      cameraDistance: camera.position.distanceTo(controls.target),
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      resources: { ...renderer.info.memory },
      createdScenes,
      disposedScenes,
    });

    if (new URLSearchParams(window.location.search).has('inspect')) {
      window.__strataInspect = inspect;
    }
    let mobileDrawerOpen = false;
    function resize() {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      // Keep the planet above the mobile drawer without shrinking the canvas.
      const isMobile = width <= 900;
      const drawerIsVisible = isMobile && mobileDrawerOpen;
      const verticalOffset = drawerIsVisible ? 0.16 : 0;

      camera.fov = 38;
      if (isMobile) {
        camera.fov = drawerIsVisible ? 80 : 65;
      }
      controls.minDistance = isMobile ? 4.1 : 3.4;

      if (drawerIsVisible) {
        camera.setViewOffset(width, height, 0, height * verticalOffset, width, height);
      } else {
        camera.clearViewOffset();
      }
      camera.updateProjectionMatrix();

      controls.update();
      render();
    }
    function onKeyDown(event) {
      if (['+', '=', '-', '_'].includes(event.key)) {
        event.preventDefault();
        const zoomIn = event.key === '+' || event.key === '=';
        const offset = camera.position.clone().sub(controls.target);
        const distance = offset.length() * (zoomIn ? 0.9 : 1.1);
        offset.setLength(
          Math.max(controls.minDistance, Math.min(controls.maxDistance, distance)),
        );
        camera.position.copy(controls.target).add(offset);
        controls.update();
        return;
      }
      const directions = {
        ArrowLeft: [-0.12, 0],
        ArrowRight: [0.12, 0],
        ArrowUp: [0, -0.12],
        ArrowDown: [0, 0.12],
      };
      const direction = directions[event.key];
      if (!direction) {
        return;
      }
      event.preventDefault();
      const [horizontalChange, verticalChange] = direction;
      const cameraOffset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(cameraOffset);
      spherical.theta += horizontalChange;
      spherical.phi += verticalChange;
      spherical.makeSafe();
      camera.position.setFromSpherical(spherical).add(controls.target);
      controls.update();
    }
    function onContextLost(event) {
      event.preventDefault();
      contextLost = true;
      setError(
        'The graphics connection was interrupted. Your world is still saved in this page.',
      );
    }
    function onContextRestored() {
      contextLost = false;
      setError('');
      flushWorld();
      render();
    }
    function onVisibilityChange() {
      if (!document.hidden) {
        updateWorld(latestWorld.current);
        render();
      }
    }
    controls.addEventListener('change', render);
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    sceneActions.current = {
      updateWorld,
      retry: () => renderer.forceContextRestore(),
      reset: () => {
        controls.reset();
        render();
      },
      setDrawer: (open) => {
        mobileDrawerOpen = open;
        resize();
      },
    };
    resize();
    applyWorld(latestWorld.current);
    setLoading(false);

    // No animation loop: an untouched world stays still and does no extra GPU work.
    return () => {
      disposed = true;
      cancelAnimationFrame(updateFrame);
      pendingWorld = null;
      observer.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      geometry.dispose();
      material.dispose();
      oceanGeometry.dispose();
      oceanMaterial.dispose();
      for (const layer of stars.children) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
      sunGeometry.dispose();
      sunMaterial.dispose();
      sunGlow.geometry.dispose();
      glowMaterial.dispose();
      glowTexture.dispose();
      starTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      disposedScenes += 1;
      if (window.__strataInspect === inspect) {
        delete window.__strataInspect;
      }
      canvas.remove();
      sceneActions.current = null;
    };
  }, []);

  useEffect(() => {
    sceneActions.current?.updateWorld(world);
  }, [world]);

  useEffect(() => {
    sceneActions.current?.setDrawer(drawerOpen);
  }, [drawerOpen]);

  return (
    <div className="scene" ref={containerRef}>
      {loading && <p className="scene-loading">Building your world…</p>}
      {error && (
        <div className="scene-error" role="alert">
          <p>{error}</p>
          {sceneActions.current && (
            <button onClick={() => sceneActions.current?.retry()}>Retry graphics</button>
          )}
        </div>
      )}
    </div>
  );
}
