import { stepDriveSession } from '@bolt/shared';
import type { CameraView } from '../../apps/web/src/game/rendering/frame.js';
import { RenderPipeline } from '../../apps/web/src/game/rendering/frame.js';
import type { BenchPipeline, BenchWorld, PipelineFrame } from './pacing.js';

/**
 * Wraps the shipped render pipeline for the pacing bench: the same begin, step, finish
 * sequence the race scene runs, with the simulation supplied by the bench world.
 */
export function shippedPipeline(world: BenchWorld, view: CameraView): BenchPipeline {
  const pipeline = new RenderPipeline();
  pipeline.configure(view);
  const session = world.session;
  const m = session.motion;
  const pose = () => ({ x: m.x, y: m.y, heading: m.headingRad, vx: m.velocityX, vy: m.velocityY });
  pipeline.place(pose());
  const s = view.scale;
  return {
    frame(timestampMs: number): PipelineFrame {
      const steps = pipeline.begin(timestampMs, false);
      for (let i = 0; i < steps; i++) {
        stepDriveSession(session, world.control());
        pipeline.push(pose());
      }
      const out = pipeline.finish(0, 0, 0, 0);
      const scrollX = out.scrollX;
      const scrollY = out.scrollY;
      // Exactly what the scene's camera does with these numbers: (world - scroll) * scale.
      const project = (wx: number, wy: number) => ({ x: (wx - scrollX) * s, y: (wy - scrollY) * s });
      const car = project(out.carX, out.carY);
      const ex = pipeline.camera.exactScrollPxX + pipeline.camera.shakePxX;
      const ey = pipeline.camera.exactScrollPxY + pipeline.camera.shakePxY;
      const projectExact = (wx: number, wy: number) => ({ x: wx * s - ex, y: wy * s - ey });
      const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;
      return {
        car,
        render: { x: out.pose.x, y: out.pose.y },
        project,
        projectExact,
        carExact: projectExact(out.pose.x, out.pose.y),
        aligned: whole(scrollX * s) && whole(scrollY * s) && whole(car.x) && whole(car.y),
        headingFrame: pipeline.latch.index,
      };
    },
  };
}
