import type { PartCard } from '@bolt/content';
import { CATALOG, STRINGS } from '@bolt/content';
import type { AnyPartDefinition, MountPoint } from '@bolt/shared';
import { accessoryMounts } from '@bolt/shared';
import type { ReactNode } from 'react';
import { Glyph } from '../../components/Glyph.js';
import type { GlyphName } from '../../components/glyphs.js';
import { compactNumber, fill } from '../text.js';

export type Fact = { glyph: GlyphName; text: string; label: string };

/** The mandatory figures of a part card (Section 5.6), as short labelled facts. */
export function partFacts(part: AnyPartDefinition, card: PartCard): Fact[] {
  const g = STRINGS.garage;
  const facts: Fact[] = [
    {
      glyph: 'weight',
      text: fill(g.weight, { kg: compactNumber(card.massKg) }),
      label: g.weightLabel,
    },
  ];
  if (part.category === 'chassis') {
    facts.push({
      glyph: 'balance',
      text: fill(g.chassisLoad, { kg: part.maxLoadKg }),
      label: g.loadLabel,
    });
    facts.push({
      glyph: 'plus',
      text: fill(g.chassisMounts, { count: accessoryMounts(part).length }),
      label: g.mounts,
    });
    // Four wheels is the norm; the three- and six-wheel frames say so.
    if (part.wheelCount !== 4)
      facts.push({
        glyph: 'tires',
        text: fill(g.chassisWheels, { count: part.wheelCount }),
        label: g.categories.tires,
      });
    return facts;
  }
  const power = card.powerPerSecond;
  facts.push({
    glyph: 'bolt',
    text:
      power > 0
        ? fill(g.energyDraw, { value: compactNumber(power) })
        : power < 0
          ? fill(g.energyOutput, { value: compactNumber(-power) })
          : g.energyNone,
    label: g.energyLabel,
  });
  if (part.category !== 'tires') {
    const heat = card.heatPerSecond;
    facts.push({
      glyph: 'flame',
      text:
        heat > 0
          ? fill(g.heatUp, { value: compactNumber(heat) })
          : heat < 0
            ? fill(g.heatDown, { value: compactNumber(-heat) })
            : g.heatNone,
      label: g.heatLabel,
    });
  }
  if (part.category === 'tires')
    facts.push({
      glyph: 'tires',
      text: fill(g.tireGrip, { value: part.grip.toFixed(2) }),
      label: STRINGS.preview.grip,
    });
  if (part.category === 'engine')
    facts.push({
      glyph: 'engine',
      text: fill(g.engineForce, { value: part.forceIndex }),
      label: g.scores.speed,
    });
  return facts;
}

export function FactRow({ facts }: { facts: Fact[] }) {
  return (
    <span className="facts">
      {facts.map((fact) => (
        <span key={fact.label} className="fact" title={fact.label}>
          <Glyph name={fact.glyph} size={12} />
          <span className="visually-hidden">{fact.label}: </span>
          {fact.text}
        </span>
      ))}
    </span>
  );
}

export function findMountOf(chassisId: string, mountId: string | null): MountPoint | null {
  if (mountId === null) return null;
  return CATALOG.chassis[chassisId]?.mounts.find((m) => m.id === mountId) ?? null;
}

export function Credits({ value, children }: { value: number; children?: ReactNode }) {
  return (
    <span className="credits">
      <Glyph name="coin" size={12} />
      {value.toLocaleString('en-US')}
      {children}
    </span>
  );
}
