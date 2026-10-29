import {
  deriveEvidenceStatus,
  resolvePropositionConclusion,
  type EvidenceRelationshipRecord,
  type RecordedPropositionAssessment,
} from '../core/evidence.ts';
import {
  computeRunMetrics,
  type ObservationAssessmentInput,
  type ObservationInput,
  type RunMetricsInput,
} from '../core/metrics.ts';
import { EVIDENCE_RULE_VERSION, METHODOLOGY_VERSION, METRICS_VERSION } from '../core/versions.ts';
import type {
  AttributionLabel,
  CitationSupportLabel,
  FidelityLabel,
  PresenceLabel,
} from '../core/vocabulary.ts';
import {
  REPORT_SCHEMA_VERSION,
  REPORT_TEMPLATE_VERSION,
  type MetricDelta,
  type ReportBuildInput,
  type ReportClaimInput,
  type ReportClaimView,
  type ReportObservationAssessmentInput,
  type ReportObservationInput,
  type ReportObservationView,
  type ReportPropositionInput,
  type ReportPropositionView,
  type ReportQuerySetInput,
  type ReportQuerySetView,
  type ReportRunInput,
  type ReportRunView,
  type ReportSnapshot,
  type RunComparison,
  type RemediationSuggestion,
} from './types.ts';

function activeRelationship(
  row: ReportPropositionInput['evidence'][number],
): EvidenceRelationshipRecord | null {
  if (row.relationship.supersededBy !== null) {
    return null;
  }
  return {
    id: row.relationship.id,
    relation: row.relationship.relation,
    sourceId: row.source.id,
    sourceType: row.source.sourceType,
    independence: row.source.independence,
  };
}

function buildProposition(row: ReportPropositionInput): ReportPropositionView {
  const evidence = [...row.evidence].sort(
    (left, right) =>
      (left.relationship.supersededBy === null ? 0 : 1) -
        (right.relationship.supersededBy === null ? 0 : 1) ||
      left.relationship.createdAt.localeCompare(right.relationship.createdAt) ||
      left.relationship.id.localeCompare(right.relationship.id),
  );
  const active = evidence
    .map(activeRelationship)
    .filter((relationship): relationship is EvidenceRelationshipRecord => relationship !== null);
  const derivedStatus = deriveEvidenceStatus(active);
  const assessments: RecordedPropositionAssessment[] = row.assessments.map((assessment) => ({
    id: assessment.id,
    version: assessment.version,
    label: assessment.label,
    rationale: assessment.rationale,
    method: assessment.method,
    reviewer: assessment.reviewer,
    createdAt: assessment.createdAt,
  }));
  const conclusion = resolvePropositionConclusion(derivedStatus, assessments);
  return {
    id: row.id,
    ordinal: row.ordinal,
    text: row.text,
    evidenceRequirements: row.evidenceRequirements,
    expectedAnswerCriterion: row.expectedAnswerCriterion,
    ambiguityNotes: row.ambiguityNotes,
    derivedStatus,
    humanAssessment:
      conclusion.humanAssessment === null
        ? null
        : {
            id: conclusion.humanAssessment.id,
            version: conclusion.humanAssessment.version,
            label: conclusion.humanAssessment.label,
            rationale: conclusion.humanAssessment.rationale,
            method: conclusion.humanAssessment.method,
            reviewer: conclusion.humanAssessment.reviewer,
            createdAt: conclusion.humanAssessment.createdAt,
          },
    primaryConclusion: conclusion.primary,
    disagreement: conclusion.disagreement,
    evidence: evidence.map((item) => ({
      relationship: item.relationship,
      evidence: item.evidence,
      source: item.source,
      active: item.relationship.supersededBy === null,
    })),
    assessmentHistory: row.assessments,
  };
}

function buildClaim(claim: ReportClaimInput): ReportClaimView {
  return {
    id: claim.claim.id,
    status: claim.claim.status,
    createdAt: claim.claim.createdAt,
    updatedAt: claim.claim.updatedAt,
    currentRevision: claim.currentRevision,
    revisions: [...claim.revisions].sort(
      (left, right) =>
        left.revisionNumber - right.revisionNumber || left.id.localeCompare(right.id),
    ),
    propositions: [...claim.propositions]
      .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
      .map(buildProposition),
  };
}

