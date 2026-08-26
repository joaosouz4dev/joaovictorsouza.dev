import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Nuvem de pontos do ROSTO REAL: o MediaPipe FaceLandmarker extrai 478 pontos
// 3D do rosto na foto/webcam e a nuvem e construida sobre essa malha (pontos +
// interpolacao ao longo das 2556 arestas da tesselacao). Os lábios sao
// landmarks conhecidos, entao a boca abre/fecha de verdade ao falar; no modo
// webcam ao vivo a nuvem espelha o rosto (e a boca) do usuario em tempo real.
// Mesma tecnica de projetos como spite/FaceMeshFaceGeometry.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const LANDMARK_COUNT = 478;
const EDGE_SUBDIV = 4;
const SAMPLE_SIZE = 192;
const FACE_HEIGHT = 2.35;
const LIVE_DETECT_INTERVAL = 0.05;

let landmarkerPromise = null;
async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      };
      try {
        return await FaceLandmarker.createFromOptions(fileset, options);
      } catch {
        options.baseOptions.delegate = 'CPU';
        return await FaceLandmarker.createFromOptions(fileset, options);
      }
    })();
  }
  return landmarkerPromise;
}

const CLOUD_VERTEX = `
  attribute float aLum;
  attribute float aMouth;
  attribute float aRand;
  uniform float uTime;
  uniform float uMouth;
  uniform float uPixelRatio;
  varying float vLum;
  varying float vMouth;

  void main() {
    vec3 p = position;

    // respiracao sutil
    p += normalize(p + vec3(0.0, 0.0, 0.001)) * sin(uTime * 1.3 + aRand * 6.2831) * 0.006;

    // mandibula desce, labio superior sobe de leve (aMouth e assinado)
    float m = uMouth * aMouth;
    p.y -= m * 0.2;
    p.z += abs(m) * 0.03;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    vLum = aLum + abs(m) * 0.7;
    vMouth = abs(m);
    gl_PointSize = uPixelRatio * (1.7 + aLum * 3.6 + abs(m) * 2.0) * (3.8 / -mv.z);
  }
`;

const CLOUD_FRAGMENT = `
  uniform vec3 uDeep;
  uniform vec3 uBright;
  uniform vec3 uAccent;
  varying float vLum;
  varying float vMouth;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.05, d);

    vec3 col = mix(uDeep, uBright, smoothstep(0.12, 0.9, vLum));
    col = mix(col, uAccent, clamp(vMouth * 0.8, 0.0, 0.65));

    float alpha = core * (0.25 + clamp(vLum, 0.0, 1.2) * 0.8);
    gl_FragColor = vec4(col * (0.6 + vLum * 0.85), alpha);
  }
`;

