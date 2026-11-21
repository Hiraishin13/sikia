import { useCallback, useState } from 'react'
import './App.css'
import { CameraStage } from './components/CameraStage'
import { ContributePanel } from './components/ContributePanel'
import { Icon, Mark, type IconName } from './components/Icon'
import { TranslatePanel, type Sentence } from './components/TranslatePanel'
import { useCapture } from './hooks/useCapture'
import type { Recording } from './lib/recording'

type Tab = 'translate' | 'contribute'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'translate', label: 'Traduire', icon: 'translate' },
  { id: 'contribute', label: 'Contribuer', icon: 'record' },
]

// ?debug dans l'adresse affiche les images par seconde.
const DEBUG = new URLSearchParams(location.search).has('debug')

export default function App() {
  const capture = useCapture()
  const [tab, setTab] = useState<Tab>('translate')
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])

  const addSentence = useCallback((s: Sentence) => setSentences((all) => [s, ...all].slice(0, 20)), [])
  const addRecording = useCallback((r: Recording) => setRecordings((all) => [r, ...all]), [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <Mark /> sikia
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

      <main className="layout">
        <CameraStage
          videoRef={capture.videoRef}
          overlayRef={capture.overlayRef}
          status={capture.status}
          error={capture.error}
          hint={capture.hint}
          fps={capture.fps}
          aspect={capture.aspect}
          debug={DEBUG}
          onStart={capture.start}
        />

        <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {capture.status !== 'ready' ? (
            <Steps />
          ) : tab === 'translate' ? (
            <TranslatePanel subscribe={capture.subscribe} sentences={sentences} onSentence={addSentence} />
          ) : (
            <ContributePanel subscribe={capture.subscribe} recordings={recordings} onRecorded={addRecording} />
          )}
        </div>
      </main>
    </div>
  )
}

/** Avant que la caméra tourne : trois gestes, dans l'ordre. */
function Steps() {
  return (
    <ol className="steps">
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
