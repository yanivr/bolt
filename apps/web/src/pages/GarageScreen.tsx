import { CATALOG, ROOKIE_BLUEPRINT, STRINGS, getPart } from '@bolt/content';
import type { BlueprintIssue, PartCategory } from '@bolt/shared';
import { buildHash, installedParts, own } from '@bolt/shared';
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
import { issueText, planFor, secondsLeft, targetMountFor } from '../garage/buildSession.js';
import { garageStore, useGarage } from '../garage/garageStore.js';
import { fill } from '../garage/text.js';
import { CategoryRail } from '../garage/ui/CategoryRail.js';
import { IndicatorBar } from '../garage/ui/IndicatorBar.js';
import { PaintNameDialog } from '../garage/ui/PaintNameDialog.js';
import { PartDetail } from '../garage/ui/PartDetail.js';
import { PartList, useListedParts } from '../garage/ui/PartList.js';
import { PartTools } from '../garage/ui/PartTools.js';
import { TopBar } from '../garage/ui/TopBar.js';
import { Workbench } from '../garage/ui/Workbench.js';
import { useBuildPreview, useBuildStats } from '../garage/ui/useBuildStats.js';
import type { GameManifests } from '../game/assets.js';

type Overlay = 'leave' | 'reset' | 'paint' | 'quick' | 'blueprints' | 'more' | null;
type Line = { tone: 'ok' | 'warn' | 'error'; text: string; key: string };

