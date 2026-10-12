import { STRINGS, getTrack, getWeatherPreset } from '@bolt/content';
import { buildTrack } from '@bolt/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { courseAssets, courseOptions, getManifests } from '../app/App.js';
import { settleCourse } from '../app/course.js';
import type { CourseOption } from '../app/course.js';
import { useApp } from '../app/store.js';
import { layoutMinimap } from '../game/layout/layoutCanvas.js';
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
/** The map image for a course: the baked one when its art is loaded, else drawn from the layout. */
function useCourseMap(option: CourseOption): { src: string; width: number; height: number } | null {
  const loaded = getManifests();
  return useMemo(() => {
    if (loaded && loaded.course.trackId === option.trackId && loaded.terrainArt !== 'layout') {
      const m = loaded.terrain.minimap;
      return { src: loaded.minimapSrc, width: m.width, height: m.height };
    }
    const def = getTrack(option.trackId);
    return def ? layoutMinimap(buildTrack(def)) : null;
  }, [loaded, option.trackId]);
}

/**
 * Track Preview (Section 5.5): the course map, the published weather, the surface mix, and
 * two build tips, all read from the track runtime and the shared balance tables. The exact
 * multipliers are one tap away in Track Details. Both racers will see this same screen.
 *
 * When this build offers more than one course (every course with baked art; all eight tracks
 * in a development or `?debug=1` build) the track is stepped through at the top of the map and
 * the weather badge becomes a choice between the track's two weathers.
 */
export function TrackPreviewScreen() {
  const setScreen = useApp((s) => s.setScreen);
  const wanted = useApp((s) => s.course);
  const setCourse = useApp((s) => s.setCourse);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const viewport = useViewport();
  const compact = viewport.width < 740 || viewport.height < 380;
  const options = useMemo(() => courseOptions(), []);
  const current = settleCourse(wanted, options);
  const trackIds = useMemo(() => [...new Set(options.map((o) => o.trackId))], [options]);
  const track = getTrack(current.trackId);
  const preset = getWeatherPreset(current.presetId);
  const facts = useMemo(
    () => (track && preset ? trackFacts(track, buildTrack(track), preset) : null),
    [track, preset],
  );
  const map = useCourseMap(current);

  // Start fetching the chosen course's art at once, so the race does not wait for it.
  useEffect(() => {
    void courseAssets(current).catch(() => undefined);
  }, [current]);

  const choose = (option: CourseOption | undefined) => {
    if (option) setCourse({ trackId: option.trackId, presetId: option.presetId });
  };
  const stepTrack = (delta: number) => {
    const at = trackIds.indexOf(current.trackId);
    const next = trackIds[(at + delta + trackIds.length) % trackIds.length];
    // The same weather slot (first or second) on the next track.
    const slot = (track?.weatherPresetIds ?? []).indexOf(current.presetId);
    const ofNext = options.filter((o) => o.trackId === next);
    choose(ofNext[Math.max(0, slot)] ?? ofNext[0]);
  };
  const weathers = options.filter((o) => o.trackId === current.trackId);

  // The map is pixel art: scale it by whole device pixels to fit its panel.
  const frame = useRef<HTMLDivElement>(null);
  const [mapScale, setMapScale] = useState(1);
  useEffect(() => {
    const node = frame.current;
    if (!node || !map) return;
    const fit = () => {
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      const room = Math.min(
        (node.clientWidth - 24) / map.width,
        (node.clientHeight - 24) / map.height,
      );
      setMapScale(Math.max(1 / dpr, Math.floor(room * dpr) / dpr));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [map]);

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
        {map && (
          <img
            className="preview-map-art"
            src={map.src}
            width={map.width}
            height={map.height}
            style={{ width: map.width * mapScale, height: map.height * mapScale }}
            alt={fill(STRINGS.preview.mapAlt, { track: track.name })}
            draggable={false}
          />
        )}
        {current.art !== 'baked' && (
          <span className="preview-art-note" data-testid="art-in-progress">
            {current.art === 'layout'
              ? STRINGS.preview.artInProgress
              : STRINGS.preview.weatherArtInProgress}
          </span>
        )}
        <span className="preview-character">{track.character}</span>
        <button className="btn btn-small preview-back" onClick={() => setScreen('home')}>
          <Glyph name="back" size={12} />
          <span>{STRINGS.preview.back}</span>
        </button>
        {trackIds.length > 1 && (
          <div
            className="preview-pick-track"
            role="group"
            aria-label={STRINGS.preview.chooseTrack}
            data-testid="course-picker"
          >
            <button
              className="btn btn-small"
              aria-label={STRINGS.preview.previousTrack}
              onClick={() => stepTrack(-1)}
            >
              <Glyph name="back" size={12} />
            </button>
            <span className="preview-pick-count">
              {fill(STRINGS.preview.trackCount, {
                index: String(trackIds.indexOf(current.trackId) + 1),
                count: String(trackIds.length),
              })}
            </span>
            <button
              className="btn btn-small preview-pick-next"
              aria-label={STRINGS.preview.nextTrack}
              onClick={() => stepTrack(1)}
            >
              <Glyph name="back" size={12} />
            </button>
          </div>
        )}
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
          {weathers.length > 1 ? (
            <div
              className="preview-pick-weather"
              role="radiogroup"
              aria-label={STRINGS.preview.chooseWeather}
            >
              {weathers.map((w) => {
                const p = getWeatherPreset(w.presetId);
                const on = w.presetId === current.presetId;
                return (
                  <button
                    key={w.presetId}
                    role="radio"
                    aria-checked={on}
                    className={`weather-badge weather-choice${on ? ' is-on' : ''}`}
                    onClick={() => choose(w)}
                  >
                    {p && <Glyph name={weatherGlyph(p.weather, p.timeOfDay)} size={on ? 24 : 16} />}
                    <span>{p?.displayName ?? w.presetId}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="weather-badge">
              <Glyph name={weatherGlyph(preset.weather, preset.timeOfDay)} size={24} />
              <span>{preset.displayName}</span>
            </p>
          )}
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
