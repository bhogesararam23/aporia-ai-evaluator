import { validateAchievementDraft, type AchievementDraftRaw } from '../../core/achievements.ts';
import { requiredText } from '../../core/validation.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../../persistence/audit.ts';
import { listClaims } from '../../persistence/repositories/claims.ts';
import {
  listProjectEvidence,
  listSources,
  type ProjectEvidenceSummary,
} from '../../persistence/repositories/evidence.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import {
  approveAchievement,
  createAchievement,
  createAchievementRevision,
  getAchievementOrThrow,
  listAchievements,
  type AchievementRecord,
  type AchievementRevisionRecord,
} from '../../persistence/repositories/achievements.ts';
import {
  renderAchievementHtml,
  renderAchievementJsonLd,
  type AchievementExportInput,
} from '../../reporting/achievement.ts';
import { downloadResponse, htmlResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RequestContext, type RouteDefinition } from '../http/types.ts';
import { emptyState, pageHeader, statusBadge, type Values } from '../views/components.ts';
import {
  achievementForm,
  achievementPreview,
  type AchievementFormClaim,
  type AchievementFormSource,
} from '../views/achievement.ts';
import { html } from '../views/html.ts';
import { layout, projectNav } from '../views/layout.ts';

function page(
  title: string,
  body: ReturnType<typeof achievementForm>,
  projectId: string,
  notice: string | null,
) {
  return layout({
    title,
    body,
    notice,
    navigation: projectNav({ projectId, current: 'achievements' }),
  });
}

function selection(
  context: RequestContext,
  prefix: 'claim_' | 'source_' | 'evidence_',
): Set<string> {
  return new Set(
    [...context.fields.entries()]
      .filter(([name, value]) => name.startsWith(prefix) && value === 'on')
      .map(([name]) => name.slice(prefix.length)),
  );
}

function rawDraft(context: RequestContext): AchievementDraftRaw {
  return {
    title: context.fields.get('title'),
    summary: context.fields.get('summary'),
    projectName: context.fields.get('projectName'),
    projectDescription: context.fields.get('projectDescription'),
    projectUrl: context.fields.get('projectUrl'),
    startDate: context.fields.get('startDate'),
    endDate: context.fields.get('endDate'),
    claimIds: [...selection(context, 'claim_')],
    contributorLines: context.fields.get('contributorLines'),
    sourceIds: [...selection(context, 'source_')],
    evidenceIds: [...selection(context, 'evidence_')],
  };
}

interface FormData {
  readonly claims: readonly AchievementFormClaim[];
  readonly sources: readonly AchievementFormSource[];
}

function formData(context: RequestContext, projectId: string): FormData {
  const claims = listClaims(context.deps.db, projectId)
    .filter((claim) => claim.currentText !== null)
    .map((claim) => ({ id: claim.id, text: claim.currentText ?? '' }));
  const evidence = listProjectEvidence(context.deps.db, projectId);
  const sources = listSources(context.deps.db, projectId).map((source) => ({
    id: source.id,
    title: source.title,
    url: source.canonicalUri,
    evidence: evidence
      .filter((item: ProjectEvidenceSummary) => item.sourceId === source.id)
      .map((item) => ({ id: item.id, locator: item.locator, digest: item.excerptDigest })),
  }));
  return { claims, sources };
}

function selectedFromRevision(revision: AchievementRevisionRecord | null): {
  claims: Set<string>;
  sources: Set<string>;
  evidence: Set<string>;
} {
  return {
    claims: new Set(
      (revision?.claims ?? [])
        .map((claim) => claim.claimId)
        .filter((id): id is string => id !== null),
    ),
    sources: new Set((revision?.evidence ?? []).map((item) => item.sourceId)),
    evidence: new Set(
      (revision?.evidence ?? [])
        .map((item) => item.evidenceId)
        .filter((id): id is string => id !== null),
    ),
  };
}

