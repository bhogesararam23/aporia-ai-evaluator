import type { DatabaseSync } from 'node:sqlite';
import { countAuditEvents, listAuditEvents } from '../persistence/audit.ts';
import { getClaimOrThrow, listClaims } from '../persistence/repositories/claims.ts';
import {
  listPropositionAssessments,
  listPropositionEvidence,
  listSources,
} from '../persistence/repositories/evidence.ts';
import { getProjectOrThrow } from '../persistence/repositories/projects.ts';
import { listQuerySets } from '../persistence/repositories/querySets.ts';
import {
  createReport,
  getReport,
  listReports,
  nextReportNumber,
} from '../persistence/repositories/reports.ts';
import { getRunOrThrow, listRuns } from '../persistence/repositories/runs.ts';
import { getWebsiteAudit, listWebsiteAudits } from '../persistence/repositories/websiteAudits.ts';
import type { WriteContext } from '../persistence/repositories/context.ts';
import { buildReportSnapshot } from '../reporting/snapshot.ts';
import type {
  ReportBuildInput,
  ReportClaimInput,
  ReportQuerySetInput,
  ReportRunInput,
  ReportSnapshot,
  ReportSourceInput,
  ReportUnavailableCheckInput,
  ReportWebsiteAuditInput,
  ReportWebsiteFindingInput,
} from '../reporting/types.ts';
import type { ReportRecord } from '../persistence/repositories/reports.ts';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapFindings(values: readonly unknown[]): ReportWebsiteFindingInput[] {
  return values.map((value) => {
    const finding = record(value);
    return {
      code: text(finding['code']),
      severity: text(finding['severity']),
      category: text(finding['category']),
      title: text(finding['title']),
      observation: text(finding['observation']),
      rationale: text(finding['rationale']),
      recommendation: text(finding['recommendation']),
      locator: text(finding['locator']),
    };
  });
}

function mapUnavailableChecks(values: readonly unknown[]): ReportUnavailableCheckInput[] {
  return values.map((value) => {
    const check = record(value);
    return {
      code: text(check['code']),
      label: text(check['label']),
      reason: text(check['reason']),
    };
  });
}

function mapSource(
  row: ReturnType<typeof listPropositionEvidence>[number]['source'],
): ReportSourceInput {
  return {
    id: row.id,
    title: row.title,
    canonicalUri: row.canonicalUri,
    publisher: row.publisher,
    author: row.author,
    sourceType: row.sourceType,
    independence: row.independence,
    retrievedAt: row.retrievedAt,
    publicationDate: row.publicationDate,
    language: row.language,
    notes: row.notes,
  };
}

function mapClaims(db: DatabaseSync, projectId: string): ReportClaimInput[] {
  return listClaims(db, projectId).map((summary) => {
    const detail = getClaimOrThrow(db, projectId, summary.id);
    return {
      claim: {
        id: detail.claim.id,
        status: detail.claim.status,
        currentRevisionId: detail.claim.currentRevisionId,
        createdAt: detail.claim.createdAt,
        updatedAt: detail.claim.updatedAt,
      },
      currentRevision:
        detail.currentRevision === null
          ? null
          : {
              id: detail.currentRevision.id,
              revisionNumber: detail.currentRevision.revisionNumber,
              text: detail.currentRevision.text,
              sourceUrl: detail.currentRevision.sourceUrl,
              intendedMeaning: detail.currentRevision.intendedMeaning,
              timeScope: detail.currentRevision.timeScope,
              locale: detail.currentRevision.locale,
              decompositionVersion: detail.currentRevision.decompositionVersion,
              createdAt: detail.currentRevision.createdAt,
              createdBy: detail.currentRevision.createdBy,
            },
      revisions: detail.revisions.map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        text: revision.text,
        sourceUrl: revision.sourceUrl,
        intendedMeaning: revision.intendedMeaning,
        timeScope: revision.timeScope,
        locale: revision.locale,
        decompositionVersion: revision.decompositionVersion,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      })),
      propositions: detail.propositions.map((proposition) => ({
        id: proposition.id,
        ordinal: proposition.ordinal,
        text: proposition.text,
        evidenceRequirements: proposition.evidenceRequirements,
        expectedAnswerCriterion: proposition.expectedAnswerCriterion,
        ambiguityNotes: proposition.ambiguityNotes,
        evidence: listPropositionEvidence(db, projectId, proposition.id).map((row) => ({
          relationship: {
            id: row.relationship.id,
            relation: row.relationship.relation,
            rationale: row.relationship.rationale,
            reviewer: row.relationship.reviewer,
            createdAt: row.relationship.createdAt,
            supersededBy: row.relationship.supersededBy,
            supersededAt: row.relationship.supersededAt,
          },
          evidence: {
            id: row.evidence.id,
            locator: row.evidence.locator,
            excerpt: row.evidence.excerpt,
            excerptDigest: row.evidence.excerptDigest,
            extractedAt: row.evidence.extractedAt,
          },
          source: mapSource(row.source),
        })),
        assessments: listPropositionAssessments(db, projectId, proposition.id).map(
          (assessment) => ({
            id: assessment.id,
            version: assessment.version,
            label: assessment.label,
            rationale: assessment.rationale,
            method: assessment.method,
            reviewer: assessment.reviewer,
            evidenceSnapshot: assessment.evidenceSnapshot,
            createdAt: assessment.createdAt,
          }),
        ),
      })),
    };
  });
}