function toCoreAssessments(
  assessments: readonly ReportObservationAssessmentInput[],
): ObservationAssessmentInput[] {
  return assessments.map((assessment) => {
    switch (assessment.dimension) {
      case 'PRESENCE':
        return {
          dimension: 'PRESENCE',
          version: assessment.version,
          label: assessment.label as PresenceLabel,
        };
      case 'FIDELITY':
        return {
          dimension: 'FIDELITY',
          version: assessment.version,
          label: assessment.label as FidelityLabel,
        };
      case 'CITATION_SUPPORT':
        return {
          dimension: 'CITATION_SUPPORT',
          version: assessment.version,
          label: assessment.label as CitationSupportLabel,
        };
      case 'ATTRIBUTION':
        return {
          dimension: 'ATTRIBUTION',
          version: assessment.version,
          label: assessment.label as AttributionLabel,
        };
      default:
        throw new Error(`Unsupported assessment dimension: ${assessment.dimension}`);
    }
  });
}

function toCoreObservations(observations: readonly ReportObservationInput[]): ObservationInput[] {
  return observations.map((observation) => ({
    id: observation.id,
    queryId: observation.queryId,
    status: observation.status,
    voided: observation.voidedAt !== null,
    citationCapture: observation.citationCapture,
    citations: observation.citations.map((citation) => ({
      id: citation.id,
      targetOwned: citation.targetOwned,
      voided: citation.voidedAt !== null,
    })),
    assessments: toCoreAssessments(observation.assessments),
  }));
}

function buildRunView(runInput: ReportRunInput, querySet: ReportQuerySetInput): ReportRunView {
  const metricsInput: RunMetricsInput = {
    runStatus: runInput.run.status,
    queries: querySet.queries.map((query) => ({ id: query.id, intent: query.intent })),
    observations: toCoreObservations(runInput.observations),
  };
  const metrics = computeRunMetrics(metricsInput);
  const observations: ReportObservationView[] = [...runInput.observations]
    .sort(
      (left, right) =>
        left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id),
    )
    .map((observation) => ({
      ...observation,
      statusEligibility:
        observation.voidedAt === null && observation.status === 'COMPLETED'
          ? 'ELIGIBLE'
          : 'EXCLUDED',
    }));
  return {
    id: runInput.run.id,
    name: runInput.run.name,
    status: runInput.run.status,
    querySetId: runInput.run.querySetId,
    querySetName: querySet.name,
    querySetVersion: querySet.version,
    providerLabel: runInput.run.providerLabel,
    modelLabel: runInput.run.modelLabel,
    interfaceLabel: runInput.run.interfaceLabel,
    groundingMode: runInput.run.groundingMode,
    locale: runInput.run.locale,
    region: runInput.run.region,
    captureFrom: runInput.run.captureFrom,
    captureTo: runInput.run.captureTo,
    conditions: runInput.run.conditions,
    notes: runInput.run.notes,
    createdBy: runInput.run.createdBy,
    createdAt: runInput.run.createdAt,
    finalizedAt: runInput.run.finalizedAt,
    observations,
    metrics,
  };
}

function sameConfiguration(left: ReportRunView, right: ReportRunView): boolean {
  return (
    left.querySetId === right.querySetId &&
    left.providerLabel === right.providerLabel &&
    left.modelLabel === right.modelLabel &&
    left.interfaceLabel === right.interfaceLabel &&
    left.groundingMode === right.groundingMode &&
    left.locale === right.locale &&
    left.region === right.region
  );
}

const COMPARABLE_METRICS = [
  'mentionRate',
  'targetSourceCitationRate',
  'anySourceCitationRate',
  'citationSupportRate',
  'claimFidelityRate',
  'attributionCorrectnessRate',
  'observedAnswerCoverage',
] as const;

function deltas(current: ReportRunView, prior: ReportRunView): MetricDelta[] {
  return COMPARABLE_METRICS.map((key) => {
    const currentMetric = current.metrics[key];
    const priorMetric = prior.metrics[key];
    return {
      metricId: currentMetric.id,
      label: currentMetric.label,
      unit: currentMetric.unit,
      current: currentMetric.value,
      prior: priorMetric.value,
      delta:
        currentMetric.value === null || priorMetric.value === null
          ? null
          : currentMetric.value - priorMetric.value,
    };
  });
}

