"""Synthetic Bayer DNG for decoder tests. No private or third-party photographs."""
import sys
from pathlib import Path
import numpy as np
import tifffile

path = Path(sys.argv[1])
tags = [
    (50706, 'B', 4, (1, 4, 0, 0), False),
    (50707, 'B', 4, (1, 1, 0, 0), False),
    (50708, 's', 0, 'SekerEagle Synthetic CFA', False),
    (33421, 'H', 2, (2, 2), False),
    (33422, 'B', 4, (0, 1, 1, 2), False),
    (50710, 'B', 3, (0, 1, 2), False),
    (50711, 'H', 1, 1, False), (50714, 'I', 1, 0, False),
    (50717, 'I', 1, 4095, False),
    (50721, '2i', 9, (1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1), False),
    (50728, '2I', 3, (1, 1, 1, 1, 1, 1), False), (50778, 'H', 1, 21, False),
]
y, x = np.indices((768, 1024))
pixels = ((x + y) % 3000 + 300).astype('uint16')
tifffile.imwrite(path, pixels, photometric=32803, metadata=None, extratags=tags)
