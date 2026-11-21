export interface DispatchWeights {
  proximity: number;
  skillMatch: number;
  rating: number;
  warrantyClaimRate: number;
}

export interface ScoringCandidate {
  distanceMeters: number;
  skills: string[];
  rating: number;
  ratingCount: number;
  warrantyClaimRate: number;
}

export interface CandidateScore {
  score: number;
  scoreBreakdown: {
    proximity: number;
    skillMatch: number;
    rating: number;
    warrantyClaimRate: number;
  };
}

/**
 * Pure weighted candidate scoring (PlatformConfig['dispatch.offer'].weights).
 * Every sub-score lives on a 0..100 scale:
 *   proximity         — linear falloff to zero at the search radius edge
 *   skillMatch        — share of the order's required skills the tech holds
 *   rating            — normalized rating; brand-new techs (no reviews) get a
 *                       neutral 70 so they are not starved by the algorithm
 *   warrantyClaimRate — low claim rate = high score
 */
export function scoreCandidate(
  candidate: ScoringCandidate,
  requiredSkills: string[],
  weights: DispatchWeights,
  maxRadiusMeters: number,
): CandidateScore {
  const proximity = Math.max(0, 100 * (1 - candidate.distanceMeters / Math.max(1, maxRadiusMeters)));
  const matchedCount = requiredSkills.filter((skill) =>
    candidate.skills.includes(skill),
  ).length;
  const skillMatch = requiredSkills.length > 0 ? (matchedCount / requiredSkills.length) * 100 : 100;
  const rating =
    candidate.ratingCount > 0 ? (Number(candidate.rating) / 5) * 100 : 70;
  const warrantyClaimRate = Math.max(0, (1 - Number(candidate.warrantyClaimRate)) * 100);

  const score =
    weights.proximity * proximity +
    weights.skillMatch * skillMatch +
    weights.rating * rating +
    weights.warrantyClaimRate * warrantyClaimRate;

  return {
    score: Math.round(score * 100) / 100,
    scoreBreakdown: {
      proximity: Math.round(proximity * 100) / 100,
      skillMatch: Math.round(skillMatch * 100) / 100,
      rating: Math.round(rating * 100) / 100,
      warrantyClaimRate: Math.round(warrantyClaimRate * 100) / 100,
    },
  };
}
