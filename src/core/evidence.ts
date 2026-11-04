import {
  EVIDENCE_RULE_VERSION,
  EVIDENCE_RULE_VERSION_V2,
  KNOWN_EVIDENCE_RULE_VERSIONS,
} from './versions.ts';
import {
  EVIDENCE_RELATIONS,
  type AssessmentMethod,
  type EvidenceRelation,
  type PropositionStatus,
  type SourceIndependence,
  type SourceType,
} from './vocabulary.ts';

export interface EvidenceRelationshipRecord {
  readonly id: string;
  readonly relation: EvidenceRelation;
  readonly sourceId: string;
  readonly sourceType: SourceType;
  readonly independence: SourceIndependence;
}

export type EvidenceRelationCounts = Record<EvidenceRelation, number>;

/** A rule version this build knows how to compute. */
export type EvidenceRuleVersion = (typeof KNOWN_EVIDENCE_RULE_VERSIONS)[number];

export interface DerivedEvidenceStatus {
  readonly status: PropositionStatus;
  readonly rationale: string;
  readonly ruleVersion: string;
  readonly counts: EvidenceRelationCounts;
  readonly sourceCount: number;
  readonly supportingSourceCount: number;
  /**
   * Present only under `evidence-aggregation-v2` when the two rules disagree: the number of distinct
   * supporting sources a `v1` report would have counted, before related/syndicated copies were
   * collapsed. It lets a reader see that the corroboration figure was reduced, rather than silently
   * showing a smaller one.
   */
  readonly apparentCorroboratingSourceCount?: number;
  readonly notes: readonly string[];
}

