// Set values[index] = value; with shift, also every row between the anchor (last clicked) and index.
export function applyRange<T>(values: T[], anchor: number | null, index: number, value: T, shift: boolean): T[] {
	const lo = shift && anchor !== null ? Math.min(anchor, index) : index;
	const hi = shift && anchor !== null ? Math.max(anchor, index) : index;
	return values.map((v, i) => (i >= lo && i <= hi ? value : v));
}
