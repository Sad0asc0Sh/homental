import { BadRequestException } from '@nestjs/common';
import { SupplyMode } from '@prisma/client';
import { serviceDefinitions } from '../../../../prisma/seed';
import { JsonLogicEvaluator } from '../shared/json-logic.evaluator';
import { PricingSchemaInterpreter } from './pricing-schema.interpreter';

const interpreter = new PricingSchemaInterpreter(new JsonLogicEvaluator());

function schemaOf(key: string): unknown {
  const definition = serviceDefinitions.find((d) => d.key === key);
  if (!definition) throw new Error(`${key} seed missing`);
  return definition.pricingSchema;
}

function interpret(
  key: string,
  config: Record<string, unknown>,
  supplyMode: SupplyMode = SupplyMode.FULL_PACKAGE,
) {
  return interpreter.interpret({
    serviceKey: key,
    pricingSchema: schemaOf(key),
    config,
    supplyMode,
  });
}

describe('PricingSchemaInterpreter — CCTV', () => {
  const result = interpret('CCTV', {
    cameraCount: 4,
    cameraQuality: 'STANDARD_4MP',
    storageDays: 30,
    nightPlate: true,
    remoteView: true,
  });

  it('computes 4 cameras × quality price, DVR channels, 2 HDDs (30 days) and the plate camera', () => {
    expect(result.hardwareSubtotal).toBe(44_500_000n); // 16.4M + 7.5M + 9.6M + 9.8M + 1.2M
    const refs = result.hardwareLines.map((line) => line.ref);
    expect(refs).toEqual(['CAM', 'DVR', 'HDD', 'PLATE_CAM', 'CABLE_KIT']);
    const hdd = result.hardwareLines.find((line) => line.ref === 'HDD');
    expect(hdd?.qty).toBe(2); // storageDays >= 30 → two drives
    // Zero-quantity lines (COLOR_NIGHT / AUDIO_MODULE off) are excluded.
    expect(refs).not.toContain('COLOR_NIGHT');
  });

  it('computes labor with per-unit cameras + remoteView flat line', () => {
    expect(result.laborSubtotal).toBe(2_720_000n); // 450k + 4×480k + 350k
    expect(result.dispatchFee).toBe(180_000n);
  });
});

describe('PricingSchemaInterpreter — ELECTRIC_SHUTTER (area > 8 m², remote clamp)', () => {
  const result = interpret('ELECTRIC_SHUTTER', {
    widthCm: 300,
    heightCm: 300,
    remoteCount: 0,
  });

  it('selects the 32M heavy-duty motor via unitPriceLogic (9 m² > 8 m²)', () => {
    // BLADE 9 × 2.6M = 23.4M + MOTOR 32M = 55.4M
    expect(result.hardwareSubtotal).toBe(55_400_000n);
    const motor = result.hardwareLines.find((line) => line.ref === 'MOTOR');
    expect(motor?.unitPrice).toBe(32_000_000);
  });

  it('REMOTE qty clamps to 0 and NEVER subtracts from the quote', () => {
    expect(result.hardwareLines.find((line) => line.ref === 'REMOTE')).toBeUndefined();
    expect(result.hardwareSubtotal).toBeGreaterThan(55_000_000n); // sanity: no negative line
  });

  it('applies the >8 m² complexity multiplier 1.15 to labor', () => {
    expect(result.laborSubtotal).toBe(3_220_000n); // 2.8M × 1.15
    expect(result.appliedComplexities).toEqual([
      expect.objectContaining({ multiplier: 1.15 }),
    ]);
    expect(result.dispatchFee).toBe(220_000n);
  });
});

describe('PricingSchemaInterpreter — PARKING_JACK (compound complexities)', () => {
  const result = interpret('PARKING_JACK', {
    jackType: 'HYDRAULIC',
    electricLock: true,
    usagePerDay: 40,
  });

  it('prices the hydraulic jack + electric lock + frame per meter', () => {
    // 118M + 4×3.2M frame + 6.5M lock + 9.5M battery + 0.9M extra remote = 147.7M
    expect(result.hardwareSubtotal).toBe(147_700_000n);
    const jack = result.hardwareLines.find((line) => line.ref === 'JACK_UNIT');
    expect(jack?.unitPrice).toBe(118_000_000);
    const remote = result.hardwareLines.find((line) => line.ref === 'REMOTE');
    expect(remote?.qty).toBe(1); // remoteCount 2 → one extra remote beyond the bundled one
  });

  it('chains 1.3 × 1.05 × 1.1 complexity multipliers on labor', () => {
    // 3.5M × 1.3 = 4.55M × 1.05 = 4,777,500 × 1.1 = 5,255,250
    expect(result.laborSubtotal).toBe(5_255_250n);
    expect(result.appliedComplexities.map((c) => c.multiplier)).toEqual([1.3, 1.05, 1.1]);
    expect(result.dispatchFee).toBe(250_000n);
  });
});

describe('PricingSchemaInterpreter — ALARM (unitPriceLogic via petImmune)', () => {
  const result = interpret('ALARM', { petImmune: true });

  it('prices the pet-immune motion sensor at 1.85M', () => {
    // 6.8M + 2×0.85M + 2×0.78M + 1.85M + 1.45M + 3.2M = 16.56M
    expect(result.hardwareSubtotal).toBe(16_560_000n);
    const motion = result.hardwareLines.find((line) => line.ref === 'MOTION_SENSOR');
    expect(motion?.unitPrice).toBe(1_850_000);
  });

  it('bills per-unit sensors beyond the included count', () => {
    expect(result.laborSubtotal).toBe(1_550_000n); // 650k + 5 × 180k
    expect(result.dispatchFee).toBe(180_000n);
  });
});

describe('PricingSchemaInterpreter — guards', () => {
  it('rejects an invalid chip option with a Persian 400', () => {
    expect(() => interpret('CCTV', { cameraQuality: 'GOLD_8K' })).toThrow(BadRequestException);
    try {
      interpret('CCTV', { cameraQuality: 'GOLD_8K' });
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body['message']).toContain('معتبر نیست');
    }
  });

  it('INSTALL_ONLY drops hardware but keeps labor + dispatch (Invariant 7)', () => {
    const result = interpret('ALARM', { petImmune: true }, SupplyMode.INSTALL_ONLY);
    expect(result.hardwareDropped).toBe(true);
    expect(result.hardwareLines).toEqual([]);
    expect(result.hardwareSubtotal).toBe(0n);
    expect(result.laborSubtotal).toBe(1_550_000n);
    expect(result.dispatchFee).toBe(180_000n);
  });

  it('rejects a schema that dares to apply dynamic factors to hardware (Invariant 2 guard)', () => {
    const mutated = {
      ...(schemaOf('CCTV') as object),
      multipliersApplyTo: ['labor', 'dispatch', 'hardware'],
    };
    expect(() =>
      interpreter.interpret({
        serviceKey: 'CCTV',
        pricingSchema: mutated,
        config: {},
        supplyMode: SupplyMode.FULL_PACKAGE,
      }),
    ).toThrow(BadRequestException);
  });
});
