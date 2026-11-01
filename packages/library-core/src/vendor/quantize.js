/*! @license
The MIT License (MIT)

Copyright (c) 2014 Olivier Lesnicki

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/**
 * Copyright (c) 2014 Olivier Lesnicki. MIT License.
 * Full notice: third-party/color-search/quantize-LICENSE.txt
 * MMCQ raw-buffer variant distributed with Eagle 4.0 Build 23.
 * Local changes: ES module export, public input type annotation, unused arguments, local variable declarations and formatting.
 */
/*
 * quantize.js - Optimized MMCQ (Modified Median Cut Quantization)
 * Based on quantize.js by Nick Rabinowitz, ported to node.js by Olivier Lesnicki
 * Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 *
 * Optimizations over legacy version:
 * - Int32Array(32768) histogram instead of sparse Array (zero-init, no || 0 fallback)
 * - Merged getHisto + vboxFromPixels into single pass over raw RGBA buffer
 * - Raw buffer input eliminates intermediate [R,G,B] array allocations
 * - All forEach replaced with for loops
 * - Inlined pv utilities (naturalOrder, max)
 */

/** @typedef {{cmap:{palette:()=>Array<{color:number[],count:number}>},pixelCount:number}} QuantizedPalette */
/** @type {{ quantize: (rawBuffer: Uint8Array | Uint8ClampedArray, length: number, skip: number, alphaThreshold: number, maxcolors: number) => QuantizedPalette | false }} */
var MMCQ = (function () {
  // private constants
  var sigbits = 5,
    rshift = 8 - sigbits,
    maxIterations = 5,
    fractByPopulations = 0.75;

  function naturalOrder(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // Simple priority queue

  function PQueue(comparator) {
    var contents = [],
      sorted = false;

    function sort() {
      contents.sort(comparator);
      sorted = true;
    }

    return {
      push: function (o) {
        contents.push(o);
        sorted = false;
      },
      peek: function (index) {
        if (!sorted) sort();
        if (index === undefined) index = contents.length - 1;
        return contents[index];
      },
      pop: function () {
        if (!sorted) sort();
        return contents.pop();
      },
      size: function () {
        return contents.length;
      },
      map: function (f) {
        return contents.map(f);
      },
      debug: function () {
        if (!sorted) sort();
        return contents;
      },
    };
  }

  // 3d color space box

  function VBox(r1, r2, g1, g2, b1, b2, histo) {
    var vbox = this;
    vbox.r1 = r1;
    vbox.r2 = r2;
    vbox.g1 = g1;
    vbox.g2 = g2;
    vbox.b1 = b1;
    vbox.b2 = b2;
    vbox.histo = histo;
  }
  VBox.prototype = {
    volume: function () {
      var vbox = this;
      if (!vbox._volume) {
        vbox._volume = (vbox.r2 - vbox.r1 + 1) * (vbox.g2 - vbox.g1 + 1) * (vbox.b2 - vbox.b1 + 1);
      }
      return vbox._volume;
    },
    count: function () {
      var vbox = this,
        histo = vbox.histo;
      if (!vbox._count_set) {
        var npix = 0,
          i,
          j,
          k,
          index;
        for (i = vbox.r1; i <= vbox.r2; i++) {
          for (j = vbox.g1; j <= vbox.g2; j++) {
            for (k = vbox.b1; k <= vbox.b2; k++) {
              index = (i << 10) + (j << 5) + k;
              npix += histo[index];
            }
          }
        }
        vbox._count = npix;
        vbox._count_set = true;
      }
      return vbox._count;
    },
    copy: function () {
      var vbox = this;
      return new VBox(vbox.r1, vbox.r2, vbox.g1, vbox.g2, vbox.b1, vbox.b2, vbox.histo);
    },
    avg: function () {
      var vbox = this,
        histo = vbox.histo;
      if (!vbox._avg) {
        var ntot = 0,
          mult = 1 << (8 - sigbits),
          rsum = 0,
          gsum = 0,
          bsum = 0,
          hval,
          i,
          j,
          k,
          histoindex;
        for (i = vbox.r1; i <= vbox.r2; i++) {
          for (j = vbox.g1; j <= vbox.g2; j++) {
            for (k = vbox.b1; k <= vbox.b2; k++) {
              histoindex = (i << 10) + (j << 5) + k;
              hval = histo[histoindex];
              ntot += hval;
              rsum += hval * (i + 0.5) * mult;
              gsum += hval * (j + 0.5) * mult;
              bsum += hval * (k + 0.5) * mult;
            }
          }
        }
        if (ntot) {
          vbox._avg = [~~(rsum / ntot), ~~(gsum / ntot), ~~(bsum / ntot)];
        } else {
          vbox._avg = [
            ~~((mult * (vbox.r1 + vbox.r2 + 1)) / 2),
            ~~((mult * (vbox.g1 + vbox.g2 + 1)) / 2),
            ~~((mult * (vbox.b1 + vbox.b2 + 1)) / 2),
          ];
        }
      }
      return vbox._avg;
    },
    contains: function (pixel) {
      var vbox = this,
        rval = pixel[0] >> rshift;
      var gval = pixel[1] >> rshift;
      var bval = pixel[2] >> rshift;
      return (
        rval >= vbox.r1 &&
        rval <= vbox.r2 &&
        gval >= vbox.g1 &&
        gval <= vbox.g2 &&
        bval >= vbox.b1 &&
        bval <= vbox.b2
      );
    },
  };

  // Color map

  function CMap() {
    this.vboxes = new PQueue(function (a, b) {
      return naturalOrder(a.vbox.count() * a.vbox.volume(), b.vbox.count() * b.vbox.volume());
    });
  }
  CMap.prototype = {
    push: function (vbox) {
      this.vboxes.push({
        vbox: vbox,
        color: vbox.avg(),
      });
    },
    palette: function () {
      return this.vboxes.map(function (vb) {
        return {
          color: vb.color,
          count: vb.vbox.count(),
        };
      });
    },
    size: function () {
      return this.vboxes.size();
    },
    map: function (color) {
      var vboxes = this.vboxes;
      for (var i = 0; i < vboxes.size(); i++) {
        return vboxes.peek(i).color;
      }
      return this.nearest(color);
    },
    nearest: function (color) {
      var vboxes = this.vboxes,
        d1,
        d2,
        pColor;
      for (var i = 0; i < vboxes.size(); i++) {
        d2 = Math.sqrt(
          Math.pow(color[0] - vboxes.peek(i).color[0], 2) +
            Math.pow(color[1] - vboxes.peek(i).color[1], 2) +
            Math.pow(color[2] - vboxes.peek(i).color[2], 2),
        );
        if (d2 < d1 || d1 === undefined) {
          d1 = d2;
          pColor = vboxes.peek(i).color;
        }
      }
      return pColor;
    },
    forcebw: function () {
      var vboxes = this.vboxes;
      vboxes.sort(function (a, b) {
        return naturalOrder(
          a.color[0] + a.color[1] + a.color[2],
          b.color[0] + b.color[1] + b.color[2],
        );
      });
      var lowest = vboxes[0].color;
      if (lowest[0] < 5 && lowest[1] < 5 && lowest[2] < 5) vboxes[0].color = [0, 0, 0];
      var idx = vboxes.length - 1,
        highest = vboxes[idx].color;
      if (highest[0] > 251 && highest[1] > 251 && highest[2] > 251)
        vboxes[idx].color = [255, 255, 255];
    },
  };

  function medianCutApply(histo, vbox) {
    if (!vbox.count()) return;

    var rw = vbox.r2 - vbox.r1 + 1,
      gw = vbox.g2 - vbox.g1 + 1,
      bw = vbox.b2 - vbox.b1 + 1,
      maxw = Math.max(rw, gw, bw);
    // only one pixel, no split
    if (vbox.count() == 1) {
      return [vbox.copy()];
    }
    /* Find the partial sum arrays along the selected axis. */
    var total = 0,
      partialsum = [],
      lookaheadsum = [],
      i,
      j,
      k,
      sum,
      index;
    var d1Start, d1End;
    if (maxw == rw) {
      d1Start = vbox.r1;
      d1End = vbox.r2;
      for (i = vbox.r1; i <= vbox.r2; i++) {
        sum = 0;
        for (j = vbox.g1; j <= vbox.g2; j++) {
          for (k = vbox.b1; k <= vbox.b2; k++) {
            index = (i << 10) + (j << 5) + k;
            sum += histo[index];
          }
        }
        total += sum;
        partialsum[i] = total;
      }
    } else if (maxw == gw) {
      d1Start = vbox.g1;
      d1End = vbox.g2;
      for (i = vbox.g1; i <= vbox.g2; i++) {
        sum = 0;
        for (j = vbox.r1; j <= vbox.r2; j++) {
          for (k = vbox.b1; k <= vbox.b2; k++) {
            index = (j << 10) + (i << 5) + k;
            sum += histo[index];
          }
        }
        total += sum;
        partialsum[i] = total;
      }
    } else {
      /* maxw == bw */
      d1Start = vbox.b1;
      d1End = vbox.b2;
      for (i = vbox.b1; i <= vbox.b2; i++) {
        sum = 0;
        for (j = vbox.r1; j <= vbox.r2; j++) {
          for (k = vbox.g1; k <= vbox.g2; k++) {
            index = (j << 10) + (k << 5) + i;
            sum += histo[index];
          }
        }
        total += sum;
        partialsum[i] = total;
      }
    }
    for (i = d1Start; i <= d1End; i++) {
      lookaheadsum[i] = total - partialsum[i];
    }

    function doCut(color) {
      var dim1 = color + '1',
        dim2 = color + '2',
        left,
        right,
        vbox1,
        vbox2,
        d2,
        count2;
      for (i = vbox[dim1]; i <= vbox[dim2]; i++) {
        if (partialsum[i] > total / 2) {
          vbox1 = vbox.copy();
          vbox2 = vbox.copy();
          left = i - vbox[dim1];
          right = vbox[dim2] - i;
          if (left <= right) d2 = Math.min(vbox[dim2] - 1, ~~(i + right / 2));
          else d2 = Math.max(vbox[dim1], ~~(i - 1 - left / 2));
          // avoid 0-count boxes
          while (!partialsum[d2]) d2++;
          count2 = lookaheadsum[d2];
          while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];
          // set dimensions
          vbox1[dim2] = d2;
          vbox2[dim1] = vbox1[dim2] + 1;
          return [vbox1, vbox2];
        }
      }
    }
    // determine the cut planes
    return maxw == rw ? doCut('r') : maxw == gw ? doCut('g') : doCut('b');
  }

  /**
   * Optimized quantize - accepts raw RGBA buffer directly.
   * Builds histogram and finds color bounds in a single pass,
   * eliminating the need for intermediate [R,G,B] array allocations.
   *
   * @param {Uint8Array | Uint8ClampedArray} rawBuffer - Raw RGBA pixel data
   * @param {number} length - Buffer length to process
   * @param {number} skip - Pixel skip factor (process every Nth pixel)
   * @param {number} alphaThreshold - Minimum alpha value to include pixel
   * @param {number} maxcolors - Maximum number of colors to extract
   * @returns {{ cmap: CMap, pixelCount: number } | false}
   */
  function quantize(rawBuffer, length, skip, alphaThreshold, maxcolors) {
    // short-circuit
    if (!rawBuffer || !rawBuffer.length || maxcolors < 2 || maxcolors > 256) {
      return false;
    }

    // Single-pass: build histogram + find color bounds
    var histo = new Int32Array(1 << (3 * sigbits));
    var rmin = 31,
      rmax = 0,
      gmin = 31,
      gmax = 0,
      bmin = 31,
      bmax = 0;
    var pixelCount = 0;
    var rval, gval, bval, index;
    var step = 4 * skip;

    for (var p = 0; p < length; p += step) {
      if (rawBuffer[p + 3] < alphaThreshold) continue;
      rval = rawBuffer[p] >> rshift;
      gval = rawBuffer[p + 1] >> rshift;
      bval = rawBuffer[p + 2] >> rshift;
      index = (rval << 10) + (gval << 5) + bval;
      histo[index]++;
      pixelCount++;

      if (rval < rmin) rmin = rval;
      else if (rval > rmax) rmax = rval;
      if (gval < gmin) gmin = gval;
      else if (gval > gmax) gmax = gval;
      if (bval < bmin) bmin = bval;
      else if (bval > bmax) bmax = bval;
    }

    if (pixelCount === 0) return false;

    // get the beginning vbox from the colors
    var vbox = new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo),
      pq = new PQueue(function (a, b) {
        return naturalOrder(a.count(), b.count());
      });
    pq.push(vbox);

    // inner function to do the iteration

    function iter(lh, target) {
      var ncolors = 1,
        niters = 0,
        vbox;
      while (niters < maxIterations) {
        vbox = lh.pop();
        if (!vbox.count()) {
          /* just put it back */
          lh.push(vbox);
          niters++;
          continue;
        }
        // do the cut
        var vboxes = medianCutApply(histo, vbox),
          vbox1 = vboxes[0],
          vbox2 = vboxes[1];

        if (!vbox1) {
          return;
        }
        lh.push(vbox1);
        if (vbox2) {
          /* vbox2 can be null */
          lh.push(vbox2);
          ncolors++;
        }
        if (ncolors >= target) return;
        if (niters++ > maxIterations) {
          return;
        }
      }
    }
    // first set of colors, sorted by population
    iter(pq, fractByPopulations * maxcolors);

    // Re-sort by the product of pixel occupancy times the size in color space.
    var pq2 = new PQueue(function (a, b) {
      return naturalOrder(a.count() * a.volume(), b.count() * b.volume());
    });
    while (pq.size()) {
      pq2.push(pq.pop());
    }

    // next set - generate the median cuts using the (npix * vol) sorting.
    iter(pq2, maxcolors - pq2.size());

    // calculate the actual colors
    var cmap = new CMap();
    while (pq2.size()) {
      cmap.push(pq2.pop());
    }

    return { cmap: cmap, pixelCount: pixelCount };
  }

  return {
    quantize: quantize,
  };
})();

export const quantize = MMCQ.quantize;
