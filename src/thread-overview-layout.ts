export const MIN_MAP_ZOOM = 0.05;
export const MAX_MAP_ZOOM = 2.5;
export const MAP_ZOOM_STEP = 0.2;

export interface MapViewportCenter {
	x: number;
	y: number;
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
	return {
		x: (scrollLeft + viewportWidth / 2 - mapLeft) / zoom,
		y: (scrollTop + viewportHeight / 2 - mapTop) / zoom,
	};
}

export function mapScrollForCenter(
	center: MapViewportCenter,
	viewportWidth: number,
	viewportHeight: number,
	mapLeft: number,
	mapTop: number,
	zoom: number,
): { left: number; top: number } {
	return {
		left: mapLeft + center.x * zoom - viewportWidth / 2,
		top: mapTop + center.y * zoom - viewportHeight / 2,
	};
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
