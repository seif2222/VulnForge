import { useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';

import type { DependencyGraph, Report, SceneNode, Severity } from '../lib/core.js';
import { WEBGL_COLORS } from '../tokens.generated.js';
import { DIM_EDGE_HEX, DIM_NODE_HEX, edgeHex, nodeHex, nodeRadius } from './graph-colors.js';
import { useThreeScene } from './useThreeScene.js';
import type { SceneInstance, ThreeSceneHandle } from './useThreeScene.js';

/**
 * The interactive 3D dependency graph: one instanced mesh for every package
 * (scales past the spec's 2000-node bar), line segments for edges, custom
 * orbit/zoom/pan controls (no inline styles, CSP-safe), hover tooltips and a
 * click selection that surfaces the node's real findings from the report.
 * The vulnerable-path filter dims everything off a vulnerable path.
 * Data comes only from the report via buildDependencyGraph; the accessible
 * 2D tree beside it always carries the same information.
 */

interface HoverInfo {
  readonly x: number;
  readonly y: number;
  readonly node: SceneNode;
}

interface GraphRefs {
  readonly graph: MutableRefObject<DependencyGraph>;
  readonly pathIds: MutableRefObject<ReadonlySet<string> | null>;
  readonly onHover: MutableRefObject<(info: HoverInfo | null) => void>;
  readonly onSelect: MutableRefObject<(nodeId: string | null) => void>;
}

interface Controls {
  theta: number;
  phi: number;
  distance: number;
  target: Vector3;
}

const BG = new Color(WEBGL_COLORS.bgBase);

function buildGraphScene(handle: ThreeSceneHandle, refs: GraphRefs): SceneInstance {
  const { renderer, canvas } = handle;
  const scene = new Scene();
  scene.background = BG;
  const camera = new PerspectiveCamera(45, handle.width / Math.max(1, handle.height), 1, 20000);
  scene.add(new AmbientLight(new Color(WEBGL_COLORS.textPrimary), 0.7));
  const key = new DirectionalLight(new Color(WEBGL_COLORS.textPrimary), 1.4);
  key.position.set(120, 180, 160);
  scene.add(key);

  const nodeGeometry = new SphereGeometry(1, 14, 10);
  const nodeMaterial = new MeshStandardMaterial({ roughness: 0.4, metalness: 0.15 });
  const edgeMaterial = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
  });

  let nodeMesh: InstancedMesh | null = null;
  let edges: LineSegments | null = null;
  let edgeGeometry: BufferGeometry | null = null;
  let appliedGraph: DependencyGraph | null = null;
  let appliedPath: ReadonlySet<string> | null | undefined;
  const matrix = new Matrix4();
  const color = new Color();

  const controls: Controls = { theta: 0.7, phi: 1.15, distance: 300, target: new Vector3(0, 0, 0) };
  let fitRadius = 300;

  const applyCamera = (): void => {
    const sinPhi = Math.sin(controls.phi);
    camera.position.set(
      controls.target.x + controls.distance * sinPhi * Math.sin(controls.theta),
      controls.target.y + controls.distance * Math.cos(controls.phi),
      controls.target.z + controls.distance * sinPhi * Math.cos(controls.theta),
    );
    camera.lookAt(controls.target);
  };

  const colorFor = (node: SceneNode, path: ReadonlySet<string> | null): string =>
    path !== null && !path.has(node.id) ? DIM_NODE_HEX : nodeHex(node);

  const rebuild = (graph: DependencyGraph): void => {
    if (nodeMesh !== null) {
      scene.remove(nodeMesh);
      nodeMesh.dispose();
    }
    if (edges !== null) {
      scene.remove(edges);
    }
    edgeGeometry?.dispose();

    nodeMesh = new InstancedMesh(nodeGeometry, nodeMaterial, graph.nodes.length);
    graph.nodes.forEach((node, index) => {
      matrix.makeScale(nodeRadius(node), nodeRadius(node), nodeRadius(node));
      matrix.setPosition(node.x, node.y, node.z);
      nodeMesh?.setMatrixAt(index, matrix);
      nodeMesh?.setColorAt(index, color.set(colorFor(node, refs.pathIds.current)));
    });
    nodeMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor !== null) {
      nodeMesh.instanceColor.needsUpdate = true;
    }
    scene.add(nodeMesh);

    const positions = new Float32Array(graph.edges.length * 6);
    const colors = new Float32Array(graph.edges.length * 6);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    graph.edges.forEach((edge, index) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (from === undefined || to === undefined) {
        return;
      }
      positions.set([from.x, from.y, from.z, to.x, to.y, to.z], index * 6);
      const path = refs.pathIds.current;
      const hex = path !== null && !path.has(edge.to) ? DIM_EDGE_HEX : edgeHex(edge.worstSeverity);
      color.set(hex);
      colors.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6);
    });
    edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    edgeGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    edges = new LineSegments(edgeGeometry, edgeMaterial);
    scene.add(edges);

    // Fit the camera to the real layout extents.
    let radius = 60;
    for (const node of graph.nodes) {
      radius = Math.max(
        radius,
        Math.sqrt(node.x * node.x + node.y * node.y + node.z * node.z) + 40,
      );
    }
    fitRadius = radius;
    controls.distance = radius * 2.1;
    controls.target.set(0, 0, 0);
    camera.far = Math.max(20000, radius * 20);
    camera.updateProjectionMatrix();
  };

  const recolor = (graph: DependencyGraph, path: ReadonlySet<string> | null): void => {
    if (nodeMesh === null) {
      return;
    }
    graph.nodes.forEach((node, index) => {
      nodeMesh?.setColorAt(index, color.set(colorFor(node, path)));
    });
    if (nodeMesh.instanceColor !== null) {
      nodeMesh.instanceColor.needsUpdate = true;
    }
    if (edgeGeometry !== null) {
      const attr = edgeGeometry.getAttribute('color');
      graph.edges.forEach((edge, index) => {
        const hex =
          path !== null && !path.has(edge.to) ? DIM_EDGE_HEX : edgeHex(edge.worstSeverity);
        color.set(hex);
        attr.setXYZ(index * 2, color.r, color.g, color.b);
        attr.setXYZ(index * 2 + 1, color.r, color.g, color.b);
      });
      attr.needsUpdate = true;
    }
  };

  // ---- controls: orbit (drag), zoom (wheel / pinch), pan (shift/right drag)
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let downPos = { x: 0, y: 0 };
  let panMode = false;
  let pinchDistance = 0;
  // Idle timing uses the injected clock (via the last tick's elapsed) so the
  // auto-rotation stays deterministic; only the click-speed check uses
  // performance.now, which never drives animation.
  let lastElapsed = 0;
  let idleAt = 0;
  const pointerNdc = new Vector2();
  let pointerClient: { x: number; y: number } | null = null;
  let pointerDirty = false;
  const raycaster = new Raycaster();
  let hoveredIndex: number | null = null;

  const toNdc = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    );
    pointerClient = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    panMode = event.shiftKey || event.button === 2;
    downAt = performance.now();
    downPos = { x: event.clientX, y: event.clientY };
    idleAt = lastElapsed;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    toNdc(event);
    pointerDirty = true;
    const previous = pointers.get(event.pointerId);
    if (previous === undefined) {
      return;
    }
    idleAt = lastElapsed;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const next = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
      if (pinchDistance > 0 && next > 0) {
        controls.distance = clampDistance((controls.distance * pinchDistance) / next);
      }
      pinchDistance = next;
      return;
    }
    if (panMode) {
      const scale = controls.distance * 0.0016;
      const right = new Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrix, 1);
      controls.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    } else {
      controls.theta -= dx * 0.005;
      controls.phi = Math.min(Math.PI - 0.15, Math.max(0.15, controls.phi - dy * 0.005));
    }
  };
  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    pinchDistance = 0;
    const moved = Math.hypot(event.clientX - downPos.x, event.clientY - downPos.y);
    if (moved < 5 && performance.now() - downAt < 400) {
      toNdc(event);
      const hit = pick();
      refs.onSelect.current(hit === null ? null : (appliedGraph?.nodes[hit]?.id ?? null));
    }
  };
  const onPointerLeave = (): void => {
    pointerClient = null;
    if (hoveredIndex !== null) {
      hoveredIndex = null;
      refs.onHover.current(null);
    }
  };
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    idleAt = lastElapsed;
    controls.distance = clampDistance(controls.distance * Math.exp(event.deltaY * 0.001));
  };
  const clampDistance = (value: number): number =>
    Math.min(fitRadius * 6, Math.max(fitRadius * 0.35, value));
  const onContextMenu = (event: Event): void => event.preventDefault();

  const pick = (): number | null => {
    if (nodeMesh === null) {
      return null;
    }
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(nodeMesh);
    const hit = hits[0];
    return hit?.instanceId ?? null;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    tick(elapsedMs, deltaMs) {
      lastElapsed = elapsedMs;
      const graph = refs.graph.current;
      const path = refs.pathIds.current;
      if (graph !== appliedGraph) {
        appliedGraph = graph;
        appliedPath = path;
        rebuild(graph);
      } else if (path !== appliedPath) {
        appliedPath = path;
        recolor(graph, path);
      }

      // Gentle idle rotation once the user stops interacting (deterministic:
      // driven by the injected clock's elapsed time, not Date.now).
      if (pointers.size === 0 && elapsedMs - idleAt > 4000) {
        controls.theta += deltaMs * 0.00004;
      }
      applyCamera();

      if (pointerDirty && pointerClient !== null) {
        pointerDirty = false;
        const hit = pick();
        if (hit !== hoveredIndex) {
          hoveredIndex = hit;
          const node = hit === null ? undefined : appliedGraph?.nodes[hit];
          refs.onHover.current(
            node === undefined || pointerClient === null
              ? null
              : { x: pointerClient.x, y: pointerClient.y, node },
          );
        }
      }
      renderer.render(scene, camera);
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      nodeMesh?.dispose();
      edgeGeometry?.dispose();
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      edgeMaterial.dispose();
    },
  };
}

