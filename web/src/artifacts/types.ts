import type { Artifact, ArtifactType } from '@teca/shared';
import type { ReactNode } from 'react';

export interface ArtifactViewProps {
  artifact: Artifact;
  selected: boolean;
  /** Persist a props patch (merged server-side). */
  onPatch: (props: Record<string, unknown>) => void;
}

export interface ArtifactDefinition {
  type: ArtifactType;
  label: string;
  /** Single glyph used in the toolbar and headers. */
  glyph: string;
  render: (props: ArtifactViewProps) => ReactNode;
}

export type ArtifactRegistry = Record<ArtifactType, ArtifactDefinition>;