function mapQuerySets(db: DatabaseSync, projectId: string): ReportQuerySetInput[] {
  return listQuerySets(db, projectId).map((detail) => ({
    id: detail.set.id,
    name: detail.set.name,
    version: detail.set.version,
    status: detail.set.status,
    description: detail.set.description,
    locale: detail.set.locale,
    approvedBy: detail.set.approvedBy,
    approvedAt: detail.set.approvedAt,
    queries: detail.queries.map((query) => ({
      id: query.id,
      ordinal: query.ordinal,
      text: query.text,
      intent: query.intent,
      locale: query.locale,
      region: query.region,
      branded: query.branded,
      expectedElements: query.expectedElements,
      inclusionRationale: query.inclusionRationale,
    })),
  }));
}

function mapRuns(db: DatabaseSync, projectId: string): ReportRunInput[] {
  return listRuns(db, projectId).map((summary) => {
    const detail = getRunOrThrow(db, projectId, summary.id);
    return {
      run: {
        id: detail.run.id,
        querySetId: detail.run.querySetId,
        name: detail.run.name,
        status: detail.run.status,
        providerLabel: detail.run.providerLabel,
        modelLabel: detail.run.modelLabel,
        interfaceLabel: detail.run.interfaceLabel,
        groundingMode: detail.run.groundingMode,
        locale: detail.run.locale,
        region: detail.run.region,
        captureFrom: detail.run.captureFrom,
        captureTo: detail.run.captureTo,
        conditions: detail.run.conditions,
        notes: detail.run.notes,
        createdBy: detail.run.createdBy,
        createdAt: detail.run.createdAt,
        finalizedAt: detail.run.finalizedAt,
        cancelledAt: detail.run.cancelledAt,
        cancelReason: detail.run.cancelReason,
      },
      observations: detail.observations.map((observation) => ({
        id: observation.id,
        queryId: observation.queryId,
        queryOrdinal: observation.queryOrdinal,
        queryTextSnapshot: observation.queryTextSnapshot,
        queryIntentSnapshot: observation.queryIntentSnapshot,
        status: observation.status,
        capturedAt: observation.capturedAt,
        answerText: observation.answerText,
        errorNote: observation.errorNote,
        citationCapture: observation.citationCapture,
        contextNotes: observation.contextNotes,
        voidedAt: observation.voidedAt,
        voidReason: observation.voidReason,
        citations: observation.citations.map((citation) => ({
          id: citation.id,
          position: citation.position,
          url: citation.url,
          title: citation.title,
          snippet: citation.snippet,
          targetOwned: citation.targetOwned,
          voidedAt: citation.voidedAt,
          voidReason: citation.voidReason,
        })),
        assessments: observation.assessments.map((assessment) => ({
          id: assessment.id,
          dimension: assessment.dimension,
          version: assessment.version,
          label: assessment.label,
          rationale: assessment.rationale,
          reviewer: assessment.reviewer,
          attributionRole: assessment.attributionRole,
          createdAt: assessment.createdAt,
        })),
      })),
    };
  });
}

function mapAudits(db: DatabaseSync, projectId: string): ReportWebsiteAuditInput[] {
  const audits: ReportWebsiteAuditInput[] = [];
  for (const summary of listWebsiteAudits(db, projectId)) {
    const audit = getWebsiteAudit(db, projectId, summary.id);
    if (audit !== null) {
      audits.push({
        id: audit.id,
        label: audit.label,
        inputMethod: audit.inputMethod,
        inputFilename: audit.inputFilename,
        contentHash: audit.contentHash,
        byteLength: audit.byteLength,
        auditedAt: audit.auditedAt,
        methodologyVersion: audit.methodologyVersion,
        findings: mapFindings(audit.findings),
        unavailableChecks: mapUnavailableChecks(audit.unavailableChecks),
        metadata: audit.metadata,
      });
    }
  }
  return audits;
}

