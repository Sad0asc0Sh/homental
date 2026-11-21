import { scoreCandidate } from './candidate-scorer';

const WEIGHTS = { proximity: 0.35, skillMatch: 0.25, rating: 0.2, warrantyClaimRate: 0.2 };
const MAX_RADIUS = 20_000;

describe('candidate-scorer — weighted dispatch formula', () => {
  it('a lower-claim, better-matched technician outranks a slightly closer low-quality one', () => {
    const qualityTech = scoreCandidate(
      {
        distanceMeters: 4_000, // proximity 80
        skills: ['ALARM', 'CCTV'],
        rating: 4.9,
        ratingCount: 210,
        warrantyClaimRate: 0.01,
      },
      ['ALARM', 'CCTV'],
      WEIGHTS,
      MAX_RADIUS,
    );
    const closerSloppyTech = scoreCandidate(
      {
        distanceMeters: 1_000, // proximity 95
        skills: ['ALARM'], // half the required skills
        rating: 3.0,
        ratingCount: 50,
        warrantyClaimRate: 0.2,
      },
      ['ALARM', 'CCTV'],
      WEIGHTS,
      MAX_RADIUS,
    );

    expect(qualityTech.score).toBeGreaterThan(closerSloppyTech.score);
    expect(qualityTech.score).toBeCloseTo(92.4, 1);
    expect(closerSloppyTech.score).toBeCloseTo(73.75, 1);
  });

  it('gives brand-new technicians a neutral 70 rating score (no starvation)', () => {
    const rookie = scoreCandidate(
      { distanceMeters: 10_000, skills: ['ALARM'], rating: 0, ratingCount: 0, warrantyClaimRate: 0 },
      ['ALARM'],
      WEIGHTS,
      MAX_RADIUS,
    );
    expect(rookie.scoreBreakdown.rating).toBe(70);
  });

  it('maps warranty claim rate inversely onto 0..100', () => {
    const clean = scoreCandidate(
      { distanceMeters: 0, skills: ['ALARM'], rating: 5, ratingCount: 10, warrantyClaimRate: 0 },
      ['ALARM'],
      WEIGHTS,
      MAX_RADIUS,
    );
    const claimHeavy = scoreCandidate(
      { distanceMeters: 0, skills: ['ALARM'], rating: 5, ratingCount: 10, warrantyClaimRate: 0.5 },
      ['ALARM'],
      WEIGHTS,
      MAX_RADIUS,
    );
    expect(clean.scoreBreakdown.warrantyClaimRate).toBe(100);
    expect(claimHeavy.scoreBreakdown.warrantyClaimRate).toBe(50);
    expect(clean.score).toBeGreaterThan(claimHeavy.score);
  });

  it('clamps proximity at zero beyond the search radius', () => {
    const far = scoreCandidate(
      { distanceMeters: 30_000, skills: ['ALARM'], rating: 5, ratingCount: 10, warrantyClaimRate: 0 },
      ['ALARM'],
      WEIGHTS,
      MAX_RADIUS,
    );
    expect(far.scoreBreakdown.proximity).toBe(0);
  });

  it('a perfect candidate scores 100', () => {
    const perfect = scoreCandidate(
      { distanceMeters: 0, skills: ['ALARM', 'CCTV'], rating: 5, ratingCount: 10, warrantyClaimRate: 0 },
      ['ALARM', 'CCTV'],
      WEIGHTS,
      MAX_RADIUS,
    );
    expect(perfect.score).toBe(100);
  });
});
