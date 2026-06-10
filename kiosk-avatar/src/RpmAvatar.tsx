// Opravdový 3D avatar přes react-three-fiber (Three.js).
//
// Dvě úrovně:
//  1) Pokud existuje kiosk/public/avatar.glb (realistický model s ARKit
//     blendshapes + visemes), použije se a lip-sync jede přes jeho morph
//     targety (jawOpen / viseme_aa / eyeBlink…).
//     → Vytvoř avatara na https://avaturn.me (nástupce zrušeného Ready Player
//       Me), exportuj jako .glb a ulož sem jako avatar.glb.
//  2) Jinak (offline / bez modelu) se renderuje procedurální 3D hlava
//     poskládaná z primitiv — funguje bez jakéhokoliv stahování.
import { Suspense, useMemo, useRef, Component, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const LOCAL_URL = "/avatar.glb";
const clamp = THREE.MathUtils.clamp;

// ── 1) GLB model (Ready Player Me) ───────────────────────────
function GlbModel({ speaking }: { speaking: boolean }) {
  const { scene } = useGLTF(LOCAL_URL);
  const meshes = useMemo(() => {
    const arr: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.morphTargetDictionary && m.morphTargetInfluences) arr.push(m);
    });
    return arr;
  }, [scene]);
  const blink = useRef({ t: 0, next: 2.5 });

  useFrame((state, dt) => {
    const tm = state.clock.elapsedTime;
    const open = speaking
      ? clamp(0.18 + 0.22 * Math.sin(tm * 11) + 0.18 * Math.sin(tm * 19 + 1) + 0.08 * Math.sin(tm * 31), 0, 1)
      : 0;
    blink.current.t += dt;
    const since = blink.current.t - blink.current.next;
    let bv = 0;
    if (since > 0) {
      if (since < 0.12) bv = since / 0.12;
      else if (since < 0.24) bv = 1 - (since - 0.12) / 0.12;
      else { blink.current.t = 0; blink.current.next = 2 + Math.random() * 3; }
    }
    for (const m of meshes) {
      const dict = m.morphTargetDictionary!;
      const inf = m.morphTargetInfluences!;
      const set = (n: string, v: number) => { const i = dict[n]; if (i !== undefined) inf[i] = v; };
      set("jawOpen", open); set("mouthOpen", open * 0.7);
      set("viseme_aa", open * 0.8); set("viseme_O", open * 0.3); set("mouthSmile", 0.12);
      set("eyeBlinkLeft", bv); set("eyeBlinkRight", bv); set("eyesClosed", bv);
    }
    scene.rotation.y = Math.sin(tm * 0.45) * 0.05;
  });
  return <primitive object={scene} position={[0, -1.5, 0]} />;
}

// ── 2) Procedurální 3D hlava (offline fallback) ──────────────
const SKIN = "#f1c8a0";
const HAIR = "#5b3b2e";

