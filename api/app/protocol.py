"""Format des paquets de points clés reçus sur /v1/stream.

Miroir de docs/keypoints-format.md et de web/src/lib/landmarks.ts.

Paquet binaire (petit-boutiste) :
    u8   version (1)
    u8   nombre d'images N
    u32  numéro de séquence du paquet
    N × (u8 drapeaux, 273 × i16 coordonnées quantifiées)

Drapeaux : bit0 image valide, bit1 main gauche, bit2 main droite, bit3 visage.
Coordonnées : valeur × 4096, voir QUANT_SCALE.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

PROTOCOL_VERSION = 1
VALUES_PER_FRAME = 273
QUANT_SCALE = 4096
MAX_FRAMES_PER_PACKET = 60  # 2 s à 30 i/s : au-delà, le client se comporte mal

_HEADER = struct.Struct("<BBI")
_FRAME_BYTES = 1 + VALUES_PER_FRAME * 2

FLAG_VALID = 1
FLAG_LEFT = 2
FLAG_RIGHT = 4
FLAG_FACE = 8


class ProtocolError(ValueError):
    """Paquet mal formé."""


@dataclass(frozen=True)
class Frame:
    valid: bool
    left_hand: bool
    right_hand: bool
    face: bool
    data: np.ndarray  # float32, VALUES_PER_FRAME valeurs normalisées

    @property
    def hands_present(self) -> bool:
        return self.valid and (self.left_hand or self.right_hand)


@dataclass(frozen=True)
class Packet:
    seq: int
    frames: list[Frame]


def decode_packet(payload: bytes) -> Packet:
    if len(payload) < _HEADER.size:
        raise ProtocolError("paquet trop court")
    version, n, seq = _HEADER.unpack_from(payload)
    if version != PROTOCOL_VERSION:
        raise ProtocolError(f"version de protocole non supportée : {version}")
    if n == 0 or n > MAX_FRAMES_PER_PACKET:
        raise ProtocolError(f"nombre d'images invalide : {n}")
    if len(payload) != _HEADER.size + n * _FRAME_BYTES:
        raise ProtocolError("taille du paquet incohérente avec le nombre d'images")

    frames: list[Frame] = []
    offset = _HEADER.size
    for _ in range(n):
        flags = payload[offset]
        q = np.frombuffer(payload, dtype="<i2", count=VALUES_PER_FRAME, offset=offset + 1)
        frames.append(
            Frame(
                valid=bool(flags & FLAG_VALID),
                left_hand=bool(flags & FLAG_LEFT),
                right_hand=bool(flags & FLAG_RIGHT),
                face=bool(flags & FLAG_FACE),
                data=q.astype(np.float32) / QUANT_SCALE,
            )
        )
        offset += _FRAME_BYTES
    return Packet(seq=seq, frames=frames)


def encode_packet(seq: int, frames: list[Frame]) -> bytes:
    """Inverse de decode_packet (utilisé par les tests et les outils de rejeu)."""
    parts = [_HEADER.pack(PROTOCOL_VERSION, len(frames), seq)]
    for f in frames:
        flags = (
            (FLAG_VALID if f.valid else 0)
            | (FLAG_LEFT if f.left_hand else 0)
            | (FLAG_RIGHT if f.right_hand else 0)
            | (FLAG_FACE if f.face else 0)
        )
        q = np.clip(np.rint(f.data * QUANT_SCALE), -32768, 32767).astype("<i2")
        parts.append(bytes([flags]) + q.tobytes())
    return b"".join(parts)