function buildComparisons(runs: readonly ReportRunView[]): RunComparison[] {
  return runs.map((run) => {
    const candidates = runs.filter(
      (candidate) =>
        candidate.id !== run.id &&
        candidate.querySetId === run.querySetId &&
        (candidate.createdAt.localeCompare(run.createdAt) < 0 ||
          (candidate.createdAt === run.createdAt && candidate.id.localeCompare(run.id) < 0)),
    );
    if (candidates.length === 0) {
      return {
        runId: run.id,
        priorRunId: null,
        comparable: false,
        reasons: ['No earlier finalized run with the same query set is available.'],
        metricDeltas: [],
      };
    }
    const compatible = candidates
      .filter((candidate) => sameConfiguration(candidate, run))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (compatible.length === 0) {
      return {
        runId: run.id,
        priorRunId: null,
        comparable: false,
        reasons: [
          'An earlier run used this query set, but its provider, model, interface, grounding, locale, or region differs. The runs are not directly comparable.',
        ],
        metricDeltas: [],
      };
    }
    const prior = compatible[compatible.length - 1] as ReportRunView;
    return {
      runId: run.id,
      priorRunId: prior.id,
      comparable: true,
      reasons: [
        'Same query-set version and declared configuration. Deltas are descriptive associations, not causal effects.',
      ],
      metricDeltas: deltas(run, prior),
    };
  });
}

function addSuggestion(
  suggestions: RemediationSuggestion[],
  input: {
    id: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    action: string;
    rationale: string;
    relatedType: string;
    relatedId: string;
  },
): void {
  if (!suggestions.some((suggestion) => suggestion.id === input.id)) {
    suggestions.push(input);
  }
}

