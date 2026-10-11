import { STRINGS, getTrack, getWeatherPreset } from '@bolt/content';
import { buildTrack } from '@bolt/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TRACK_ID, WEATHER_PRESET_ID, getManifests } from '../app/App.js';
import { useApp } from '../app/store.js';
import { Dialog } from '../components/Dialog.js';
import { Glyph } from '../components/Glyph.js';
import type { GlyphName } from '../components/glyphs.js';
import { PixelText } from '../components/PixelText.js';
import { useViewport } from '../components/useViewport.js';
import { fill } from '../garage/text.js';
import { trackFacts } from '../garage/trackFacts.js';

export function weatherGlyph(weather: string, timeOfDay: string): GlyphName {
  if (weather === 'rain' || weather === 'heavy_rain' || weather === 'snowfall') return 'rain';
  return timeOfDay === 'night' ? 'moon' : 'sun';
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Track Preview (Section 5.5): the course map, the published weather, the surface mix, and
 * two build tips, all read from the track runtime and the shared balance tables. The exact
 * multipliers are one tap away in Track Details. Both racers will see this same screen.
 */
export function TrackPreviewScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const manifests = getManifests();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const viewport = useViewport();
  const compact = viewport.width < 740 || viewport.height < 380;
  const track = getTrack(TRACK_ID);
  const preset = getWeatherPreset(WEATHER_PRESET_ID);
  const facts = useMemo(
    () => (track && preset ? trackFacts(track, buildTrack(track), preset) : null),
    [track, preset],
  );

  // The map is pixel art: scale it by whole device pixels to fit its panel.
  const frame = useRef<HTMLDivElement>(null);
  const [mapScale, setMapScale] = useState(1);
  const minimap = manifests?.terrain.minimap;
  useEffect(() => {
    const node = frame.current;
    if (!node || !minimap) return;
    const fit = () => {
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      const room = Math.min(
        (node.clientWidth - 24) / minimap.width,
        (node.clientHeight - 24) / minimap.height,
      );
      setMapScale(Math.max(1 / dpr, Math.floor(room * dpr) / dpr));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [minimap]);

  // Escape goes back, as the Back button does. An open dialog takes the key first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScreen('home');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen]);

  if (!track || !preset || !facts) return null;
  const surfaceLine = facts.surfaces.map((row) => `${row.name}: ${percent(row.share)}`).join(', ');

  return (
    <main className="screen preview">
      <section className="panel preview-map" ref={frame} aria-label={track.name}>
        {manifests && minimap && (
          <img
            className="preview-map-art"
            src={`${manifests.terrainBase}/${minimap.file}`}
            width={minimap.width}
            height={minimap.height}
            style={{ width: minimap.width * mapScale, height: minimap.height * mapScale }}
            alt={fill(STRINGS.preview.mapAlt, { track: track.name })}
            draggable={false}
          />
        )}
        <span className="preview-character">{track.character}</span>
        <button className="btn btn-small preview-back" onClick={() => setScreen('home')}>
          <Glyph name="back" size={12} />
          <span>{STRINGS.preview.back}</span>
        </button>
      </section>
      <section className="preview-info">
        <p className="preview-header">{STRINGS.preview.header}</p>
        <div className="preview-head">
          <h1 className="preview-title">
            <PixelText
              text={track.name.toUpperCase()}
              scale={compact ? 2 : 3}
              color="#F5EED9"
              shadow="#0e1320"
            />
          </h1>
          <p className="weather-badge">
            <Glyph name={weatherGlyph(preset.weather, preset.timeOfDay)} size={24} />
            <span>{preset.displayName}</span>
          </p>
        </div>
        <dl className="preview-facts">
          <div>
            <dt>{STRINGS.preview.laps}</dt>
            <dd>{facts.laps}</dd>
          </div>
          <div>
            <dt>{STRINGS.preview.lapLength}</dt>
            <dd>
              {fill(STRINGS.preview.meters, { value: facts.lapMeters.toLocaleString('en-US') })}
              <small> {facts.lengthLabel}</small>
            </dd>
          </div>
          <div>
            <dt>{STRINGS.preview.corners}</dt>
            <dd>{facts.corners}</dd>
          </div>
          <div className="preview-fact-wide">
            <dt>{STRINGS.preview.surfaces}</dt>
            <dd>{surfaceLine}</dd>
          </div>
        </dl>
        <ul className="preview-tips" aria-label={STRINGS.preview.tips}>
          {facts.tips.map((tip) => (
            <li key={tip}>
              <Glyph name="bulb" size={12} />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
        <div className="preview-actions">
          <button
            className="btn btn-small"
            onClick={() => setDetailsOpen(true)}
            aria-expanded={detailsOpen}
          >
            {STRINGS.preview.details}
          </button>
          <button
            className="btn btn-primary preview-go"
            onClick={() => setScreen('garage')}
            autoFocus
          >
            {STRINGS.preview.buildYourCar}
          </button>
        </div>
      </section>
      {detailsOpen && (
        <Dialog
          title={STRINGS.preview.details}
          onClose={() => setDetailsOpen(false)}
          className="sheet sheet-narrow"
          head={
            <button className="btn btn-small" onClick={() => setDetailsOpen(false)}>
              {STRINGS.home.close}
            </button>
          }
        >
          <div className="sheet-body">
            <table className="detail-table">
              <thead>
                <tr>
                  <th scope="col">{STRINGS.preview.surface}</th>
                  <th scope="col">{STRINGS.preview.share}</th>
                  <th scope="col">{STRINGS.preview.grip}</th>
                </tr>
              </thead>
              <tbody>
                {facts.surfaces.map((row) => (
                  <tr key={row.surface}>
                    <th scope="row">{row.name}</th>
                    <td>{percent(row.share)}</td>
                    <td>x{row.grip.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="detail-table">
              <tbody>
                <tr>
                  <th scope="row">{STRINGS.preview.cooling}</th>
                  <td>x{facts.cooling.toFixed(2)}</td>
                </tr>
                <tr>
                  <th scope="row">{STRINGS.preview.solar}</th>
                  <td>x{facts.solar.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            <p className="sheet-note">{STRINGS.preview.detailsNote}</p>
          </div>
        </Dialog>
      )}
    </main>
  );
}
