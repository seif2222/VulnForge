import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from 'three';

import { WEBGL_COLORS } from '../tokens.generated.js';
import { spiralPosition } from './spiral.js';
import { useThreeScene } from './useThreeScene.js';
import type { SceneInstance, ThreeSceneHandle } from './useThreeScene.js';

/**
 * The Live Monitor's 3D scan visual: one slot per real OSV query the engine
 * announced (queriesTotal), lit in arrival order as real progress events name
 * each package. The newest package pulses accent; settled queries stay
 * ice-white; slots the engine has not reached yet stay dark. No invented
 * nodes — the count and the order both come from the server's SSE stream.
 * The HTML counters beside the canvas carry the same numbers as text.
 */

interface ScanFieldRefs {
  readonly packages: MutableRefObject<readonly string[]>;
  readonly total: MutableRefObject<number>;
}

const NODE_RADIUS = 5;

function buildScanField(handle: ThreeSceneHandle, refs: ScanFieldRefs): SceneInstance {
  const { renderer } = handle;
  const scene = new Scene();
  scene.background = new Color(WEBGL_COLORS.bgBase);
  const camera = new PerspectiveCamera(45, handle.width / Math.max(1, handle.height), 1, 20000);
  scene.add(new AmbientLight(new Color(WEBGL_COLORS.textPrimary), 0.7));
  const key = new DirectionalLight(new Color(WEBGL_COLORS.textPrimary), 1.3);
  key.position.set(120, 200, 140);
  scene.add(key);

  const geometry = new SphereGeometry(NODE_RADIUS, 12, 8);
  const material = new MeshStandardMaterial({ roughness: 0.35, metalness: 0.15 });
  const dim = new Color(WEBGL_COLORS.bgOverlay);
  const lit = new Color(WEBGL_COLORS.textPrimary);
  const active = new Color(WEBGL_COLORS.accent);
  const matrix = new Matrix4();

  let mesh: InstancedMesh | null = null;
  let capacity = -1;
  let litCount = -1;
  const bornAt = new Map<number, number>();
  let theta = 0.5;

  const fitDistance = (count: number): number => Math.max(200, 14 * Math.sqrt(count) * 3.2);

  const ensureCapacity = (count: number): void => {
    if (mesh !== null && count <= capacity) {
      return;
    }
    if (mesh !== null) {
      scene.remove(mesh);
      mesh.dispose();
    }
    capacity = Math.max(count, 16);
    mesh = new InstancedMesh(geometry, material, capacity);
    mesh.count = count;
    for (let index = 0; index < count; index += 1) {
      const { x, y, z } = spiralPosition(index);
      matrix.makeScale(1, 1, 1);
      matrix.setPosition(x, y, z);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, dim);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true;
    }
    scene.add(mesh);
    // The rebuild reset every slot to dim: force the lit pass to reapply.
    litCount = -1;
  };

  return {
    tick(elapsedMs, deltaMs) {
      const packages = refs.packages.current;
      const total = Math.max(refs.total.current, packages.length);
      if (total === 0) {
        renderer.render(scene, camera);
        return;
      }
      ensureCapacity(total);
      const instanced = mesh;
      if (instanced === null) {
        return;
      }
      instanced.count = total;

      // Light newly completed queries; only the recent ones animate. Start one
      // slot early so the previous newest drops from accent to ice-white.
      const newest = packages.length - 1;
      const recolorFrom = litCount < packages.length ? Math.max(0, litCount - 1) : packages.length;
      for (let index = recolorFrom; index < packages.length; index += 1) {
        if (!bornAt.has(index)) {
          bornAt.set(index, elapsedMs);
        }
        instanced.setColorAt(index, index === newest ? active : lit);
      }
      if (packages.length !== litCount) {
        litCount = packages.length;
        if (instanced.instanceColor !== null) {
          instanced.instanceColor.needsUpdate = true;
        }
      }

      // Birth scale-in (300ms) and a gentle pulse on the newest query.
      for (let index = Math.max(0, newest - 24); index <= newest; index += 1) {
        const born = bornAt.get(index);
        if (born === undefined) {
          continue;
        }
        const age = Math.max(0, elapsedMs - born);
        const grow = Math.min(1, age / 300);
        const pulse = index === newest ? 1 + 0.25 * Math.sin(elapsedMs / 130) : 1;
        const scale = grow * pulse;
        const { x, y, z } = spiralPosition(index);
        matrix.makeScale(scale, scale, scale);
        matrix.setPosition(x, y, z);
        instanced.setMatrixAt(index, matrix);
      }
      instanced.instanceMatrix.needsUpdate = true;

      // Slow deterministic orbit from the injected clock.
      theta += deltaMs * 0.00012;
      const distance = fitDistance(total);
      camera.position.set(distance * Math.sin(theta), distance * 0.45, distance * Math.cos(theta));
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    dispose() {
      mesh?.dispose();
      geometry.dispose();
      material.dispose();
      bornAt.clear();
    },
  };
}

export function ScanFieldScene(props: {
  readonly packages: readonly string[];
  readonly total: number;
}) {
  const packagesRef = useRef(props.packages);
  packagesRef.current = props.packages;
  const totalRef = useRef(props.total);
  totalRef.current = props.total;

  const containerRef = useThreeScene({
    init: (handle) => buildScanField(handle, { packages: packagesRef, total: totalRef }),
    resetKey: 'scan-field',
    clearColor: new Color(WEBGL_COLORS.bgBase).getHex(),
  });

  return (
    <div
      ref={containerRef}
      className="scene-container scene-scan"
      role="img"
      aria-label={`scan progress: ${props.packages.length} of ${props.total} packages queried`}
    />
  );
}