function renderFormPage(
  context: RequestContext,
  projectId: string,
  options: {
    readonly action: string;
    readonly submitLabel: string;
    readonly current: AchievementRevisionRecord | null;
    readonly issues: readonly ValidationIssue[];
    readonly values: Values;
    readonly selected?: {
      claims: Set<string>;
      sources: Set<string>;
      evidence: Set<string>;
    };
    readonly status?: number;
  },
) {
  const project = getProjectOrThrow(context.deps.db, projectId);
  const data = formData(context, projectId);
  const selected =
    options.selected ??
    (options.values.size > 0
      ? {
          claims: selection(context, 'claim_'),
          sources: selection(context, 'source_'),
          evidence: selection(context, 'evidence_'),
        }
      : selectedFromRevision(options.current));
  const body = html`
    ${pageHeader(
      options.current === null ? 'New achievement record' : 'New achievement revision',
      'A local, structured record of claims, contributors, dates and supplied evidence. Approval is a separate step; nothing is published.',
    )}
    ${achievementForm({
      action: options.action,
      csrfToken: context.csrfToken,
      projectId,
      issues: options.issues,
      values: options.values,
      defaults: {
        projectName: project.project.name,
        projectDescription: project.project.description ?? '',
        projectUrl: project.project.primaryDomain ?? '',
      },
      current: options.current,
      claims: data.claims,
      sources: data.sources,
      selectedClaims: selected.claims,
      selectedSources: selected.sources,
      selectedEvidence: selected.evidence,
      submitLabel: options.submitLabel,
    })}
  `;
  return htmlResponse(
    page(options.current === null ? 'New achievement' : 'New revision', body, projectId, null),
    options.status ?? 200,
  );
}

function renderPreview(
  context: RequestContext,
  projectId: string,
  achievement: AchievementRecord,
  revision: AchievementRevisionRecord,
  approvalIssues: readonly ValidationIssue[] = [],
  approvalValues: Values = new Map(),
  status = 200,
) {
  const body = achievementPreview({
    projectId,
    achievement,
    revision,
    csrfToken: context.csrfToken,
    approvalIssues,
    approvalValues,
  });
  return htmlResponse(
    page(revision.title, body, projectId, context.url.searchParams.get('notice')),
    status,
  );
}

function firstIssue(error: unknown, field: string): ValidationIssue[] {
  if (error instanceof AppError) {
    return [{ field, message: error.message }];
  }
  throw error;
}

function exportInput(
  revision: AchievementRevisionRecord,
  achievement: AchievementRecord,
): AchievementExportInput {
  if (revision.approval === null) {
    throw new AppError('CONFLICT', 'Approve the current revision before exporting.');
  }
  if (achievement.currentRevisionId !== revision.id) {
    throw new AppError('CONFLICT', 'Only the current revision can be exported.');
  }
  return {
    title: revision.title,
    summary: revision.summary,
    projectName: revision.projectName,
    projectDescription: revision.projectDescription,
    projectUrl: revision.projectUrl,
    startDate: revision.startDate,
    endDate: revision.endDate,
    claims: revision.claims,
    contributors: revision.contributors,
    evidence: revision.evidence,
    unresolvedContradictions: revision.unresolvedContradictions,
    revisionNumber: revision.revisionNumber,
    contentHash: revision.contentHash,
    createdAt: revision.createdAt,
    approvedBy: revision.approval.approvedBy,
    approvedAt: revision.approval.approvedAt,
    approvalNote: revision.approval.note,
  };
}