const STEP_CATEGORIES = ['chassis', 'tires', 'weapon'] as const;
type Step = (typeof STEP_CATEGORIES)[number];

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
  const wide = width >= 1100 && width > height;
  // On the narrowest landscape phones the three secondary actions fold into one menu, so the
  // indicators keep their numbers and Ready keeps its size.
  const folded = width < 740 && width > height;

  const blueprint = session.history.present;
  const locked = session.phase === 'locked';
  const [overlay, setOverlay] = useState<Overlay>(null);
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

  // The locked car, and only the locked car, goes to the race.
  const lockedCar = session.locked;
  const lockReason = session.lockReason;
  useEffect(() => {
    if (!lockedCar) return;
    setOverlay(null);
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

  const listed = useListedParts(session, blueprint, manifests);
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
  const flaggedCategories = useMemo(() => {
    const set = new Set<PartCategory>();
    for (const issue of errors) {
      if (issue.slot === 'chassis' || issue.slot === 'engine' || issue.slot === 'tires')
        set.add(issue.slot);
      const def = issue.partId ? own(CATALOG.parts, issue.partId) : undefined;
      if (def) set.add(def.category);
    }
    return set;
  }, [errors]);

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
  else if (urgent) line = { tone: 'warn', text: STRINGS.garage.tenSeconds, key: 'ten' };
  else if (notice) line = { tone: notice.tone, text: notice.text, key: `n${notice.stamp}` };
  else if (blocking) line = { tone: 'error', text: issueText(blocking), key: 'blocked' };
  else if (!drawable) line = { tone: 'error', text: STRINGS.garage.artInProgressNote, key: 'art' };
  else line = { tone: 'ok', text: STRINGS.garage.readyToRace, key: 'ready' };

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
  const steps = coaching
    ? Object.fromEntries(
        STEP_CATEGORIES.map((id, index) => [
          id,
          { number: index + 1, done: done[id], label: STRINGS.garage.tips[id] },
        ]),
      )
    : {};

  // --- Presses -------------------------------------------------------------------------------
  const pickCategory = useCallback(
    (category: PartCategory) => garageStore.getState().setCategory(category),
    [],
  );

  const stepFocus = (direction: 1 | -1) => {
    if (!focused) return;
    const open = listed.filter((entry) => !entry.pending);
    const at = open.findIndex((entry) => entry.part.id === focused.id);
    const next = open[(at + direction + open.length) % open.length];
    if (next) actions.focusPart(next.part.id);
  };

  const ready = () => {
    if (!drawable) return;
    completeMilestone(MILESTONE_GARAGE_TIPS);
    actions.ready();
  };

  // Focus follows the panes for keyboard and switch users. Opening a card moves focus to its
  // buy button; closing it returns to the card; a fresh install lands on the part's marker,
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
        focus(`.mount[data-instance="${selectedId}"]`);
      else focus(`.part-card[data-part="${before.part}"]`);
    }
  }, [focusId, selectedId]);

  // Keyboard: undo and redo, and Escape to back out one level.
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (overlayRef.current !== null) return;
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
        else if (current && current.selection.kind !== 'none') store.clearSelection();
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
      parts.find((p) => p.def.id === focused.id) ??
      null)
    : null;

  const filterMountId = targetMountFor(session);
  const list = (
    <PartList
      manifests={manifests}
      blueprint={blueprint}
      category={session.category}
      parts={listed}
      focusPartId={session.focusPartId}
      filterMountId={filterMountId}
      onFocus={actions.focusPart}
      onClearFilter={actions.clearSelection}
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
      onRotate={() => actions.rotate(selectedPart.instance.instanceId)}
      onFire={(slot) => actions.setFire(selectedPart.instance.instanceId, slot)}
      onRemove={() => actions.remove(selectedPart.instance.instanceId)}
    />
  ) : null;

  const readyBlocked = blocking !== null || !drawable;
  const canRepair = blocking !== null && !notice && !dragIssue && !urgent && !locked;

  return (
    <main className={`screen garage${wide ? ' is-wide' : ''}${height < 470 ? ' is-short' : ''}`}>
      <h1 className="visually-hidden">{STRINGS.garage.title}</h1>
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
      />
      <CategoryRail
        category={session.category}
        flagged={flaggedCategories}
        steps={steps}
        onPick={pickCategory}
      />
      <div className="g-stage">
        <Workbench
          manifests={manifests}
          blueprint={blueprint}
          selection={session.selection}
          targetMountId={focused ? (plan?.mountId ?? null) : null}
          flagged={flaggedParts}
          locked={locked}
          onTapMount={actions.tapMount}
          onSelectInstance={actions.selectInstance}
          onMove={actions.moveTo}
          onNudge={actions.nudge}
          onRotate={actions.rotate}
          onRemove={actions.remove}
          onClearSelection={actions.clearSelection}
          onOpenPaint={() => setOverlay('paint')}
          onDragIssue={setDragIssue}
        />
        <p
          className={`g-status tone-${line.tone}${canRepair ? ' has-action' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="garage-status"
          data-tone={line.tone}
        >
          <Glyph name={line.tone === 'ok' ? 'check' : 'warn'} size={12} />
          <span key={line.key}>{line.text}</span>
          {canRepair ? (
            <button className="btn btn-small g-repair" onClick={actions.repair}>
              {STRINGS.garage.repair}
            </button>
          ) : (
            <span className="g-status-name" aria-hidden="true" data-testid="car-name">
              {blueprint.name}
            </span>
          )}
        </p>
      </div>
      <div className="g-side">
        {coaching && (
          <aside className="g-coach" aria-label={STRINGS.garage.tips.title}>
            <div className="g-coach-steps">
              {STEP_CATEGORIES.map((id, index) => (
                <button
                  key={id}
                  type="button"
                  className={`chip g-coach-step${done[id] ? ' is-done' : ''}`}
                  onClick={() => pickCategory(id)}
                >
                  <span className="g-step-number">
                    {done[id] ? <Glyph name="check" size={12} /> : index + 1}
                  </span>
                  {STRINGS.garage.tips[id]}
                </button>
              ))}
            </div>
            <div className="g-coach-actions">
              <button
                className="btn btn-small"
                onClick={() => {
                  actions.load(ROOKIE_BLUEPRINT, STRINGS.garage.starterLoaded);
                  completeMilestone(MILESTONE_GARAGE_TIPS);
                }}
              >
                {STRINGS.garage.tips.useStarter}
              </button>
              <button
                className="btn btn-small btn-quiet"
                onClick={() => completeMilestone(MILESTONE_GARAGE_TIPS)}
              >
                {STRINGS.garage.tips.skip}
              </button>
            </div>
          </aside>
        )}
        <div className="g-panes">
          {wide ? (
            <>
              {list}
              {detail ?? tools ?? (
                <section className="g-detail is-empty">
                  <Glyph name={session.category} size={36} />
                  <p>{STRINGS.garage.detailEmpty}</p>
                  <p className="dim">{STRINGS.garage.tapMount}</p>
                </section>
              )}
            </>
          ) : (
            (detail ?? tools ?? list)
          )}
        </div>
      </div>
      <footer className="g-bottom">
        <IndicatorBar stats={stats} />
        {folded ? (
          <button
            className="btn btn-small g-more"
            onClick={() => setOverlay('more')}
            disabled={locked}
            aria-haspopup="dialog"
          >
            {STRINGS.garage.more}
          </button>
        ) : (
          <>
            <button className="btn btn-small" onClick={() => setOverlay('reset')} disabled={locked}>
              {STRINGS.garage.reset}
            </button>
            <button
              className="btn btn-small"
              onClick={() => setOverlay('blueprints')}
              disabled={locked}
              aria-label={`${STRINGS.garage.save}: ${STRINGS.blueprints.title}`}
            >
              {STRINGS.garage.save}
            </button>
            <button className="btn btn-small" onClick={() => setOverlay('quick')} disabled={locked}>
              {STRINGS.garage.quickBuild}
            </button>
          </>
        )}
        <button
          className="btn btn-primary g-ready"
          onClick={ready}
          aria-disabled={readyBlocked || locked}
          aria-describedby="g-ready-why"
          data-testid="ready"
        >
          {STRINGS.garage.ready}
        </button>
        <span id="g-ready-why" className="visually-hidden">
          {readyBlocked ? line.text : STRINGS.garage.readyToRace}
        </span>
      </footer>

      {urgent && (
        <p className="visually-hidden" role="alert">
          {STRINGS.garage.tenSeconds}
        </p>
      )}

      {overlay === 'more' && (
        <Dialog
          title={STRINGS.garage.more}
          onClose={() => setOverlay(null)}
          className="dialog g-more-menu"
          hideTitle
        >
          <button className="btn" onClick={() => setOverlay('reset')}>
            {STRINGS.garage.reset}
          </button>
          <button
            className="btn"
            onClick={() => setOverlay('blueprints')}
            aria-label={`${STRINGS.garage.save}: ${STRINGS.blueprints.title}`}
          >
            {STRINGS.garage.save}
          </button>
          <button className="btn" onClick={() => setOverlay('quick')}>
            {STRINGS.garage.quickBuild}
          </button>
          <button className="btn" onClick={() => setOverlay('paint')}>
            {STRINGS.garage.paintAndName}
          </button>
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