export function useFaceCloud(imageSrc, { speaking, level } = {}) {
  const containerRef = useRef(null);
  const canvasHostRef = useRef(null);
  const stateRef = useRef({ speaking: false, level: 0 });
  const controlRef = useRef({});
  const [faceStatus, setFaceStatus] = useState('idle');

  useEffect(() => {
    stateRef.current.speaking = Boolean(speaking);
    stateRef.current.level = level || 0;
  }, [speaking, level]);

  useEffect(() => {
    const host = canvasHostRef.current;
    const container = containerRef.current;
    if (!host || !container) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return undefined;
    }

    let destroyed = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(0, 0, 5);

    const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
    const capacity = LANDMARK_COUNT + edges.length * EDGE_SUBDIV;

    const positions = new Float32Array(capacity * 3);
    const lums = new Float32Array(capacity);
    const mouths = new Float32Array(capacity);
    const rands = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) rands[i] = Math.random();

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const lumAttr = new THREE.BufferAttribute(lums, 1);
    const mouthAttr = new THREE.BufferAttribute(mouths, 1);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('aLum', lumAttr);
    geometry.setAttribute('aMouth', mouthAttr);
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouth: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uDeep: { value: new THREE.Color('#3730d8') },
        uBright: { value: new THREE.Color('#6ee7ff') },
        uAccent: { value: new THREE.Color('#e935a8') },
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const cloud = new THREE.Points(geometry, material);
    scene.add(cloud);

    // indices dos labios, extraidos das conexoes oficiais do FaceLandmarker
    const lipIndexSet = new Set();
    for (const conn of FaceLandmarker.FACE_LANDMARKS_LIPS) {
      lipIndexSet.add(conn.start);
      lipIndexSet.add(conn.end);
    }

    // cabeca generica de fallback (espiral dourada sobre elipsoide deformado)
    const applyProceduralHead = () => {
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < capacity; i++) {
        const yUnit = 1 - (i / (capacity - 1)) * 2;
        const radius = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
        const angle = golden * i;
        let x = Math.cos(angle) * radius;
        const y = yUnit;
        let z = Math.sin(angle) * radius;

        const frontness = Math.max(0, z);
        const nose =
          frontness *
          Math.max(0, 1 - Math.abs(x) * 3.4) *
          Math.max(0, 1 - Math.abs(y + 0.08) * 2.4);
        const mouthMask =
          frontness *
          Math.max(0, 1 - Math.abs(y + 0.45) / 0.16) *
          Math.max(0, 1 - Math.abs(x) / 0.4);
        x *= 1 - Math.max(0, -y) * 0.22;

        const jitter = 1 + (rands[i] - 0.5) * 0.04;
        positions[i * 3] = x * jitter;
        positions[i * 3 + 1] = y * 1.3 * jitter;
        positions[i * 3 + 2] = (z * 0.94 + nose * 0.18) * jitter;
        lums[i] = 0.14 + rands[i] * 0.16 + frontness * 0.26;
        mouths[i] = mouthMask * (y < -0.45 ? 1 : -0.35);
      }
      posAttr.needsUpdate = true;
      lumAttr.needsUpdate = true;
      mouthAttr.needsUpdate = true;
    };
    applyProceduralHead();

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = SAMPLE_SIZE;
    sampleCanvas.height = SAMPLE_SIZE;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

    // buffers de trabalho por landmark
    const lmX = new Float32Array(LANDMARK_COUNT);
    const lmY = new Float32Array(LANDMARK_COUNT);
    const lmZ = new Float32Array(LANDMARK_COUNT);
    const lmLum = new Float32Array(LANDMARK_COUNT);
    const lmMouth = new Float32Array(LANDMARK_COUNT);

    const updateFromLandmarks = (landmarks, source, sw, sh, mirror) => {
      sampleCtx.save();
      if (mirror) {
        sampleCtx.translate(SAMPLE_SIZE, 0);
        sampleCtx.scale(-1, 1);
      }
      sampleCtx.drawImage(source, 0, 0, sw, sh, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      sampleCtx.restore();
      const { data } = sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

      // bounding box para centralizar e escalar o rosto
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const lm = landmarks[i];
        const x = mirror ? 1 - lm.x : lm.x;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (lm.y < minY) minY = lm.y;
        if (lm.y > maxY) maxY = lm.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const aspect = sw / sh;
      const faceH = Math.max(0.001, maxY - minY);
      const scale = FACE_HEIGHT / faceH;

      // centro da boca a partir dos landmarks dos labios
      let mouthCx = 0;
      let mouthCy = 0;
      for (const idx of lipIndexSet) {
        const lm = landmarks[idx];
        mouthCx += mirror ? 1 - lm.x : lm.x;
        mouthCy += lm.y;
      }
      mouthCx /= lipIndexSet.size;
      mouthCy /= lipIndexSet.size;

      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const lm = landmarks[i];
        const nx = mirror ? 1 - lm.x : lm.x;
        lmX[i] = (nx - cx) * scale * aspect;
        lmY[i] = -(lm.y - cy) * scale;
        lmZ[i] = -lm.z * scale * aspect * 0.85;

        const px = Math.min(SAMPLE_SIZE - 1, Math.max(0, Math.floor(nx * SAMPLE_SIZE)));
        const py = Math.min(SAMPLE_SIZE - 1, Math.max(0, Math.floor(lm.y * SAMPLE_SIZE)));
        const idx4 = (py * SAMPLE_SIZE + px) * 4;
        let l = (0.299 * data[idx4] + 0.587 * data[idx4 + 1] + 0.114 * data[idx4 + 2]) / 255;
        l = Math.pow(l, 1.1);
        lmLum[i] = 0.12 + l * 1.05;

        // peso de boca: gaussiana em torno do centro dos labios; abaixo do
        // centro (mandibula) desce, acima (labio superior) sobe de leve
        const dx = (nx - mouthCx) * aspect;
        const dy = lm.y - mouthCy;
        const dist = Math.sqrt(dx * dx + dy * dy) / (faceH * 0.42);
        let w = Math.exp(-dist * dist * 3.2);
        if (lipIndexSet.has(i)) w = Math.max(w, 0.85);
        lmMouth[i] = w * (lm.y > mouthCy ? 1 : -0.3);
      }

      // grava landmarks + pontos interpolados nas arestas da tesselacao
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        positions[i * 3] = lmX[i];
        positions[i * 3 + 1] = lmY[i];
        positions[i * 3 + 2] = lmZ[i];
        lums[i] = lmLum[i];
        mouths[i] = lmMouth[i];
      }
      let w = LANDMARK_COUNT;
      for (const edge of edges) {
        const a = edge.start;
        const b = edge.end;
        for (let k = 1; k <= EDGE_SUBDIV; k++) {
          const t = k / (EDGE_SUBDIV + 1);
          positions[w * 3] = lmX[a] + (lmX[b] - lmX[a]) * t;
          positions[w * 3 + 1] = lmY[a] + (lmY[b] - lmY[a]) * t;
          positions[w * 3 + 2] = lmZ[a] + (lmZ[b] - lmZ[a]) * t;
          lums[w] = (lmLum[a] + (lmLum[b] - lmLum[a]) * t) * 0.82;
          mouths[w] = lmMouth[a] + (lmMouth[b] - lmMouth[a]) * t;
          w++;
        }
      }
      posAttr.needsUpdate = true;
      lumAttr.needsUpdate = true;
      mouthAttr.needsUpdate = true;
    };

    let landmarker = null;
    let currentMode = 'IMAGE';
    const ensureMode = async (mode) => {
      if (!landmarker) landmarker = await getLandmarker();
      if (currentMode !== mode) {
        await landmarker.setOptions({ runningMode: mode });
        currentMode = mode;
      }
      return landmarker;
    };

    let videoEl = null;
    let live = false;
    let lastDetect = 0;
    let liveFaceSeen = false;

    controlRef.current.applyImage = async (src) => {
      live = false;
      videoEl = null;
      if (!src) {
        applyProceduralHead();
        setFaceStatus('idle');
        return;
      }
      setFaceStatus('detecting');
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = src;
        });
        const lm = await ensureMode('IMAGE');
        if (destroyed) return;
        const result = lm.detect(img);
        const face = result.faceLandmarks?.[0];
        if (face) {
          updateFromLandmarks(face, img, img.width, img.height, false);
          setFaceStatus('found');
        } else {
          applyProceduralHead();
          setFaceStatus('notFound');
        }
      } catch {
        if (!destroyed) {
          applyProceduralHead();
          setFaceStatus('error');
        }
      }
    };

    controlRef.current.setVideo = async (video) => {
      setFaceStatus('detecting');
      try {
        await ensureMode('VIDEO');
        if (destroyed) return;
        videoEl = video;
        live = true;
        liveFaceSeen = false;
      } catch {
        if (!destroyed) setFaceStatus('error');
      }
    };

    controlRef.current.clear = () => {
      live = false;
      videoEl = null;
      applyProceduralHead();
      setFaceStatus('idle');
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    let t = 0;
    let rafId;
    const animate = () => {
      if (destroyed) return;
      t += 0.016;
      material.uniforms.uTime.value = t;

      const { speaking: isSpeaking, level: audioLevel } = stateRef.current;
      const targetMouth = isSpeaking ? 0.25 + audioLevel * 0.75 : 0;
      const current = material.uniforms.uMouth.value;
      material.uniforms.uMouth.value += (targetMouth - current) * (targetMouth > current ? 0.35 : 0.18);

      // deriva lenta e quase imperceptivel, falando ou nao; quem anima a fala
      // e a boca, nao a cabeca
      const swayTarget = Math.sin(t * 0.22) * 0.045 + (isSpeaking ? Math.sin(t * 0.5) * 0.02 : 0);
      const bobTarget = Math.sin(t * 0.3) * 0.012;
      cloud.rotation.y += (swayTarget - cloud.rotation.y) * 0.04;
      cloud.rotation.x += (bobTarget - cloud.rotation.x) * 0.04;

      if (live && landmarker && videoEl && videoEl.readyState >= 2 && t - lastDetect > LIVE_DETECT_INTERVAL) {
        lastDetect = t;
        try {
          const result = landmarker.detectForVideo(videoEl, performance.now());
          const face = result.faceLandmarks?.[0];
          if (face) {
            updateFromLandmarks(face, videoEl, videoEl.videoWidth, videoEl.videoHeight, true);
            if (!liveFaceSeen) {
              liveFaceSeen = true;
              setFaceStatus('found');
            }
          }
        } catch {
          // frame perdido nao interrompe o loop
        }
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      destroyed = true;
      controlRef.current = {};
      window.removeEventListener('resize', resize);
      if (rafId) cancelAnimationFrame(rafId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    controlRef.current.applyImage?.(imageSrc);
  }, [imageSrc]);

  const setVideoSource = (video) => {
    controlRef.current.setVideo?.(video);
  };

  const clearVideo = () => {
    controlRef.current.clear?.();
  };

  return { containerRef, canvasHostRef, setVideoSource, clearVideo, faceStatus };
}
