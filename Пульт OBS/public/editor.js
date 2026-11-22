const EditorGeometry = (() => {
  const align = (length, flags, near, far) => flags & near ? 0 : flags & far ? length : length / 2;
  const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

  function box(t) {
    const sourceW = t.sourceWidth - t.cropLeft - t.cropRight;
    const sourceH = t.sourceHeight - t.cropTop - t.cropBottom;
    if (!(sourceW > 0 && sourceH > 0)) return null;
    const bounded = t.boundsType !== 'OBS_BOUNDS_NONE';
    let visualW = sourceW * Math.abs(t.scaleX);
    let visualH = sourceH * Math.abs(t.scaleY);
    const w = bounded ? t.boundsWidth : visualW;
    const h = bounded ? t.boundsHeight : visualH;
    if (!(w > 0 && h > 0 && visualW > 0 && visualH > 0)) return null;
    const flippedX = t.scaleX < 0;
    const flippedY = t.scaleY < 0;
    // Free transforms keep OBS's signed alignment. Bounded transforms flip inside the box.
    const left = bounded || !flippedX ? -align(w, t.alignment, 1, 2) : align(w, t.alignment, 1, 2) - w;
    const top = bounded || !flippedY ? -align(h, t.alignment, 4, 8) : align(h, t.alignment, 4, 8) - h;
    const type = t.boundsType;
    if (type === 'OBS_BOUNDS_STRETCH') {
      visualW = w;
      visualH = h;
    } else if (bounded) {
      const fx = w / visualW;
      const fy = h / visualH;
      const factor = {
        OBS_BOUNDS_SCALE_INNER: Math.min(fx, fy),
        OBS_BOUNDS_SCALE_OUTER: Math.max(fx, fy),
        OBS_BOUNDS_SCALE_TO_WIDTH: fx,
        OBS_BOUNDS_SCALE_TO_HEIGHT: fy,
        OBS_BOUNDS_MAX_ONLY: Math.min(1, fx, fy),
      }[type] ?? 1;
      visualW *= factor;
      visualH *= factor;
    }
    const visual = {
      left: left + align(w - visualW, t.boundsAlignment, 1, 2),
      top: top + align(h - visualH, t.boundsAlignment, 4, 8),
      w: visualW, h: visualH, flippedX, flippedY, sourceW, sourceH,
      clip: t.cropToBounds && ['OBS_BOUNDS_SCALE_OUTER', 'OBS_BOUNDS_SCALE_TO_WIDTH', 'OBS_BOUNDS_SCALE_TO_HEIGHT'].includes(type),
    };
    return { left, top, w, h, visual, angle: t.rotation * Math.PI / 180, x: t.positionX, y: t.positionY };
  }

  function rotate(x, y, angle) {
    return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
  }

  function corners({ left, top, w, h }) {
    return [[left, top], [left + w, top], [left + w, top + h], [left, top + h]];
  }

  function resize(selection, handle, dx, dy, linked) {
    const points = corners(selection);
    const [ax, ay] = points[(handle + 2) % 4];
    const [hx, hy] = points[handle];
    const [localDx, localDy] = rotate(dx, dy, -selection.angle);
    const wx = hx - ax;
    const wy = hy - ay;
    const minX = Math.max(0.05, Math.min(1, 12 / selection.w));
    const minY = Math.max(0.05, Math.min(1, 12 / selection.h));
    let factorX = clamp(1 + localDx / wx, minX, 20);
    let factorY = clamp(1 + localDy / wy, minY, 20);
    if (linked) {
      const ratio = 1 + (localDx * wx + localDy * wy) / (wx * wx + wy * wy);
      factorX = factorY = clamp(ratio, Math.max(minX, minY), 20);
    }
    const [x, y] = rotate(ax * (1 - factorX), ay * (1 - factorY), selection.angle);
    return { x: selection.x + x, y: selection.y + y, factorX, factorY };
  }

  return { box, rotate, corners, resize };
})();

