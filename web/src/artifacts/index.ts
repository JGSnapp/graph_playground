import type { ArtifactType } from '@teca/shared';
import { ARTIFACT_DEFINITIONS } from './renderers';
import type { ArtifactDefinition, ArtifactRegistry } from './types';

export const ARTIFACT_REGISTRY: ArtifactRegistry = Object.fromEntries(
  ARTIFACT_DEFINITIONS.map((definition) => [definition.type, definition]),
) as ArtifactRegistry;

export const artifactDefinition = (type: ArtifactType): ArtifactDefinition =>
  ARTIFACT_REGISTRY[type] ?? ARTIFACT_REGISTRY.note;

export { ARTIFACT_DEFINITIONS };
export type { ArtifactDefinition, ArtifactViewProps } from './types';