function listPage(context: RequestContext, projectId: string) {
  const project = getProjectOrThrow(context.deps.db, projectId);
  const achievements = listAchievements(context.deps.db, projectId);
  const body = html`
    ${pageHeader(
      'Achievement records',
      'Local structured records linking claims, contributor roles, dates, project details and supplied evidence. Records are drafts until a revision is explicitly approved. Aporia does not publish.',
      html`<a class="button button-primary" href="/projects/${projectId}/achievements/new"
        >New achievement record</a
      >`,
    )}
    <div class="notice" role="status">
      An approved record can be downloaded as HTML and JSON-LD for a publication you control. The
      download is not a publication action.
    </div>
    ${
      achievements.length === 0
        ? emptyState(
            'No achievement records',
            'Create a record from real project claims and evidence. Nothing is seeded or fabricated.',
            html`<a class="button button-primary" href="/projects/${projectId}/achievements/new"
              >Create the first record</a
            >`,
          )
        : html`
            <div class="table-wrap">
              <table>
                <caption>
                  Achievement records in ${project.project.name}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Revision</th>
                    <th scope="col">Claims</th>
                    <th scope="col">Contributors</th>
                    <th scope="col">State</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  ${achievements.map(
                    (achievement) => html`
                      <tr>
                        <td>${achievement.currentTitle ?? 'No revision'}</td>
                        <td>${achievement.currentRevisionNumber ?? '—'}</td>
                        <td>${achievement.claimCount}</td>
                        <td>${achievement.contributorCount}</td>
                        <td>
                          ${
                            achievement.publicationReady
                              ? statusBadge('Approved for local publication', 'good')
                              : statusBadge('Draft', 'warn')
                          }
                        </td>
                        <td>
                          <a href="/projects/${projectId}/achievements/${achievement.id}"
                            >Preview</a
                          >
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          `
    }
  `;
  return htmlResponse(
    page('Achievements', body, projectId, context.url.searchParams.get('notice')),
  );
}

export const achievementRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/achievements',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      return listPage(context, projectId);
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/achievements/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      return renderFormPage(context, projectId, {
        action: `/projects/${projectId}/achievements`,
        submitLabel: 'Create draft achievement',
        current: null,
        issues: [],
        values: new Map(),
      });
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/achievements',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const raw = rawDraft(context);
      const validated = validateAchievementDraft(raw);
      if (!validated.ok) {
        return renderFormPage(context, projectId, {
          action: `/projects/${projectId}/achievements`,
          submitLabel: 'Create draft achievement',
          current: null,
          issues: validated.issues,
          values: context.fields,
          status: 422,
        });
      }
      try {
        const achievement = createAchievement(
          context.deps.db,
          projectId,
          validated.value,
          writeContext(context),
        );
        return redirectWithNotice(
          `/projects/${projectId}/achievements/${achievement.id}`,
          'achievement-created',
        );
      } catch (error) {
        return renderFormPage(context, projectId, {
          action: `/projects/${projectId}/achievements`,
          submitLabel: 'Create draft achievement',
          current: null,
          issues: firstIssue(error, 'form'),
          values: context.fields,
          status: 422,
        });
      }
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/achievements/:achievementId/revisions/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const achievementId = context.params['achievementId'] ?? '';
      const achievement = getAchievementOrThrow(context.deps.db, projectId, achievementId);
      return renderFormPage(context, projectId, {
        action: `/projects/${projectId}/achievements/${achievementId}/revisions`,
        submitLabel: 'Create revision',
        current: achievement.currentRevision,
        issues: [],
        values: new Map(),
      });
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/achievements/:achievementId/revisions',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const achievementId = context.params['achievementId'] ?? '';
      const achievement = getAchievementOrThrow(context.deps.db, projectId, achievementId);
      const raw = rawDraft(context);
      const validated = validateAchievementDraft(raw);
      if (!validated.ok) {
        return renderFormPage(context, projectId, {
          action: `/projects/${projectId}/achievements/${achievementId}/revisions`,
          submitLabel: 'Create revision',
          current: achievement.currentRevision,
          issues: validated.issues,
          values: context.fields,
          status: 422,
        });
      }
      try {
        createAchievementRevision(
          context.deps.db,
          projectId,
          achievementId,
          validated.value,
          writeContext(context),
        );
        return redirectWithNotice(
          `/projects/${projectId}/achievements/${achievementId}`,
          'achievement-revision-created',
        );
      } catch (error) {
        return renderFormPage(context, projectId, {
          action: `/projects/${projectId}/achievements/${achievementId}/revisions`,
          submitLabel: 'Create revision',
          current: achievement.currentRevision,
          issues: firstIssue(error, 'form'),
          values: context.fields,
          status: 422,
        });
      }
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/achievements/:achievementId/revisions/:revisionId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const achievementId = context.params['achievementId'] ?? '';
      const revisionId = context.params['revisionId'] ?? '';
      const achievement = getAchievementOrThrow(context.deps.db, projectId, achievementId);
      const revision = achievement.revisions.find((item) => item.id === revisionId);
      if (revision === undefined) {
        throw new AppError('NOT_FOUND', 'Achievement revision not found.');
      }
      return renderPreview(context, projectId, achievement, revision);
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/achievements/:achievementId/export.html',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const achievementId = context.params['achievementId'] ?? '';
      const achievement = getAchievementOrThrow(context.deps.db, projectId, achievementId);
      if (achievement.currentRevision === null) {
        throw new AppError('CONFLICT', 'The achievement has no current revision.');
      }
      const input = exportInput(achievement.currentRevision, achievement);
      const html = renderAchievementHtml(input);
      appendAuditEvent(context.deps.db, {
        projectId,
        actor: context.deps.config.operator,
        action: 'achievement.exported',
        entityType: 'achievement',
        entityId: achievementId,
        details: { format: 'html', revisionId: achievement.currentRevision.id },
        at: context.now,
      });
      return downloadResponse(
        html,
        'text/html; charset=utf-8',
        `aporia-achievement-${achievementId}-r${achievement.currentRevision.revisionNumber}.html`,
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/achievements/:achievementId/export.jsonld',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const achievementId = context.params['achievementId'] ?? '';
      const achievement = getAchievementOrThrow(context.deps.db, projectId, achievementId);
      if (achievement.currentRevision === null) {
        throw new AppError('CONFLICT', 'The achievement has no current revision.');
      }
      const input = exportInput(achievement.currentRevision, achievement);
      const jsonLd = renderAchievementJsonLd(input);
      appendAuditEvent(context.deps.db, {
        projectId,
        actor: context.deps.config.operator,
        action: 'achievement.exported',
        entityType: 'achievement',
        entityId: achievementId,
        details: { format: 'jsonld', revisionId: achievement.currentRevision.id },
        at: context.now,
      });
      return downloadResponse(
        jsonLd,
        'application/ld+json; charset=utf-8',
        `aporia-achievement-${achievementId}-r${achievement.currentRevision.revisionNumber}.jsonld`,
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/achievements/:achievementId/approve',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const achievementId = context.params['achievementId'] ?? '';
      const achievement = getAchievementOrThrow(context.deps.db, projectId, achievementId);
      const revision = achievement.currentRevision;
      if (revision === null) {
        throw new AppError('CONFLICT', 'The achievement has no current revision.');
      }
      const note = requiredText(context.fields.get('note'), 'note', {
        min: 3,
        max: 2000,
        multiline: true,
      });
      const confirmation = requiredText(context.fields.get('confirmation'), 'confirmation', {
        max: 200,
      });
      const issues: ValidationIssue[] = [
        ...(note.ok ? [] : note.issues),
        ...(confirmation.ok ? [] : confirmation.issues),
      ];
      if (!note.ok || !confirmation.ok) {
        return renderPreview(
          context,
          projectId,
          achievement,
          revision,
          issues,
          context.fields,
          422,
        );
      }
      try {
        approveAchievement(
          context.deps.db,
          projectId,
          achievementId,
          { confirmation: confirmation.value, note: note.value },
          writeContext(context),
        );
        return redirectWithNotice(
          `/projects/${projectId}/achievements/${achievementId}`,
          'achievement-approved',
        );
      } catch (error) {
        return renderPreview(
          context,
          projectId,
          achievement,
          revision,
          firstIssue(error, 'confirmation'),
          context.fields,
          422,
        );
      }
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/achievements/:achievementId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const achievementId = context.params['achievementId'] ?? '';
      const achievement = getAchievementOrThrow(context.deps.db, projectId, achievementId);
      if (achievement.currentRevision === null) {
        throw new AppError('NOT_FOUND', 'The achievement has no current revision.');
      }
      return renderPreview(context, projectId, achievement, achievement.currentRevision);
    },
  },
];
