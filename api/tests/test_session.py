from app.pipeline import StubRecognizer
from app.session import Segmenter
from tests.helpers import pause, sign


def make() -> Segmenter:
    return Segmenter(StubRecognizer())


def test_un_signe_apres_une_courte_pause():
    seg = make()
    assert not seg.push(sign(12)).sign_added  # pas encore de pause
    events = seg.push(pause(6))
    assert events.sign_added
    assert events.sentence is None
    assert len(seg.current_glosses) == 1


def test_phrase_apres_une_longue_pause():
    seg = make()
    seg.push(sign(12, 0.1) + pause(10) + sign(12, 0.2))
    events = seg.push(pause(30))
    assert events.sentence is not None
    assert len(events.sentence) == 2
    assert seg.current_glosses == []  # la phrase est repartie de zéro


def test_les_parasites_trop_courts_sont_ignores():
    seg = make()
    events = seg.push(sign(3) + pause(30))
    assert not events.sign_added
    assert events.sentence is None


def test_le_decoupage_ne_depend_pas_de_la_taille_des_paquets():
    frames = sign(12) + pause(10) + sign(15, 0.3) + pause(30)
    whole = make().push(frames).sentence
    seg = make()
    chunks = None
    for i in range(0, len(frames), 10):
        ev = seg.push(frames[i : i + 10])
        chunks = ev.sentence or chunks
    assert whole is not None and chunks is not None
    assert [c[0].gloss for c in whole] == [c[0].gloss for c in chunks]


def test_reset():
    seg = make()
    seg.push(sign(12) + pause(6))
    seg.reset()
    assert seg.current_glosses == []
