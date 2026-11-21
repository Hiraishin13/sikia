import numpy as np

from app.protocol import VALUES_PER_FRAME, Frame


def frame(hands: bool, value: float = 0.1) -> Frame:
    data = np.full(VALUES_PER_FRAME, value if hands else 0.0, dtype=np.float32)
    return Frame(valid=True, left_hand=hands, right_hand=hands, face=True, data=data)


def sign(n: int = 12, value: float = 0.1) -> list[Frame]:
    return [frame(True, value) for _ in range(n)]


def pause(n: int) -> list[Frame]:
    return [frame(False) for _ in range(n)]
