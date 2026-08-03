var BinPacking3D = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // node_modules/binpackingjs/dist/esm/3d/index.js
  var index_exports = {};
  __export(index_exports, {
    ALL_ROTATIONS: () => ALL_ROTATIONS,
    Axis: () => Axis,
    Packer3D: () => Packer3D,
    RotationType: () => RotationType,
    START_POSITION: () => START_POSITION,
    computeFactor: () => computeFactor,
    factoredInteger: () => factoredInteger,
    getDimension: () => getDimension,
    itemsIntersect: () => itemsIntersect,
    pack3D: () => pack3D,
    rectIntersect: () => rectIntersect,
    scoreRotation: () => scoreRotation,
    toOriginal: () => toOriginal
  });

  // node_modules/binpackingjs/dist/esm/index-fs4vjjqp.js
  function getDecimalPlaces(value) {
    if (!Number.isFinite(value))
      return 0;
    const str = String(value);
    const dotIndex = str.indexOf(".");
    if (dotIndex === -1)
      return 0;
    const expIndex = str.indexOf("e-");
    if (expIndex !== -1) {
      const mantissaDecimals = str.substring(dotIndex + 1, expIndex).length;
      const exp = parseInt(str.substring(expIndex + 2), 10);
      return mantissaDecimals + exp;
    }
    return str.length - dotIndex - 1;
  }
  var MAX_DECIMAL_PLACES = 10;
  var DEFAULT_FACTOR = 1e5;
  function computeFactor(values) {
    let maxDecimals = 0;
    for (const v of values) {
      const d = getDecimalPlaces(v);
      if (d > maxDecimals)
        maxDecimals = d;
    }
    if (maxDecimals === 0)
      return 1;
    if (maxDecimals > MAX_DECIMAL_PLACES)
      maxDecimals = MAX_DECIMAL_PLACES;
    return Math.pow(10, maxDecimals);
  }
  function factoredInteger(value, factor = DEFAULT_FACTOR) {
    return Math.round(value * factor);
  }
  function toOriginal(value, factor = DEFAULT_FACTOR) {
    if (factor === 1)
      return value;
    const decimalPlaces = Math.round(Math.log10(factor));
    return Number((value / factor).toFixed(decimalPlaces));
  }

  // node_modules/binpackingjs/dist/esm/index-90rdwr87.js
  var RotationType;
  ((RotationType2) => {
    RotationType2[RotationType2["WHD"] = 0] = "WHD";
    RotationType2[RotationType2["HWD"] = 1] = "HWD";
    RotationType2[RotationType2["HDW"] = 2] = "HDW";
    RotationType2[RotationType2["DHW"] = 3] = "DHW";
    RotationType2[RotationType2["DWH"] = 4] = "DWH";
    RotationType2[RotationType2["WDH"] = 5] = "WDH";
  })(RotationType ||= {});
  var ALL_ROTATIONS = [
    0,
    1,
    2,
    3,
    4,
    5
    /* WDH */
  ];
  var Axis;
  ((Axis2) => {
    Axis2[Axis2["Width"] = 0] = "Width";
    Axis2[Axis2["Height"] = 1] = "Height";
    Axis2[Axis2["Depth"] = 2] = "Depth";
  })(Axis ||= {});
  var START_POSITION = [0, 0, 0];
  function getDimension(width, height, depth, rotation) {
    switch (rotation) {
      case 0:
        return [width, height, depth];
      case 1:
        return [height, width, depth];
      case 2:
        return [height, depth, width];
      case 3:
        return [depth, height, width];
      case 4:
        return [depth, width, height];
      case 5:
        return [width, depth, height];
    }
  }
  function rectIntersect(i1Pos, i1Dim, i2Pos, i2Dim, x, y) {
    const cx1 = i1Pos[x] + i1Dim[x] / 2;
    const cy1 = i1Pos[y] + i1Dim[y] / 2;
    const cx2 = i2Pos[x] + i2Dim[x] / 2;
    const cy2 = i2Pos[y] + i2Dim[y] / 2;
    const ix = Math.max(cx1, cx2) - Math.min(cx1, cx2);
    const iy = Math.max(cy1, cy2) - Math.min(cy1, cy2);
    return ix < (i1Dim[x] + i2Dim[x]) / 2 && iy < (i1Dim[y] + i2Dim[y]) / 2;
  }
  function itemsIntersect(pos1, dim1, pos2, dim2) {
    return rectIntersect(
      pos1,
      dim1,
      pos2,
      dim2,
      0,
      1
      /* Height */
    ) && rectIntersect(
      pos1,
      dim1,
      pos2,
      dim2,
      1,
      2
      /* Depth */
    ) && rectIntersect(
      pos1,
      dim1,
      pos2,
      dim2,
      0,
      2
      /* Depth */
    );
  }
  function normalizeItem(item, factor) {
    return {
      width: factoredInteger(item.width, factor),
      height: factoredInteger(item.height, factor),
      depth: factoredInteger(item.depth, factor),
      weight: factoredInteger(item.weight, factor)
    };
  }
  function getVolume(width, height, depth) {
    return width * height * depth;
  }
  var enabled = false;
  function createLogger(prefix) {
    return (...args) => {
      if (enabled) {
        console.debug(prefix, ...args);
      }
    };
  }
  var log = createLogger("3D:");
  function normalizeBin(bin, factor) {
    return {
      name: bin.name,
      width: factoredInteger(bin.width, factor),
      height: factoredInteger(bin.height, factor),
      depth: factoredInteger(bin.depth, factor),
      maxWeight: factoredInteger(bin.maxWeight, factor)
    };
  }
  function binVolume(bin) {
    return bin.width * bin.height * bin.depth;
  }
  function scoreRotation(bin, itemWidth, itemHeight, itemDepth, rotation) {
    const d = getDimension(itemWidth, itemHeight, itemDepth, rotation);
    if (bin.width < d[0] || bin.height < d[1] || bin.depth < d[2]) {
      return 0;
    }
    const widthEfficiency = Math.floor(bin.width / d[0]) * d[0] / bin.width;
    const heightEfficiency = Math.floor(bin.height / d[1]) * d[1] / bin.height;
    const depthEfficiency = Math.floor(bin.depth / d[2]) * d[2] / bin.depth;
    return widthEfficiency * heightEfficiency * depthEfficiency;
  }
  function getBestRotationOrder(bin, itemWidth, itemHeight, itemDepth, allowedRotations) {
    const scores = allowedRotations.map((r) => ({
      rotation: r,
      score: scoreRotation(bin, itemWidth, itemHeight, itemDepth, r)
    }));
    return scores.sort((a, b) => b.score - a.score).map((s) => s.rotation);
  }
  var MutableBin3D = class {
    name;
    width;
    height;
    depth;
    maxWeight;
    items = [];
    constructor(bin) {
      this.name = bin.name;
      this.width = bin.width;
      this.height = bin.height;
      this.depth = bin.depth;
      this.maxWeight = bin.maxWeight;
    }
    getVolume() {
      return this.width * this.height * this.depth;
    }
    getPackedWeight() {
      return this.items.reduce((w, item) => w + item.weight, 0);
    }
    weighItem(weight) {
      if (this.maxWeight === 0)
        return false;
      return this.maxWeight === Infinity || weight + this.getPackedWeight() <= this.maxWeight;
    }
    putItem(sourceItem, itemWidth, itemHeight, itemDepth, itemWeight, position, allowedRotations) {
      const rotations = getBestRotationOrder(this, itemWidth, itemHeight, itemDepth, allowedRotations);
      for (const rotation of rotations) {
        const d = getDimension(itemWidth, itemHeight, itemDepth, rotation);
        if (this.width < position[0] + d[0] || this.height < position[1] + d[1] || this.depth < position[2] + d[2]) {
          continue;
        }
        let fits = true;
        for (const existing of this.items) {
          if (itemsIntersect(position, d, existing.position, existing.dimension)) {
            fits = false;
            break;
          }
        }
        if (fits) {
          const packed = {
            name: sourceItem.name,
            width: itemWidth,
            height: itemHeight,
            depth: itemDepth,
            weight: itemWeight,
            position: [position[0], position[1], position[2]],
            rotationType: rotation,
            dimension: [d[0], d[1], d[2]],
            sourceItem
          };
          this.items.push(packed);
          log("putItem success", packed.name, "at", packed.position, "dim", packed.dimension);
          return packed;
        }
      }
      return null;
    }
  };
  function normalize(item, factor) {
    const n = normalizeItem(item, factor);
    return {
      source: item,
      width: n.width,
      height: n.height,
      depth: n.depth,
      weight: n.weight,
      allowedRotations: item.allowedRotations ?? ALL_ROTATIONS
    };
  }
  function findFittedBin(bins, item) {
    for (const b of bins) {
      if (!b.weighItem(item.weight))
        continue;
      const startPos = [0, 0, 0];
      const result = b.putItem(item.source, item.width, item.height, item.depth, item.weight, startPos, item.allowedRotations);
      if (result) {
        b.items.pop();
        return b;
      }
    }
    return null;
  }
  function getBiggerBinThan(bins, b, visited) {
    const v = b.getVolume();
    for (const b2 of bins) {
      if (b2.getVolume() > v && !visited.has(b2)) {
        return b2;
      }
    }
    return null;
  }
  function packToBin(bins, b, items, visited = /* @__PURE__ */ new Set()) {
    const firstItem = items[0];
    if (!firstItem)
      return [];
    visited.add(b);
    if (!b.weighItem(firstItem.weight)) {
      const b2 = getBiggerBinThan(bins, b, visited);
      if (b2)
        return packToBin(bins, b2, items, visited);
      return items;
    }
    const startPos = [0, 0, 0];
    const fit = b.putItem(firstItem.source, firstItem.width, firstItem.height, firstItem.depth, firstItem.weight, startPos, firstItem.allowedRotations);
    if (!fit) {
      const b2 = getBiggerBinThan(bins, b, visited);
      if (b2)
        return packToBin(bins, b2, items, visited);
      return items;
    }
    const unpacked = [];
    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      let fitted = false;
      if (b.weighItem(item.weight)) {
        lookup:
          for (let pt = 0; pt < 3; pt++) {
            for (const ib of b.items) {
              let pv;
              const d = ib.dimension;
              switch (pt) {
                case 0:
                  pv = [ib.position[0] + d[0], ib.position[1], ib.position[2]];
                  break;
                case 1:
                  pv = [ib.position[0], ib.position[1] + d[1], ib.position[2]];
                  break;
                case 2:
                  pv = [ib.position[0], ib.position[1], ib.position[2] + d[2]];
                  break;
                default:
                  continue;
              }
              const result = b.putItem(item.source, item.width, item.height, item.depth, item.weight, pv, item.allowedRotations);
              if (result) {
                fitted = true;
                break lookup;
              }
            }
          }
      }
      if (!fitted) {
        unpacked.push(item);
      }
    }
    return unpacked;
  }
  function pack3D(options) {
    const allValues = [];
    for (const bin of options.bins) {
      allValues.push(bin.width, bin.height, bin.depth, bin.maxWeight);
    }
    for (const item of options.items) {
      allValues.push(item.width, item.height, item.depth, item.weight);
    }
    const factor = options.factor ?? computeFactor(allValues);
    const normalizedBins = options.bins.map((bin) => ({ source: bin, normalized: normalizeBin(bin, factor) })).sort((a, b) => binVolume(a.normalized) - binVolume(b.normalized));
    let items = options.items.map((item) => normalize(item, factor)).sort((a, b) => getVolume(b.width, b.height, b.depth) - getVolume(a.width, a.height, a.depth));
    const mutableBins = normalizedBins.map((b) => new MutableBin3D(b.normalized));
    const unfitItems = [];
    while (items.length > 0) {
      const firstItem = items[0];
      const bin = findFittedBin(mutableBins, firstItem);
      if (!bin) {
        unfitItems.push(firstItem.source);
        items = items.slice(1);
        continue;
      }
      items = packToBin(mutableBins, bin, items);
    }
    const defactor = (v) => toOriginal(v, factor);
    const packedBins = mutableBins.map((mb, i) => {
      const src = normalizedBins[i].source;
      return {
        name: mb.name,
        width: src.width,
        height: src.height,
        depth: src.depth,
        maxWeight: src.maxWeight,
        items: mb.items.map((item) => ({
          ...item,
          width: defactor(item.width),
          height: defactor(item.height),
          depth: defactor(item.depth),
          weight: defactor(item.weight),
          position: item.position.map(defactor),
          dimension: item.dimension.map(defactor)
        })),
        volume: src.width * src.height * src.depth
      };
    });
    return { packedBins, unfitItems };
  }
  var Packer3D = class {
    bins = [];
    items = [];
    addBin(bin) {
      this.bins.push(bin);
    }
    addItem(item) {
      this.items.push(item);
    }
    pack() {
      return pack3D({ bins: this.bins, items: this.items });
    }
  };
  return __toCommonJS(index_exports);
})();
