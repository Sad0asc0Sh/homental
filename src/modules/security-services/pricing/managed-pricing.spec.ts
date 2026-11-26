import { BadRequestException } from '@nestjs/common';
import { computeServicePackage, toSliderView } from './managed-pricing';

describe('Phase 11B bargaining bounds and settlement', () => {
  it.each([
    [-1500, 4_080_000n],
    [0, 4_800_000n],
    [500, 5_040_000n],
    [2500, 6_000_000n],
  ])('prices a CCTV slider of %d bps with zero drift', (sliderBps, price) => {
    const result = computeServicePackage(3_120_000n, 90_000n, 20_000n, 1000n, 0n, sliderBps);
    expect(result).toMatchObject({ basePrice: 4_800_000n, price, minDeltaBps: -1500, maxDeltaBps: 2500 });
    const { technicianPackageNet, commission, reserve, freight, allowance } = result;
    expect(reserve).toBe(price / 20n);
    expect(price).toBe(technicianPackageNet + commission + reserve + freight + allowance);
    expect(toSliderView(result, 500)).toMatchObject({ dispatchAudience: sliderBps >= 500 ? 'TOP' : 'ALL' });
  });

  it('allows -15% on the two-service bundle and rounds the three-service floor up to -10%', () => {
    const dual = computeServicePackage(7_000_000n, 180_000n, 87_500n, 1000n, 600n, -1500);
    const triple = computeServicePackage(13_550_000n, 400_000n, 585_000n, 1000n, 1000n, -1000);
    expect(dual).toMatchObject({ minDeltaBps: -1500, price: 8_629_200n });
    expect(triple).toMatchObject({ minDeltaBps: -1000, price: 17_496_000n });
    for (const { price, technicianPackageNet, commission, reserve, freight, allowance } of [dual, triple]) {
      expect(price).toBe(technicianPackageNet + commission + reserve + freight + allowance);
    }
    expect(() => computeServicePackage(13_550_000n, 400_000n, 585_000n, 1000n, 1000n, -1100))
      .toThrow(BadRequestException);
  });

  it.each([-1600, 499, 2550, 2600, 200.5])('rejects slider %d bps with a Persian 400', (sliderBps) => {
    expect(() => computeServicePackage(3_120_000n, 90_000n, 20_000n, 1000n, 0n, sliderBps))
      .toThrow(/تنظیم بسته/);
  });

  it('rounds the customer package and reserves down at sub-Toman precision', () => {
    const result = computeServicePackage(3_120_001n, 90_002n, 20_003n, 1000n, 0n, 500);
    expect(result.price).toBe(result.basePrice * 10_500n / 10_000n);
    const { price, reserve, technicianPackageNet, commission, freight, allowance } = result;
    expect(reserve).toBe(price / 20n);
    expect(price).toBe(technicianPackageNet + commission + reserve + freight + allowance);
  });
});