function buildRemediation(
  input: ReportBuildInput,
  claims: readonly ReportClaimView[],
  runs: readonly ReportRunView[],
): RemediationSuggestion[] {
  const suggestions: RemediationSuggestion[] = [];
  if (claims.length === 0) {
    addSuggestion(suggestions, {
      id: 'claims.none',
      priority: 'HIGH',
      action: 'Record at least one claim and decompose it into atomic propositions.',
      rationale: 'The report has no claims, so no evidence conclusion can be reviewed.',
      relatedType: 'project',
      relatedId: input.project.id,
    });
  }
  for (const claim of claims) {
    if (claim.propositions.length === 0) {
      addSuggestion(suggestions, {
        id: `claim.${claim.id}.no-propositions`,
        priority: 'HIGH',
        action: 'Add atomic propositions to the current claim revision.',
        rationale: 'A claim without propositions cannot be assessed at proposition level.',
        relatedType: 'claim',
        relatedId: claim.id,
      });
    }
    for (const proposition of claim.propositions) {
      if (proposition.primaryConclusion.status === 'NOT_ASSESSED') {
        addSuggestion(suggestions, {
          id: `proposition.${proposition.id}.unassessed`,
          priority: 'MEDIUM',
          action:
            'Record evidence relationships or an explicit human assessment for this proposition.',
          rationale: proposition.derivedStatus.rationale,
          relatedType: 'proposition',
          relatedId: proposition.id,
        });
      } else if (proposition.primaryConclusion.status === 'INSUFFICIENT_EVIDENCE') {
        addSuggestion(suggestions, {
          id: `proposition.${proposition.id}.insufficient`,
          priority: 'MEDIUM',
          action:
            'Record additional directly relevant evidence or state why the proposition cannot be assessed.',
          rationale: proposition.derivedStatus.rationale,
          relatedType: 'proposition',
          relatedId: proposition.id,
        });
      } else if (proposition.derivedStatus.status === 'CONFLICTING_EVIDENCE') {
        addSuggestion(suggestions, {
          id: `proposition.${proposition.id}.conflict`,
          priority: 'HIGH',
          action: 'Resolve or explicitly adjudicate the conflicting evidence with a rationale.',
          rationale: 'Supporting and contradictory records coexist and remain unresolved.',
          relatedType: 'proposition',
          relatedId: proposition.id,
        });
      }
      if (proposition.disagreement) {
        addSuggestion(suggestions, {
          id: `proposition.${proposition.id}.disagreement`,
          priority: 'MEDIUM',
          action: 'Review the recorded human conclusion against the deterministic evidence rule.',
          rationale:
            'The human conclusion and the evidence-rule output disagree; both are retained in this report.',
          relatedType: 'proposition',
          relatedId: proposition.id,
        });
      }
    }
  }
  if (runs.length === 0) {
    addSuggestion(suggestions, {
      id: 'runs.none',
      priority: 'HIGH',
      action: 'Capture and finalize at least one manual AI-answer observation run.',
      rationale:
        'No finalized run exists, so answer presence, fidelity, citation, and attribution metrics are unavailable.',
      relatedType: 'project',
      relatedId: input.project.id,
    });
  }
  for (const run of runs) {
    if (run.metrics.coverage.untestedQueries > 0) {
      addSuggestion(suggestions, {
        id: `run.${run.id}.untested-queries`,
        priority: 'MEDIUM',
        action: 'Record observations for query intents that were not tested.',
        rationale: `${run.metrics.coverage.untestedQueries} query intent(s) have no eligible completed observation.`,
        relatedType: 'run',
        relatedId: run.id,
      });
    }
    const emptyDimensions = [
      run.metrics.mentionRate,
      run.metrics.claimFidelityRate,
      run.metrics.attributionCorrectnessRate,
      run.metrics.citationSupportRate,
    ].filter((metric) => metric.value === null);
    if (emptyDimensions.length > 0) {
      addSuggestion(suggestions, {
        id: `run.${run.id}.unassessed-dimensions`,
        priority: 'MEDIUM',
        action: 'Complete the missing observation assessments for this finalized run.',
        rationale: `No eligible units exist for: ${emptyDimensions.map((metric) => metric.label).join(', ')}. Unassessed dimensions remain unknown, not zero.`,
        relatedType: 'run',
        relatedId: run.id,
      });
    }
  }
  for (const audit of input.websiteAudits) {
    for (const finding of audit.findings) {
      if (finding.severity === 'BLOCKING') {
        addSuggestion(suggestions, {
          id: `audit.${audit.id}.${finding.code}.blocking`,
          priority: 'HIGH',
          action: finding.recommendation,
          rationale: finding.observation,
          relatedType: 'website_audit',
          relatedId: audit.id,
        });
      } else if (finding.severity === 'LIKELY_DISCOVERABILITY_ISSUE') {
        addSuggestion(suggestions, {
          id: `audit.${audit.id}.${finding.code}.likely`,
          priority: 'MEDIUM',
          action: finding.recommendation,
          rationale: finding.observation,
          relatedType: 'website_audit',
          relatedId: audit.id,
        });
      }
    }
  }
  if (input.websiteAudits.length === 0) {
    addSuggestion(suggestions, {
      id: 'audits.none',
      priority: 'LOW',
      action: 'Optionally audit the target page HTML supplied by the operator.',
      rationale:
        'No local HTML audit is included; technical discoverability checks are unavailable in this report.',
      relatedType: 'project',
      relatedId: input.project.id,
    });
  }
  const independent = input.claims.some((claim) =>
    claim.propositions.some((proposition) =>
      proposition.evidence.some(
        (row) =>
          row.source.independence === 'INDEPENDENT' && row.relationship.supersededBy === null,
      ),
    ),
  );
  if (input.claims.length > 0 && !independent) {
    addSuggestion(suggestions, {
      id: 'evidence.independent-corroboration',
      priority: 'MEDIUM',
      action: 'Record any genuinely independent source that directly supports a proposition.',
      rationale:
        'No active evidence relationship is currently marked as independent. Do not manufacture corroboration; mark independence accurately.',
      relatedType: 'project',
      relatedId: input.project.id,
    });
  }
  return suggestions.slice(0, 40);
}

