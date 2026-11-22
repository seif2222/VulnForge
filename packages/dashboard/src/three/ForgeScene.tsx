import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
} from 'three';

import type { AgentState, Severity } from '../lib/core.js';
import { WEBGL_COLORS } from '../tokens.generated.js';
import { severityHex } from './graph-colors.js';
import { useThreeScene } from './useThreeScene.js';
import type { SceneInstance, ThreeSceneHandle } from './useThreeScene.js';

/**
 * Forge in WebGL: the same identity as Forge2D (ice-white glossy shell, dark
 * visor with striped eyes, antenna with ball, ear discs, chest screen), built
 * from primitives — no external model files, so the bundle stays offline.
 * The six approved agent states drive motion and accent color. All colors come
 * from the generated token module; all motion reads the injected clock.
 */

interface ForgeRefs {
  readonly state: MutableRefObject<AgentState>;
  readonly severity: MutableRefObject<Severity | null>;
}

function chestColorFor(state: AgentState, severity: Severity | null): string {
  switch (state) {
    case 'detected':
      return severityHex(severity ?? 'high');
    case 'completed':
      return WEBGL_COLORS.success;
    case 'error':
      return WEBGL_COLORS.danger;
    default:
      return WEBGL_COLORS.accent;
  }
}

function buildForgeScene(handle: ThreeSceneHandle, refs: ForgeRefs): SceneInstance {
  const { renderer } = handle;
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, handle.width / Math.max(1, handle.height), 1, 1000);
  camera.position.set(0, 6, 175);
  camera.lookAt(0, 4, 0);

  const ambient = new AmbientLight(new Color(WEBGL_COLORS.textPrimary), 0.55);
  const key = new DirectionalLight(new Color(WEBGL_COLORS.textPrimary), 1.6);
  key.position.set(60, 90, 80);
  const rim = new PointLight(new Color(WEBGL_COLORS.accent), 12, 400);
  rim.position.set(-50, -40, 60);
  scene.add(ambient, key, rim);

  const shell = new MeshStandardMaterial({
    color: new Color(WEBGL_COLORS.textPrimary),
    roughness: 0.22,
    metalness: 0.18,
  });
  const shellDim = new MeshStandardMaterial({
    color: new Color(WEBGL_COLORS.textSecondary),
    roughness: 0.35,
    metalness: 0.2,
  });
  const visorMat = new MeshStandardMaterial({
    color: new Color(WEBGL_COLORS.bgBase),
    roughness: 0.12,
    metalness: 0.45,
  });
  const eyeMat = new MeshStandardMaterial({
    color: new Color(WEBGL_COLORS.bgBase),
    emissive: new Color(WEBGL_COLORS.accent),
    emissiveIntensity: 1.6,
  });
  const chestMat = new MeshStandardMaterial({
    color: new Color(WEBGL_COLORS.bgBase),
    emissive: new Color(WEBGL_COLORS.accent),
    emissiveIntensity: 1.2,
  });
  const antennaBallMat = new MeshStandardMaterial({
    color: new Color(WEBGL_COLORS.bgBase),
    emissive: new Color(WEBGL_COLORS.accent),
    emissiveIntensity: 1.4,
  });
  const materials = [shell, shellDim, visorMat, eyeMat, chestMat, antennaBallMat];

  const robot = new Group();
  const head = new Group();
  head.position.set(0, 15, 0);

  const geometries: Array<BoxGeometry | CapsuleGeometry | CylinderGeometry | SphereGeometry> = [];
  const add = (
    parent: Group,
    geometry: BoxGeometry | CapsuleGeometry | CylinderGeometry | SphereGeometry,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh => {
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Head: glossy ice-white shell (sphere squashed to the 2D proportions).
  const headShell = add(head, new SphereGeometry(34, 48, 32), shell, 0, 0, 0);
  headShell.scale.set(1, 0.76, 0.82);
  // Visor: dark band across the face. Its front face must clear the head
  // sphere's z extent (27.9) or the shell bulges through the middle.
  add(head, new BoxGeometry(52, 24, 8), visorMat, 0, 0, 25.5);
  // Striped eyes: two stripes per eye, emissive accent, just off the visor.
  add(head, new BoxGeometry(10, 2.6, 1.5), eyeMat, -11, 3.7, 30.2);
  add(head, new BoxGeometry(10, 2.6, 1.5), eyeMat, -11, -1.8, 30.2);
  add(head, new BoxGeometry(10, 2.6, 1.5), eyeMat, 11, 3.7, 30.2);
  add(head, new BoxGeometry(10, 2.6, 1.5), eyeMat, 11, -1.8, 30.2);
  // Ear discs.
  const earL = add(head, new CylinderGeometry(4, 4, 8, 24), shellDim, -38, -9, 0);
  earL.rotation.z = Math.PI / 2;
  const earR = add(head, new CylinderGeometry(4, 4, 8, 24), shellDim, 38, -9, 0);
  earR.rotation.z = Math.PI / 2;
  // Antenna with ball.
  add(head, new CylinderGeometry(1.5, 1.5, 14, 12), shellDim, 0, 33, 0);
  const ball = add(head, new SphereGeometry(4.5, 24, 16), antennaBallMat, 0, 43, 0);

  // Body: capsule torso with the chest screen.
  const body = new Group();
  body.position.set(0, -30, 0);
  const torso = add(body, new CapsuleGeometry(18, 8, 8, 24), shell, 0, 0, 0);
  torso.scale.set(1.2, 0.75, 0.9);
  add(body, new BoxGeometry(20, 12, 2), chestMat, 0, -2, 15.5);

  robot.add(head, body);
  scene.add(robot);

  const applyState = (elapsedMs: number): void => {
    const state = refs.state.current;
    const severity = refs.severity.current;
    const t = elapsedMs / 1000;

    // Defaults every frame so state switches never leave stale motion behind.
    head.rotation.set(0, 0, 0);
    robot.rotation.set(0, 0, 0);
    robot.position.y = 0;
    eyeMat.emissiveIntensity = 1.6;
    antennaBallMat.emissiveIntensity = 1.4;
    chestMat.emissiveIntensity = 1.2;

    const accent = chestColorFor(state, severity);
    chestMat.emissive.set(accent);
    antennaBallMat.emissive.set(state === 'detected' ? accent : WEBGL_COLORS.accent);

    switch (state) {
      case 'idle':
        robot.position.y = Math.sin(t * 1.4) * 2.5;
        antennaBallMat.emissiveIntensity = 1.2 + 0.4 * Math.sin(t * 2);
        break;
      case 'scanning':
        head.rotation.y = Math.sin(t * 2.2) * 0.5;
        robot.position.y = Math.sin(t * 1.4) * 1.5;
        break;
      case 'analyzing':
        eyeMat.emissiveIntensity = 1.6 + 1.2 * Math.sin(t * 9);
        head.rotation.x = 0.08 + 0.05 * Math.sin(t * 3);
        break;
      case 'detected':
        chestMat.emissiveIntensity = 1.4 + 1.2 * Math.abs(Math.sin(t * 7));
        antennaBallMat.emissiveIntensity = 1.4 + 1.4 * Math.abs(Math.sin(t * 7));
        robot.position.y = Math.sin(t * 3) * 1.2;
        break;
      case 'completed':
        chestMat.emissiveIntensity = 2;
        head.rotation.x = 0.06 * Math.sin(t * 1.5);
        robot.position.y = Math.abs(Math.sin(t * 1.8)) * 2;
        break;
      case 'error':
        robot.rotation.z = 0.12;
        chestMat.emissiveIntensity = 1.8 + 0.8 * Math.sin(t * 4);
        break;
    }
    ball.scale.setScalar(1 + 0.06 * Math.sin(t * 2));
  };

  return {
    tick(elapsedMs) {
      applyState(elapsedMs);
      renderer.render(scene, camera);
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
    },
  };
}

export function ForgeScene(props: {
  readonly state: AgentState;
  readonly detectedSeverity?: Severity | null;
}) {
  const stateRef = useRef(props.state);
  stateRef.current = props.state;
  const severityRef = useRef(props.detectedSeverity ?? null);
  severityRef.current = props.detectedSeverity ?? null;

  const containerRef = useThreeScene({
    init: (handle) => buildForgeScene(handle, { state: stateRef, severity: severityRef }),
    resetKey: 'forge',
    alpha: true,
  });

  return (
    <div
      ref={containerRef}
      className="scene-container scene-forge"
      role="img"
      aria-label={`Forge, state: ${props.state}`}
    />
  );
}