function buildSource(
  db: DatabaseSync,
  projectId: string,
  reportNumber: number,
  title: string,
  generatedAt: string,
): ReportBuildInput {
  const detail = getProjectOrThrow(db, projectId);
  const auditEvents = listAuditEvents(db, projectId, { limit: 1 });
  return {
    reportNumber,
    title,
    generatedAt,
    project: {
      id: detail.project.id,
      name: detail.project.name,
      description: detail.project.description,
      primaryDomain: detail.project.primaryDomain,
      createdAt: detail.project.createdAt,
      updatedAt: detail.project.updatedAt,
    },
    targetEntity:
      detail.targetEntity === null
        ? null
        : {
            id: detail.targetEntity.id,
            type: detail.targetEntity.type,
            canonicalName: detail.targetEntity.canonicalName,
            alternateNames: detail.targetEntity.alternateNames,
            publicUrls: detail.targetEntity.publicUrls,
            identityStatus: detail.targetEntity.identityStatus,
            identityMethod: detail.targetEntity.identityMethod,
            identityScope: detail.targetEntity.identityScope,
            notes: detail.targetEntity.notes,
          },
    entities: detail.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      canonicalName: entity.canonicalName,
      alternateNames: entity.alternateNames,
      publicUrls: entity.publicUrls,
      identityStatus: entity.identityStatus,
      identityMethod: entity.identityMethod,
      identityScope: entity.identityScope,
      notes: entity.notes,
    })),
    claims: mapClaims(db, projectId),
    querySets: mapQuerySets(db, projectId),
    runs: mapRuns(db, projectId),
    websiteAudits: mapAudits(db, projectId),
    audit: {
      eventCount: countAuditEvents(db, projectId),
      lastEventAt: auditEvents[0]?.createdAt ?? null,
    },
  };
}

export interface GeneratedReport {
  readonly report: ReportRecord;
  readonly snapshot: ReportSnapshot;
}

export function generateReport(
  db: DatabaseSync,
  projectId: string,
  title: string | undefined,
  context: WriteContext,
): GeneratedReport {
  const detail = getProjectOrThrow(db, projectId);
  const reportNumber = nextReportNumber(db, projectId);
  const resolvedTitle =
    title ?? `${detail.project.name} evaluation report ${context.at.slice(0, 10)}`;
  const source = buildSource(db, projectId, reportNumber, resolvedTitle, context.at);
  const snapshot = buildReportSnapshot(source);
  const report = createReport(
    db,
    projectId,
    {
      reportNumber,
      title: resolvedTitle,
      generatedAt: context.at,
      snapshotVersion: snapshot.schemaVersion,
      methodologyVersion: snapshot.report.methodologyVersion,
      metricsVersion: snapshot.report.metricsVersion,
      evidenceRuleVersion: snapshot.report.evidenceRuleVersion,
      snapshot,
    },
    context,
  );
  return { report, snapshot };
}

export function exportProject(
  db: DatabaseSync,
  projectId: string,
  exportedAt: string,
): Record<string, unknown> {
  const detail = getProjectOrThrow(db, projectId);
  const reports = listReports(db, projectId).flatMap((summary) => {
    const report = getReport(db, projectId, summary.id);
    return report === null
      ? []
      : [
          {
            id: report.id,
            reportNumber: report.reportNumber,
            title: report.title,
            generatedAt: report.generatedAt,
            snapshotVersion: report.snapshotVersion,
            methodologyVersion: report.methodologyVersion,
            metricsVersion: report.metricsVersion,
            evidenceRuleVersion: report.evidenceRuleVersion,
            supersededByReportId: report.supersededByReportId,
            snapshot: report.snapshot,
          },
        ];
  });
  return {
    schemaVersion: 'project-export-v1',
    exportedAt,
    project: detail.project,
    targetEntity: detail.targetEntity,
    entities: detail.entities,
    sources: listSources(db, projectId),
    claims: mapClaims(db, projectId),
    querySets: mapQuerySets(db, projectId),
    runs: mapRuns(db, projectId),
    websiteAudits: listWebsiteAudits(db, projectId).flatMap((summary) => {
      const audit = getWebsiteAudit(db, projectId, summary.id);
      return audit === null ? [] : [audit];
    }),
    reports,
    auditEvents: listAuditEvents(db, projectId, { limit: 500 }),
    auditEventCount: countAuditEvents(db, projectId),
  };
}
