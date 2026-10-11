import { CATALOG, ROOKIE_BLUEPRINT, STRINGS, getPart } from '@bolt/content';
import type { BlueprintIssue, PartCategory } from '@bolt/shared';
import { accessoryMounts, buildHash, drawableChassisIds, installedParts, own } from '@bolt/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getManifests } from '../app/App.js';
import { buildSeconds } from '../app/flags.js';
import { MILESTONE_BUILT, MILESTONE_GARAGE_TIPS, useApp } from '../app/store.js';
import { isDrawable } from '../components/BlueprintCard.js';
import { BlueprintsView } from '../components/BlueprintsView.js';
import { Dialog } from '../components/Dialog.js';
import { Glyph } from '../components/Glyph.js';
import { StarterList } from '../components/StarterList.js';
import { useViewport } from '../components/useViewport.js';
import type { Slot } from '../garage/buildSession.js';
import { activeSlot, issueText, planFor, secondsLeft } from '../garage/buildSession.js';
import { clockSound, garageSound } from '../garage/garageSounds.js';
import { garageStore, useGarage } from '../garage/garageStore.js';
import { catalogEntries, fitsMount, partsForSlot, slotKey } from '../garage/slots.js';
import { fill, mountName } from '../garage/text.js';
import { CarPanel } from '../garage/ui/CarPanel.js';
import type { IndicatorKey } from '../garage/ui/IndicatorBar.js';
import { IndicatorBar, IndicatorDialog } from '../garage/ui/IndicatorBar.js';
import { PaintNameDialog } from '../garage/ui/PaintNameDialog.js';
import { PartDetail } from '../garage/ui/PartDetail.js';
import { PartList } from '../garage/ui/PartList.js';
import { PartTools } from '../garage/ui/PartTools.js';
import { TopBar } from '../garage/ui/TopBar.js';
import type { CoachMarks } from '../garage/ui/Workbench.js';
import { Workbench } from '../garage/ui/Workbench.js';
import { useBuildPreview, useBuildStats } from '../garage/ui/useBuildStats.js';
import type { GameManifests } from '../game/assets.js';
import { uiSound } from '../game/audio/index.js';

type Overlay = 'leave' | 'reset' | 'paint' | 'quick' | 'blueprints' | 'more' | null;
type Line = { tone: 'ok' | 'warn' | 'error'; text: string; key: string };

const STEPS = ['chassis', 'tires', 'weapon'] as const;
type Step = (typeof STEPS)[number];

/** How long the lock banner stays up before the race starts, in milliseconds. */
const LOCK_BANNER_MS = 1600;

/**
 * The garage (Section 5.6). The screen owns no rules: it reads the build session from the
 * garage store, shows the shared model's numbers, and dispatches the player's presses.
 */
export function GarageScreen() {
  const manifests = getManifests();
  const session = useGarage((s) => s.session);

  // One build session per visit, started from the car the player last raced, or from a saved
  // build they asked to review. Held in state so a remount starts from the same car.
  const [initial] = useState(() => {
    const app = useApp.getState();
    return { draft: app.garageDraft ?? app.blueprint, fallback: app.blueprint };
  });
  useEffect(() => {
    useApp.getState().takeGarageDraft();
    garageStore
      .getState()
      .start(initial.draft, { seconds: buildSeconds(), fallback: initial.fallback });
    return () => garageStore.getState().end();
  }, [initial]);

  if (!manifests || !session) return <main className="screen garage" />;
  return <Garage manifests={manifests} />;
}

