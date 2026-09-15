export const MIN_MAP_ZOOM = 0.05;
export const MAX_MAP_ZOOM = 2.5;
export const MAP_ZOOM_STEP = 0.2;

export interface MapViewportCenter {
	x: number;
	y: number;
}

export function mapPointAtViewportPosition(
	scrollLeft: number,
	scrollTop: number,
	viewportX: number,
	viewportY: number,
	mapLeft: number,
	mapTop: number,
	zoom: number,
): MapViewportCenter {
	return {
		x: (scrollLeft + viewportX - mapLeft) / zoom,
		y: (scrollTop + viewportY - mapTop) / zoom,
	};
}

export function mapScrollForViewportPoint(
	point: MapViewportCenter,
	viewportX: number,
	viewportY: number,
	mapLeft: number,
	mapTop: number,
	zoom: number,
): { left: number; top: number } {
	return {
		left: mapLeft + point.x * zoom - viewportX,
		top: mapTop + point.y * zoom - viewportY,
	};
}

export function mapViewportCenter(
	scrollLeft: number,
	scrollTop: number,
	viewportWidth: number,
	viewportHeight: number,
	mapLeft: number,
	mapTop: number,
	zoom: number,
): MapViewportCenter {
	return mapPointAtViewportPosition(
		scrollLeft, scrollTop, viewportWidth / 2, viewportHeight / 2, mapLeft, mapTop, zoom,
	);
}

export function mapScrollForCenter(
	center: MapViewportCenter,
	viewportWidth: number,
	viewportHeight: number,
	mapLeft: number,
	mapTop: number,
	zoom: number,
): { left: number; top: number } {
	return mapScrollForViewportPoint(
		center, viewportWidth / 2, viewportHeight / 2, mapLeft, mapTop, zoom,
	);
}

export function wheelMapZoomFactor(deltaY: number, deltaMode: number, viewportHeight: number): number {
	const normalizedDelta = deltaMode === 1
		? deltaY * 16
		: deltaMode === 2
			? deltaY * Math.max(1, viewportHeight)
			: deltaY;
	return Math.max(0.75, Math.min(1.25, Math.exp(-normalizedDelta / 100)));
}

export function clampMapZoom(value: number): number {
	return Math.max(MIN_MAP_ZOOM, Math.min(value, MAX_MAP_ZOOM));
}

export function fitMapZoom(
	contentWidth: number,
	contentHeight: number,
	viewportWidth: number,
	viewportHeight: number,
): number {
	return clampMapZoom(Math.min(
		Math.max(1, viewportWidth - 48) / Math.max(1, contentWidth),
		Math.max(1, viewportHeight - 48) / Math.max(1, contentHeight),
		MAX_MAP_ZOOM,
	));
}

export function mapStageGeometry(
	contentWidth: number,
	contentHeight: number,
	viewportWidth: number,
	viewportHeight: number,
	zoom: number,
): { left: number; top: number; width: number; height: number } {
	return {
		left: viewportWidth / 2,
		top: viewportHeight / 2,
		width: Math.ceil(contentWidth * zoom + viewportWidth),
		height: Math.ceil(contentHeight * zoom + viewportHeight),
	};
}
