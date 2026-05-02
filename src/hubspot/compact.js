/**
 * Response compaction. HubSpot returns every property on an object even when
 * empty, which inflates token cost in MCP tool responses. `compact` recursively
 * drops null, undefined, and empty-string values, and removes objects/arrays
 * that become empty as a result.
 */

/**
 * Recursively strip null / undefined / empty-string values from a value.
 * @param {unknown} value
 * @returns {unknown} Compacted value, or `undefined` if the value was empty.
 */
export function compact(value) {
  if (value === null || value === undefined || value === "") return undefined;

  if (Array.isArray(value)) {
    const arr = value.map(compact).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }

  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }

  return value;
}