function ProceduralHead({ speaking }: { speaking: boolean }) {
  const grp = useRef<THREE.Group>(null!);
  const mouth = useRef<THREE.Mesh>(null!);
  const lids = useRef<THREE.Group>(null!);
  const blink = useRef({ t: 0, next: 2.5 });

  useFrame((state, dt) => {
    const tm = state.clock.elapsedTime;
    const open = speaking
      ? clamp(0.12 + 0.5 * (0.5 + 0.5 * Math.sin(tm * 12)) * (0.7 + 0.3 * Math.sin(tm * 23 + 1)), 0, 1)
      : 0;
    if (mouth.current) mouth.current.scale.set(0.16, 0.05 + open * 0.22, 0.08);

    blink.current.t += dt;
    const since = blink.current.t - blink.current.next;
    let closed = 0;
    if (since > 0) {
      if (since < 0.1) closed = since / 0.1;
      else if (since < 0.2) closed = 1 - (since - 0.1) / 0.1;
      else { blink.current.t = 0; blink.current.next = 2 + Math.random() * 3; }
    }
    if (lids.current) lids.current.scale.y = closed;
    if (grp.current) grp.current.rotation.y = Math.sin(tm * 0.45) * 0.06;
  });

  return (
    <group ref={grp}>
      {/* vlasy vzadu */}
      <mesh position={[0, 0.02, -0.08]} scale={[0.62, 0.7, 0.55]}>
        <sphereGeometry args={[1, 32, 32]} /><meshStandardMaterial color={HAIR} roughness={0.95} />
      </mesh>
      {/* hlava */}
      <mesh scale={[0.52, 0.62, 0.52]}>
        <sphereGeometry args={[1, 48, 48]} /><meshStandardMaterial color={SKIN} roughness={0.85} />
      </mesh>
      {/* ofina */}
      <mesh position={[0, 0.33, 0.06]} rotation={[0.25, 0, 0]} scale={[0.56, 0.4, 0.56]}>
        <sphereGeometry args={[1, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={HAIR} roughness={0.95} />
      </mesh>
      {/* oči */}
      <group position={[0, 0.05, 0]}>
        {[-0.18, 0.18].map((x) => (
          <group key={x}>
            <mesh position={[x, 0, 0.45]}><sphereGeometry args={[0.075, 24, 24]} /><meshStandardMaterial color="#ffffff" roughness={0.4} /></mesh>
            <mesh position={[x, 0, 0.5]}><sphereGeometry args={[0.034, 16, 16]} /><meshStandardMaterial color="#3a2a20" /></mesh>
          </group>
        ))}
        {/* víčka — zvětší se při mrknutí */}
        <group ref={lids} scale={[1, 0, 1]}>
          {[-0.18, 0.18].map((x) => (
            <mesh key={x} position={[x, 0.02, 0.47]} scale={[0.085, 0.09, 0.06]}>
              <sphereGeometry args={[1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={SKIN} />
            </mesh>
          ))}
        </group>
      </group>
      {/* obočí */}
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, 0.17, 0.47]} scale={[0.09, 0.018, 0.03]}>
          <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={HAIR} />
        </mesh>
      ))}
      {/* nos */}
      <mesh position={[0, -0.03, 0.53]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.04, 0.12, 12]} /><meshStandardMaterial color={SKIN} />
      </mesh>
      {/* pusa — lip-sync přes scale.y */}
      <mesh ref={mouth} position={[0, -0.24, 0.47]} scale={[0.16, 0.06, 0.08]}>
        <sphereGeometry args={[1, 24, 24]} /><meshStandardMaterial color="#9c3b34" />
      </mesh>
      {/* tváře */}
      {[-0.28, 0.28].map((x) => (
        <mesh key={x} position={[x, -0.12, 0.4]}><sphereGeometry args={[0.05, 16, 16]} /><meshStandardMaterial color="#ff9d8a" transparent opacity={0.3} /></mesh>
      ))}
      {/* ramena / uniforma */}
      <mesh position={[0, -0.98, 0]} scale={[0.75, 0.42, 0.5]}>
        <sphereGeometry args={[1, 32, 32]} /><meshStandardMaterial color="#33417a" roughness={0.7} />
      </mesh>
    </group>
  );
}

// ── Scéna + obal ─────────────────────────────────────────────
function Stage({ children }: { children: ReactNode }) {
  return (
    <Canvas camera={{ position: [0, 0.02, 1.05], fov: 24 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} style={{ background: "transparent" }}>
      <ambientLight intensity={0.9} />
      <hemisphereLight args={[0xffffff, 0x445066, 0.6]} />
      <directionalLight position={[2, 3, 3]} intensity={1.5} />
      <directionalLight position={[-3, 1, 2]} intensity={0.5} />
      {children}
    </Canvas>
  );
}

// Když chybí/selže lokální GLB, spadneme na procedurální hlavu.
class GlbBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

export function RpmCanvas({ speaking }: { speaking: boolean }) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <GlbBoundary fallback={<Stage><ProceduralHead speaking={speaking} /></Stage>}>
        <Suspense fallback={<Stage><ProceduralHead speaking={speaking} /></Stage>}>
          <Stage><GlbModel speaking={speaking} /></Stage>
        </Suspense>
      </GlbBoundary>
    </div>
  );
}
