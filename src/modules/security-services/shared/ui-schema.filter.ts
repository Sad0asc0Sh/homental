import type { LocationType } from '@prisma/client';
import { asUiSchema, type UiSchemaLike } from './ui-schema.types';

/**
 * Removes any `uiSchema` field / goal card whose optional `locationTypes[]`
 * exclude the requested location — the schema-driven way to show a
 * shop-only "panic button" only to shops and plate-reading questions only to
 * parking owners (Invariant 3: zero hard-coded service branching).
 */
export function filterUiSchemaForLocation(
  uiSchema: unknown,
  locationType: LocationType,
): UiSchemaLike {
  const schema = asUiSchema(uiSchema);

  const steps = (schema.steps ?? []).map((step) => ({
    ...step,
    fields: (step.fields ?? []).filter(
      (field) => !field.locationTypes || field.locationTypes.includes(locationType),
    ),
  }));

  const filtered: UiSchemaLike = { ...schema, steps };

  if (schema.goalCards) {
    filtered.goalCards = {
      ...schema.goalCards,
      cards: (schema.goalCards.cards ?? []).filter(
        (card) => !card.locationTypes || card.locationTypes.includes(locationType),
      ),
    };
  }
  return filtered;
}