function emptyCounts(): EvidenceRelationCounts {
  const counts = {} as EvidenceRelationCounts;
  for (const relation of EVIDENCE_RELATIONS) {
    counts[relation] = 0;
  }
  return counts;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function deriveEvidenceStatus(
  relationships: readonly EvidenceRelationshipRecord[],
  ruleVersion: string = EVIDENCE_RULE_VERSION,
): DerivedEvidenceStatus {
  if (!(KNOWN_EVIDENCE_RULE_VERSIONS as readonly string[]).includes(ruleVersion)) {
    throw new Error(
      `deriveEvidenceStatus: unknown evidence rule version "${ruleVersion}". ` +
        `Known rule versions: ${KNOWN_EVIDENCE_RULE_VERSIONS.join(', ')}.`,
    );
  }
  const isV2 = ruleVersion === EVIDENCE_RULE_VERSION_V2;
  const counts = emptyCounts();
  // v1 counts every distinct supporting sourceId; v2 counts only those the reviewer did not mark
  // RELATED, because a related or syndicated copy of material the reviewer already holds cannot
  // independently corroborate it. `allSupportingSources` is kept for both rules so the disclosure
  // note and the v1-vs-v2 divergence can name how many sources a v1 report would have shown.
  const allSupportingSources = new Set<string>();
  const independentSupportingSources = new Set<string>();
  const allSources = new Set<string>();
  const notes: string[] = [];

  for (const relationship of relationships) {
    counts[relationship.relation] += 1;
    allSources.add(relationship.sourceId);
    if (relationship.relation === 'SUPPORTS') {
      allSupportingSources.add(relationship.sourceId);
      if (relationship.independence !== 'RELATED') {
        independentSupportingSources.add(relationship.sourceId);
      }
    }
  }

  const supports = counts.SUPPORTS;
  const contradicts = counts.CONTRADICTS;
  const qualifies = counts.QUALIFIES;
  const unavailable = counts.UNAVAILABLE;
  const contextual = counts.CONTEXTUALIZES;
  const doesNotAddress = counts.DOES_NOT_ADDRESS;
  const sourceCount = allSources.size;
  const supportingSourceCount = isV2
    ? independentSupportingSources.size
    : allSupportingSources.size;
  // The v1-vs-v2 divergence only exists under v2, and only when a related/syndicated record was
  // collapsed away. When the two rules agree, no divergence field is emitted at all.
  const corroborationCollapsed =
    isV2 && supports > 0 && allSupportingSources.size > independentSupportingSources.size;

  let status: PropositionStatus;
  if (relationships.length === 0) {
    status = 'NOT_ASSESSED';
  } else if (supports > 0 && contradicts > 0) {
    status = 'CONFLICTING_EVIDENCE';
  } else if (contradicts > 0) {
    status = 'CONTRADICTED';
  } else if (supports > 0 && qualifies > 0) {
    status = 'PARTIALLY_SUPPORTED';
  } else if (supports > 0) {
    status = 'SUPPORTED_WITHIN_SCOPE';
  } else if (qualifies > 0) {
    status = 'PARTIALLY_SUPPORTED';
  } else if (unavailable > 0 && contextual + doesNotAddress === 0) {
    status = 'UNAVAILABLE';
  } else if (contextual + doesNotAddress + unavailable === relationships.length) {
    status = 'INSUFFICIENT_EVIDENCE';
  } else {
    status = 'INSUFFICIENT_EVIDENCE';
  }

  if (relationships.length === 0) {
    notes.push('No evidence relationships have been recorded for this proposition.');
  }
  if (supports > 0 && contradicts > 0) {
    notes.push(
      'Supporting and contradictory evidence coexist. The conflict remains unresolved unless a human assessment documents an adjudication.',
    );
  }
  if (qualifies > 0 && contradicts > 0) {
    notes.push(
      'Qualifying evidence and contradictory evidence are both present; review the stated scope.',
    );
  }
  if (unavailable > 0) {
    notes.push(
      `${plural(unavailable, 'relationship')} could not be inspected reliably and ${
        unavailable === 1 ? 'was' : 'were'
      } not counted as support or contradiction.`,
    );
  }
  if (contextual + doesNotAddress > 0) {
    notes.push(
      `${plural(contextual + doesNotAddress, 'relationship')} contextualized or did not address the proposition and did not contribute to the status.`,
    );
  }
  // This disclosure is about literal duplicate source ids, so it reads against the all-source count
  // under both rules (identical to `v1`, which never collapsed anything). The v2 independence
  // collapse is disclosed separately below, so the two mechanisms do not overwrite each other.
  if (supports > 0 && supports > allSupportingSources.size) {
    notes.push(
      `${plural(supports, 'supporting relationship')} reference ${plural(
        allSupportingSources.size,
        'distinct source',
      )}. Duplicate or syndicated material does not create independent corroboration.`,
    );
  }
  if (supports > 0) {
    const supportingRelationships = relationships.filter((r) => r.relation === 'SUPPORTS');
    const allSelfPublished = supportingRelationships.every(
      (r) => r.sourceType === 'SELF_PUBLISHED' || r.independence === 'SELF_PUBLISHED',
    );
    if (allSelfPublished) {
      notes.push(
        'All recorded supporting evidence is self-published or affiliated. No independent corroboration is recorded.',
      );
    }
    const unknownIndependence = supportingRelationships.filter(
      (r) => r.independence === 'UNKNOWN',
    ).length;
    if (unknownIndependence > 0) {
      notes.push(
        `Independence is unknown for ${plural(unknownIndependence, 'supporting relationship')}.`,
      );
    }
    // `evidence-aggregation-v2` (ADR-025): a supporting record the reviewer marked RELATED is not an
    // independent corroborating source. The status is unchanged; the corroboration figure and this
    // disclosure are what move, so a reader can see the reduction rather than a silently smaller one.
    if (corroborationCollapsed) {
      notes.push(
        `Corroboration is counted by underlying source: ${plural(
          allSupportingSources.size,
          'distinct source',
        )} would count as corroboration under the previous rule, but ${plural(
          independentSupportingSources.size,
          'independent source',
        )} remain once material recorded as related or syndicated is excluded.`,
      );
    }
    if (isV2 && independentSupportingSources.size === 0 && allSupportingSources.size > 0) {
      notes.push(
        'No independent corroboration is recorded: every supporting source was marked related or syndicated, so the support rests on material the reviewer does not treat as independent.',
      );
    }
  }
  if (sourceCount === 0 && relationships.length > 0) {
    notes.push('No distinct source records were linked.');
  }
  notes.push(
    'This rule summarizes human-recorded relationships; it does not independently verify the sources or the proposition.',
  );

  const rationaleParts: string[] = [];
  if (supports > 0) {
    rationaleParts.push(
      `${plural(supports, 'supporting relationship')} across ${plural(
        supportingSourceCount,
        'distinct source',
      )}`,
    );
  }
  if (contradicts > 0) {
    rationaleParts.push(`${plural(contradicts, 'contradicting relationship')}`);
  }
  if (qualifies > 0) {
    rationaleParts.push(`${plural(qualifies, 'qualifying relationship')}`);
  }
  if (unavailable > 0) {
    rationaleParts.push(`${plural(unavailable, 'unavailable relationship')}`);
  }
  if (contextual + doesNotAddress > 0) {
    rationaleParts.push(
      `${plural(contextual + doesNotAddress, 'contextual or non-addressing relationship')}`,
    );
  }
  const rationale =
    rationaleParts.length === 0
      ? 'No evidence relationships have been recorded for this proposition.'
      : `${rationaleParts.join('; ')}.`;

  return {
    status,
    rationale,
    ruleVersion,
    counts,
    sourceCount,
    supportingSourceCount,
    ...(corroborationCollapsed
      ? { apparentCorroboratingSourceCount: allSupportingSources.size }
      : {}),
    notes,
  };
}

export interface RecordedPropositionAssessment {
  readonly id: string;
  readonly version: number;
  readonly label: PropositionStatus;
  readonly rationale: string;
  readonly method: AssessmentMethod;
  readonly reviewer: string;
  readonly createdAt: string;
}

export interface PropositionConclusion {
  readonly derived: DerivedEvidenceStatus;
  readonly humanAssessment: RecordedPropositionAssessment | null;
  readonly primary: {
    readonly status: PropositionStatus;
    readonly rationale: string;
    readonly method: AssessmentMethod;
    readonly version: string;
    readonly reviewer: string | null;
    readonly assessmentId: string | null;
  };
  readonly disagreement: boolean;
}

export function resolvePropositionConclusion(
  derived: DerivedEvidenceStatus,
  assessments: readonly RecordedPropositionAssessment[],
): PropositionConclusion {
  const humanAssessments = assessments.filter((assessment) => assessment.method === 'HUMAN');
  const latest = humanAssessments.reduce<RecordedPropositionAssessment | null>(
    (current, candidate) => {
      if (current === null || candidate.version > current.version) {
        return candidate;
      }
      return current;
    },
    null,
  );

  if (latest === null) {
    return {
      derived,
      humanAssessment: null,
      primary: {
        status: derived.status,
        rationale: derived.rationale,
        method: 'RULE',
        version: derived.ruleVersion,
        reviewer: null,
        assessmentId: null,
      },
      disagreement: false,
    };
  }

  return {
    derived,
    humanAssessment: latest,
    primary: {
      status: latest.label,
      rationale: latest.rationale,
      method: 'HUMAN',
      version: `proposition-assessment-v${latest.version}`,
      reviewer: latest.reviewer,
      assessmentId: latest.id,
    },
    disagreement: latest.label !== derived.status,
  };
}