function Garage({ manifests }: { manifests: GameManifests }) {
  const session = useGarage((s) => s.session)!;
  const actions = garageStore.getState();
  const setScreen = useApp((s) => s.setScreen);
  const setBlueprint = useApp((s) => s.setBlueprint);
  const completeMilestone = useApp((s) => s.completeMilestone);
  const tipsDone = useApp((s) => s.milestones[MILESTONE_GARAGE_TIPS] === true);
  const { width, height } = useViewport();
  const portrait = width <= height;
  // Room for the list and the compare pane side by side.
  const wide = width >= 1100 && !portrait;
  const g = STRINGS.garage;

  const blueprint = session.history.present;
  const locked = session.phase === 'locked';
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [indicator, setIndicator] = useState<IndicatorKey | null>(null);
  const [dragIssue, setDragIssue] = useState<BlueprintIssue | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState<Record<Step, boolean>>({
    chassis: false,
    tires: false,
    weapon: false,
  });

  // --- The build clock ---------------------------------------------------------------------
  useEffect(() => {
    const timer = window.setInterval(() => {
      garageStore.getState().tick();
      setNow(Date.now());
    }, 200);
    return () => window.clearInterval(timer);
  }, []);
  const left = secondsLeft(session, now);

  // Interface sounds for what just happened on the bench and for the last seconds of the
  // clock. Silent until the player has touched the page, like all sound.
  const heard = useRef<{ session: typeof session | null; left: number | null }>({
    session: null,
    left: null,
  });
  useEffect(() => {
    const sound = garageSound(heard.current.session, session);
    heard.current.session = session;
    if (sound) uiSound(sound.kind, sound.kind === 'install' ? sound.partId : undefined);
  }, [session]);
  useEffect(() => {
    const sound = session.phase === 'building' ? clockSound(heard.current.left, left) : null;
    heard.current.left = left;
    if (sound) uiSound(sound);
  }, [left, session.phase]);

  // The locked car, and only the locked car, goes to the race.
  const lockedCar = session.locked;
  const lockReason = session.lockReason;
  useEffect(() => {
    if (!lockedCar) return;
    setOverlay(null);
    setIndicator(null);
    setBlueprint(lockedCar);
    completeMilestone(MILESTONE_BUILT);
    const timer = window.setTimeout(
      () => setScreen('race'),
      lockReason === 'timer' ? LOCK_BANNER_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [lockedCar, lockReason, setBlueprint, completeMilestone, setScreen]);

  // --- Numbers from the shared model -------------------------------------------------------
  const stats = useBuildStats(blueprint);
  const focused = session.focusPartId ? (getPart(session.focusPartId) ?? null) : null;
  const plan = useMemo(
    () => (focused ? planFor(session, CATALOG, focused.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focused, blueprint, session.selection, session.targetMountId],
  );
  const previewBlueprint =
    plan && plan.action !== 'current' && plan.result.ok ? plan.result.blueprint : null;
  const preview = useBuildPreview(stats, previewBlueprint);

  const parts = useMemo(() => installedParts(blueprint, CATALOG), [blueprint]);
  const selectedPart =
    session.selection.kind === 'instance'
      ? (parts.find(
          (p) =>
            session.selection.kind === 'instance' &&
            p.instance.instanceId === session.selection.instanceId,
        ) ?? null)
      : null;
  const selectedId = selectedPart?.instance.instanceId ?? null;

  // --- What the side panel shows -------------------------------------------------------------
  const slot = activeSlot(session, CATALOG);
  const slotId = slot ? slotKey(slot) : null;
  const browsing = session.view === 'browse';
  const drawableSet = useMemo(
    () => new Set(drawableChassisIds(manifests.cars, CATALOG)),
    [manifests],
  );
  const entries = useMemo(
    () => {
      const options = { drawable: drawableSet };
      if (browsing) return catalogEntries(blueprint, CATALOG, session.category, options);
      return slot ? partsForSlot(blueprint, CATALOG, slot, options) : [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blueprint, browsing, session.category, slotId, drawableSet],
  );
  const listOpen = browsing || slot !== null;

  const errors = useMemo(
    () => (stats?.issues ?? []).filter((issue) => issue.severity === 'error'),
    [stats],
  );
  const drawable = isDrawable(manifests, blueprint);
  const blocking = errors[0] ?? null;
  const flaggedParts = useMemo(
    () => [
      ...new Set([
        ...session.flagged,
        ...errors.flatMap((i) => (i.instanceId ? [i.instanceId] : [])),
      ]),
    ],
    [session.flagged, errors],
  );
  const flaggedEssentials = useMemo(() => {
    const set = new Set<string>();
    for (const issue of errors)
      if (issue.slot === 'chassis' || issue.slot === 'engine' || issue.slot === 'tires')
        set.add(issue.slot);
    if (!drawable) set.add('chassis');
    return set;
  }, [errors, drawable]);

  // --- The status line -----------------------------------------------------------------------
  const notice = session.notice;
  const noticeStamp = notice?.stamp ?? 0;
  const noticeTone = notice?.tone ?? 'ok';
  useEffect(() => {
    if (noticeStamp === 0) return;
    const timer = window.setTimeout(
      () => garageStore.getState().dismissNotice(),
      noticeTone === 'ok' ? 3500 : 7000,
    );
    return () => window.clearTimeout(timer);
  }, [noticeStamp, noticeTone]);

  const urgent = left !== null && left <= 10 && !locked;
  let line: Line;
  if (dragIssue) line = { tone: 'error', text: issueText(dragIssue), key: 'drag' };
  else if (notice && notice.tone === 'error')
    line = { tone: 'error', text: notice.text, key: `n${notice.stamp}` };
  else if (urgent) line = { tone: 'warn', text: g.tenSeconds, key: 'ten' };
  else if (notice) line = { tone: notice.tone, text: notice.text, key: `n${notice.stamp}` };
  else if (blocking) line = { tone: 'error', text: issueText(blocking), key: 'blocked' };
  else if (!drawable) line = { tone: 'error', text: g.artInProgressNote, key: 'art' };
  else line = { tone: 'ok', text: g.readyToRace, key: 'ready' };
  const idle = !browsing && slot === null && !focused && !selectedPart;
  // The status line has a place of its own with its height reserved: the middle of the header
  // in landscape, a row under the car in portrait. It never lies over the car and nothing
  // moves when it changes. With nothing to report it says the build is ready, quietly.
  const statusLine = (
    <p
      className={`g-status tone-${line.tone}${line.key === 'ready' ? ' is-quiet' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="garage-status"
      data-tone={line.tone}
      title={line.text}
    >
      <Glyph name={line.tone === 'ok' ? 'check' : 'warn'} size={12} />
      <span key={line.key}>{line.text}</span>
    </p>
  );

  // --- First-build teaching (Section 4) ------------------------------------------------------
  const hasWeapon = parts.some((p) => p.def.category === 'weapon');
  const focusCategory = focused?.category;
  useEffect(() => {
    if (focusCategory === 'chassis' || focusCategory === 'tires')
      setSeen((old) => (old[focusCategory] ? old : { ...old, [focusCategory]: true }));
  }, [focusCategory]);
  const done: Record<Step, boolean> = { ...seen, weapon: hasWeapon };
  const coaching = !tipsDone && !locked;
  const allDone = done.chassis && done.tires && done.weapon;
  useEffect(() => {
    if (coaching && allDone) completeMilestone(MILESTONE_GARAGE_TIPS);
  }, [coaching, allDone, completeMilestone]);
  // The weapon step points at the first free mount that takes a weapon.
  const chassisDef = own(CATALOG.chassis, blueprint.chassisId);
  const weaponMount = useMemo(() => {
    if (!chassisDef) return null;
    const taken = new Set(parts.map((p) => p.mount.id));
    const weapons = Object.values(CATALOG.parts).filter((p) => p.category === 'weapon');
    const free = accessoryMounts(chassisDef).filter((m) => !taken.has(m.id));
    return free.find((m) => weapons.some((w) => fitsMount(m, w)))?.id ?? null;
  }, [chassisDef, parts]);
  const marks: CoachMarks = coaching
    ? {
        chassis: { number: 1, done: done.chassis, label: g.tips.chassis },
        tires: { number: 2, done: done.tires, label: g.tips.tires },
        weapon: { number: 3, done: done.weapon, label: g.tips.weapon, mountId: weaponMount },
      }
    : {};
  const stepSlot = (step: Step): Slot | null =>
    step === 'weapon'
      ? weaponMount
        ? { kind: 'mount', mountId: weaponMount }
        : null
      : { kind: step };
  const openStep = (step: Step) => {
    const target = stepSlot(step);
    if (!target) actions.browse('weapon');
    else if (!slot || slotKey(slot) !== slotKey(target)) actions.selectSlot(target);
  };
  const nextStep = STEPS.find((step) => !done[step]) ?? null;
  // The step the open list belongs to, for its header.
  const listStep = coaching
    ? (STEPS.find((step) => {
        const target = stepSlot(step);
        return !done[step] && target !== null && slot !== null && slotKey(target) === slotId;
      }) ?? null)
    : null;
  const useStarter = () => {
    actions.load(ROOKIE_BLUEPRINT, g.starterLoaded);
    completeMilestone(MILESTONE_GARAGE_TIPS);
  };
  const skipTips = () => completeMilestone(MILESTONE_GARAGE_TIPS);

  // --- Presses -------------------------------------------------------------------------------
  const browseCategory = useCallback(
    (category: PartCategory) => garageStore.getState().browse(category),
    [],
  );

  const focusPart = (partId: string) => {
    // On a wide screen the list stays beside the part's card; a row picked there is a
    // replacement for that mount, not a second part for the best free one.
    if (selectedPart) actions.targetMount(selectedPart.mount.id);
    actions.focusPart(partId);
    // From the whole catalog, a part whose only mounts are taken opens as the replacement
    // its row offered.
    const offer = browsing ? entries.find((entry) => entry.part.id === partId) : undefined;
    if (offer?.action === 'replace' && offer.mountId) actions.chooseMount(offer.mountId);
  };

  const stepFocus = (direction: 1 | -1) => {
    if (!focused) return;
    const open = entries.filter((entry) => !entry.pending);
    const at = open.findIndex((entry) => entry.part.id === focused.id);
    const next = open[(at + direction + open.length) % open.length];
    if (next) actions.focusPart(next.part.id);
  };

  const ready = () => {
    if (!drawable) return;
    completeMilestone(MILESTONE_GARAGE_TIPS);
    actions.ready();
  };

  // Focus follows the panes for keyboard and switch users. Opening a row moves focus to its
  // buy button; closing it returns to the row; a fresh install lands on the part's slot tile,
  // where the arrow keys nudge it.
  const focusId = session.focusPartId;
  const lastFocus = useRef<{ part: string | null; selected: string | null }>({
    part: null,
    selected: null,
  });
  useEffect(() => {
    const before = lastFocus.current;
    lastFocus.current = { part: focusId, selected: selectedId };
    const adrift =
      document.activeElement === null ||
      document.activeElement === document.body ||
      !document.contains(document.activeElement);
    const focus = (selector: string) =>
      document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    if (focusId && !before.part) {
      if (adrift) {
        const buy = document.querySelector<HTMLElement>('.g-detail [data-testid="install"]');
        if (buy) buy.focus({ preventScroll: true });
        else focus('.g-detail .g-pane-head .btn');
      }
    } else if (!focusId && before.part && adrift) {
      if (selectedId && selectedId !== before.selected)
        focus(`.slot-tile[data-instance="${selectedId}"]`);
      else if (document.querySelector(`.part-card[data-part="${before.part}"]`))
        focus(`.part-card[data-part="${before.part}"]`);
      else focus('.slot-tile.is-selected');
    }
  }, [focusId, selectedId]);

  // Keyboard: undo and redo, and Escape to back out one level.
  const overlayRef = useRef(false);
  overlayRef.current = overlay !== null || indicator !== null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (overlayRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const store = garageStore.getState();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
      } else if (event.key === 'Escape') {
        const current = store.session;
        if (current?.focusPartId) store.focusPart(null);
        else store.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const installedCount = focused
    ? focused.id === blueprint.chassisId ||
      focused.id === blueprint.engineId ||
      focused.id === blueprint.tireKitId
      ? 1
      : blueprint.parts.filter((p) => p.partId === focused.id).length
    : 0;
  const removable = focused
    ? (parts.find((p) => p.instance.instanceId === selectedId && p.def.id === focused.id) ??
      (slot?.kind === 'mount'
        ? parts.find((p) => p.def.id === focused.id && p.mount.id === slot.mountId)
        : undefined) ??
      (browsing ? parts.find((p) => p.def.id === focused.id) : undefined) ??
      null)
    : null;

  const heading = browsing
    ? g.browseTitle
    : slot?.kind === 'mount'
      ? mountName(slot.mountId)
      : slot
        ? g.categories[slot.kind]
        : '';
  const list = (
    <PartList
      manifests={manifests}
      blueprint={blueprint}
      entries={entries}
      heading={heading}
      listKey={browsing ? 'browse' : (slotId ?? 'none')}
      grouped={!browsing && slot?.kind === 'mount'}
      browse={browsing ? { category: session.category, onCategory: browseCategory } : null}
      focusPartId={session.focusPartId}
      coach={listStep ? { number: STEPS.indexOf(listStep) + 1, label: g.tips[listStep] } : null}
      onFocus={focusPart}
      onBrowse={browsing ? null : () => actions.browse()}
    />
  );
  const detail =
    focused && plan ? (
      <PartDetail
        manifests={manifests}
        blueprint={blueprint}
        part={focused}
        plan={plan}
        stats={stats}
        preview={preview}
        installed={installedCount}
        targetMountId={session.targetMountId}
        pickMount={browsing}
        locked={locked}
        onBack={() => actions.focusPart(null)}
        onStep={stepFocus}
        onInstall={() => actions.install(focused.id)}
        onRemove={removable ? () => actions.remove(removable.instance.instanceId) : null}
        onChooseMount={actions.chooseMount}
      />
    ) : null;
  const tools = selectedPart ? (
    <PartTools
      manifests={manifests}
      part={selectedPart}
      locked={locked}
      onReplace={() => actions.targetMount(selectedPart.mount.id)}
      onNudge={(dx, dy) => actions.nudge(selectedPart.instance.instanceId, dx, dy)}
      onFace={(turn) => actions.face(selectedPart.instance.instanceId, turn)}
      onFire={(choice) => actions.setFire(selectedPart.instance.instanceId, choice)}
      onRemove={() => actions.remove(selectedPart.instance.instanceId)}
    />
  ) : null;

  const readyBlocked = blocking !== null || !drawable;
  const canRepair = blocking !== null && !locked;
  const swatch = manifests.cars.paints[blueprint.paintId]?.ramp[3] ?? '#cf3440';
  const carPanel = (
    <CarPanel
      manifests={manifests}
      name={blueprint.name}
      swatch={swatch}
      stats={stats}
      parts={parts}
      mountCount={chassisDef ? accessoryMounts(chassisDef).length : 0}
      blocked={blocking ? issueText(blocking) : !drawable ? g.artInProgressNote : null}
      locked={locked}
      onPaint={() => setOverlay('paint')}
      onBrowse={() => actions.browse()}
      onIndicator={setIndicator}
      onMount={(mountId) => actions.selectSlot({ kind: 'mount', mountId })}
      onRepair={canRepair ? actions.repair : null}
    >
      {coaching && !portrait && (
        <aside className="g-coach" aria-label={g.tips.title}>
          <div className="g-coach-steps">
            {STEPS.map((id, index) => (
              <button
                key={id}
                type="button"
                className={`chip g-coach-step${done[id] ? ' is-done' : ''}`}
                onClick={() => openStep(id)}
              >
                <span className="g-step-number">
                  {done[id] ? <Glyph name="check" size={12} /> : index + 1}
                </span>
                {g.tips[id]}
              </button>
            ))}
          </div>
          <div className="g-coach-actions">
            <button className="btn btn-small" onClick={useStarter}>
              {g.tips.useStarter}
            </button>
            <button className="btn btn-small btn-quiet" onClick={skipTips}>
              {g.tips.skip}
            </button>
          </div>
        </aside>
      )}
    </CarPanel>
  );

  const target =
    focused && plan
      ? {
          mountId: plan.mountId,
          replacedId: plan.replaced && plan.result.ok ? plan.replaced.instance.instanceId : null,
        }
      : null;

  return (
    <main
      className={`screen garage${wide ? ' is-wide' : ''}${portrait ? ' is-portrait' : ''}${
        height < 470 ? ' is-short' : ''
      }${coaching ? ' is-coaching' : ''}`}
    >
      <h1 className="visually-hidden">{g.title}</h1>
      <TopBar
        stats={stats}
        preview={preview}
        secondsLeft={left}
        canUndo={session.history.past.length > 0}
        canRedo={session.history.future.length > 0}
        locked={locked}
        onBack={() => setOverlay('leave')}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onCredits={() => setIndicator('budget')}
        statusLine={portrait ? null : statusLine}
      />
      <Workbench
        manifests={manifests}
        blueprint={blueprint}
        row={portrait}
        slot={slot}
        selectedInstanceId={selectedId}
        target={target}
        flagged={flaggedParts}
        flaggedEssentials={flaggedEssentials}
        marks={marks}
        idle={idle}
        locked={locked}
        onSlot={actions.selectSlot}
        onShowCar={actions.clearSelection}
        onSelectInstance={actions.selectInstance}
        onMove={actions.moveTo}
        onNudge={actions.nudge}
        onRotate={actions.rotate}
        onRemove={actions.remove}
        onClearSelection={actions.clearSelection}
        onDragIssue={setDragIssue}
      />
      {portrait && <div className="g-status-row">{statusLine}</div>}
      {coaching && portrait && (
        <aside className="g-coach-line" aria-label={g.tips.title}>
          {nextStep && (
            <button type="button" className="chip g-coach-step" onClick={() => openStep(nextStep)}>
              <span className="g-step-number">{STEPS.indexOf(nextStep) + 1}</span>
              <span className="g-coach-text">{g.tips[nextStep]}</span>
            </button>
          )}
          <button className="btn btn-small" onClick={useStarter}>
            {g.tips.useStarter}
          </button>
          <button className="btn btn-small btn-quiet" onClick={skipTips}>
            {g.tips.skip}
          </button>
        </aside>
      )}
      <div className="g-panel">
        {wide ? (
          <>
            {listOpen || selectedPart ? list : carPanel}
            {detail ??
              tools ??
              (listOpen ? (
                carPanel
              ) : (
                <section className="g-detail is-empty">
                  <Glyph name="chassis" size={36} />
                  <p>{g.detailEmpty}</p>
                  <p className="dim">{g.tapMount}</p>
                </section>
              ))}
          </>
        ) : (
          (detail ?? tools ?? (listOpen ? list : carPanel))
        )}
      </div>
      <footer className="g-bottom">
        <IndicatorBar stats={stats} onOpen={setIndicator} />
        <button
          className="btn btn-small g-more"
          onClick={() => setOverlay('more')}
          disabled={locked}
          aria-haspopup="dialog"
          aria-label={g.more}
        >
          <Glyph name="more" size={24} />
          <span className="g-more-text">{g.more}</span>
        </button>
      </footer>
      <button
        className="btn btn-primary g-ready"
        onClick={ready}
        aria-disabled={readyBlocked || locked}
        aria-describedby="g-ready-why"
        data-testid="ready"
      >
        {g.ready}
      </button>
      <span id="g-ready-why" className="visually-hidden">
        {readyBlocked ? line.text : g.readyToRace}
      </span>

      {urgent && (
        <p className="visually-hidden" role="alert">
          {g.tenSeconds}
        </p>
      )}

      {indicator && stats && (
        <IndicatorDialog stats={stats} open={indicator} onClose={() => setIndicator(null)} />
      )}
      {overlay === 'more' && (
        <Dialog
          title={g.more}
          onClose={() => setOverlay(null)}
          className="dialog g-more-menu"
          hideTitle
        >
          <button className="btn" onClick={() => setOverlay('paint')}>
            {g.paintAndName}
          </button>
          <button
            className="btn"
            onClick={() => setOverlay('blueprints')}
            aria-label={`${g.save}: ${STRINGS.blueprints.title}`}
          >
            {g.save}
          </button>
          <button className="btn" onClick={() => setOverlay('quick')}>
            {g.quickBuild}
          </button>
          <button className="btn" onClick={() => setOverlay('reset')}>
            {g.reset}
          </button>
          <button
            className="btn"
            onClick={() => {
              actions.browse();
              setOverlay(null);
            }}
          >
            {g.browseAll}
          </button>
          <button
            className="btn"
            onClick={() => {
              actions.clearSelection();
              setOverlay(null);
            }}
          >
            {g.carStats}
          </button>
          {canRepair && (
            <button
              className="btn"
              onClick={() => {
                actions.repair();
                setOverlay(null);
              }}
            >
              {g.repair}
            </button>
          )}
          {coaching && (
            <button
              className="btn"
              onClick={() => {
                skipTips();
                setOverlay(null);
              }}
            >
              {g.tips.skip}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setOverlay(null)} data-autofocus>
            {STRINGS.home.close}
          </button>
        </Dialog>
      )}
      {overlay === 'leave' && (
        <Dialog
          title={STRINGS.garage.leave}
          role="alertdialog"
          onClose={() => setOverlay(null)}
          className="dialog"
          hideTitle
        >
          <p>{STRINGS.garage.leaveConfirm}</p>
          <div className="dialog-actions">
            <button className="btn btn-danger" onClick={() => setScreen('home')}>
              {STRINGS.garage.leave}
            </button>
            <button className="btn btn-primary" onClick={() => setOverlay(null)} data-autofocus>
              {STRINGS.garage.keepBuilding}
            </button>
          </div>
        </Dialog>
      )}
      {overlay === 'reset' && (
        <Dialog
          title={STRINGS.garage.reset}
          role="alertdialog"
          onClose={() => setOverlay(null)}
          className="dialog"
          hideTitle
        >
          <p>{STRINGS.garage.resetConfirm}</p>
          <div className="dialog-actions">
            <button
              className="btn btn-danger"
              onClick={() => {
                actions.reset();
                setOverlay(null);
              }}
            >
              {STRINGS.garage.reset}
            </button>
            <button className="btn btn-primary" onClick={() => setOverlay(null)} data-autofocus>
              {STRINGS.garage.keepBuilding}
            </button>
          </div>
        </Dialog>
      )}
      {overlay === 'paint' && (
        <PaintNameDialog
          name={blueprint.name}
          paintId={blueprint.paintId}
          onPaint={actions.paint}
          onRename={actions.rename}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === 'quick' && (
        <Dialog
          title={STRINGS.garage.templatesTitle}
          onClose={() => setOverlay(null)}
          className="sheet"
          head={
            <button className="btn btn-small" onClick={() => setOverlay(null)}>
              {STRINGS.home.close}
            </button>
          }
        >
          <p className="sheet-note">{STRINGS.garage.templatesNote}</p>
          <div className="sheet-body">
            <StarterList
              manifests={manifests}
              actionLabel={STRINGS.garage.useThis}
              onPick={(template) => {
                actions.load(
                  template.blueprint,
                  fill(STRINGS.garage.templateLoaded, { name: template.name }),
                );
                setOverlay(null);
              }}
            />
          </div>
        </Dialog>
      )}
      {overlay === 'blueprints' && (
        <Dialog
          title={STRINGS.blueprints.title}
          onClose={() => setOverlay(null)}
          className="sheet sheet-full"
          hideTitle
        >
          <BlueprintsView
            manifests={manifests}
            current={blueprint}
            currentHash={buildHash(blueprint)}
            closeLabel={STRINGS.home.close}
            onClose={() => setOverlay(null)}
            onUse={(picked) => {
              actions.load(picked, fill(STRINGS.blueprints.nowUsing, { name: picked.name }));
              setOverlay(null);
            }}
            onReview={(picked) => {
              actions.load(picked, fill(STRINGS.blueprints.nowUsing, { name: picked.name }));
              setOverlay(null);
            }}
          />
        </Dialog>
      )}
      {locked && lockReason === 'timer' && (
        <div className="overlay g-locked" role="alert">
          <div className="panel dialog">
            <Glyph name="lock" size={36} />
            <p>{STRINGS.garage.locked}</p>
          </div>
        </div>
      )}
    </main>
  );
}
