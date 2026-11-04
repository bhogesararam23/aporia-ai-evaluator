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
  /**
   * The source's canonical URI, when the reviewer recorded one. `evidence-aggregation-v2` uses it to
   * recognise two source records that are the same underlying material (ADR-025 §1 rule 1); `v1` and
   * every existing construction ignore it, so it is optional.
   */
  readonly canonicalUri?: string | null;
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

/**
 * Query parameters that carry distribution or campaign tracking rather than the identity of the
 * document. They are dropped before comparing canonical URIs, because the same story reached through
 * different tracking links is one underlying source. Only well-known tracking keys are removed, so a
 * meaningful query string is never normalised away.
 */
const TRACKING_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'vero_id',
  '_bto',
  '_hsenc',
  '_hsmi',
  's_kwcid',
  'ef_id',
  'eprefix',
]);

/** Whether a normalised URL uses the default port for its scheme, so `:80`/`:443` is dropped. */
function isDefaultPort(protocol: string, port: string): boolean {
  if (port === '') {
    return true;
  }
  return (protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443');
}

/**
 * A conservative identity for the underlying source a record came from (ADR-025 §1 rule 1).
 *
 * Two records merge only when a full canonical URI can be parsed and normalised to the same string:
 * scheme and host lower-cased, default port and a leading `www.` dropped, fragment and tracking query
 * parameters removed, remaining query parameters sorted, and a trailing path slash stripped. The path
 * itself keeps its case. If the canonical URI is missing or unparseable the identity falls back to the
 * record's own `sourceId`, so nothing is merged on a guess. Pure and deterministic: it never reaches the
 * network and cannot vary by locale.
 */
export function underlyingSourceIdentity(input: {
  readonly sourceId: string;
  readonly canonicalUri?: string | null;
}): string {
  const raw = (input.canonicalUri ?? '').trim();
  if (raw === '') {
    return `id:${input.sourceId}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `id:${input.sourceId}`;
  }
  const protocol = url.protocol.toLowerCase();
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }
  const hostPart = isDefaultPort(protocol, url.port) ? host : `${host}:${url.port}`;
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '');
  }
  const kept: string[] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (/^utm_/i.test(key) || TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
      continue;
    }
    kept.push(`${key}=${value}`);
  }
  kept.sort();
  const query = kept.length === 0 ? '' : `?${kept.join('&')}`;
  return `uri:${protocol}//${hostPart}${pathname}${query}`;
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
  // v1 counts every distinct supporting sourceId. v2 counts corroboration by underlying source: it
  // groups supporting records that share a canonical URI (or fall back to their own source id), and
  // never lets a record marked RELATED add a source. `allSupportingSources` stays source-id based so the
  // v1 figure, the duplicate disclosure and the v1-vs-v2 divergence can all name what a v1 report showed.
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
        independentSupportingSources.add(
          isV2 ? underlyingSourceIdentity(relationship) : relationship.sourceId,
        );
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
        )} a previous rule would count becomes ${plural(
          independentSupportingSources.size,
          'independent source',
        )} once related or syndicated records and copies that share one underlying source (the same canonical URI) are collapsed.`,
      );
    }
    if (isV2 && independentSupportingSources.size === 0 && allSupportingSources.size > 0) {
      notes.push(
        'No independent corroboration is recorded: every supporting source was related, syndicated, or a copy of one underlying source, so the support rests on material the reviewer does not treat as independent.',
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
