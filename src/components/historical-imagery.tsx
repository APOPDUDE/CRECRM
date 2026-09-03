import { useEffect } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { imageryStack, type ImagerySource } from '@/lib/map-layers'

/**
 * Historical imagery under the overlays — Paxiv's Basemap › Historical year slider.
 * Sits in its own pane just above the live basemap (tilePane is 200) so wherever a
 * year's flight has no tile, today's imagery shows through instead of a hole.
 */
const IMAGERY_PANE = 'historicalImagery'

/** Web-Mercator half-world in metres — the tile grid's origin. */
const HALF = 20037508.342789244

/**
 * A TileLayer over an ArcGIS exportImage/export endpoint: one dynamic image per
 * tile, asked for in the tile's own 3857 box. Slower than a cache, but it is how the
 * flights without a tile cache (Hillsborough 1938, 2013–2017; SWFWMD) can be shown.
 */
const ExportTiles = L.TileLayer.extend({
  getTileUrl(this: L.TileLayer & { options: L.TileLayerOptions & { base: string } }, coords: L.Coords) {
    const size = (2 * HALF) / 2 ** coords.z
    const minx = -HALF + coords.x * size
    const maxy = HALF - coords.y * size
    const bbox = `${minx},${maxy - size},${minx + size},${maxy}`
    return `${this.options.base}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image`
  },
}) as unknown as new (opts: L.TileLayerOptions & { base: string }) => L.TileLayer

function layerFor(src: ImagerySource): L.TileLayer {
  const common: L.TileLayerOptions = {
    pane: IMAGERY_PANE,
    maxNativeZoom: src.maxNativeZoom,
    maxZoom: 22,
    bounds: src.bounds ? L.latLngBounds(src.bounds) : undefined,
    attribution: `${src.source} ${src.year}`,
    // a tile the flight never covered stays blank rather than a broken-image icon
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  }
  return src.kind === 'xyz'
    ? L.tileLayer(src.url, common)
    : new ExportTiles({ ...common, base: src.url })
}

/** Mount inside a MapContainer; `year` null = live imagery only. */
export function HistoricalImagery({ year }: { year: number | null }) {
  const map = useMap()
  useEffect(() => {
    if (!year) return
    if (!map.getPane(IMAGERY_PANE)) map.createPane(IMAGERY_PANE).style.zIndex = '210'
    const layers = imageryStack(year).map(layerFor)
    layers.forEach((l) => l.addTo(map))
    return () => {
      layers.forEach((l) => map.removeLayer(l))
    }
  }, [map, year])
  return null
}
