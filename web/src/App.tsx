import { useCallback, useState } from 'react'
import './App.css'
import { CameraStage } from './components/CameraStage'
import { GesturePanel } from './components/GesturePanel'
import { LabApp } from './components/lab/LabApp'
import { ContributePanel } from './components/ContributePanel'
import { Icon, Mark, type IconName } from './components/Icon'
import { PerfPanel } from './components/PerfPanel'
import { TranslatePanel, type Sentence } from './components/TranslatePanel'
import { useCapture } from './hooks/useCapture'
import type { Recording } from './lib/recording'

type Tab = 'translate' | 'gestures' | 'contribute' | 'lab'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'translate', label: 'Traduire', icon: 'translate' },
  { id: 'gestures', label: 'Gestes', icon: 'hand' },
  { id: 'contribute', label: 'Contribuer', icon: 'record' },
  { id: 'lab', label: 'Laboratoire', icon: 'flask' },
]

// ?debug dans l'adresse affiche les images par seconde.
const DEBUG = new URLSearchParams(location.search).has('debug')

export default function App() {
  const [tab, setTab] = useState<Tab>('translate')
  // L'onglet Gestes fait tourner le reconnaisseur de gestes de Google ; les autres, le suivi des signes.
  const capture = useCapture(tab === 'lab' ? 'off' : tab === 'gestures' ? 'gestures' : 'signs')
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])

  const addSentence = useCallback((s: Sentence) => setSentences((all) => [s, ...all].slice(0, 20)), [])
  const addRecording = useCallback((r: Recording) => setRecordings((all) => [r, ...all]), [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <Mark /> Sikia
        </span>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="panel"
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'lab' && (
        <main className="lab-main">
          <LabApp />
        </main>
      )}

      {/* Masquée (et non démontée) dans le laboratoire : la caméra et ses modèles restent chargés. */}
      <main className="layout" hidden={tab === 'lab'}>
        <CameraStage
          videoRef={capture.videoRef}
          overlayRef={capture.overlayRef}
          status={capture.status}
          error={capture.error}
          hint={capture.hint}
          fps={capture.fps}
          aspect={capture.aspect}
          debug={DEBUG}
          showGuide={tab !== 'gestures'}
          onStart={capture.start}
        />

        <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {capture.status !== 'ready' ? (
            <Steps />
          ) : tab === 'gestures' ? (
            <GesturePanel subscribeGestures={capture.subscribeGestures} status={capture.gestureStatus} />
          ) : tab === 'translate' ? (
            <TranslatePanel subscribe={capture.subscribe} sentences={sentences} onSentence={addSentence} />
          ) : (
            <ContributePanel subscribe={capture.subscribe} recordings={recordings} onRecorded={addRecording} />
          )}
          {DEBUG && capture.status === 'ready' && <PerfPanel perf={capture.perf} />}
        </div>
      </main>
    </div>
  )
}

/** Avant que la caméra tourne : trois gestes, dans l'ordre. */
function Steps() {
  return (
    <ol className="steps card">
      <li>
        <p>
          <strong>Posez le téléphone</strong> sur un support ou une table, écran vers vous.
        </p>
      </li>
      <li>
        <p>
          <strong>Cadrez-vous</strong> : la tête, les épaules et les deux mains doivent être visibles.
        </p>
      </li>
      <li>
        <p>
          <strong>Signez</strong>, puis baissez les mains un instant à la fin de chaque phrase.
        </p>
      </li>
    </ol>
  )
}
