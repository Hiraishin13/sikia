"""Classifieur de signes isolés : Conv1D + Transformer sur séquences de points clés."""

from __future__ import annotations

import torch
from torch import nn

from .layout import LEFT_HAND, RIGHT_HAND, VALUES_PER_FRAME


class SignTransformer(nn.Module):
    """x (B, T, 273) et mask (B, T) (1 = vraie image) → logits (B, n_classes).

    En entrée du réseau : les points, leur vitesse image à image, et deux indicateurs « main présente »
    déduits des données (une main absente est remplie de zéros).
    """

    def __init__(
        self,
        n_classes: int,
        seq_len: int = 64,
        d_model: int = 256,
        heads: int = 4,
        layers: int = 4,
        ff: int = 512,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        in_dim = VALUES_PER_FRAME * 2 + 2
        self.proj = nn.Linear(in_dim, d_model)
        self.conv = nn.Conv1d(d_model, d_model, kernel_size=5, padding=2)
        self.pos = nn.Parameter(torch.zeros(1, seq_len, d_model))
        nn.init.trunc_normal_(self.pos, std=0.02)
        block = nn.TransformerEncoderLayer(
            d_model, heads, ff, dropout, activation="gelu", batch_first=True, norm_first=True
        )
        self.encoder = nn.TransformerEncoder(block, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, n_classes)

    def forward(self, x: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        m = mask.unsqueeze(-1)
        x = x * m
        step = (x[:, 1:] - x[:, :-1]) * (m[:, 1:] * m[:, :-1])
        delta = torch.cat([torch.zeros_like(x[:, :1]), step], dim=1)
        left = (x[..., LEFT_HAND].abs().sum(-1, keepdim=True) > 0).to(x.dtype)
        right = (x[..., RIGHT_HAND].abs().sum(-1, keepdim=True) > 0).to(x.dtype)

        h = self.proj(torch.cat([x, delta, left, right], dim=-1))
        h = h + torch.nn.functional.gelu(self.conv(h.transpose(1, 2))).transpose(1, 2)
        h = h + self.pos[:, : h.shape[1]]
        h = self.encoder(h, src_key_padding_mask=(mask == 0))
        pooled = (h * m).sum(1) / m.sum(1).clamp(min=1.0)
        return self.head(self.norm(pooled))


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