function buildLimitations(
  input: ReportBuildInput,
  claims: readonly ReportClaimView[],
  runs: readonly ReportRunView[],
): string[] {
  const limitations: string[] = [
    'All AI answers in this report were manually captured by the local operator. Aporia did not call any provider, search API, or external service.',
    'Provider and model labels are operator-supplied. They were not verified against a provider interface.',
    'Evidence classifications are human-recorded judgments. The derived proposition status is a transparent rule over those records, not an AI judgment and not independent verification of the sources or the claim.',
    'Source independence and source type are reviewer-recorded labels, not properties Aporia verified. “Recorded as independent” does not mean a source or its credibility was checked.',
    'Metrics describe the captured sample and recorded conditions. They are not universal probabilities, provider rankings, or model-quality claims.',
    'No composite score is calculated. Evidence support, discoverability, answer presence, fidelity, citation support, attribution, and coverage remain separate.',
    'Aporia cannot guarantee indexing, caching, model memory, recommendations, or future citations.',
    'No confidence intervals are reported. Samples may be small and purposively selected; repeated responses to a query can be correlated.',
    'Reports may contain sensitive claims, answers, and evidence supplied by the operator. Review before sharing.',
  ];
  if (runs.length === 0) {
    limitations.push(
      'No finalized manual evaluation run is available; AI answer metrics are unavailable.',
    );
  }
  if (input.websiteAudits.length === 0) {
    limitations.push(
      'No website audit is included. Discoverability checks requiring network access remain unavailable.',
    );
  }
  if (input.websiteAudits.length > 0) {
    limitations.push(
      'Website audits inspected only the supplied HTML bytes. HTTP status, robots.txt, sitemaps, TLS, live link health, indexing, caching, rendered content, and provider citations were not tested.',
    );
  }
  if (
    claims.some((claim) =>
      claim.propositions.some((p) => p.primaryConclusion.status === 'NOT_ASSESSED'),
    )
  ) {
    limitations.push(
      'Some propositions remain unassessed; missing evidence was not treated as contradiction.',
    );
  }
  if (
    runs.some(
      (run) => (run.metrics.coverage.untestedIntents ?? run.metrics.coverage.untestedQueries) > 0,
    )
  ) {
    limitations.push(
      'Some query-intent groups have no eligible completed observation and were excluded from coverage denominators.',
    );
  }
  if (runs.some((run) => (run.metrics.coverage.partialAssessmentIntents ?? 0) > 0)) {
    limitations.push(
      'Some intent groups were partially assessed: at least one eligible observation had no presence assessment, and the group remains in the denominator because another eligible observation was assessed.',
    );
  }
  if (
    runs.some((run) =>
      [
        run.metrics.mentionRate,
        run.metrics.targetSourceCitationRate,
        run.metrics.citationSupportRate,
        run.metrics.claimFidelityRate,
        run.metrics.attributionCorrectnessRate,
      ].some((metric) => metric.value === null),
    )
  ) {
    limitations.push(
      'Some metric denominators are empty; those values are unknown and were not reported as zero.',
    );
  }
  if (
    runs.some((run) =>
      run.metrics.citationSupportRate.exclusions.some(
        (exclusion) => exclusion.reason === 'CITATION_METADATA_UNAVAILABLE',
      ),
    )
  ) {
    limitations.push(
      'Citation metrics exclude observations whose interface did not expose citation metadata.',
    );
  }
  return limitations;
}

