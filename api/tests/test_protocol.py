import numpy as np
import pytest

from app.protocol import (
    MAX_FRAMES_PER_PACKET,
    ProtocolError,
    decode_packet,
    encode_packet,
)
from tests.helpers import frame


def test_roundtrip_conserve_drapeaux_et_valeurs():
    f = frame(True, 1.5)
    packet = decode_packet(encode_packet(7, [f, frame(False)]))
    assert packet.seq == 7
    assert len(packet.frames) == 2
    assert packet.frames[0].left_hand and packet.frames[0].right_hand and packet.frames[0].face
    assert not packet.frames[1].hands_present
    assert np.allclose(packet.frames[0].data, 1.5, atol=1 / 4096)


def test_taille_dun_paquet_de_10_images():
    # 6 octets d'en-tête + 10 × (1 + 546) : ~5,5 Ko toutes les 330 ms
    assert len(encode_packet(0, [frame(True)] * 10)) == 6 + 10 * 547


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"\x01",
        b"\x02\x01\x00\x00\x00\x00",  # mauvaise version
        b"\x01\x00\x00\x00\x00\x00",  # zéro image
        bytes([1, MAX_FRAMES_PER_PACKET + 1, 0, 0, 0, 0]),  # trop d'images
    ],
)
def test_paquets_invalides(payload):
    with pytest.raises(ProtocolError):
        decode_packet(payload)


def test_taille_incoherente():
    good = encode_packet(0, [frame(True)])
    with pytest.raises(ProtocolError):
        decode_packet(good[:-1])
    with pytest.raises(ProtocolError):
        decode_packet(good + b"\x00")
