// Prépare public/mediapipe/ : copie les fichiers WASM depuis node_modules et
// télécharge les modèles .task. Idempotent : ne refait rien si tout est déjà là.
// Les fichiers sont servis par l'app elle-même (pas de CDN tiers à l'exécution)
// et ignorés par git (voir web/.gitignore).
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'mediapipe')

const MODELS = {
  'hand_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
}

const exists = (p) => stat(p).then(() => true, () => false)

await mkdir(join(out, 'models'), { recursive: true })

const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
if (!(await exists(wasmSrc))) {
  console.error('node_modules/@mediapipe/tasks-vision/wasm introuvable : lancez npm install.')
  process.exit(1)
}
await cp(wasmSrc, join(out, 'wasm'), { recursive: true })

for (const [name, url] of Object.entries(MODELS)) {
  const dest = join(out, 'models', name)
  if (await exists(dest)) continue
  console.log(`Téléchargement de ${name}…`)
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`Échec ${res.status} pour ${url}`)
    process.exit(1)
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}
console.log('MediaPipe prêt dans public/mediapipe/')