export function GraphScene(props: {
  readonly graph: DependencyGraph;
  readonly report: Report;
  readonly pathIds: ReadonlySet<string> | null;
}) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const graphRef = useRef(props.graph);
  graphRef.current = props.graph;
  const pathRef = useRef(props.pathIds);
  pathRef.current = props.pathIds;
  const hoverRef = useRef<(info: HoverInfo | null) => void>(setHover);
  hoverRef.current = setHover;
  const selectRef = useRef<(nodeId: string | null) => void>(setSelectedId);
  selectRef.current = setSelectedId;

  const containerRef = useThreeScene({
    init: (handle) =>
      buildGraphScene(handle, {
        graph: graphRef,
        pathIds: pathRef,
        onHover: hoverRef,
        onSelect: selectRef,
      }),
    resetKey: 'graph',
    clearColor: new Color(WEBGL_COLORS.bgBase).getHex(),
  });

  const selected =
    selectedId === null ? null : (props.graph.nodes.find((node) => node.id === selectedId) ?? null);
  const selectedFindings =
    selected === null
      ? []
      : props.report.vulnerabilities.filter(
          (vuln) => `${vuln.package}@${vuln.installedVersion}` === selected.id,
        );

  const severityBadge = (severity: Severity | null): string => severity ?? 'low';

  return (
    <div>
      <div
        ref={containerRef}
        className="scene-container scene-graph"
        role="img"
        aria-label={`3D dependency graph: ${props.graph.nodes.length} packages, ${props.graph.edges.length} edges`}
      />
      {/* Hover readout: anchored in the corner (no inline styles under CSP). */}
      {hover !== null && (
        <p className="scene-hover mono">
          {hover.node.id}
          {hover.node.subtreeWorstSeverity !== null && ` · ${hover.node.subtreeWorstSeverity}`}
          {hover.node.findingCount > 0 && ` · ${hover.node.findingCount} findings`}
        </p>
      )}
      <p className="scene-hint mono muted">
        drag to orbit · scroll to zoom · shift-drag to pan · click a package for its findings
      </p>
      {selected !== null && (
        <div className="scene-detail">
          <p className="mono">
            {selected.id} {selected.isDirect && <span className="badge low">direct</span>}{' '}
            {selected.subtreeWorstSeverity !== null && (
              <span className={`badge ${severityBadge(selected.subtreeWorstSeverity)}`}>
                subtree {selected.subtreeWorstSeverity}
              </span>
            )}
          </p>
          <p className="muted mono">
            depth {selected.depth} · required by {selected.dependentCount} package(s) ·{' '}
            {selected.findingCount} finding(s)
          </p>
          {selectedFindings.length === 0 ? (
            <p className="muted">no findings on this exact version</p>
          ) : (
            selectedFindings.slice(0, 5).map((vuln) => (
              <div key={vuln.findingKey} className="suggestion-card">
                <p className="mono">
                  <span className={`badge ${vuln.severity}`}>{vuln.severity}</span> {vuln.id}
                </p>
                <p>{vuln.summary}</p>
                {vuln.fixedVersion !== null && (
                  <p className="muted mono">fixed in {vuln.fixedVersion}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