export function buildReportSnapshot(input: ReportBuildInput): ReportSnapshot {
  const claims = [...input.claims].sort(
    (left, right) =>
      left.claim.createdAt.localeCompare(right.claim.createdAt) ||
      left.claim.id.localeCompare(right.claim.id),
  );
  const claimViews = claims.map(buildClaim);
  const querySetMap = new Map(input.querySets.map((set) => [set.id, set]));
  const finalizedRuns = input.runs
    .filter((run) => run.run.status === 'FINALIZED')
    .sort(
      (left, right) =>
        left.run.createdAt.localeCompare(right.run.createdAt) ||
        left.run.id.localeCompare(right.run.id),
    );
  const runViews: ReportRunView[] = [];
  for (const run of finalizedRuns) {
    const querySet = querySetMap.get(run.run.querySetId);
    if (querySet === undefined) {
      throw new Error(`Run ${run.run.id} references a query set missing from the report input.`);
    }
    runViews.push(buildRunView(run, querySet));
  }
  const querySetViews: ReportQuerySetView[] = [...input.querySets]
    .sort((left, right) => left.name.localeCompare(right.name) || left.version - right.version)
    .map((set) => ({
      ...set,
      runCount: input.runs.filter((run) => run.run.querySetId === set.id).length,
    }));
  const comparisons = buildComparisons(runViews);
  const coverage = {
    claims: claimViews.length,
    propositions: claimViews.reduce((sum, claim) => sum + claim.propositions.length, 0),
    sources: new Set(
      claimViews.flatMap((claim) =>
        claim.propositions.flatMap((proposition) =>
          proposition.evidence.map((row) => row.source.id),
        ),
      ),
    ).size,
    evidenceItems: new Set(
      claimViews.flatMap((claim) =>
        claim.propositions.flatMap((proposition) =>
          proposition.evidence.map((row) => row.evidence.id),
        ),
      ),
    ).size,
    evidenceRelationships: claimViews.reduce(
      (sum, claim) =>
        sum +
        claim.propositions.reduce((inner, proposition) => inner + proposition.evidence.length, 0),
      0,
    ),
    querySets: querySetViews.length,
    finalizedRuns: runViews.length,
    openRuns: input.runs.filter((run) => run.run.status === 'OPEN').length,
    cancelledRuns: input.runs.filter((run) => run.run.status === 'CANCELLED').length,
    observations: runViews.reduce((sum, run) => sum + run.observations.length, 0),
    websiteAudits: input.websiteAudits.length,
    unassessedPropositions: claimViews.reduce(
      (sum, claim) =>
        sum +
        claim.propositions.filter(
          (proposition) => proposition.primaryConclusion.status === 'NOT_ASSESSED',
        ).length,
      0,
    ),
    claimsWithoutPropositions: claimViews.filter((claim) => claim.propositions.length === 0).length,
    runConfigurationsWithoutMetrics: runViews.filter((run) =>
      [
        run.metrics.mentionRate,
        run.metrics.claimFidelityRate,
        run.metrics.attributionCorrectnessRate,
        run.metrics.citationSupportRate,
      ].every((metric) => metric.value === null),
    ).length,
  };
  const remediation = buildRemediation(input, claimViews, runViews);
  const limitations = buildLimitations(input, claimViews, runViews);
  const unavailableChecks = Array.from(
    new Map(
      input.websiteAudits
        .flatMap((audit) => audit.unavailableChecks)
        .map((check) => [check.code, check] as const),
    ).values(),
  );
  const websiteAuditVersions = Array.from(
    new Set(input.websiteAudits.map((audit) => audit.methodologyVersion)),
  ).sort();
  const querySetVersions = querySetViews.map((set) => `${set.name} v${set.version}`);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    templateVersion: REPORT_TEMPLATE_VERSION,
    report: {
      number: input.reportNumber,
      title: input.title,
      generatedAt: input.generatedAt,
      methodologyVersion: METHODOLOGY_VERSION,
      metricsVersion: METRICS_VERSION,
      evidenceRuleVersion: EVIDENCE_RULE_VERSION,
    },
    project: input.project,
    targetEntity: input.targetEntity,
    entities: input.entities,
    scope: {
      subject:
        input.targetEntity === null
          ? input.project.name
          : `${input.project.name} — ${input.targetEntity.canonicalName}`,
      authorization:
        'Local operator-supplied project. No external provider, search, browser, crawler, or publishing access was used.',
      exclusions: [
        'No provider or search integration was called; all answers were manually captured.',
        'No remote URL, robots.txt, sitemap, HTTP response, or index status was fetched.',
        'No independent source discovery, identity verification, or account-control check was performed.',
        'No public page was published or submitted to any provider.',
        'No causal effect is claimed for any observed change.',
      ],
    },
    methodology: {
      answerSource: 'Manual capture only (ADR-010); no provider integration is implemented.',
      evidenceAggregation:
        'evidence-aggregation-v1 precedence over human-recorded evidence relationships; explicit human conclusions are retained separately.',
      metricDefinitionsVersion: METRICS_VERSION,
      websiteAuditVersions,
      querySetVersions,
    },
    coverage,
    claims: claimViews,
    querySets: querySetViews,
    runs: runViews,
    comparisons,
    websiteAudits: input.websiteAudits,
    remediation,
    limitations,
    unavailableChecks,
    audit: input.audit,
  };
}
